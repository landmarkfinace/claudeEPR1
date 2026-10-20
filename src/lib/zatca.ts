// ─────────────────────────────────────────────────────────────────────────────
// ZATCA e-Invoicing library (server-side only)
// Saudi Arabia's Fatara (فواتيرا) compliance — WITH PER-INVOICE PHASE DESIGNATION:
//
//   PHASE 1 (Generation) — mandatory QR on every invoice:
//     TLV (Tag-Length-Value) encoded base64 payload with the 5 mandatory tags:
//       1 seller name · 2 seller VAT number · 3 timestamp (ISO-8601)
//       4 invoice total (VAT inclusive) · 5 VAT total
//     No crypto, no portal submission.
//
//   PHASE 2 (Integration) — cryptographic stamping + reporting:
//     6 invoice XML hash (SHA-256, base64) · 7 ECDSA signature (base64)
//     8 ECDSA public key (base64, raw 64-byte x‖y point)
//     plus the UBL 2.1 XML document, an invoice UUID, and the PIH chain
//     (Previous Invoice Hash) that links each invoice to the previous one.
//     Submitted to the Fatoora gateway (reporting = simplified invoices,
//     clearance = standard invoices) using the ZATCA connection profile
//     (env / EGS serial / CSID token) stored in the Setting table.
//
// The phase is chosen PER INVOICE (Invoice.zatcaPhase = 1 | 2) — the boss
// requirement that Phase 1 and Phase 2 stay SEPARATE designations.
//
// Key management: an EC P-256 keypair is generated on first use and stored
// in the Setting table (zatca_private_key / zatca_public_key PEM strings).
// Formal certification still requires onboarding on the Fatoora portal
// (CSID issuance) — this implementation produces the exact data structure
// the portal expects, so the onboarding step is a configuration concern,
// not a code change.
// ─────────────────────────────────────────────────────────────────────────────
import {
  createHash,
  createSign,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  randomUUID,
} from 'node:crypto'
import { Prisma } from '@prisma/client'
import QRCode from 'qrcode'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'

/** KSA-mandated initial PIH for the FIRST invoice of a chain (base64 of SHA-256 of "0"). */
export const ZATCA_INITIAL_PIH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

// ── TLV encoding ────────────────────────────────────────────────────────────

/** [tag (1 byte)][length (2 bytes, big-endian)][UTF-8 value] → Buffer */
export function tlvEncode(entries: { tag: number; value: string }[]): Buffer {
  const parts: Buffer[] = []
  for (const { tag, value } of entries) {
    const valueBytes = Buffer.from(value, 'utf8')
    const head = Buffer.alloc(3)
    head.writeUInt8(tag & 0xff, 0)
    head.writeUInt16BE(valueBytes.length, 1)
    parts.push(head, valueBytes)
  }
  return Buffer.concat(parts)
}

// ── Settings access ─────────────────────────────────────────────────────────

export type ZatcaSellerInfo = {
  companyName: string
  companyNameAr: string
  address: string
  addressAr: string
  vatNumber: string
  crNumber: string
  currency: string
  bankName: string
  bankIban: string
}

/** Read the seller-related Setting rows (with the same defaults the API uses). */
export async function readSellerInfo(): Promise<ZatcaSellerInfo> {
  const rows = await db.setting.findMany()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return {
    companyName: map.companyName || 'Landmark Inter Gulf',
    companyNameAr: map.companyNameAr || 'لاندمارك انتر جلف',
    address: map.address || '',
    addressAr: map.addressAr || '',
    vatNumber: (map.vatNumber || '').trim(),
    crNumber: (map.crNumber || '').trim(),
    currency: map.currency || 'SAR',
    bankName: map.bankName || '',
    bankIban: map.bankIban || '',
  }
}

// ── ZATCA connection profile (Phase 2 gateway configuration) ────────────────

export type ZatcaEnv = 'simulation' | 'preprod' | 'production'

/** Default Fatoora gateway base URLs per environment. */
export const ZATCA_ENV_BASES: Record<ZatcaEnv, string> = {
  simulation: 'https://gw-fatura.zatca.gov.sa/e-invoicing/simulation',
  preprod: 'https://gw-fatura.zatca.gov.sa/e-invoicing/developer-portal',
  production: 'https://gw-fatura.zatca.gov.sa/e-invoicing/core',
}

/** Result of the last "Test Connection" run (persisted as zatca_last_test). */
export type ZatcaLastTest = {
  at: string // ISO timestamp
  ok: boolean
  mode: ZatcaEnv
  httpStatus?: number
  error?: string
  latencyMs: number
}

/**
 * The ZATCA connection profile returned to clients — NEVER includes the raw
 * CSID token, only whether one is configured (csidTokenSet).
 */
export type ZatcaProfile = {
  env: ZatcaEnv
  egsSerial: string
  csidTokenSet: boolean
  apiBase: string
  lastTest: ZatcaLastTest | null
}

function parseZatcaEnv(v: string | undefined): ZatcaEnv {
  return v === 'preprod' || v === 'production' ? v : 'simulation'
}

function parseLastTest(v: string | undefined): ZatcaLastTest | null {
  if (!v) return null
  try {
    const raw = JSON.parse(v) as Partial<ZatcaLastTest>
    if (!raw || typeof raw.at !== 'string' || typeof raw.ok !== 'boolean') return null
    return {
      at: raw.at,
      ok: raw.ok,
      mode: parseZatcaEnv(raw.mode),
      httpStatus: typeof raw.httpStatus === 'number' ? raw.httpStatus : undefined,
      error: typeof raw.error === 'string' ? raw.error : undefined,
      latencyMs: typeof raw.latencyMs === 'number' ? raw.latencyMs : 0,
    }
  } catch {
    return null // malformed JSON — treat as never tested
  }
}

/** Read the ZATCA gateway profile from the Setting table (token stays server-side). */
export async function readZatcaProfile(): Promise<ZatcaProfile> {
  const rows = await db.setting.findMany({
    where: {
      key: {
        in: ['zatca_env', 'zatca_egs_serial', 'zatca_csid_token', 'zatca_api_base', 'zatca_last_test'],
      },
    },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value

  const env = parseZatcaEnv(map.zatca_env)
  // An explicitly saved apiBase wins over the per-environment default
  const apiBase = (map.zatca_api_base ?? '').trim() || ZATCA_ENV_BASES[env]
  return {
    env,
    egsSerial: (map.zatca_egs_serial ?? '').trim(),
    csidTokenSet: Boolean((map.zatca_csid_token ?? '').trim()),
    apiBase,
    lastTest: parseLastTest(map.zatca_last_test),
  }
}

/** Read the raw CSID bearer token (server-side only — never send to a client). */
export async function readZatcaCsidToken(): Promise<string> {
  const row = await db.setting.findUnique({ where: { key: 'zatca_csid_token' } })
  return (row?.value ?? '').trim()
}

/** Upsert (value) or remove (null) one zatca_* Setting row. */
export async function writeZatcaSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.setting.deleteMany({ where: { key } })
    return
  }
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

/** Persist the outcome of a connection test (never throws). */
export async function saveZatcaLastTest(test: ZatcaLastTest): Promise<void> {
  await writeZatcaSetting('zatca_last_test', JSON.stringify(test))
}

// ── ECDSA keypair (auto-generated once, stored in Setting) ──────────────────

type ZatcaKeys = { privatePem: string; publicPem: string }

async function getZatcaKeys(): Promise<ZatcaKeys> {
  const rows = await db.setting.findMany({
    where: { key: { in: ['zatca_private_key', 'zatca_public_key'] } },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value

  if (map.zatca_private_key && map.zatca_public_key) {
    return { privatePem: map.zatca_private_key, publicPem: map.zatca_public_key }
  }

  // First use — generate an EC P-256 keypair (the curve ZATCA mandates)
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const privatePem = privateKey.export({ type: 'sec1', format: 'pem' }).toString()
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  await db.$transaction([
    db.setting.upsert({
      where: { key: 'zatca_private_key' },
      update: { value: privatePem },
      create: { key: 'zatca_private_key', value: privatePem },
    }),
    db.setting.upsert({
      where: { key: 'zatca_public_key' },
      update: { value: publicPem },
      create: { key: 'zatca_public_key', value: publicPem },
    }),
  ])
  return { privatePem, publicPem }
}

/** Check whether the ZATCA EC keypair has been generated (no side effects). */
export async function hasZatcaKeys(): Promise<boolean> {
  const rows = await db.setting.findMany({
    where: { key: { in: ['zatca_private_key', 'zatca_public_key'] } },
    select: { key: true },
  })
  const found = new Set(rows.map((r) => r.key))
  return found.has('zatca_private_key') && found.has('zatca_public_key')
}

/**
 * QR tag 8 value: base64 of the RAW 64-byte EC point (x‖y), 0x04 prefix
 * stripped — exactly the form ZATCA specifies. Derived from the SPKI PEM.
 */
function ecPublicKeyBase64(publicPem: string): string {
  const jwk = createPublicKey(publicPem).export({ format: 'jwk' }) as {
    x?: string
    y?: string
  }
  const x = Buffer.from(jwk.x ?? '', 'base64url')
  const y = Buffer.from(jwk.y ?? '', 'base64url')
  return Buffer.concat([x, y]).toString('base64')
}

/** Sign the invoice hash with ECDSA/SHA-256 → base64 (DER encoded, as node emits). */
function signHash(privatePem: string, data: Buffer): string {
  const signer = createSign('SHA256')
  signer.update(data)
  return signer.sign(createPrivateKey(privatePem)).toString('base64')
}

// ── UBL 2.1 XML generation ──────────────────────────────────────────────────

export type ZatcaInvoiceLine = {
  sr: number
  description: string
  unit: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type ZatcaInvoiceData = {
  invoiceNumber: string
  uuid: string
  issueDate: Date
  dueDate: Date | null
  invoiceType: string // standard | simplified
  currency: string
  subtotal: number
  vatRate: number
  vatAmount: number
  total: number
  paidAmount: number
  notes: string | null
  clientName: string
  clientNameAr: string | null
  clientVatNumber: string | null
  clientAddress: string | null
  clientCity: string | null
  clientCrNumber: string | null
  items: ZatcaInvoiceLine[]
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Build a UBL 2.1 Invoice XML in the ZATCA reporting structure
 * (ProfileID reporting:1.0, ICV counter, PIH attachment, seller/buyer
 * parties with VAT numbers, TaxTotal, LegalMonetaryTotal, invoice lines).
 * The hashed document intentionally omits the UBLExtensions/Signature block,
 * matching how Fatoora computes the invoice hash.
 */
export function buildInvoiceXml(
  inv: ZatcaInvoiceData,
  seller: ZatcaSellerInfo,
  previousHash: string,
  icv: number,
): string {
  const date = inv.issueDate.toISOString().slice(0, 10)
  const time = inv.issueDate.toISOString().slice(11, 19) + 'Z'
  // 0100000 = standard (B2B) tax invoice · 0200000 = simplified (B2C)
  const typeCode = inv.invoiceType === 'simplified' ? '0200000' : '0100000'

  const lines = inv.items
    .map(
      (it) => `  <cac:InvoiceLine>
    <cbc:ID>${it.sr}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${xmlEscape(it.unit || 'EA')}">${it.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(inv.currency)}">${round2(it.lineTotal).toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${xmlEscape(it.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${round2(inv.vatRate * 100).toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${xmlEscape(inv.currency)}">${round2(it.unitPrice).toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n')

  const buyerVatBlock =
    inv.clientVatNumber || inv.invoiceType !== 'simplified'
      ? `
    <cac:PartyTaxScheme>
      <cbc:CompanyID schemeID="VAT">${xmlEscape(inv.clientVatNumber || '')}</cbc:CompanyID>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:PartyTaxScheme>`
      : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${xmlEscape(inv.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${xmlEscape(inv.uuid)}</cbc:UUID>
  <cbc:IssueDate>${date}</cbc:IssueDate>
  <cbc:IssueTime>${time}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${typeCode}">${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${xmlEscape(inv.currency)}</cbc:DocumentCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${icv}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${previousHash}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      ${seller.crNumber ? `<cac:PartyIdentification><cbc:ID schemeID="CR">${xmlEscape(seller.crNumber)}</cbc:ID></cac:PartyIdentification>` : ''}
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(seller.address)}</cbc:StreetName>
        <cbc:CityName>Jubail</cbc:CityName>
        <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID schemeID="VAT">${xmlEscape(seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(seller.companyName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>${buyerVatBlock}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(inv.clientName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  ${
    seller.bankIban
      ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>${xmlEscape(seller.bankIban)}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
      : ''
  }
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.vatAmount).toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.subtotal).toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.vatAmount).toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${round2(inv.vatRate * 100).toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.subtotal).toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.subtotal).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.total).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PrepaidAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.paidAmount).toFixed(2)}</cbc:PrepaidAmount>
    <cbc:PayableAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.total).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`
}

/** ZATCA invoice hash: base64 of the SHA-256 digest of the invoice XML (UTF-8). */
export function hashInvoiceXml(xml: string): string {
  return createHash('sha256').update(xml, 'utf8').digest('base64')
}

// ── Invoice record adapters (shared by the ZATCA API routes) ────────────────

/** An Invoice row loaded WITH its items and linked client. */
export type ZatcaInvoiceRecord = Prisma.InvoiceGetPayload<{
  include: { items: true; client: true }
}>

/** Build the ZatcaInvoiceData for a loaded invoice (items sorted by sr). */
export function zatcaInvoiceData(inv: ZatcaInvoiceRecord): ZatcaInvoiceData {
  return {
    invoiceNumber: inv.invoiceNumber,
    uuid: inv.uuid ?? '',
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    invoiceType: inv.invoiceType,
    currency: 'SAR',
    subtotal: round2(inv.subtotal),
    vatRate: inv.vatRate,
    vatAmount: round2(inv.vatAmount),
    total: round2(inv.total),
    paidAmount: round2(inv.paidAmount),
    notes: inv.notes,
    clientName: inv.clientName,
    clientNameAr: inv.client?.nameAr ?? null,
    clientVatNumber: inv.client?.vatNumber ?? null,
    clientAddress: inv.client?.address ?? null,
    clientCity: inv.client?.city ?? null,
    clientCrNumber: inv.client?.crNumber ?? null,
    items: [...inv.items]
      .sort((a, b) => a.sr - b.sr)
      .map((it) => ({
        sr: it.sr,
        description: it.description,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: round2(it.unitPrice),
        lineTotal: round2(it.lineTotal),
      })),
  }
}

/** Build the ZatcaStampSource for a loaded invoice (phase from zatcaPhase). */
export function zatcaStampSource(
  inv: ZatcaInvoiceRecord,
  phase?: 1 | 2
): ZatcaStampSource {
  return {
    id: inv.id,
    createdAt: inv.createdAt,
    invoiceNumber: inv.invoiceNumber,
    phase: phase ?? (inv.zatcaPhase === 2 ? 2 : 1),
    storedUuid: inv.uuid,
    storedHash: inv.invoiceHash,
    storedPreviousHash: inv.previousHash,
    storedSignature: inv.signature,
  }
}

/** Stamp one invoice (persisting fresh crypto on the row) — used by the QR route. */
export async function buildInvoiceStamp(inv: ZatcaInvoiceRecord): Promise<ZatcaStamp> {
  return buildZatcaStamp(
    zatcaStampSource(inv),
    () => zatcaInvoiceData(inv),
    async (fields) => {
      await db.invoice.update({ where: { id: inv.id }, data: fields })
    },
  )
}

/** Build the full Phase 2 submission bundle (stamp + UBL XML) for one invoice. */
export async function buildInvoiceSubmission(inv: ZatcaInvoiceRecord): Promise<ZatcaSubmission> {
  return buildZatcaSubmission(
    zatcaStampSource(inv),
    () => zatcaInvoiceData(inv),
    async (fields) => {
      await db.invoice.update({ where: { id: inv.id }, data: fields })
    },
  )
}

// ── Full stamp: what /api/invoices/[id]/zatca returns ───────────────────────

export type ZatcaStamp = {
  /** Which ZATCA phase this invoice is designated for (per-invoice choice) */
  phase: 1 | 2
  uuid: string
  invoiceHash: string
  previousHash: string
  signature: string
  qrPayload: string
  qrDataUrl: string
  publicKeyBase64: string
  icv: number
  sellerVatNumber: string
  warnings: string[]
}

export type ZatcaStampSource = {
  id: string
  createdAt: Date
  invoiceNumber: string
  /**
   * Per-invoice ZATCA phase designation:
   *   1 = Phase 1 (Generation) — QR with TLV tags 1-5 only, no crypto
   *   2 = Phase 2 (Integration) — full 8-tag stamp + UBL + PIH chain
   */
  phase: 1 | 2
  /** If already stamped and unchanged → these are reused from the DB. */
  storedUuid: string | null
  storedHash: string | null
  storedPreviousHash: string | null
  storedSignature: string | null
}

/**
 * Stamp an invoice (or reuse its stored stamp) and build the QR payload for
 * its ZATCA phase. Pure computation + DB persistence is left to the caller.
 *
 * Phase 1 → TLV tags 1-5 ONLY: no keypair is touched, nothing is persisted
 *   and any previously stored crypto is ignored (kept in the DB, unused).
 * Phase 2 → current behavior: full 8-tag TLV + uuid + hash + PIH chain +
 *   ECDSA signature, persisted once.
 */
export async function buildZatcaStamp(
  source: ZatcaStampSource,
  buildData: () => ZatcaInvoiceData,
  persist: (fields: {
    uuid: string
    invoiceHash: string
    previousHash: string
    signature: string
  }) => Promise<void>,
): Promise<ZatcaStamp> {
  const seller = await readSellerInfo()
  const warnings: string[] = []
  if (!seller.vatNumber) {
    warnings.push(
      'Seller VAT number is not set in Settings — the QR tag 2 will be empty. Add it under Settings → Company & Tax.',
    )
  }

  const data = buildData()

  // ---- PHASE 1 (Generation): QR with TLV tags 1-5 only, no crypto at all ----
  if (source.phase === 1) {
    const qrPayload = tlvEncode([
      { tag: 1, value: seller.companyName },
      { tag: 2, value: seller.vatNumber },
      { tag: 3, value: data.issueDate.toISOString() },
      { tag: 4, value: round2(data.total).toFixed(2) },
      { tag: 5, value: round2(data.vatAmount).toFixed(2) },
    ]).toString('base64')

    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      margin: 0,
      width: 480,
      errorCorrectionLevel: 'M',
    })

    return {
      phase: 1,
      uuid: '',
      invoiceHash: '',
      previousHash: '',
      signature: '',
      qrPayload,
      qrDataUrl,
      publicKeyBase64: '',
      icv: 0,
      sellerVatNumber: seller.vatNumber,
      warnings,
    }
  }

  // ---- PHASE 2 (Integration): full 8-tag cryptographic stamp ----
  const keys = await getZatcaKeys()
  const publicKeyBase64 = ecPublicKeyBase64(keys.publicPem)

  let uuid = source.storedUuid
  let invoiceHash = source.storedHash
  let previousHash = source.storedPreviousHash
  let signature = source.storedSignature
  let icv = 0

  if (!uuid || !invoiceHash || !signature || !previousHash) {
    // ---- first stamp (or repairing an incomplete one) ----
    uuid = source.storedUuid ?? randomUUID()

    // PIH chain: hash of the most recently stamped invoice (any status),
    // or the KSA initial PIH constant for the first invoice ever stamped.
    const prev = await db.invoice.findFirst({
      where: { id: { not: source.id }, invoiceHash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { invoiceHash: true },
    })
    previousHash = prev?.invoiceHash ?? ZATCA_INITIAL_PIH

    icv = await computeInvoiceCounter(previousHash)
    // The XML must embed the FINAL uuid so later rebuilds (submission, UBL
    // download) hash byte-identically — no drift, no surprise re-stamps.
    const xml = buildInvoiceXml({ ...data, uuid }, seller, previousHash, icv)
    invoiceHash = hashInvoiceXml(xml)
    signature = signHash(keys.privatePem, Buffer.from(invoiceHash, 'base64'))

    await persist({ uuid, invoiceHash, previousHash, signature })
  } else {
    icv = await computeInvoiceCounter(previousHash)
  }

  // QR timestamp must reflect the invoice issue moment (tag 3)
  const qrPayload = tlvEncode([
    { tag: 1, value: seller.companyName },
    { tag: 2, value: seller.vatNumber },
    { tag: 3, value: data.issueDate.toISOString() },
    { tag: 4, value: round2(data.total).toFixed(2) },
    { tag: 5, value: round2(data.vatAmount).toFixed(2) },
    { tag: 6, value: invoiceHash },
    { tag: 7, value: signature },
    { tag: 8, value: publicKeyBase64 },
  ]).toString('base64')

  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    margin: 0,
    width: 480,
    errorCorrectionLevel: 'M',
  })

  return {
    phase: 2,
    uuid,
    invoiceHash,
    previousHash,
    signature,
    qrPayload,
    qrDataUrl,
    publicKeyBase64,
    icv,
    sellerVatNumber: seller.vatNumber,
    warnings,
  }
}

/**
 * Invoice Counter Value (ICV): the 1-based position of this invoice in the
 * PIH chain, reconstructed by walking the previousHash links backwards
 * (robust against deletions / re-stamps, unlike a plain row count).
 */
async function computeInvoiceCounter(previousHash: string): Promise<number> {
  if (!previousHash || previousHash === ZATCA_INITIAL_PIH) return 1
  const rows = await db.invoice.findMany({
    where: { invoiceHash: { not: null }, previousHash: { not: null } },
    select: { invoiceHash: true, previousHash: true },
  })
  const byHash = new Map<string, string>()
  for (const r of rows) byHash.set(r.invoiceHash as string, r.previousHash as string)

  let counter = 1
  let ph: string | null = previousHash
  const seen = new Set<string>()
  while (ph && ph !== ZATCA_INITIAL_PIH && !seen.has(ph)) {
    seen.add(ph)
    counter++
    ph = byHash.get(ph) ?? null
  }
  return counter
}

// ── Phase 2 submission bundle (stamp + UBL XML, guaranteed consistent) ──────

export type ZatcaSubmission = {
  stamp: ZatcaStamp
  /** UBL 2.1 XML whose SHA-256 hash equals stamp.invoiceHash */
  xml: string
  /** Invoice Counter Value — position of this invoice in the PIH chain */
  icv: number
  /** True when the stored stamp no longer matched the rebuilt XML and was re-signed */
  restamped: boolean
}

/**
 * Build everything needed to submit one Phase 2 invoice to the Fatoora
 * gateway: the (stored or freshly computed) cryptographic stamp plus the UBL
 * 2.1 XML document. If the current document no longer hashes to the stored
 * stamp (e.g. company details changed in Settings after stamping), the stamp
 * is re-computed and persisted so the printed QR, the stored fields and the
 * submitted XML always agree.
 */
export async function buildZatcaSubmission(
  source: ZatcaStampSource,
  buildData: () => ZatcaInvoiceData,
  persist: (fields: {
    uuid: string
    invoiceHash: string
    previousHash: string
    signature: string
  }) => Promise<void>,
): Promise<ZatcaSubmission> {
  const seller = await readSellerInfo()
  const stamp = await buildZatcaStamp(source, buildData, persist)
  if (stamp.phase !== 2 || !stamp.uuid) {
    throw new Error('ZATCA submission requires a Phase 2 invoice')
  }

  const icv = await computeInvoiceCounter(stamp.previousHash)
  // Stamp.uuid is authoritative (the caller's record may be stale for a
  // fresh stamp whose uuid was just assigned + persisted).
  const data = buildData()
  const xml = buildInvoiceXml({ ...data, uuid: stamp.uuid }, seller, stamp.previousHash, icv)

  if (hashInvoiceXml(xml) === stamp.invoiceHash) {
    return { stamp, xml, icv, restamped: false }
  }

  // Stored stamp drifted from the current document — re-hash + re-sign and
  // persist so the submitted pair (XML, hash) and the printed QR stay in sync.
  const keys = await getZatcaKeys()
  const invoiceHash = hashInvoiceXml(xml)
  const signature = signHash(keys.privatePem, Buffer.from(invoiceHash, 'base64'))
  await persist({ uuid: stamp.uuid, invoiceHash, previousHash: stamp.previousHash, signature })
  return {
    stamp: { ...stamp, invoiceHash, signature },
    xml,
    icv,
    restamped: true,
  }
}
