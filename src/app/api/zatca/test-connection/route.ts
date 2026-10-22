// POST /api/zatca/test-connection — readiness report for e-invoicing:
// company details, national address, phase, onboarding state, and (for the
// online environments) whether the ZATCA gateway can be reached from this server.
import {
  ok,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import { readZatcaProfile, readSellerInfo, saveZatcaLastTest, isValidKsaVat, ZATCA_ENV_BASES, type ZatcaLastTest } from '@/lib/zatca'

export const dynamic = 'force-dynamic'

type LocalCheck = { name: string; ok: boolean; detail: string }

export async function POST() {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth
    const started = Date.now()
    const profile = await readZatcaProfile()
    const seller = await readSellerInfo()
    const a = seller.national
    const checks: LocalCheck[] = []

    checks.push({
      name: 'Company VAT number',
      ok: isValidKsaVat(seller.vatNumber),
      detail: isValidKsaVat(seller.vatNumber) ? `VAT ${seller.vatNumber}` : '15 digits, starting and ending with 3 — Settings → Company & Tax',
    })
    checks.push({ name: 'Company CR number', ok: Boolean(seller.crNumber), detail: seller.crNumber || 'Missing — Settings → Company & Tax' })
    const addrOk = Boolean(a.street && /^\d{4}$/.test(a.buildingNo) && a.district && a.city && /^\d{5}$/.test(a.postalCode))
    checks.push({
      name: 'National address',
      ok: addrOk,
      detail: addrOk ? `${a.buildingNo} ${a.street}, ${a.district}, ${a.city} ${a.postalCode}` : 'Street, 4-digit building no., district, city and 5-digit postal code are required for Phase 2',
    })
    checks.push({
      name: 'Phase',
      ok: true,
      detail: profile.mode === 'phase2' ? 'Phase 2 (Integration) — invoices are signed and sent to ZATCA' : 'Phase 1 (Generation) — QR only, nothing is sent to ZATCA',
    })
    if (profile.mode === 'phase2') {
      checks.push({
        name: 'Signing certificate',
        ok: profile.signingReady,
        detail:
          profile.signingWith === 'production'
            ? 'Production CSID'
            : profile.signingWith === 'compliance'
              ? 'Compliance CSID only — finish onboarding to send real invoices'
              : profile.signingWith === 'local-test'
                ? 'LOCAL TEST certificate — not valid with ZATCA'
                : 'Not onboarded — Settings → ZATCA → Onboarding',
      })
    }

    let httpStatus: number | undefined
    let error: string | undefined
    if (profile.env !== 'local') {
      try {
        const res = await fetch(`${ZATCA_ENV_BASES[profile.env]}/compliance`, {
          method: 'POST',
          headers: { 'Accept-Version': 'V2', 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(10000),
          cache: 'no-store',
        })
        httpStatus = res.status
        // any HTTP answer (400/401 for an empty request) proves the gateway is reachable
        checks.push({ name: 'ZATCA gateway reachable', ok: true, detail: `${ZATCA_ENV_BASES[profile.env]} answered (HTTP ${res.status})` })
      } catch (e) {
        error = e instanceof Error ? e.message : 'network error'
        checks.push({ name: 'ZATCA gateway reachable', ok: false, detail: `Cannot reach ZATCA from this server: ${error}` })
      }
    }

    const result: ZatcaLastTest = {
      at: new Date().toISOString(),
      ok: checks.every((c) => c.ok),
      mode: profile.env,
      httpStatus,
      error,
      latencyMs: Date.now() - started,
    }
    await saveZatcaLastTest(result)
    return ok({ ...result, checks })
  } catch {
    return serverError()
  }
}
