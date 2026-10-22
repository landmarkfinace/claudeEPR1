// POST /api/e-invoices/[id]/zatca/report — send ONE issued Phase 2 e-invoice
// to ZATCA (Fatoora), exactly as signed at issue time:
//   • standard (B2B) → Clearance API  /invoices/clearance/single (Clearance-Status: 1)
//     ZATCA returns the cleared XML with its own stamp + QR → stored and printed.
//   • simplified (B2C) → Reporting API /invoices/reporting/single (within 24 h)
//   • onboarding not finished yet (compliance CSID only) → /compliance/invoices
//     (test check, nothing is registered with ZATCA)
//   • local environment → nothing is sent; the invoice is marked "local_only".
// The signed XML is never rebuilt or re-signed here — what was issued is what
// ZATCA receives.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { ok, badRequest, notFound, serverError, requirePermission, isResponse, logActivity } from '@/lib/api-helpers'
import { readSubmissionAuth, readZatcaProfile, zatcaMessages, zatcaRequest } from '@/lib/zatca'
import { qrFromXml } from '@/lib/zatca-ubl'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requirePermission('einvoices.edit')
    if (isResponse(auth)) return auth
    const { id } = await ctx.params

    const invoice = await db.eInvoice.findUnique({ where: { id } })
    if (!invoice) return notFound('E-Invoice not found')
    if (invoice.status === 'draft') return badRequest('Issue the e-invoice first')
    if (!invoice.signedXml || !invoice.invoiceHash || !invoice.uuid) {
      return badRequest(
        (invoice.zatcaPhase ?? 1) === 2
          ? 'This invoice was issued by the old system without a valid ZATCA signature and cannot be sent. Issue a credit note for it and create a new invoice.'
          : 'Phase 1 invoices are not sent to ZATCA'
      )
    }
    if (invoice.zatcaStatus === 'cleared' || invoice.zatcaStatus === 'reported') {
      return badRequest(`Already ${invoice.zatcaStatus} by ZATCA`)
    }

    const profile = await readZatcaProfile()
    const simplified = invoice.invoiceKind === 'simplified'
    const submittedAt = new Date()

    // The environment the document was signed in must be the active one
    if (invoice.zatcaSubmissionMode && invoice.zatcaSubmissionMode !== profile.env) {
      return badRequest(
        `This invoice was signed in the "${invoice.zatcaSubmissionMode}" environment but the active ZATCA environment is "${profile.env}". Switch back, or issue a new invoice.`
      )
    }

    if (profile.env === 'local') {
      await db.eInvoice.update({
        where: { id },
        data: { zatcaStatus: 'local_only', zatcaSubmittedAt: submittedAt, zatcaResponse: JSON.stringify({ local: true }) },
      })
      return ok({
        zatcaStatus: 'local_only',
        mode: 'local',
        errors: [],
        warnings: [
          'LOCAL TEST environment — nothing was sent to ZATCA. The signature uses a self-signed test certificate and is not valid with ZATCA.',
        ],
      })
    }

    const creds = await readSubmissionAuth()
    if (!creds) {
      return NextResponse.json(
        { error: 'ZATCA onboarding is not finished for this environment (Settings → ZATCA → Onboarding)' },
        { status: 409 }
      )
    }

    const payload = {
      invoiceHash: invoice.invoiceHash,
      uuid: invoice.uuid,
      invoice: Buffer.from(invoice.signedXml, 'utf8').toString('base64'),
    }
    const authPair = { token: creds.token, secret: creds.secret }

    let endpoint: 'compliance' | 'clearance' | 'reporting' =
      creds.kind === 'compliance' ? 'compliance' : simplified ? 'reporting' : 'clearance'

    const call = async () =>
      endpoint === 'compliance'
        ? zatcaRequest(creds.env, '/compliance/invoices', { body: payload, auth: authPair })
        : endpoint === 'clearance'
          ? zatcaRequest(creds.env, '/invoices/clearance/single', {
              body: payload,
              auth: authPair,
              headers: { 'Clearance-Status': '1' },
            })
          : zatcaRequest(creds.env, '/invoices/reporting/single', {
              body: payload,
              auth: authPair,
              headers: { 'Clearance-Status': '0' },
            })

    let result
    try {
      result = await call()
      // 303 = ZATCA has switched clearance off → report the invoice instead
      if (endpoint === 'clearance' && result.httpStatus === 303) {
        endpoint = 'reporting'
        result = await call()
      }
    } catch (err) {
      return NextResponse.json(
        {
          error: `Could not reach ZATCA (${err instanceof Error ? err.message : 'network error'}). Nothing changed — try again later.`,
        },
        { status: 502 }
      )
    }

    const { httpStatus, body } = result
    const { errors, warnings } = zatcaMessages(body)
    const clearance = String(body.clearanceStatus ?? '').toUpperCase()
    const reporting = String(body.reportingStatus ?? '').toUpperCase()

    if (httpStatus === 401) {
      return NextResponse.json(
        { error: 'ZATCA rejected the credentials (401). The CSID may have expired — renew it in Settings → ZATCA.' },
        { status: 502 }
      )
    }
    if (httpStatus === 429 || httpStatus >= 500) {
      return NextResponse.json(
        { error: `ZATCA is busy or unavailable (HTTP ${httpStatus}). Nothing changed — try again in a few minutes.` },
        { status: 502 }
      )
    }

    let zatcaStatus: 'cleared' | 'reported' | 'rejected' | 'compliance_passed' | 'compliance_failed'
    let clearedXml: string | null = null
    if (endpoint === 'compliance') {
      const passed = (httpStatus === 200 || httpStatus === 202) && (clearance === 'CLEARED' || reporting === 'REPORTED')
      zatcaStatus = passed ? 'compliance_passed' : 'compliance_failed'
    } else if (endpoint === 'clearance') {
      zatcaStatus = clearance === 'CLEARED' && (httpStatus === 200 || httpStatus === 202) ? 'cleared' : 'rejected'
      if (zatcaStatus === 'cleared' && typeof body.clearedInvoice === 'string') {
        clearedXml = Buffer.from(body.clearedInvoice, 'base64').toString('utf8')
      }
    } else {
      zatcaStatus = reporting === 'REPORTED' && (httpStatus === 200 || httpStatus === 202) ? 'reported' : 'rejected'
    }

    const clearedQr = clearedXml ? qrFromXml(clearedXml) : null
    const stored = { ...body }
    delete (stored as { clearedInvoice?: unknown }).clearedInvoice
    await db.eInvoice.update({
      where: { id },
      data: {
        zatcaStatus,
        zatcaSubmittedAt: submittedAt,
        zatcaResponse: JSON.stringify({ httpStatus, endpoint, ...stored }),
        ...(clearedXml ? { clearedXml } : {}),
        ...(clearedQr ? { qrPayload: clearedQr } : {}),
      },
    })

    await logActivity({
      user: auth,
      action: 'submitted',
      module: 'einvoice',
      description: `E-Invoice ${invoice.invoiceNumber} sent to ZATCA (${endpoint}, ${profile.env}) — ${zatcaStatus}`,
      amount: round2(invoice.totalDue),
    })

    return ok({
      zatcaStatus,
      zatcaSubmittedAt: submittedAt.toISOString(),
      mode: profile.env,
      endpoint,
      httpStatus,
      errors,
      warnings,
    })
  } catch (err) {
    console.error('[api/e-invoices/[id]/zatca/report POST]', err)
    return serverError()
  }
}
