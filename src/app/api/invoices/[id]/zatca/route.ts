// GET /api/invoices/[id]/zatca — ZATCA Phase 1+2 stamp for one invoice.
// Returns { uuid, invoiceHash, previousHash, signature, qrPayload, qrDataUrl,
//           sellerVatNumber, warnings } — the print dialog renders the QR and
// the compliance block from this payload. The stamp (UUID, hash, PIH,
// signature) is computed once, persisted on the invoice, and reused so the
// hash chain stays stable across reprints.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import {
  ok,
  notFound,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import { buildZatcaStamp, type ZatcaInvoiceData } from '@/lib/zatca'

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

    const stamp = await buildZatcaStamp(
      {
        id: invoice.id,
        createdAt: invoice.createdAt,
        invoiceNumber: invoice.invoiceNumber,
        storedUuid: invoice.uuid,
        storedHash: invoice.invoiceHash,
        storedPreviousHash: invoice.previousHash,
        storedSignature: invoice.signature,
      },
      (): ZatcaInvoiceData => ({
        invoiceNumber: invoice.invoiceNumber,
        uuid: invoice.uuid ?? '',
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        invoiceType: invoice.invoiceType,
        currency: 'SAR',
        subtotal: round2(invoice.subtotal),
        vatRate: invoice.vatRate,
        vatAmount: round2(invoice.vatAmount),
        total: round2(invoice.total),
        paidAmount: round2(invoice.paidAmount),
        notes: invoice.notes,
        clientName: invoice.clientName,
        clientNameAr: invoice.client?.nameAr ?? null,
        clientVatNumber: invoice.client?.vatNumber ?? null,
        clientAddress: invoice.client?.address ?? null,
        clientCity: invoice.client?.city ?? null,
        clientCrNumber: invoice.client?.crNumber ?? null,
        items: invoice.items.map((it) => ({
          sr: it.sr,
          description: it.description,
          unit: it.unit,
          quantity: it.quantity,
          unitPrice: round2(it.unitPrice),
          lineTotal: round2(it.lineTotal),
        })),
      }),
      async (fields) => {
        await db.invoice.update({ where: { id: invoice.id }, data: fields })
      },
    )

    return ok(stamp)
  } catch (err) {
    console.error('[api/invoices/[id]/zatca GET]', err)
    return serverError()
  }
}
