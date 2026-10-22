// ─────────────────────────────────────────────────────────────────────────────
// E-Invoice library (server-side only — imports the Prisma client).
// Bilingual (EN/AR) ZATCA tax invoices, credit notes and debit notes:
//   • number generation  INV-YYYY-00001 | CRN-YYYY-00001 | DBN-YYYY-00001
//   • per-line + header money math (server is the single source of truth;
//     VAT per category = round(taxable × rate) as ZATCA BR-CO-17 requires)
//   • ZATCA validation before issuing (Phase 1 and Phase 2 rules)
//   • issuing: Phase 1 → 5-tag QR frozen on the document;
//              Phase 2 → signed UBL 2.1 XML + ICV/PIH chain + 8/9-tag QR
// Seller identity/bank details come from the Setting table.
// Frontend note: this module is SERVER-ONLY (db import) — client components
// must not import it; duplicate the tiny pure helpers client-side if needed.
// ─────────────────────────────────────────────────────────────────────────────
import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import QRCode from 'qrcode'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  tlvEncode,
  ZATCA_INITIAL_PIH,
  getZatcaSigner,
  readSellerInfo,
  readZatcaProfile,
  isValidKsaVat,
  type ZatcaSellerInfo,
} from '@/lib/zatca'
import { signUbl, unitCodeFor, type UblDocument, type UblTaxCategory } from '@/lib/zatca-ubl'

export { ZATCA_INITIAL_PIH }

// ── Document types & number generation ──────────────────────────────────────

export const DOC_PREFIX: Record<string, string> = {
  invoice: 'INV',
  credit_note: 'CRN',
  debit_note: 'DBN',
}

export type EInvoiceDocType = 'invoice' | 'credit_note' | 'debit_note'

/**
 * Next e-invoice number for a docType + issue year:
 * `{PREFIX}-{YYYY}-{00001}` — 5-digit sequence = max existing sequence for
 * that prefix+year + 1 (parsed from stored numbers LIKE 'PREFIX-YYYY-%').
 */
export async function nextEInvoiceNumber(
  docType: string,
  issueDate: Date,
  tx: Prisma.TransactionClient | PrismaClient = db
): Promise<string> {
  const prefix = DOC_PREFIX[docType] ?? DOC_PREFIX.invoice
  const year = issueDate.getFullYear()
  const stem = `${prefix}-${year}-`
  const existing = await tx.eInvoice.findMany({
    where: { invoiceNumber: { startsWith: stem } },
    select: { invoiceNumber: true },
  })
  let max = 0
  for (const row of existing) {
    const n = parseInt(row.invoiceNumber.slice(stem.length), 10)
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${stem}${String(max + 1).padStart(5, '0')}`
}

// ── Money math (server-computed, never trusts client figures) ───────────────

export type EInvoiceItemInput = {
  quantity: number
  unitPrice: number
  discount?: number | null
  vatPercent?: number | null
}

export type EInvoiceItemTotals = {
  taxableAmount: number
  vatAmount: number
  lineTotal: number
}

/** taxable = round2(qty × price − discount); vat = round2(taxable × vat%/100). */
export function computeItemTotals(item: EInvoiceItemInput): EInvoiceItemTotals {
  const quantity = round2(item.quantity)
  const unitPrice = round2(item.unitPrice)
  const discount = round2(item.discount ?? 0)
  const vatPercent = round2(item.vatPercent ?? 15)
  const taxableAmount = round2(quantity * unitPrice - discount)
  const vatAmount = round2((taxableAmount * vatPercent) / 100)
  return { taxableAmount, vatAmount, lineTotal: round2(taxableAmount + vatAmount) }
}

export type EInvoiceTotals = {
  subtotal: number
  totalDiscount: number
  taxableAmount: number
  vatAmount: number
  totalDue: number
}

/** Header totals from normalized items. VAT is computed per VAT category
 *  (taxable of the category × rate, rounded) — ZATCA rule BR-CO-17. */
export function computeInvoiceTotals(
  items: (EInvoiceItemInput & Partial<EInvoiceItemTotals> & { taxCategory?: string | null })[]
): EInvoiceTotals {
  let subtotal = 0
  let totalDiscount = 0
  const groups = new Map<string, { taxable: number; rate: number }>()
  for (const it of items) {
    subtotal = round2(subtotal + round2(round2(it.quantity) * round2(it.unitPrice)))
    totalDiscount = round2(totalDiscount + round2(it.discount ?? 0))
    const t = it.taxableAmount ?? computeItemTotals(it).taxableAmount
    const cat = it.taxCategory || ((it.vatPercent ?? 15) > 0 ? 'S' : 'Z')
    const rate = cat === 'S' ? round2(it.vatPercent ?? 15) : 0
    const key = `${cat}|${rate}`
    const g = groups.get(key) ?? { taxable: 0, rate }
    g.taxable = round2(g.taxable + t)
    groups.set(key, g)
  }
  let vatSum = 0
  for (const g of groups.values()) vatSum = round2(vatSum + round2((g.taxable * g.rate) / 100))
  const taxableAmount = round2(subtotal - totalDiscount)
  return {
    subtotal,
    totalDiscount,
    taxableAmount,
    vatAmount: vatSum,
    totalDue: round2(taxableAmount + vatSum),
  }
}

// ── Seller info (Settings) ──────────────────────────────────────────────────

export type ESellerInfo = ZatcaSellerInfo & {
  bankAccountNumber: string
  bankAccountName: string
  bankSwiftCode: string
  bankAddress: string
}

export async function readEInvoiceSellerInfo(): Promise<ESellerInfo> {
  const base = await readSellerInfo()
  const rows = await db.setting.findMany({
    where: { key: { in: ['bankAccountNumber', 'bankAccountName', 'bankSwiftCode', 'bankAddress'] } },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return {
    ...base,
    bankAccountNumber: map.bankAccountNumber || '',
    bankAccountName: map.bankAccountName || '',
    bankSwiftCode: map.bankSwiftCode || '',
    bankAddress: map.bankAddress || '',
  }
}

// ── KSA local date/time (UTC+3, no daylight saving) ────────────────────────

export function ksaDateTime(d: Date): { date: string; time: string } {
  const k = new Date(d.getTime() + 3 * 3_600_000)
  const iso = k.toISOString()
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) }
}

/** Calendar date stored for a date-only field (saved as UTC midnight). */
const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

// ── QR ──────────────────────────────────────────────────────────────────────

/**
 * Phase 1 QR (ZATCA "Generation" phase) — 5 TLV tags, 1-byte tag + 1-byte length:
 *   1 seller name · 2 seller VAT number · 3 timestamp (ISO 8601)
 *   4 invoice total incl. VAT · 5 VAT total
 */
export function buildPhase1QrPayload(
  seller: { companyName: string; companyNameAr: string; vatNumber: string },
  invoice: { issuedAt: Date | null; issueDate: Date; totalDue: number; vatAmount: number }
): string {
  const ts = (invoice.issuedAt ?? invoice.issueDate).toISOString().slice(0, 19) + 'Z'
  return tlvEncode([
    { tag: 1, value: seller.companyNameAr.trim() || seller.companyName },
    { tag: 2, value: seller.vatNumber },
    { tag: 3, value: ts },
    { tag: 4, value: round2(invoice.totalDue).toFixed(2) },
    { tag: 5, value: round2(invoice.vatAmount).toFixed(2) },
  ]).toString('base64')
}

/** Render a QR payload as a PNG data URL (pure black on white, quiet zone 4). */
export async function qrDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, {
    margin: 4,
    width: 600,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000', light: '#FFFFFF' },
  })
}

// ── ZATCA validation ────────────────────────────────────────────────────────

export type ZatcaIssue = { field: string; message: string }
export type ZatcaValidation = { errors: ZatcaIssue[]; warnings: ZatcaIssue[] }

type ValidatableItem = {
  sr: number
  descriptionEn: string
  vatPercent: number
  taxCategory: string
  exemptionCode: string | null
  exemptionReason: string | null
}

type ValidatableInvoice = {
  docType: string
  invoiceKind: string
  clientNameEn: string
  clientVatNumber: string | null
  clientCrNumber: string | null
  clientAddressEn: string | null
  buyerStreet: string | null
  buyerBuildingNo: string | null
  buyerDistrict: string | null
  buyerCity: string | null
  buyerPostalCode: string | null
  buyerCountry: string
  issueDate: Date
  supplyDate: Date | null
  relatedInvoiceId: string | null
  noteReason: string | null
}

/**
 * ZATCA checks run before a document is issued. Phase 1 covers the content a
 * tax invoice must show (VAT Implementing Regulations Art. 53); Phase 2 adds
 * the KSA business rules the Fatoora gateway enforces (BR-KSA-…).
 */
export function validateForZatca(
  inv: ValidatableInvoice,
  items: ValidatableItem[],
  seller: ZatcaSellerInfo,
  phase: 1 | 2
): ZatcaValidation {
  const errors: ZatcaIssue[] = []
  const warnings: ZatcaIssue[] = []
  const err = (field: string, message: string) => errors.push({ field, message })
  const warn = (field: string, message: string) => warnings.push({ field, message })
  const p2 = phase === 2
  const standard = inv.invoiceKind !== 'simplified'
  const isNote = inv.docType === 'credit_note' || inv.docType === 'debit_note'

  // Seller
  if (!isValidKsaVat(seller.vatNumber))
    err('seller.vat', 'Company VAT number must be 15 digits, starting and ending with 3 (Settings → Company & Tax)')
  if (!seller.companyName.trim()) err('seller.name', 'Company name is missing (Settings)')
  if (!seller.companyNameAr.trim()) warn('seller.nameAr', 'Company name in Arabic is missing — tax invoices must be readable in Arabic')
  const a = seller.national
  if (p2) {
    if (!seller.crNumber) err('seller.cr', 'Company CR number is required for Phase 2 (Settings → Company & Tax)')
    if (!a.street) err('seller.street', 'Company street name is missing (Settings → ZATCA → National address)')
    if (!/^\d{4}$/.test(a.buildingNo)) err('seller.building', 'Company building number must be 4 digits (Settings → ZATCA → National address)')
    if (!a.district) err('seller.district', 'Company district is missing (Settings → ZATCA → National address)')
    if (!a.city) err('seller.city', 'Company city is missing (Settings → ZATCA → National address)')
    if (!/^\d{5}$/.test(a.postalCode)) err('seller.postal', 'Company postal code must be 5 digits (Settings → ZATCA → National address)')
  } else if (!seller.address.trim() && !a.street) {
    err('seller.address', 'Company address is missing (Settings)')
  }

  // Buyer
  const vat = (inv.clientVatNumber ?? '').trim()
  if (vat && !isValidKsaVat(vat) && (inv.buyerCountry || 'SA') === 'SA')
    err('buyer.vat', 'Client VAT number must be 15 digits, starting and ending with 3')
  if (standard) {
    if (!inv.clientNameEn.trim()) err('buyer.name', 'Client name is required on a standard tax invoice')
    if (!vat) {
      if (p2 && !(inv.clientCrNumber ?? '').trim())
        err('buyer.id', 'Client has no VAT number — enter the client CR number instead (BR-KSA-14)')
      else warn('buyer.vat', 'Client VAT number is empty — only correct if the client is not VAT-registered')
    }
    if (p2 && (inv.buyerCountry || 'SA') === 'SA') {
      if (!inv.buyerStreet) err('buyer.street', 'Client street name is required (client national address)')
      if (!/^\d{4}$/.test(inv.buyerBuildingNo ?? '')) err('buyer.building', 'Client building number must be 4 digits')
      if (!inv.buyerDistrict) err('buyer.district', 'Client district is required')
      if (!inv.buyerCity) err('buyer.city', 'Client city is required')
      if (!/^\d{5}$/.test(inv.buyerPostalCode ?? '')) err('buyer.postal', 'Client postal code must be 5 digits')
    } else if (!p2 && !inv.clientAddressEn && !inv.buyerStreet) {
      err('buyer.address', 'Client address is required on a standard tax invoice')
    }
  }

  // Dates
  const today = ksaDateTime(new Date()).date
  const issue = dateOnly(inv.issueDate) ?? today
  if (issue > today) (p2 ? err : warn)('issueDate', 'Issue date is in the future — ZATCA does not accept future-dated invoices')
  if (standard && !inv.supplyDate)
    (p2 ? err : warn)('supplyDate', 'Supply date is required on a standard tax invoice (date the service was delivered)')

  // Notes
  if (isNote) {
    if (!inv.relatedInvoiceId) err('relatedInvoiceId', 'Select the original invoice this note corrects')
    if (!(inv.noteReason ?? '').trim()) err('noteReason', 'Enter the reason for the credit / debit note (required by ZATCA)')
  }

  // Lines
  if (items.length === 0) err('items', 'At least one line item is required')
  for (const it of items) {
    if (!it.descriptionEn.trim()) err(`items.${it.sr}`, `Line ${it.sr}: description is required`)
    if (it.taxCategory !== 'S') {
      if (p2 && !it.exemptionCode) err(`items.${it.sr}`, `Line ${it.sr}: choose the ZATCA exemption / zero-rating reason code`)
      if (!(it.exemptionReason ?? '').trim() && !it.exemptionCode)
        err(`items.${it.sr}`, `Line ${it.sr}: give the reason why no VAT is charged`)
    } else if (it.vatPercent <= 0) {
      err(`items.${it.sr}`, `Line ${it.sr}: a 0% line must be marked Zero-rated, Exempt or Out of scope`)
    }
  }
  return { errors, warnings }
}

// ── Phase 2 document assembly ───────────────────────────────────────────────

type IssuableItem = ValidatableItem & {
  descriptionAr: string
  unitEn: string | null
  quantity: number
  unitPrice: number
  discount: number
  taxableAmount: number
  vatAmount: number
}

type IssuableInvoice = ValidatableInvoice & {
  invoiceNumber: string
  dueDate: Date | null
  poRef: string | null
  contractRef: string | null
  paymentMeansCode: string
}

/** Build the UBL document model (amounts recomputed exactly as the XML states them). */
export function buildUblDocument(
  inv: IssuableInvoice,
  rawItems: IssuableItem[],
  seller: ESellerInfo,
  opts: { uuid: string; icv: number; pih: string; issuedAt: Date; billingReference: string | null }
): UblDocument {
  const items = [...rawItems].sort((x, y) => x.sr - y.sr)
  const groups = new Map<string, { category: UblTaxCategory; percent: number; taxable: number; exemptionCode: string | null; exemptionReason: string | null }>()
  const lines = items.map((it) => {
    const category = (['S', 'Z', 'E', 'O'].includes(it.taxCategory) ? it.taxCategory : 'S') as UblTaxCategory
    const percent = category === 'S' ? round2(it.vatPercent) : 0
    const lineExtension = round2(it.taxableAmount)
    const vatAmount = round2((lineExtension * percent) / 100)
    const key = `${category}|${percent}|${it.exemptionCode ?? ''}`
    const g = groups.get(key) ?? {
      category,
      percent,
      taxable: 0,
      exemptionCode: category === 'S' ? null : it.exemptionCode,
      exemptionReason: category === 'S' ? null : it.exemptionReason || it.exemptionCode,
    }
    g.taxable = round2(g.taxable + lineExtension)
    groups.set(key, g)
    const name = it.descriptionAr?.trim() ? `${it.descriptionEn.trim()} / ${it.descriptionAr.trim()}` : it.descriptionEn.trim()
    return {
      id: it.sr,
      name: name.slice(0, 1000),
      quantity: it.quantity,
      unitCode: unitCodeFor(it.unitEn),
      unitPrice: round2(it.unitPrice),
      discount: round2(it.discount),
      lineExtension,
      vatPercent: percent,
      vatAmount,
      taxCategory: category,
    }
  })
  const taxSubtotals = [...groups.values()]
    .sort((x, y) => x.category.localeCompare(y.category) || x.percent - y.percent)
    .map((g) => ({ ...g, vat: round2((g.taxable * g.percent) / 100) }))
  const lineExtensionTotal = round2(lines.reduce((s, l) => s + l.lineExtension, 0))
  const vatTotal = round2(taxSubtotals.reduce((s, g) => s + g.vat, 0))
  const { date: _d, time } = ksaDateTime(opts.issuedAt)
  return {
    docType: inv.docType === 'credit_note' ? 'credit_note' : inv.docType === 'debit_note' ? 'debit_note' : 'invoice',
    kind: inv.invoiceKind === 'simplified' ? 'simplified' : 'standard',
    number: inv.invoiceNumber,
    uuid: opts.uuid,
    issueDate: dateOnly(inv.issueDate)!,
    issueTime: time,
    supplyDate: dateOnly(inv.supplyDate),
    dueDate: dateOnly(inv.dueDate),
    currency: seller.currency || 'SAR',
    icv: opts.icv,
    pih: opts.pih,
    billingReference: opts.billingReference,
    noteReason: inv.noteReason?.trim() || null,
    paymentMeansCode: inv.paymentMeansCode || '30',
    iban: seller.bankIban || null,
    poRef: inv.poRef,
    contractRef: inv.contractRef,
    seller,
    buyer: {
      name: inv.clientNameEn.trim(),
      vatNumber: inv.clientVatNumber?.trim() || null,
      crNumber: inv.clientCrNumber?.trim() || null,
      street: inv.buyerStreet,
      buildingNo: inv.buyerBuildingNo,
      district: inv.buyerDistrict,
      city: inv.buyerCity,
      postalCode: inv.buyerPostalCode,
      country: inv.buyerCountry || 'SA',
    },
    lines,
    taxSubtotals,
    lineExtensionTotal,
    taxExclusiveTotal: lineExtensionTotal,
    vatTotal,
    taxInclusiveTotal: round2(lineExtensionTotal + vatTotal),
    payableAmount: round2(lineExtensionTotal + vatTotal),
  }
}

// ── Issuing ─────────────────────────────────────────────────────────────────

/** Serialises Phase 2 issuing so two documents never take the same ICV / PIH. */
let issueQueue: Promise<unknown> = Promise.resolve()
function serialised<T>(fn: () => Promise<T>): Promise<T> {
  const run = issueQueue.then(fn, fn)
  issueQueue = run.catch(() => undefined)
  return run
}

export class ZatcaValidationError extends Error {
  constructor(public validation: ZatcaValidation) {
    super(validation.errors.map((e) => e.message).join(' · '))
  }
}

/**
 * Issue a draft: validate, then freeze everything ZATCA needs.
 *   Phase 1 — totals, UUID and the 5-tag QR are frozen on the document.
 *   Phase 2 — UBL 2.1 XML signed with the EGS certificate, ICV/PIH chained,
 *             QR with the cryptographic stamp; the document then waits for
 *             clearance (standard) or reporting (simplified).
 */
export async function issueEInvoice(id: string, issuedByName: string) {
  return serialised(async () => {
    const inv = await db.eInvoice.findUnique({
      where: { id },
      include: { items: true, relatedInvoice: { select: { invoiceNumber: true, status: true } } },
    })
    if (!inv) throw new Error('E-Invoice not found')
    if (inv.status !== 'draft') throw new Error('Only draft e-invoices can be issued')

    const profile = await readZatcaProfile()
    const phase: 1 | 2 = profile.mode === 'phase2' ? 2 : 1
    const seller = await readEInvoiceSellerInfo()
    const items = [...inv.items].sort((a, b) => a.sr - b.sr)
    const validation = validateForZatca(inv, items, seller, phase)
    if (inv.relatedInvoice && inv.relatedInvoice.status === 'draft')
      validation.errors.push({ field: 'relatedInvoiceId', message: 'The original invoice is still a draft' })
    if (validation.errors.length > 0) throw new ZatcaValidationError(validation)

    const totals = computeInvoiceTotals(items)
    const issuedAt = new Date()
    const uuid = randomUUID()

    if (phase === 1) {
      const qrPayload = buildPhase1QrPayload(seller, { issuedAt, issueDate: inv.issueDate, ...totals })
      const updated = await db.eInvoice.update({
        where: { id },
        data: {
          ...totals,
          uuid,
          zatcaPhase: 1,
          qrPayload,
          status: 'issued',
          issuedAt,
          issuedByName,
        },
      })
      return { invoice: updated, qrPayload, validation, phase }
    }

    const signer = await getZatcaSigner()
    // ICV / PIH chain of this EGS in this environment
    const prev = await db.eInvoice.findFirst({
      where: { signedXml: { not: null }, zatcaSubmissionMode: signer.env, icv: { not: null } },
      orderBy: { icv: 'desc' },
      select: { icv: true, invoiceHash: true },
    })
    const icv = (prev?.icv ?? 0) + 1
    const pih = prev?.invoiceHash ?? ZATCA_INITIAL_PIH
    const doc = buildUblDocument(inv, items, seller, {
      uuid,
      icv,
      pih,
      issuedAt,
      billingReference: inv.relatedInvoice?.invoiceNumber ?? null,
    })
    const signed = signUbl(doc, signer, issuedAt)
    const updated = await db.eInvoice.update({
      where: { id },
      data: {
        subtotal: totals.subtotal,
        totalDiscount: totals.totalDiscount,
        taxableAmount: doc.taxExclusiveTotal,
        vatAmount: doc.vatTotal,
        totalDue: doc.taxInclusiveTotal,
        uuid,
        icv,
        previousHash: pih,
        invoiceHash: signed.invoiceHash,
        signature: signed.signature,
        signedXml: signed.xml,
        qrPayload: signed.qrPayload,
        zatcaPhase: 2,
        zatcaStatus: 'pending',
        zatcaSubmissionMode: signer.env,
        status: 'issued',
        issuedAt,
        issuedByName,
      },
    })
    return { invoice: updated, qrPayload: signed.qrPayload, validation, phase, signerKind: signer.kind }
  })
}

/**
 * QR for an issued document: the frozen payload, or (documents issued before
 * this version) a correctly encoded 5-tag payload that is then frozen.
 */
export async function ensureQrPayload(inv: {
  id: string
  status: string
  qrPayload: string | null
  issuedAt: Date | null
  issueDate: Date
  totalDue: number
  vatAmount: number
}): Promise<string | null> {
  if (inv.status === 'draft') return null
  if (inv.qrPayload) return inv.qrPayload
  const seller = await readSellerInfo()
  const payload = buildPhase1QrPayload(seller, inv)
  await db.eInvoice.update({ where: { id: inv.id }, data: { qrPayload: payload } }).catch(() => undefined)
  return payload
}

// ── Derived status helpers ──────────────────────────────────────────────────

/** Overdue is DERIVED, never stored: past due + open + underpaid. */
export function isEInvoiceOverdue(inv: {
  dueDate: Date | null
  status: string
  paidAmount: number
  totalDue: number
  now?: Date
}): boolean {
  if (!inv.dueDate) return false
  if (inv.status !== 'issued' && inv.status !== 'partially_paid') return false
  if (inv.paidAmount >= inv.totalDue - 0.005) return false
  const now = inv.now ?? new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return inv.dueDate < todayStart
}

