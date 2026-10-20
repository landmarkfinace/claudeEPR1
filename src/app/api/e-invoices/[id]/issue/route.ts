// E-Invoice issue API — POST /api/e-invoices/[id]/issue
// Draft → issued. Assigns the ZATCA Phase 2 readiness data at issue time:
//   uuid (v4) · icv (sequential across all issued e-invoices) ·
//   previousHash (latest issued e-invoice's hash, PIH chain — starts at
//   ZATCA_INITIAL_PIH) · invoiceHash (base64 SHA-256 of the UBL XML).
// Totals are defensively recomputed from the stored items first.
// Response: full updated row + qrPayload + qrDataUrl.
import { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import {
  computeInvoiceTotals,
  buildEInvoiceXml,
  hashEInvoiceXml,
  buildEInvoiceQrPayload,
  qrDataUrl,
  readEInvoiceSellerInfo,
  ZATCA_INITIAL_PIH,
} from '@/lib/e-invoice'
import { mapEInvoice, eInvoiceDetailInclude } from '../../mappers'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.edit')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const inv = await db.eInvoice.findUnique({ where: { id }, include: { items: true } })
    if (!inv) return notFound('E-Invoice not found')
    if (inv.status !== 'draft') return badRequest('Only draft e-invoices can be issued')

    // Defensive recompute from stored items (never trust stored aggregates)
    const items = [...inv.items].sort((a, b) => a.sr - b.sr)
    const totals = computeInvoiceTotals(items)

    // PIH chain: latest issued e-invoice (highest icv) — or the KSA seed
    const prev = await db.eInvoice.findFirst({
      where: { icv: { not: null }, invoiceHash: { not: null } },
      orderBy: [{ icv: 'desc' }, { issuedAt: 'desc' }],
      select: { invoiceHash: true },
    })
    const previousHash = prev?.invoiceHash ?? ZATCA_INITIAL_PIH

    // ICV: 1-based counter across ALL issued e-invoices
    const maxIcv = await db.eInvoice.aggregate({
      where: { icv: { not: null } },
      _max: { icv: true },
    })
    const icv = (maxIcv._max.icv ?? 0) + 1

    const uuid = randomUUID()
    const seller = await readEInvoiceSellerInfo()

    // The XML embeds the final uuid/icv/previousHash so the hash covers them
    const xml = buildEInvoiceXml({ ...inv, ...totals, uuid }, items, seller, previousHash, icv)
    const invoiceHash = hashEInvoiceXml(xml)

    const issuedAt = new Date()
    const updated = await db.eInvoice.update({
      where: { id: inv.id },
      data: {
        ...totals,
        uuid,
        icv,
        previousHash,
        invoiceHash,
        status: 'issued',
        issuedAt,
        issuedByName: auth.name,
      },
      include: eInvoiceDetailInclude,
    })

    const payload = buildEInvoiceQrPayload(seller, updated)
    const qr = await qrDataUrl(payload)

    await logActivity({
      user: auth,
      action: 'issued',
      module: 'einvoice',
      description: `E-Invoice ${updated.invoiceNumber} issued — ${updated.clientNameEn}`,
      amount: totals.totalDue,
    })
    return ok({ ...mapEInvoice(updated), qrPayload: payload, qrDataUrl: qr })
  } catch (err) {
    console.error('[api/e-invoices/[id]/issue POST]', err)
    return serverError()
  }
}
