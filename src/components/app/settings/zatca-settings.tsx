'use client'

// Settings → ZATCA e-Invoicing panel.
//   1. Company phase (Phase 1 Generation / Phase 2 Integration) — ZATCA sets
//      this per taxpayer (wave notification), so it is a company setting.
//   2. National address of the company (mandatory in the Phase 2 XML).
//   3. Environment + EGS unit identity.
//   4. Onboarding with ZATCA: OTP → compliance CSID → compliance checks →
//      production CSID (online environments only).
//   5. Readiness check.
import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, CircleDashed, KeyRound, Loader2, PlugZap, RotateCcw, ShieldCheck, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ENV_HINTS,
  ENV_LABELS,
  ZATCA_ENV_GATEWAYS,
  ZatcaChecksList,
  type ZatcaEnv,
  type ZatcaMode,
  type ZatcaProfile,
  type ZatcaSellerAddress,
  type ZatcaTestResult,
} from '@/components/app/views/zatca-shared'

const EMPTY_ADDRESS: ZatcaSellerAddress = { street: '', buildingNo: '', additionalNo: '', district: '', city: '', postalCode: '' }

function StepState({ done, active }: { done: boolean; active: boolean }) {
  if (done) return <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
  return <CircleDashed className={cn('h-5 w-5 shrink-0', active ? 'text-[#B8942C]' : 'text-muted-foreground/50')} />
}

export function ZatcaSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const [profile, setProfile] = useState<ZatcaProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<ZatcaTestResult | null>(null)

  const [mode, setMode] = useState<ZatcaMode>('phase1')
  const [env, setEnv] = useState<ZatcaEnv>('local')
  const [addr, setAddr] = useState<ZatcaSellerAddress>(EMPTY_ADDRESS)
  const [egsName, setEgsName] = useState('')
  const [branchName, setBranchName] = useState('')
  const [industry, setIndustry] = useState('')
  const [invoiceTypes, setInvoiceTypes] = useState<ZatcaProfile['invoiceTypes']>('1100')
  const [otp, setOtp] = useState('')

  const apply = useCallback((p: ZatcaProfile) => {
    setProfile(p)
    setMode(p.mode)
    setEnv(p.env)
    setAddr(p.sellerAddress ?? EMPTY_ADDRESS)
    setEgsName(p.egsName)
    setBranchName(p.branchName)
    setIndustry(p.industry)
    setInvoiceTypes(p.invoiceTypes)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      apply(await api.get<ZatcaProfile>('/api/zatca/profile'))
    } catch {
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [apply])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (saving) return
    if (mode === 'phase2' && profile?.mode !== 'phase2') {
      const sure = window.confirm(
        'Switch the company to ZATCA Phase 2?\n\nOnly do this when ZATCA has told you your integration date (Fatoora portal / ZATCA notice). From now on every new invoice is signed and must be cleared or reported to ZATCA.'
      )
      if (!sure) return
    }
    setSaving(true)
    try {
      const p = await api.put<ZatcaProfile>('/api/zatca/profile', {
        mode,
        env,
        sellerAddress: addr,
        egsName: egsName.trim(),
        branchName: branchName.trim(),
        industry: industry.trim(),
        invoiceTypes,
      })
      apply(p)
      toast.success('ZATCA settings saved')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save ZATCA settings')
    } finally {
      setSaving(false)
    }
  }

  async function onboard(action: 'compliance-csid' | 'compliance-checks' | 'production-csid' | 'reset') {
    if (busy) return
    if (action === 'reset' && !window.confirm(`Remove the ZATCA certificates for ${ENV_LABELS[env]}? You will need a new OTP.`)) return
    setBusy(action)
    try {
      const p = await api.post<ZatcaProfile>('/api/zatca/onboarding', { action, ...(action === 'compliance-csid' ? { otp } : {}) })
      apply(p)
      if (action === 'compliance-csid') {
        setOtp('')
        toast.success('Compliance CSID received from ZATCA — now run the compliance checks')
      } else if (action === 'compliance-checks') {
        const passed = p.complianceChecks.filter((c) => c.ok).length
        if (passed === p.complianceChecks.length) toast.success(`All ${passed} compliance checks passed`)
        else toast.error(`${p.complianceChecks.length - passed} compliance check(s) failed — see the list`)
      } else if (action === 'production-csid') {
        toast.success('Production CSID received — Phase 2 invoices can now be sent to ZATCA')
      } else toast.success('Certificates removed')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'ZATCA onboarding failed', { duration: 12000 })
    } finally {
      setBusy(null)
    }
  }

  async function runTest() {
    if (busy) return
    setBusy('test')
    setTestResult(null)
    try {
      const r = await api.post<ZatcaTestResult>('/api/zatca/test-connection', {})
      setTestResult(r)
      if (r.ok) toast.success('ZATCA readiness check passed')
      else toast.error('Some ZATCA readiness checks failed — see below')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Readiness check failed')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading ZATCA settings…
      </p>
    )
  }
  if (!profile) {
    return (
      <Button variant="outline" size="sm" onClick={() => void load()}>
        <RotateCcw className="h-3.5 w-3.5" /> Retry loading ZATCA settings
      </Button>
    )
  }

  const savedEnv = profile.env
  const dirty =
    mode !== profile.mode ||
    env !== profile.env ||
    JSON.stringify(addr) !== JSON.stringify(profile.sellerAddress) ||
    egsName !== profile.egsName ||
    branchName !== profile.branchName ||
    industry !== profile.industry ||
    invoiceTypes !== profile.invoiceTypes
  const checks = profile.complianceChecks
  const checksPassed = checks.length > 0 && checks.every((c) => c.ok)
  const setA = (k: keyof ZatcaSellerAddress, v: string) => setAddr((a) => ({ ...a, [k]: v }))

  return (
    <div className="space-y-5">
      {/* 1 — Phase */}
      <div className="space-y-2">
        <Label>Company ZATCA phase</Label>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              {
                v: 'phase1',
                title: 'Phase 1 · Generation',
                text: 'Electronic invoices with the ZATCA QR code (5 tags). Nothing is sent to ZATCA.',
              },
              {
                v: 'phase2',
                title: 'Phase 2 · Integration',
                text: 'Every invoice is signed with the ZATCA certificate; standard invoices are cleared, simplified ones reported.',
              },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={mode === o.v}
              disabled={!canEdit}
              onClick={() => setMode(o.v)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed',
                mode === o.v
                  ? 'border-[#132A4A] bg-[#132A4A]/[0.04] ring-1 ring-[#132A4A]/30 dark:border-[#E1B169]/50 dark:bg-[#0C1D33]/50'
                  : 'border-border hover:border-muted-foreground/40'
              )}
            >
              <p className="text-sm font-semibold">{o.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{o.text}</p>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          ZATCA decides when a company moves to Phase 2 (wave notification on the Fatoora portal). Switch only
          on your integration date, after onboarding is complete.
        </p>
      </div>

      {/* 2 — National address */}
      <div className="space-y-3 rounded-lg border p-4">
        <p className="text-sm font-semibold">Company national address (Saudi Post / National Address)</p>
        <div className="grid gap-3 sm:grid-cols-6">
          <div className="space-y-1 sm:col-span-3">
            <Label htmlFor="z-street" className="text-xs">Street name</Label>
            <Input id="z-street" value={addr.street} onChange={(e) => setA('street', e.target.value)} disabled={!canEdit} placeholder="4th Street" />
          </div>
          <div className="space-y-1 sm:col-span-1">
            <Label htmlFor="z-bldg" className="text-xs">Building no.</Label>
            <Input id="z-bldg" value={addr.buildingNo} onChange={(e) => setA('buildingNo', e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={!canEdit} placeholder="5526" inputMode="numeric" className="font-mono" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="z-add" className="text-xs">Additional no.</Label>
            <Input id="z-add" value={addr.additionalNo} onChange={(e) => setA('additionalNo', e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={!canEdit} placeholder="1234" inputMode="numeric" className="font-mono" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="z-district" className="text-xs">District</Label>
            <Input id="z-district" value={addr.district} onChange={(e) => setA('district', e.target.value)} disabled={!canEdit} placeholder="Al Wahah" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="z-city" className="text-xs">City</Label>
            <Input id="z-city" value={addr.city} onChange={(e) => setA('city', e.target.value)} disabled={!canEdit} placeholder="Jubail" />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="z-postal" className="text-xs">Postal code</Label>
            <Input id="z-postal" value={addr.postalCode} onChange={(e) => setA('postalCode', e.target.value.replace(/\D/g, '').slice(0, 5))} disabled={!canEdit} placeholder="35712" inputMode="numeric" className="font-mono" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Required on every Phase 2 invoice: 4-digit building number and 5-digit postal code.</p>
      </div>

      {/* 3 — Environment + EGS */}
      <div className="space-y-3 rounded-lg border p-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <PlugZap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          ZATCA connection (Phase 2)
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="z-env" className="text-xs">Environment</Label>
            <Select value={env} onValueChange={(v) => setEnv(v as ZatcaEnv)} disabled={!canEdit}>
              <SelectTrigger id="z-env" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local test (offline)</SelectItem>
                <SelectItem value="sandbox">Sandbox — Developer Portal</SelectItem>
                <SelectItem value="simulation">Simulation — Fatoora</SelectItem>
                <SelectItem value="production">Production — LIVE</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{ENV_HINTS[env]}</p>
            <p className="break-all font-mono text-[11px] text-muted-foreground">{ZATCA_ENV_GATEWAYS[env]}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="z-types" className="text-xs">Invoice types this system issues</Label>
            <Select value={invoiceTypes} onValueChange={(v) => setInvoiceTypes(v as ZatcaProfile['invoiceTypes'])} disabled={!canEdit}>
              <SelectTrigger id="z-types" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1100">Standard (B2B) and Simplified (B2C)</SelectItem>
                <SelectItem value="1000">Standard (B2B) only</SelectItem>
                <SelectItem value="0100">Simplified (B2C) only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Written into the ZATCA certificate request; change it before onboarding.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="z-egsname" className="text-xs">EGS unit name</Label>
            <Input id="z-egsname" value={egsName} onChange={(e) => setEgsName(e.target.value)} disabled={!canEdit} placeholder="EGS-ERP-1" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="z-branch" className="text-xs">Branch name</Label>
            <Input id="z-branch" value={branchName} onChange={(e) => setBranchName(e.target.value)} disabled={!canEdit} placeholder="Jubail Head Office" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="z-ind" className="text-xs">Industry</Label>
            <Input id="z-ind" value={industry} onChange={(e) => setIndustry(e.target.value)} disabled={!canEdit} placeholder="Manpower Supply" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">EGS serial (auto)</Label>
            <p className="break-all rounded-md border bg-muted/40 px-2.5 py-2 font-mono text-xs">{profile.egsSerial || 'Created at onboarding'}</p>
          </div>
        </div>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Save ZATCA settings
          </Button>
          {dirty ? <span className="text-xs text-amber-600">Unsaved changes</span> : null}
        </div>
      ) : null}

      {/* 4 — Onboarding */}
      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <KeyRound className="h-4 w-4 text-[#B8942C]" />
            Onboarding with ZATCA — {ENV_LABELS[savedEnv]}
          </p>
          <Badge variant="secondary" className="font-medium">
            {profile.signingWith === 'production'
              ? 'Ready: production CSID'
              : profile.signingWith === 'compliance'
                ? 'Compliance CSID only'
                : profile.signingWith === 'local-test'
                  ? 'Local test certificate'
                  : 'Not onboarded'}
          </Badge>
        </div>

        {savedEnv === 'local' ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            The local test environment needs no onboarding: invoices are signed with a self-signed TEST
            certificate so you can try the whole Phase 2 flow. Choose Sandbox, Simulation or Production and save to
            onboard with ZATCA.
          </p>
        ) : (
          <ol className="space-y-3">
            <li className="flex gap-3">
              <StepState done={profile.complianceCsid} active={!profile.complianceCsid} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium">1. Compliance CSID (OTP)</p>
                <p className="text-xs text-muted-foreground">
                  {savedEnv === 'sandbox'
                    ? 'Developer Portal sandbox: use OTP 123345.'
                    : 'Log in to fatoora.zatca.gov.sa → Onboard new solution unit/device → generate an OTP (valid 1 hour).'}
                </p>
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6-digit OTP"
                      inputMode="numeric"
                      className="w-40 font-mono"
                      aria-label="ZATCA OTP"
                    />
                    <Button variant="outline" onClick={() => void onboard('compliance-csid')} disabled={otp.length !== 6 || !!busy || dirty}>
                      {busy === 'compliance-csid' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {profile.complianceCsid ? 'Request again' : 'Get compliance CSID'}
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
            <li className="flex gap-3">
              <StepState done={checksPassed} active={profile.complianceCsid && !checksPassed} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium">2. Compliance checks</p>
                <p className="text-xs text-muted-foreground">
                  Sends signed sample invoices, credit notes and debit notes of every selected type to ZATCA for validation.
                </p>
                {canEdit ? (
                  <Button variant="outline" onClick={() => void onboard('compliance-checks')} disabled={!profile.complianceCsid || !!busy}>
                    {busy === 'compliance-checks' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Run compliance checks
                  </Button>
                ) : null}
                {checks.length > 0 ? (
                  <ul className="space-y-1">
                    {checks.map((c) => (
                      <li key={c.name} className="rounded-md border bg-card p-2 text-xs">
                        <p className="flex items-center gap-1.5 font-medium">
                          {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-rose-600" />}
                          {c.name} <span className="font-normal text-muted-foreground">— {c.status}</span>
                        </p>
                        {(c.messages ?? []).map((m, i) => (
                          <p key={i} className="mt-0.5 pl-5 text-muted-foreground">{m}</p>
                        ))}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
            <li className="flex gap-3">
              <StepState done={profile.productionCsid} active={checksPassed && !profile.productionCsid} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium">3. Production CSID</p>
                <p className="text-xs text-muted-foreground">
                  The certificate real invoices are signed with.
                  {profile.productionCsidExpiry ? ` Valid until ${formatDateTime(profile.productionCsidExpiry)} — renew before it expires.` : ''}
                </p>
                {canEdit ? (
                  <Button onClick={() => void onboard('production-csid')} disabled={!checksPassed || !!busy}>
                    {busy === 'production-csid' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Get production CSID
                  </Button>
                ) : null}
              </div>
            </li>
            {canEdit && (profile.complianceCsid || profile.productionCsid) ? (
              <li>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => void onboard('reset')} disabled={!!busy}>
                  Remove certificates for {ENV_LABELS[savedEnv]}
                </Button>
              </li>
            ) : null}
          </ol>
        )}
        {dirty && savedEnv !== 'local' ? (
          <p className="text-xs text-amber-600">Save the settings above before onboarding.</p>
        ) : null}
      </div>

      {/* 5 — Readiness */}
      <div className="space-y-2">
        <Button variant="outline" onClick={() => void runTest()} disabled={!!busy}>
          {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Check ZATCA readiness
        </Button>
        {testResult ? <ZatcaChecksList checks={testResult.checks} /> : null}
      </div>
    </div>
  )
}
