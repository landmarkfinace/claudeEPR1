'use client'

// Shared ZATCA UI primitives — used by the E-Invoice module's submission
// dialog (e-invoice-zatca-submit.tsx) and the Settings → ZATCA connection
// section (settings.tsx). Extracted from the retired classic Invoice module
// so those pieces survive its removal.
//
//   • ZatcaStatusBadge  — reported | cleared | rejected pill
//   • ZatcaChecksList   — severity-colored validation checklist
//   • ZatcaProfile / ZatcaCheck / ZatcaTestResult — API payload types
//   • ZATCA_ENV_GATEWAYS / ENV_LABELS — client-safe Fatoora gateway constants
import { CheckCircle2, XCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'

export type ZatcaEnv = 'local' | 'sandbox' | 'simulation' | 'production'
export type ZatcaMode = 'phase1' | 'phase2'

/** Fatoora gateway URLs (client-safe copy of the server-side ZATCA_ENV_BASES). */
export const ZATCA_ENV_GATEWAYS: Record<ZatcaEnv, string> = {
  local: '— nothing is sent —',
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
}

export const ENV_LABELS: Record<ZatcaEnv, string> = {
  local: 'Local test',
  sandbox: 'Sandbox',
  simulation: 'Simulation',
  production: 'Production',
}

export const ENV_HINTS: Record<ZatcaEnv, string> = {
  local: 'Offline trial with a self-signed TEST certificate. Nothing reaches ZATCA and nothing produced here is legally valid.',
  sandbox: 'ZATCA Developer Portal — free technical testing. Use OTP 123345 (ZATCA sandbox OTP). No legal effect.',
  simulation: 'ZATCA Simulation portal — rehearsal with your real VAT number (OTP from fatoora.zatca.gov.sa → Simulation). No legal effect.',
  production: 'ZATCA Core — LIVE. Invoices are legally cleared / reported. OTP from fatoora.zatca.gov.sa.',
}

export type ZatcaSellerAddress = {
  street: string
  buildingNo: string
  additionalNo: string
  district: string
  city: string
  postalCode: string
}

export type ZatcaComplianceCheck = { name: string; ok: boolean; status?: string; messages?: string[] }

/** GET /api/zatca/profile — keys, CSIDs and secrets never leave the server. */
export type ZatcaProfile = {
  mode: ZatcaMode
  env: ZatcaEnv
  apiBase: string
  egsSerial: string
  egsName: string
  branchName: string
  industry: string
  invoiceTypes: '1100' | '1000' | '0100'
  sellerAddress: ZatcaSellerAddress
  keysReady: boolean
  csrReady: boolean
  csrEnv: ZatcaEnv | null
  complianceCsid: boolean
  complianceChecks: ZatcaComplianceCheck[]
  productionCsid: boolean
  productionCsidExpiry: string | null
  signingReady: boolean
  signingWith: 'production' | 'compliance' | 'local-test' | null
  lastTest: {
    at: string
    ok: boolean
    mode: ZatcaEnv
    httpStatus?: number
    error?: string
    latencyMs: number
  } | null
}

export type ZatcaCheck = {
  name: string
  ok: boolean
  severity?: 'error' | 'warning'
  detail: string
}

/** POST /api/zatca/test-connection result. */
export type ZatcaTestResult = {
  ok: boolean
  mode: ZatcaEnv
  checks: ZatcaCheck[]
  note?: string
  error?: string
  httpStatus?: number
  latencyMs: number
}

/** Submission-status badge (used in e-invoice list rows and dialogs). */
export function ZatcaStatusBadge({
  status,
  className,
}: {
  status: string | null
  className?: string
}) {
  if (status === 'cleared') {
    return (
      <Badge
        className={cn(
          'gap-1 border-emerald-200 bg-emerald-50 font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
          className
        )}
      >
        <CheckCircle2 className="h-3 w-3" />
        Cleared
      </Badge>
    )
  }
  if (status === 'reported') {
    return (
      <Badge
        className={cn(
          'border-amber-200 bg-amber-50 font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
          className
        )}
      >
        Reported
      </Badge>
    )
  }
  if (status === 'pending') {
    return (
      <Badge className={cn('border-sky-200 bg-sky-50 font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300', className)}>
        Not sent yet
      </Badge>
    )
  }
  if (status === 'local_only') {
    return (
      <Badge className={cn('border-slate-300 bg-slate-100 font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300', className)}>
        Local test only
      </Badge>
    )
  }
  if (status === 'compliance_passed' || status === 'compliance_failed') {
    return (
      <Badge
        className={cn(
          'font-medium',
          status === 'compliance_passed'
            ? 'border-success/25 bg-success-soft text-success-soft-foreground'
            : 'border-danger/25 bg-danger-soft text-danger-soft-foreground',
          className
        )}
      >
        Test check {status === 'compliance_passed' ? 'passed' : 'failed'}
      </Badge>
    )
  }
  if (status === 'rejected') {
    return (
      <Badge
        className={cn(
          'border-rose-200 bg-rose-50 font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300',
          className
        )}
      >
        Rejected
      </Badge>
    )
  }
  return null
}

/** The validation checklist shared by the report + test-connection results. */
export function ZatcaChecksList({ checks }: { checks: ZatcaCheck[] }) {
  if (checks.length === 0) return null
  return (
    <ul className="space-y-1.5">
      {checks.map((c) => (
        <li
          key={c.name}
          className="flex items-start gap-2 rounded-md border bg-card p-2 text-xs"
        >
          {c.ok ? (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <XCircle
              className={cn(
                'mt-0.5 h-3.5 w-3.5 shrink-0',
                c.severity === 'warning'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-rose-600 dark:text-rose-400'
              )}
            />
          )}
          <div className="min-w-0">
            <p className="font-medium">
              {c.name}
              {!c.ok && c.severity === 'warning' ? (
                <span className="ml-1.5 rounded border border-amber-200 bg-amber-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                  warning
                </span>
              ) : null}
              {!c.ok && c.severity !== 'warning' ? (
                <span className="ml-1.5 rounded border border-rose-200 bg-rose-50 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
                  error
                </span>
              ) : null}
            </p>
            <p className="text-muted-foreground">{c.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
