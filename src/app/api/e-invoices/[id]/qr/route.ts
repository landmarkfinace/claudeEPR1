// GET /api/e-invoices/[id]/qr — the QR printed on an issued e-invoice.
// The payload is FROZEN at issue (Phase 1: 5 tags; Phase 2: stamp tags;
// cleared standard invoices: the QR inside ZATCA's cleared XML) so later
// Settings changes never alter a document already given to a client.
// Drafts have no QR — a draft is not a tax invoice.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, notFound, serverError, requirePermission, isResponse } from '@/lib/api-helpers'
import { ensureQrPayload, qrDataUrl } from '@/lib/e-invoice'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth
    const { id } = await ctx.params
    const inv = await db.eInvoice.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        qrPayload: true,
        issuedAt: true,
        issueDate: true,
        totalDue: true,
        vatAmount: true,
        zatcaPhase: true,
        zatcaStatus: true,
        invoiceKind: true,
        signedXml: true,
      },
    })
    if (!inv) return notFound('E-Invoice not found')
    const payload = await ensureQrPayload(inv)
    const phase2 = Boolean(inv.signedXml)
    return ok({
      qrPayload: payload,
      qrDataUrl: payload ? await qrDataUrl(payload) : null,
      phase: phase2 ? 2 : 1,
      zatcaStatus: inv.zatcaStatus,
      // Phase 2 standard invoices may only be given to the client after clearance
      shareable:
        inv.status !== 'draft' &&
        (!phase2 || inv.invoiceKind === 'simplified' || inv.zatcaStatus === 'cleared'),
    })
  } catch (err) {
    console.error('[api/e-invoices/[id]/qr GET]', err)
    return serverError()
  }
}
