// GET /api/invoices/[id]/zatca/ubl — download the UBL 2.1 XML of a Phase 2
// invoice (the exact document whose SHA-256 hash is QR tag 6 / the submitted
// invoiceHash). Phase 2 only — Phase 1 invoices have no UBL document.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import { buildInvoiceSubmission } from '@/lib/zatca'

export const dynamic = 'force-dynamic'

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

    if (invoice.zatcaPhase !== 2) {
      return badRequest('Only Phase 2 invoices have a UBL XML document')
    }

    const submission = await buildInvoiceSubmission(invoice)

    return new NextResponse(submission.xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.xml"`,
      },
    })
  } catch (err) {
    console.error('[api/invoices/[id]/zatca/ubl GET]', err)
    return serverError()
  }
}
