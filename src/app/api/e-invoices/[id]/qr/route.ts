// E-Invoice QR API — GET /api/e-invoices/[id]/qr
// Returns { qrPayload, qrDataUrl } for the 5-tag TLV ZATCA-style QR.
// Works for DRAFTS too (uses issueDate for tag 3 when not yet issued) so the
// print preview can render it before issuing.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  notFound,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import { buildEInvoiceQrPayload, qrDataUrl, readEInvoiceSellerInfo } from '@/lib/e-invoice'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth

    const { id } = await ctx.params
    const inv = await db.eInvoice.findUnique({
      where: { id },
      select: { issuedAt: true, issueDate: true, totalDue: true, vatAmount: true },
    })
    if (!inv) return notFound('E-Invoice not found')

    const seller = await readEInvoiceSellerInfo()
    const payload = buildEInvoiceQrPayload(seller, inv)
    const qr = await qrDataUrl(payload)
    return ok({ qrPayload: payload, qrDataUrl: qr })
  } catch (err) {
    console.error('[api/e-invoices/[id]/qr GET]', err)
    return serverError()
  }
}
