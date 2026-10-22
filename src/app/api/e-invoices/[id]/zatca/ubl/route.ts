// GET /api/e-invoices/[id]/zatca/ubl — download the Phase 2 XML of an issued
// e-invoice: ZATCA's cleared XML when the invoice has been cleared (that is
// the legally valid copy for standard invoices), otherwise the signed XML
// exactly as it was hashed and signed at issue time.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { badRequest, notFound, serverError, requirePermission, isResponse } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth
    const { id } = await ctx.params
    const invoice = await db.eInvoice.findUnique({
      where: { id },
      select: { invoiceNumber: true, signedXml: true, clearedXml: true },
    })
    if (!invoice) return notFound('E-Invoice not found')
    const xml = invoice.clearedXml ?? invoice.signedXml
    if (!xml) return badRequest('Only Phase 2 e-invoices have a UBL XML document')
    const suffix = invoice.clearedXml ? '-cleared' : ''
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}${suffix}.xml"`,
      },
    })
  } catch (err) {
    console.error('[api/e-invoices/[id]/zatca/ubl GET]', err)
    return serverError()
  }
}
