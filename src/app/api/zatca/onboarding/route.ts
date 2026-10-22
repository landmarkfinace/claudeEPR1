// POST /api/zatca/onboarding — EGS onboarding with ZATCA (Fatoora), the steps
// the Developer Portal / Fatoora portal prescribe:
//   1. action "compliance-csid"  { otp }  — CSR (secp256k1) → Compliance CSID
//   2. action "compliance-checks"        — signed sample documents of every
//                                          type the EGS will issue → /compliance/invoices
//   3. action "production-csid"          — Compliance request id → Production CSID
//   action "reset" clears the CSIDs of the active environment.
// The OTP comes from the Fatoora portal (fatoora.zatca.gov.sa → Onboard new
// solution unit/device), valid for one hour.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { ok, badRequest, serverError, requirePermission, isResponse, logActivity } from '@/lib/api-helpers'
import {
  buildCsrPem,
  certBodyFromToken,
  certInfoFromBase64,
  getZatcaKeys,
  readEgsIdentity,
  readZatcaProfile,
  readZatcaSecret,
  writeZatcaSetting,
  zatcaMessages,
  zatcaRequest,
  ZATCA_INITIAL_PIH,
  type ZatcaComplianceCheck,
  type ZatcaSigner,
} from '@/lib/zatca'
import { signUbl } from '@/lib/zatca-ubl'
import { buildUblDocument, readEInvoiceSellerInfo, validateForZatca, ksaDateTime } from '@/lib/e-invoice'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  action: z.enum(['compliance-csid', 'compliance-checks', 'production-csid', 'reset']),
  otp: z.string().trim().regex(/^\d{6}$/, 'The OTP is 6 digits').optional(),
})

const fail = (error: string, status = 400, extra?: Record<string, unknown>) =>
  NextResponse.json({ error, ...extra }, { status })

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('settings.edit')
    if (isResponse(auth)) return auth
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request')
    const { action, otp } = parsed.data

    const profile = await readZatcaProfile()
    if (profile.env === 'local') {
      return badRequest('Onboarding is not needed in the local test environment — choose Sandbox, Simulation or Production first')
    }
    const env = profile.env

    if (action === 'reset') {
      for (const k of ['zatca_ccsid_token', 'zatca_ccsid_secret', 'zatca_ccsid_request_id', 'zatca_ccsid_env', 'zatca_compliance_checks', 'zatca_pcsid_token', 'zatca_pcsid_secret', 'zatca_pcsid_env', 'zatca_pcsid_expiry']) {
        await writeZatcaSetting(k, null)
      }
      return ok(await readZatcaProfile())
    }

    // ── 1. Compliance CSID ──────────────────────────────────────────────────
    if (action === 'compliance-csid') {
      if (!otp) return badRequest('Enter the 6-digit OTP from the Fatoora portal')
      const seller = await readEInvoiceSellerInfo()
      const v = validateForZatca(
        { docType: 'invoice', invoiceKind: 'standard', clientNameEn: 'x', clientVatNumber: '300000000000003', clientCrNumber: null, clientAddressEn: null, buyerStreet: 'x', buyerBuildingNo: '1234', buyerDistrict: 'x', buyerCity: 'x', buyerPostalCode: '12345', buyerCountry: 'SA', issueDate: new Date(), supplyDate: new Date(), relatedInvoiceId: null, noteReason: null },
        [],
        seller,
        2
      ).errors.filter((e) => e.field.startsWith('seller.'))
      if (v.length > 0) return fail(`Complete the company details first: ${v.map((e) => e.message).join(' · ')}`, 400)

      if (!profile.egsSerial) {
        await writeZatcaSetting('zatca_egs_serial', `1-LandmarkERP|2-1.0|3-${randomUUID()}`)
      }
      const keys = await getZatcaKeys()
      const csr = buildCsrPem(keys, await readEgsIdentity(), env)
      await writeZatcaSetting('zatca_csr', csr)
      await writeZatcaSetting('zatca_csr_env', env)

      let r
      try {
        r = await zatcaRequest(env, '/compliance', {
          body: { csr: Buffer.from(csr, 'utf8').toString('base64') },
          headers: { OTP: otp },
        })
      } catch (e) {
        return fail(`Could not reach ZATCA (${e instanceof Error ? e.message : 'network error'})`, 502)
      }
      if (r.httpStatus !== 200 || typeof r.body.binarySecurityToken !== 'string') {
        const m = zatcaMessages(r.body)
        return fail(`ZATCA refused the request (HTTP ${r.httpStatus}): ${m.errors.join(' · ') || 'check the OTP (valid 1 hour) and the company VAT number'}`, 502)
      }
      await writeZatcaSetting('zatca_ccsid_token', r.body.binarySecurityToken as string)
      await writeZatcaSetting('zatca_ccsid_secret', String(r.body.secret ?? ''))
      await writeZatcaSetting('zatca_ccsid_request_id', String(r.body.requestID ?? ''))
      await writeZatcaSetting('zatca_ccsid_env', env)
      await writeZatcaSetting('zatca_compliance_checks', null)
      await logActivity({ user: auth, action: 'update', module: 'settings', description: `ZATCA compliance CSID received (${env})` })
      return ok(await readZatcaProfile())
    }

    const token = await readZatcaSecret('zatca_ccsid_token')
    const secret = await readZatcaSecret('zatca_ccsid_secret')
    if (!profile.complianceCsid || !token) return badRequest('Get the compliance CSID first (step 1)')

    // ── 2. Compliance checks ────────────────────────────────────────────────
    if (action === 'compliance-checks') {
      const seller = await readEInvoiceSellerInfo()
      const signer: ZatcaSigner = {
        keys: await getZatcaKeys(),
        cert: certInfoFromBase64(certBodyFromToken(token)),
        kind: 'compliance',
        env,
      }
      const kinds: ('standard' | 'simplified')[] = []
      if (profile.invoiceTypes[0] === '1') kinds.push('standard')
      if (profile.invoiceTypes[1] === '1') kinds.push('simplified')
      const docTypes: ('invoice' | 'credit_note' | 'debit_note')[] = ['invoice', 'credit_note', 'debit_note']
      const today = new Date(`${ksaDateTime(new Date()).date}T00:00:00.000Z`)
      let pih = ZATCA_INITIAL_PIH
      let icv = 0
      const results: ZatcaComplianceCheck[] = []
      for (const kind of kinds) {
        for (const docType of docTypes) {
          icv += 1
          const number = `TST-${kind === 'standard' ? 'S' : 'B'}-${docType === 'invoice' ? 'INV' : docType === 'credit_note' ? 'CRN' : 'DBN'}-${icv}`
          const doc = buildUblDocument(
            {
              docType,
              invoiceKind: kind,
              invoiceNumber: number,
              clientNameEn: 'Compliance Test Client Co.',
              clientVatNumber: kind === 'standard' ? '311111111111113' : null,
              clientCrNumber: null,
              clientAddressEn: null,
              buyerStreet: 'King Fahd Road',
              buyerBuildingNo: '1234',
              buyerDistrict: 'Al Olaya',
              buyerCity: 'Riyadh',
              buyerPostalCode: '12345',
              buyerCountry: 'SA',
              issueDate: today,
              supplyDate: today,
              dueDate: null,
              poRef: null,
              contractRef: null,
              paymentMeansCode: '30',
              relatedInvoiceId: docType === 'invoice' ? null : 'x',
              noteReason: docType === 'invoice' ? null : 'Compliance test adjustment',
            },
            [
              {
                sr: 1,
                descriptionEn: 'Manpower supply - compliance test',
                descriptionAr: '',
                unitEn: 'Hours',
                quantity: 10,
                unitPrice: 20,
                discount: 0,
                vatPercent: 15,
                taxCategory: 'S',
                exemptionCode: null,
                exemptionReason: null,
                taxableAmount: 200,
                vatAmount: 30,
              },
            ],
            seller,
            {
              uuid: randomUUID(),
              icv,
              pih,
              issuedAt: new Date(),
              billingReference: docType === 'invoice' ? null : `TST-${kind === 'standard' ? 'S' : 'B'}-INV-1`,
            }
          )
          const signed = signUbl(doc, signer)
          pih = signed.invoiceHash
          const name = `${kind === 'standard' ? 'Standard' : 'Simplified'} ${docType.replace('_', ' ')}`
          try {
            const r = await zatcaRequest(env, '/compliance/invoices', {
              body: { invoiceHash: signed.invoiceHash, uuid: doc.uuid, invoice: Buffer.from(signed.xml, 'utf8').toString('base64') },
              auth: { token, secret },
            })
            const m = zatcaMessages(r.body)
            const status = String(r.body.clearanceStatus ?? r.body.reportingStatus ?? `HTTP ${r.httpStatus}`)
            results.push({
              name,
              ok: (r.httpStatus === 200 || r.httpStatus === 202) && /CLEARED|REPORTED/i.test(status),
              status,
              messages: [...m.errors, ...m.warnings],
            })
          } catch (e) {
            results.push({ name, ok: false, status: 'network error', messages: [e instanceof Error ? e.message : 'network error'] })
          }
        }
      }
      await writeZatcaSetting('zatca_compliance_checks', JSON.stringify(results))
      await logActivity({
        user: auth,
        action: 'update',
        module: 'settings',
        description: `ZATCA compliance checks: ${results.filter((r) => r.ok).length}/${results.length} passed (${env})`,
      })
      return ok({ ...(await readZatcaProfile()), checks: results })
    }

    // ── 3. Production CSID ──────────────────────────────────────────────────
    if (action === 'production-csid') {
      const checks = profile.complianceChecks
      if (checks.length === 0 || checks.some((c) => !c.ok)) {
        return badRequest('All compliance checks must pass before requesting the production CSID (step 2)')
      }
      const requestId = await readZatcaSecret('zatca_ccsid_request_id')
      let r
      try {
        r = await zatcaRequest(env, '/production/csids', {
          body: { compliance_request_id: requestId },
          auth: { token, secret },
        })
      } catch (e) {
        return fail(`Could not reach ZATCA (${e instanceof Error ? e.message : 'network error'})`, 502)
      }
      if (r.httpStatus !== 200 || typeof r.body.binarySecurityToken !== 'string') {
        const m = zatcaMessages(r.body)
        return fail(`ZATCA refused the production CSID (HTTP ${r.httpStatus}): ${m.errors.join(' · ') || 'unknown error'}`, 502)
      }
      const pToken = r.body.binarySecurityToken as string
      await writeZatcaSetting('zatca_pcsid_token', pToken)
      await writeZatcaSetting('zatca_pcsid_secret', String(r.body.secret ?? ''))
      await writeZatcaSetting('zatca_pcsid_env', env)
      try {
        await writeZatcaSetting('zatca_pcsid_expiry', new Date(certInfoFromBase64(certBodyFromToken(pToken)).validTo).toISOString())
      } catch {
        /* expiry is informational */
      }
      await logActivity({ user: auth, action: 'update', module: 'settings', description: `ZATCA production CSID received (${env})` })
      return ok(await readZatcaProfile())
    }

    return badRequest('Unknown action')
  } catch (err) {
    console.error('[api/zatca/onboarding POST]', err)
    return serverError()
  }
}
