// POST /api/invoices/[id]/zatca/report — submit ONE Phase 2 invoice to ZATCA
// (the "connect system" flow). Phase 1 invoices are rejected: only Phase 2
// (Integration) invoices are reported/cleared on the Fatoora gateway.
//
//   Simulation mode (profile env = simulation, or preprod/production without
//   a CSID token): the full local validation runs, a realistic gateway
//   response is produced and persisted (zatcaStatus / zatcaSubmittedAt /
//   zatcaSubmissionMode='simulation' / zatcaResponse JSON).
//
//   Production mode (env = preprod|production AND CSID token set): the UBL
//   2.1 XML is POSTed to /invoices/report/single (simplified) or
//   /invoices/clearance/single (standard) with the CSID bearer token
//   (15s timeout). The gateway response is mapped to reported|cleared|rejected
//   and persisted. Network failure → 502 with a clear, actionable message.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
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
  readZatcaProfile,
  readZatcaCsidToken,
  buildInvoiceSubmission,
} from '@/lib/zatca'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

type ZatcaCheck = {
  name: string
  ok: boolean
  severity: 'error' | 'warning'
  detail: string
}

/** Shape ZATCA's gateway answers with (reporting + clearance variants). */
type ZatcaGatewayResponse = {
  reportingStatus?: string
  clearanceStatus?: string
  status?: number
  messages?: { type?: string; code?: string; message?: string; status?: string }[]
  [key: string]: unknown
}

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('invoices.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const invoice = await db.invoice.findUnique({
      where: { id },
      include: { items: { orderBy: { sr: 'asc' } }, client: true },
    })
    if (!invoice) return notFound('Invoice not found')

    // Phase 1 invoices never touch the gateway — Phase 1 and Phase 2 are
    // SEPARATE per-invoice designations (boss requirement).
    if (invoice.zatcaPhase !== 2) {
      return badRequest('Only Phase 2 invoices can be submitted to ZATCA')
    }
    if (invoice.status === 'draft') {
      return badRequest('Issue the invoice first')
    }

    // ---- stamp (reuses the stored one) + UBL 2.1 XML, always consistent ----
    const submission = await buildInvoiceSubmission(invoice)
    const { stamp, xml, icv, restamped } = submission

    // ---- local validation (always) ----
    const checks: ZatcaCheck[] = []

    checks.push({
      name: 'Seller VAT number',
      ok: Boolean(stamp.sellerVatNumber),
      severity: 'error',
      detail: stamp.sellerVatNumber
        ? `Seller VAT ${stamp.sellerVatNumber}`
        : 'Seller VAT number is not set in Settings',
    })

    const buyerVat = invoice.client?.vatNumber ?? ''
    if (invoice.invoiceType === 'simplified') {
      checks.push({
        name: 'Buyer VAT number',
        ok: true,
        severity: 'warning',
        detail: 'Not required for simplified (B2C) invoices',
      })
    } else {
      checks.push({
        name: 'Buyer VAT number',
        ok: Boolean(buyerVat),
        severity: 'warning', // unregistered buyer is allowed — warning, not error
        detail: buyerVat
          ? `Buyer VAT ${buyerVat}`
          : 'Buyer VAT number is missing — an unregistered buyer is allowed, the invoice will carry a warning',
      })
    }

    const vatExpected = round2(round2(invoice.subtotal) * invoice.vatRate)
    const vatOk = Math.abs(vatExpected - round2(invoice.vatAmount)) <= 0.01
    checks.push({
      name: 'Totals consistent',
      ok: vatOk,
      severity: 'error',
      detail: vatOk
        ? `VAT ${round2(invoice.vatAmount)} matches subtotal × rate (${vatExpected})`
        : `VAT amount ${round2(invoice.vatAmount)} does not match subtotal × rate (${vatExpected})`,
    })

    checks.push({
      name: 'Line items',
      ok: invoice.items.length > 0,
      severity: 'error',
      detail:
        invoice.items.length > 0
          ? `${invoice.items.length} line item${invoice.items.length === 1 ? '' : 's'}`
          : 'The invoice has no line items',
    })

    const blocking = checks.filter((c) => !c.ok && c.severity === 'error')
    if (blocking.length > 0) {
      return NextResponse.json(
        {
          error: `ZATCA validation failed: ${blocking.map((c) => c.name).join(', ')}`,
          checks,
        },
        { status: 400 }
      )
    }

    // ---- decide the mode ----
    const profile = await readZatcaProfile()
    const csidToken = await readZatcaCsidToken()
    const useProduction = profile.env !== 'simulation' && Boolean(csidToken)
    const mode: 'simulation' | 'production' = useProduction ? 'production' : 'simulation'
    const submittedAt = new Date()
    const isSimplified = invoice.invoiceType === 'simplified'

    let zatcaStatus: 'reported' | 'cleared' | 'rejected'
    let response: Record<string, unknown>

    if (!useProduction) {
      // ---- SIMULATION: realistic local response, no gateway call ----
      zatcaStatus = isSimplified ? 'reported' : 'cleared'
      response = {
        simulated: true,
        status: isSimplified ? 202 : 200,
        ...(isSimplified
          ? { reportingStatus: 'REPORTED' }
          : { clearanceStatus: 'CLEARED' }),
        reportingTime: submittedAt.toISOString(),
        uuid: stamp.uuid,
        invoiceHash: stamp.invoiceHash,
        invoiceCounterValue: icv,
        ...(isSimplified ? {} : { clearanceUuid: `sim-${stamp.uuid}` }),
        ...(restamped
          ? { note: 'Stamp was refreshed before submission (document changed since the last stamp)' }
          : {}),
        ...(profile.env !== 'simulation'
          ? { note: `Profile env is ${profile.env} but no CSID token is configured — submission simulated locally` }
          : {}),
        checks,
        messages: [],
      }
    } else {
      // ---- PRODUCTION: POST the UBL to the Fatoora gateway ----
      const endpoint = isSimplified ? 'invoices/report/single' : 'invoices/clearance/single'
      let gateway: ZatcaGatewayResponse
      try {
        const res = await fetch(`${profile.apiBase.replace(/\/$/, '')}/${endpoint}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${csidToken}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            invoiceHash: stamp.invoiceHash,
            uuid: stamp.uuid,
            invoice: Buffer.from(xml, 'utf8').toString('base64'),
          }),
          signal: AbortSignal.timeout(15000),
          cache: 'no-store',
        })
        const text = await res.text()
        try {
          gateway = JSON.parse(text) as ZatcaGatewayResponse
        } catch {
          gateway = { status: res.status, messages: [{ message: text.slice(0, 500) }] }
        }
      } catch (err) {
        return NextResponse.json(
          {
            error: `Could not reach the ZATCA gateway (${
              err instanceof Error ? err.message : 'network error'
            }) — check internet connectivity or switch the profile to simulation mode`,
          },
          { status: 502 }
        )
      }

      const reported = (gateway.reportingStatus ?? '').toUpperCase() === 'REPORTED'
      const cleared = (gateway.clearanceStatus ?? '').toUpperCase() === 'CLEARED'
      zatcaStatus = cleared ? 'cleared' : reported ? 'reported' : 'rejected'
      response = { ...gateway, gatewayStatus: gateway.status, checks }
    }

    // ---- persist the submission outcome on the invoice ----
    await db.invoice.update({
      where: { id },
      data: {
        zatcaStatus,
        zatcaSubmittedAt: submittedAt,
        zatcaSubmissionMode: mode,
        zatcaResponse: JSON.stringify(response),
      },
    })

    await logActivity({
      user: auth,
      action: 'submitted',
      module: 'invoice',
      description: `Invoice ${invoice.invoiceNumber} submitted to ZATCA (Phase 2, ${mode}) — ${zatcaStatus}`,
      amount: round2(invoice.total),
    })

    return ok({
      zatcaStatus,
      zatcaSubmittedAt: submittedAt.toISOString(),
      mode,
      checks,
      response,
    })
  } catch (err) {
    console.error('[api/invoices/[id]/zatca/report POST]', err)
    return serverError()
  }
}
