// GET /api/invoices/[id]/zatca — ZATCA stamp for one invoice, PHASE-AWARE.
// Returns { phase, uuid, invoiceHash, previousHash, signature, qrPayload,
//           qrDataUrl, sellerVatNumber, warnings } — the print dialog renders
// the QR and the compliance block from this payload.
//   Phase 1 → QR with TLV tags 1-5 only; uuid/hash/PIH/signature are '' and
//             any stored crypto is ignored (kept in the DB, unused).
//   Phase 2 → full 8-tag QR + cryptographic stamp (UUID, hash, PIH, signature)
//             computed once, persisted on the invoice, and reused so the hash
//             chain stays stable across reprints.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  notFound,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import { buildInvoiceStamp } from '@/lib/zatca'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('invoices.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const invoice = await db.invoice.findUnique({
      where: { id },
      include: { items: { orderBy: { sr: 'asc' } }, client: true },
    })
    if (!invoice) return notFound('Invoice not found')

    const stamp = await buildInvoiceStamp(invoice)
    return ok(stamp)
  } catch (err) {
    console.error('[api/invoices/[id]/zatca GET]', err)
    return serverError()
  }
}
