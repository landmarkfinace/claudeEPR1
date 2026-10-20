// Invoices API — GET (paginated list + KPI totals + distinct years) / POST (create).
// The invoice number is ALWAYS generated server-side (INV-YYYY-NNNN, max for the
// issue year + 1) and is immutable afterwards. Line totals, subtotal, VAT and the
// grand total are computed here from the items — never trusted from a client.
// Filters: ?search (number / client / subject) ?status ?year (issue-date year)
//          ?zatcaPhase=1|2 ?zatcaStatus=reported|cleared|rejected
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { getVatRate } from '@/lib/vat'
import type { InvoiceRow } from '@/lib/types'
import {
  ok,
  badRequest,
  conflict,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  parseDate,
  toInt,
  logActivity,
} from '@/lib/api-helpers'

const INVOICE_STATUSES = ['draft', 'issued', 'paid', 'cancelled'] as const
type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

const ZATCA_STATUSES = ['reported', 'cleared', 'rejected'] as const

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

/** Aggregated KPIs for the header stat cards (scoped to the active filters). */
type InvoiceTotals = {
  count: number
  total: number
  paid: number
  outstanding: number
  overdue: number
}

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

const invoiceSchema = z.object({
  clientId: z.string().nullable().optional(),
  clientName: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  issueDate: z.string().min(1, 'Issue date is required'),
  dueDate: z.string().nullable().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  // ZATCA document type: standard = B2B tax invoice, simplified = B2C
  invoiceType: z.enum(['standard', 'simplified']).optional(),
  // Per-invoice ZATCA designation: 1 = Phase 1 (Generation), 2 = Phase 2 (Integration)
  zatcaPhase: z.coerce.number().int().min(1).max(2).optional(),
  vatRate: z.coerce.number().min(0, 'VAT rate cannot be negative').max(1, 'VAT rate cannot exceed 100%').optional(),
  paidAmount: z.coerce.number().min(0, 'Paid amount cannot be negative').optional(),
  notes: z.string().nullable().optional(),
  items: z.array(itemSchema).min(1, 'At least one line item is required'),
  ...signatureAndBankSchema,
})

/** Server-side money math — the single source of truth for invoice totals. */
function computeTotals(
  items: { quantity: number; unitPrice: number }[],
  vatRate: number
): { subtotal: number; vatAmount: number; total: number } {
  const subtotal = round2(
    items.reduce((sum, it) => sum + round2(it.quantity * it.unitPrice), 0)
  )
  const vatAmount = round2(subtotal * vatRate)
  const total = round2(subtotal + vatAmount)
  return { subtotal, vatAmount, total }
}

function startOfToday(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0)
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('invoices.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)
    const where: Prisma.InvoiceWhereInput = {}

    // Free-text search across invoice number, client name and subject
    const search = sp.get('search')?.trim()
    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { clientName: { contains: search } },
        { subject: { contains: search } },
      ]
    }

    // Status filter (validated against the known list)
    const status = sp.get('status')?.trim()
    if (status && (INVOICE_STATUSES as readonly string[]).includes(status)) {
      where.status = status
    }

    // Issue-year filter
    const year = toInt(sp.get('year'))
    if (Number.isInteger(year) && year >= 1900 && year <= 2200) {
      where.issueDate = {
        gte: new Date(year, 0, 1, 0, 0, 0, 0),
        lte: new Date(year, 11, 31, 23, 59, 59, 999),
      }
    }

    // ZATCA phase designation filter (1 = Generation, 2 = Integration)
    const zatcaPhase = toInt(sp.get('zatcaPhase'))
    if (zatcaPhase === 1 || zatcaPhase === 2) {
      where.zatcaPhase = zatcaPhase
    }

    // ZATCA Phase 2 submission status filter
    const zatcaStatus = sp.get('zatcaStatus')?.trim()
    if (zatcaStatus && (ZATCA_STATUSES as readonly string[]).includes(zatcaStatus)) {
      where.zatcaStatus = zatcaStatus
    }

    // KPI totals exclude cancelled invoices (they don't count as invoiced/collected)
    const aggWhere: Prisma.InvoiceWhereInput = { ...where, status: { not: 'cancelled' } }
    const overdueWhere: Prisma.InvoiceWhereInput = {
      ...where,
      status: 'issued',
      dueDate: { lt: startOfToday() },
    }

    const [rows, total, agg, overdueCount, yearRows] = await Promise.all([
      db.invoice.findMany({
        where,
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
      }),
      db.invoice.count({ where }),
      db.invoice.aggregate({
        where: aggWhere,
        _count: { _all: true },
        _sum: { total: true, paidAmount: true },
      }),
      db.invoice.count({ where: overdueWhere }),
      db.invoice.findMany({ select: { issueDate: true }, orderBy: { issueDate: 'desc' } }),
    ])

    const years = Array.from(new Set(yearRows.map((r) => r.issueDate.getFullYear())))
      .sort((a, b) => b - a)
      .slice(0, 30)

    const totals: InvoiceTotals = {
      count: agg._count._all,
      total: round2(agg._sum.total ?? 0),
      paid: round2(agg._sum.paidAmount ?? 0),
      outstanding: round2(round2(agg._sum.total ?? 0) - round2(agg._sum.paidAmount ?? 0)),
      overdue: overdueCount,
    }

    return ok({
      data: rows.map(mapInvoice),
      page: p.page,
      pageSize: p.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
      totals,
      years,
    })
  } catch {
    return serverError()
  }
}

function mapInvoice(i: {
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
}): InvoiceRow {
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
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('invoices.create')
    if (isResponse(auth)) return auth

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = invoiceSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const issueDate = parseDate(body.issueDate)
    if (!issueDate) return badRequest('Invalid issue date')
    const dueDate = parseDate(body.dueDate)

    // Client: either a linked Client record or a free-text name
    let clientId: string | null = null
    let clientName = body.clientName?.trim() ?? ''
    if (body.clientId) {
      const client = await db.client.findUnique({
        where: { id: body.clientId },
        select: { id: true, name: true },
      })
      if (!client) return badRequest('Selected client no longer exists')
      clientId = client.id
      clientName = client.name // canonical name from the linked record
    }
    if (!clientName) return badRequest('Client name is required')

    const vatRate = body.vatRate !== undefined ? body.vatRate : await getVatRate()
    const items = body.items.map((it, idx) => ({
      sr: idx + 1,
      description: it.description.trim(),
      unit: it.unit?.trim() || null,
      quantity: it.quantity,
      unitPrice: round2(it.unitPrice),
      lineTotal: round2(it.quantity * it.unitPrice),
    }))
    const { subtotal, vatAmount, total } = computeTotals(items, vatRate)

    const status: InvoiceStatus = body.status ?? 'draft'
    let paidAmount = body.paidAmount !== undefined ? round2(body.paidAmount) : 0
    if (status === 'paid' && body.paidAmount === undefined) paidAmount = total
    if (paidAmount > total) {
      return badRequest('Paid amount cannot exceed the invoice total')
    }

    // Auto number INV-YYYY-NNNN — allocated inside the transaction (max + 1)
    const created = await db.$transaction(async (tx) => {
      const year = issueDate.getFullYear()
      const prefix = `INV-${year}-`
      const existing = await tx.invoice.findMany({
        where: { invoiceNumber: { startsWith: prefix } },
        select: { invoiceNumber: true },
      })
      let max = 0
      for (const row of existing) {
        const n = parseInt(row.invoiceNumber.slice(prefix.length), 10)
        if (Number.isInteger(n) && n > max) max = n
      }
      const invoiceNumber = `${prefix}${String(max + 1).padStart(4, '0')}`

      return tx.invoice.create({
        data: {
          invoiceNumber,
          clientId,
          clientName,
          subject: body.subject?.trim() || null,
          issueDate,
          dueDate,
          status,
          invoiceType: body.invoiceType ?? 'standard',
          zatcaPhase: body.zatcaPhase ?? 1,
          subtotal,
          vatRate,
          vatAmount,
          total,
          paidAmount,
          notes: body.notes?.trim() || null,
          createdByName: auth.name,
          approvedBy: body.approvedBy ?? null,
          approvedByTitle: body.approvedByTitle ?? null,
          receivedBy: body.receivedBy ?? null,
          receivedByTitle: body.receivedByTitle ?? null,
          bankName: body.bankName ?? null,
          bankAccountName: body.bankAccountName ?? null,
          bankAccountNumber: body.bankAccountNumber ?? null,
          bankIban: body.bankIban ?? null,
          bankSwiftCode: body.bankSwiftCode ?? null,
          bankAddress: body.bankAddress ?? null,
          items: { create: items },
        },
        include: { items: { orderBy: { sr: 'asc' } } },
      })
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'invoice',
      description: `Invoice ${created.invoiceNumber} — ${clientName}`,
      amount: total,
    })
    return ok(mapInvoice(created), 201)
  } catch (e) {
    console.error('[api/invoices POST]', e)
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return conflict('Invoice number already exists — please retry')
    }
    return serverError()
  }
}
