// E-Invoice issue API — POST /api/e-invoices/[id]/issue
// Draft → issued, following the company's ZATCA phase (Settings → ZATCA):
//   Phase 1 — ZATCA content checks, totals + UUID + 5-tag QR frozen.
//   Phase 2 — ZATCA business-rule checks, signed UBL 2.1 XML (XAdES),
//             ICV + PIH chain, QR with the cryptographic stamp. The document
//             must then be cleared (standard) / reported (simplified).
// Validation failures → 422 with { errors, warnings } so the UI can list them.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { issueEInvoice, qrDataUrl, ZatcaValidationError } from '@/lib/e-invoice'
import { ZatcaSetupError } from '@/lib/zatca'
import { mapEInvoice, eInvoiceDetailInclude } from '../../mappers'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.edit')
    if (isResponse(auth)) return auth
    const { id } = await ctx.params

    let result: Awaited<ReturnType<typeof issueEInvoice>>
    try {
      result = await issueEInvoice(id, auth.name)
    } catch (e) {
      if (e instanceof ZatcaValidationError) {
        return NextResponse.json(
          {
            error: `ZATCA check failed: ${e.validation.errors[0]?.message ?? 'see details'}${
              e.validation.errors.length > 1 ? ` (+${e.validation.errors.length - 1} more)` : ''
            }`,
            errors: e.validation.errors,
            warnings: e.validation.warnings,
          },
          { status: 422 }
        )
      }
      if (e instanceof ZatcaSetupError) {
        return NextResponse.json({ error: e.message }, { status: 409 })
      }
      if (e instanceof Error && /not found|Only draft/.test(e.message)) {
        return NextResponse.json({ error: e.message }, { status: e.message.includes('not found') ? 404 : 400 })
      }
      throw e
    }

    const updated = await db.eInvoice.findUniqueOrThrow({ where: { id }, include: eInvoiceDetailInclude })
    const qr = await qrDataUrl(result.qrPayload)
    await logActivity({
      user: auth,
      action: 'issued',
      module: 'einvoice',
      description: `E-Invoice ${updated.invoiceNumber} issued (ZATCA Phase ${result.phase}${
        result.phase === 2 ? `, ICV ${updated.icv}` : ''
      }) — ${updated.clientNameEn}`,
      amount: updated.totalDue,
    })
    return ok({
      ...mapEInvoice(updated),
      qrPayload: result.qrPayload,
      qrDataUrl: qr,
      warnings: result.validation.warnings,
      needsSubmission: result.phase === 2,
    })
  } catch (err) {
    console.error('[api/e-invoices/[id]/issue POST]', err)
    return serverError()
  }
}
