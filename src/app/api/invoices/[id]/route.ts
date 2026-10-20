// Invoice API — GET / PUT / DELETE a single invoice.
// GET returns the invoice WITH its line items and (when linked) the client record
// so the print document can render a full "Bill To" block.
// PUT supports two shapes:
//   • full edit — items[] present → items are REPLACED and all totals recomputed
//   • quick update — only scalar fields (status / paidAmount / dates / notes…):
//     "mark paid" sends { status: 'paid' } and the server fills paidAmount = total.
// The invoice number is immutable (allocated at creation).
// ZATCA: editing items/dates/client/totals of a STAMPED Phase 2 invoice clears
// the stored crypto stamp (uuid/hash/PIH/signature) so it re-stamps on the next
// fetch, and resets a reported/cleared submission status (resubmission needed).
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import type { InvoiceRow } from '@/lib/types'
import {
  ok,
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  parseDate,
  logActivity,
} from '@/lib/api-helpers'

const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'cancelled'] as const
type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

/**
 * Optional trimmed text field that maps "" → null (an empty signature/bank
 * override box means "fall back to the company default", not "keep a blank").
 */
const optionalText = (max: number, label: string) =>
  z.preprocess(
    (v) => (v === '' ? null : v),
    z
      .string()
      .trim()
      .max(max, `${label} cannot exceed ${max} characters`)
      .nullable()
      .optional(),
  )

/** Shared zod fields for the per-invoice signature + bank override blocks. */
const signatureAndBankSchema = {
  approvedBy: optionalText(120, 'Approved By name'),
  approvedByTitle: optionalText(120, 'Approved By title'),
  receivedBy: optionalText(120, 'Received By name'),
  receivedByTitle: optionalText(120, 'Received By title'),
  bankName: optionalText(120, 'Bank name'),
  bankAccountName: optionalText(120, 'Bank account name'),
  bankAccountNumber: optionalText(34, 'Bank account number'),
  bankIban: optionalText(34, 'Bank IBAN'),
  bankSwiftCode: optionalText(20, 'Bank SWIFT code'),
  bankAddress: optionalText(240, 'Bank address'),
} as const

const clientSelect = {
  id: true,
  name: true,
  nameAr: true,
  address: true,
  addressAr: true,
  city: true,
  phone: true,
  email: true,
  crNumber: true,
  vatNumber: true,
  bankName: true,
  iban: true,
  accountNumber: true,
  swiftCode: true,
} as const

const itemSchema = z.object({
  description: z.string().min(1, 'Item description is required'),
  unit: z.string().nullable().optional(),
  quantity: z.coerce
    .number()
    .positive('Quantity must be greater than 0')
    .max(1_000_000, 'Quantity is too large'),
  unitPrice: z.coerce
    .number()
    .min(0, 'Unit price cannot be negative')
    .max(1_000_000_000, 'Unit price is too large'),
})

const invoiceUpdateSchema = z.object({
  clientId: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  issueDate: z.string().min(1, 'Issue date is required').optional(),
  dueDate: z.string().nullable().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  // ZATCA document type: standard = B2B tax invoice, simplified = B2C
  invoiceType: z.enum(['standard', 'simplified']).optional(),
  // Per-invoice ZATCA designation: 1 = Phase 1 (Generation), 2 = Phase 2 (Integration)
  zatcaPhase: z.coerce.number().int().min(1).max(2).optional(),
  vatRate: z.coerce.number().min(0, 'VAT rate cannot be negative').max(1, 'VAT rate cannot exceed 100%').optional(),
  paidAmount: z.coerce.number().min(0, 'Paid amount cannot be negative').optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, 'At least one line item is required').optional(),
  ...signatureAndBankSchema,
})

const invoiceInclude = {
  items: { orderBy: { sr: 'asc' as const } },
  client: { select: clientSelect },
} as const

type InvoiceWithRelations = {
  id: string
  invoiceNumber: string
  clientId: string | null
  clientName: string
  subject: string | null
  issueDate: Date
  dueDate: Date | null
  status: string
  invoiceType: string
  subtotal: number
  vatRate: number
  vatAmount: number
  total: number
  paidAmount: number
  notes: string | null
  createdByName: string | null
  createdAt: Date
  zatcaPhase: number
  zatcaStatus: string | null
  zatcaSubmittedAt: Date | null
  approvedBy: string | null
  approvedByTitle: string | null
  receivedBy: string | null
  receivedByTitle: string | null
  bankName: string | null
  bankAccountName: string | null
  bankAccountNumber: string | null
  bankIban: string | null
  bankSwiftCode: string | null
  bankAddress: string | null
  items: {
    id: string
    sr: number
    description: string
    unit: string | null
    quantity: number
    unitPrice: number
    lineTotal: number
  }[]
  client: {
    id: string
    name: string
    nameAr: string | null
    address: string | null
    addressAr: string | null
    city: string | null
    phone: string | null
    email: string | null
    crNumber: string | null
    vatNumber: string | null
    bankName: string | null
    iban: string | null
    accountNumber: string | null
    swiftCode: string | null
  } | null
}

function mapInvoiceFull(i: InvoiceWithRelations): InvoiceRow & {
  client: InvoiceWithRelations['client']
  items: Required<InvoiceRow>['items']
} {
  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    clientId: i.clientId,
    clientName: i.clientName,
    subject: i.subject,
    issueDate: i.issueDate.toISOString(),
    dueDate: i.dueDate ? i.dueDate.toISOString() : null,
    status: i.status,
    invoiceType: i.invoiceType,
    subtotal: round2(i.subtotal),
    vatRate: i.vatRate,
    vatAmount: round2(i.vatAmount),
    total: round2(i.total),
    paidAmount: round2(i.paidAmount),
    notes: i.notes,
    createdByName: i.createdByName,
    createdAt: i.createdAt.toISOString(),
    zatcaPhase: i.zatcaPhase,
    zatcaStatus: i.zatcaStatus || null,
    zatcaSubmittedAt: i.zatcaSubmittedAt ? i.zatcaSubmittedAt.toISOString() : null,
    approvedBy: i.approvedBy,
    approvedByTitle: i.approvedByTitle,
    receivedBy: i.receivedBy,
    receivedByTitle: i.receivedByTitle,
    bankName: i.bankName,
    bankAccountName: i.bankAccountName,
    bankAccountNumber: i.bankAccountNumber,
    bankIban: i.bankIban,
    bankSwiftCode: i.bankSwiftCode,
    bankAddress: i.bankAddress,
    client: i.client,
    items: i.items.map((it) => ({
      id: it.id,
      sr: it.sr,
      description: it.description,
      unit: it.unit,
      quantity: it.quantity,
      unitPrice: round2(it.unitPrice),
      lineTotal: round2(it.lineTotal),
    })),
  }
}

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('invoices.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const invoice = await db.invoice.findUnique({
      where: { id },
      include: invoiceInclude,
    })
    if (!invoice) return notFound('Invoice not found')
    return ok(mapInvoiceFull(invoice as InvoiceWithRelations))
  } catch {
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('invoices.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.invoice.findUnique({
      where: { id },
      include: { items: { orderBy: { sr: 'asc' } } },
    })
    if (!existing) return notFound('Invoice not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = invoiceUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    // ---- client (linked record or free text) ----
    let clientId = existing.clientId
    let clientName = existing.clientName
    if (body.clientId !== undefined) {
      if (body.clientId === null || body.clientId === '') {
        clientId = null
        const typed = body.clientName?.trim() ?? ''
        if (typed) clientName = typed
        else if (!clientName) return badRequest('Client name is required')
      } else {
        const client = await db.client.findUnique({
          where: { id: body.clientId },
          select: { id: true, name: true },
        })
        if (!client) return badRequest('Selected client no longer exists')
        clientId = client.id
        clientName = client.name
      }
    } else if (body.clientName !== undefined) {
      const typed = body.clientName?.trim() ?? ''
      if (!typed && !clientId) return badRequest('Client name is required')
      if (typed) clientName = typed
    }

    // ---- dates ----
    const issueDate =
      body.issueDate !== undefined ? parseDate(body.issueDate) : existing.issueDate
    if (!issueDate) return badRequest('Invalid issue date')
    const dueDate =
      body.dueDate !== undefined ? parseDate(body.dueDate) : existing.dueDate

    // ---- items + totals (always recomputed server-side) ----
    const vatRate = body.vatRate !== undefined ? body.vatRate : existing.vatRate
    let items:
      | { sr: number; description: string; unit: string | null; quantity: number; unitPrice: number; lineTotal: number }[]
      | null = null
    let subtotal: number
    if (body.items !== undefined) {
      items = body.items.map((it, idx) => ({
        sr: idx + 1,
        description: it.description.trim(),
        unit: it.unit?.trim() || null,
        quantity: it.quantity,
        unitPrice: round2(it.unitPrice),
        lineTotal: round2(it.quantity * it.unitPrice),
      }))
      subtotal = round2(items.reduce((sum, it) => sum + it.lineTotal, 0))
    } else {
      subtotal = round2(existing.subtotal)
    }
    const vatAmount = round2(subtotal * vatRate)
    const total = round2(subtotal + vatAmount)

    // ---- status + paid amount ----
    const status: InvoiceStatus = body.status ?? (existing.status as InvoiceStatus)
    let paidAmount =
      body.paidAmount !== undefined ? round2(body.paidAmount) : round2(existing.paidAmount)
    // "Mark paid" quick action: status → paid fills the paid amount with the total
    if (body.status === 'paid' && body.paidAmount === undefined) paidAmount = total
    if (paidAmount > total) {
      return badRequest('Paid amount cannot exceed the invoice total')
    }

    // ---- ZATCA stamp invalidation ----
    // If anything that went into a stored Phase 2 stamp changed (items, issue
    // date, client, totals), the stored crypto no longer describes this
    // document: clear it so the next stamp fetch re-stamps, and reset a
    // reported/cleared submission status (the invoice must be resubmitted).
    let stampInvalidated = false
    if (existing.invoiceHash) {
      const itemsChanged =
        items !== null &&
        (existing.items.length !== items.length ||
          items.some((it, idx) => {
            const ex = existing.items[idx]
            return (
              ex.description !== it.description ||
              ex.unit !== it.unit ||
              round2(ex.quantity) !== round2(it.quantity) ||
              round2(ex.unitPrice) !== round2(it.unitPrice)
            )
          }))
      const dateChanged = issueDate.getTime() !== existing.issueDate.getTime()
      const clientChanged = clientId !== existing.clientId || clientName !== existing.clientName
      const totalsChanged =
        round2(subtotal) !== round2(existing.subtotal) ||
        vatRate !== existing.vatRate ||
        round2(vatAmount) !== round2(existing.vatAmount) ||
        round2(total) !== round2(existing.total)
      stampInvalidated = itemsChanged || dateChanged || clientChanged || totalsChanged
    }
    const zatcaPhase = body.zatcaPhase ?? existing.zatcaPhase

    const updated = await db.$transaction(async (tx) => {
      if (items !== null) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } })
      }
      return tx.invoice.update({
        where: { id },
        data: {
          clientId,
          clientName,
          subject: body.subject !== undefined ? (body.subject ?? '').trim() || null : undefined,
          issueDate,
          dueDate,
          status,
          invoiceType: body.invoiceType,
          zatcaPhase,
          subtotal,
          vatRate,
          vatAmount,
          total,
          paidAmount,
          notes: body.notes !== undefined ? (body.notes ?? '').trim() || null : undefined,
          approvedBy: body.approvedBy !== undefined ? body.approvedBy : undefined,
          approvedByTitle: body.approvedByTitle !== undefined ? body.approvedByTitle : undefined,
          receivedBy: body.receivedBy !== undefined ? body.receivedBy : undefined,
          receivedByTitle: body.receivedByTitle !== undefined ? body.receivedByTitle : undefined,
          bankName: body.bankName !== undefined ? body.bankName : undefined,
          bankAccountName: body.bankAccountName !== undefined ? body.bankAccountName : undefined,
          bankAccountNumber:
            body.bankAccountNumber !== undefined ? body.bankAccountNumber : undefined,
          bankIban: body.bankIban !== undefined ? body.bankIban : undefined,
          bankSwiftCode: body.bankSwiftCode !== undefined ? body.bankSwiftCode : undefined,
          bankAddress: body.bankAddress !== undefined ? body.bankAddress : undefined,
          ...(items !== null ? { items: { create: items } } : {}),
          ...(stampInvalidated
            ? {
                uuid: null,
                invoiceHash: null,
                previousHash: null,
                signature: null,
                // a reported/cleared invoice that changed must be resubmitted
                ...(existing.zatcaStatus === 'reported' || existing.zatcaStatus === 'cleared'
                  ? { zatcaStatus: null }
                  : {}),
              }
            : {}),
        },
        include: invoiceInclude,
      })
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'invoice',
      description:
        stampInvalidated && existing.invoiceHash
          ? `Invoice ${updated.invoiceNumber} — ${updated.clientName} (ZATCA stamp reset — content changed)`
          : `Invoice ${updated.invoiceNumber} — ${updated.clientName}`,
      amount: round2(updated.total),
    })
    return ok(mapInvoiceFull(updated as InvoiceWithRelations))
  } catch {
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('invoices.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.invoice.findUnique({ where: { id } })
    if (!existing) return notFound('Invoice not found')

    await db.invoice.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'invoice',
      description: `Invoice ${existing.invoiceNumber} — ${existing.clientName}`,
      amount: round2(existing.total),
    })
    return ok({ deleted: true })
  } catch {
    return serverError()
  }
}
