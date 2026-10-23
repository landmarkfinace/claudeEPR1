'use client'

// Per-client billing statement print preview — one company's monthly manpower
// summary: every billed worker with their PAYROLL hours for the month (regular +
// overtime, exactly the same numbers as the salary sheet) and the manually-
// entered client rate per hour, then Subtotal + 15% VAT + Grand Total. Styled
// after the company letterhead (navy rule + gold accent), A4 portrait.
//
// TEMPLATE DISPATCH — the dialog offers the module's print layouts:
//   classic    the original approved layout (the DEFAULT) — its rendering
//              code is UNTOUCHED and byte-identical (moved verbatim into
//              ClientSummaryClassicDocument below)
//   bycategory the By-Category folder-tab design (01 Bill To & Period /
//              02 Workers By Category / 03 Category Summary / 04 Billing
//              Summary / 05 Approval) with the automatic OT-column variant
//
// The template is a PRINT OPTION ONLY (no database column, nothing saved):
// switching never changes any hours, rate, OT rate, amount, subtotal, VAT or
// grand total — only the look of the printout. "Show OT columns" is likewise
// a per-print checkbox (auto-ON when any worker has OT hours billed at a
// rate different from their normal rate).
import { Fragment, useEffect, useMemo, useState } from 'react'
import { Printer, FileDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { formatDateTime, formatMoney, formatNumber, monthName } from '@/lib/format'
import { downloadPrintAreaAsPdf, printPrintArea } from '@/lib/print-to-pdf'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api-client'
import type { AppSettings, ClientSalaryGroup, LetterheadConfig } from '@/lib/types'
import {
  CLIENT_SUMMARY_TEMPLATES,
  resolveClientSummaryTemplate,
  type ClientSummaryTemplateId,
} from '@/lib/client-summary-print-templates'
import { DEFAULT_LETTERHEAD, hasDistinctOtRates } from './client-summary-print-shared'
import { ClientSummaryByCategoryDocument } from './client-summary-print-by-category'

/** "212" | "212.5" — integers stay clean, fractions keep 2dp */
function fmtHours(n: number): string {
  return Number.isInteger(n) ? String(n) : formatNumber(n, 2)
}

const ONES = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function toWords(n: number): string {
  if (n < 0) return `Minus ${toWords(-n)}`
  if (n < 20) return ONES[n]
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`
  if (n < 1000)
    return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${toWords(n % 100)}` : ''}`
  if (n < 1_000_000)
    return `${toWords(Math.floor(n / 1000))} Thousand${n % 1000 ? ` ${toWords(n % 1000)}` : ''}`
  return `${toWords(Math.floor(n / 1_000_000))} Million${n % 1_000_000 ? ` ${toWords(n % 1_000_000)}` : ''}`
}

/** "SAR Twenty-Three Thousand Four Hundred Fifty and 50 Halalas Only" */
function amountInWords(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100
  const units = Math.floor(rounded)
  const halalas = Math.round((rounded - units) * 100)
  let s = `${currency} ${toWords(units)}`
  if (halalas > 0) s += ` and ${toWords(halalas)} Halalas`
  return `${s} Only`
}

const SIGNATURES = [
  { label: 'Prepared By', title: 'Accounts Department' },
  { label: 'Approved By', title: 'General Manager' },
  { label: 'Accepted By', title: 'Client Representative' },
]

/**
 * The ORIGINAL approved summary layout — moved VERBATIM out of the dialog so
 * the Settings template preview can render it too. The markup is unchanged:
 * rendering this component produces exactly the same output the dialog has
 * always printed (Classic stays the byte-identical default).
 */
export function ClientSummaryClassicDocument({
  group,
  month,
  year,
  vatRate,
  settings,
}: {
  group: ClientSalaryGroup
  month: number
  year: number
  vatRate: number
  settings: AppSettings
}) {
  const money = (n: number) => formatMoney(n, settings.currency)
  const vatPercent = Math.round(vatRate * 100)

  // Rows grouped by project (rates are entered per worker inside each project)
  const byProject = useMemo(() => {
    const map = new Map<string, { name: string; rows: typeof group.rows }>()
    for (const r of group.rows) {
      let p = map.get(r.projectId)
      if (!p) {
        p = { name: r.projectName, rows: [] }
        map.set(r.projectId, p)
      }
      p.rows.push(r)
    }
    return Array.from(map.values())
  }, [group])

  const hasOt = (group?.otHours ?? 0) > 0 || (group?.rows.some((r) => r.otHours > 0) ?? false)

  const periodLabel = `${monthName(month)} ${year}`
  const th =
    'border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800'
  const thR = `${th} text-right`
  const td = 'border border-neutral-300 px-1.5 py-1 align-top text-neutral-900'
  const tdR = `${td} text-right tabular-nums`

  return (
    <div className="print-area mx-auto min-w-[640px] max-w-[820px] bg-white p-6 text-neutral-900 shadow-sm print:min-w-0 print:max-w-none print:p-0">
      {/* Company letterhead — brand navy rule + gold accent */}
      <div className="flex items-start justify-between gap-6 border-b-2 border-[#0F1F3D] pb-4">
        <div className="flex items-center gap-3">
          <img
            src={settings.logo ?? '/logo-mark.png'}
            alt={`${settings.companyName} logo`}
            className="h-16 w-16 rounded object-contain"
          />
          <div>
            <h1 className="text-xl font-bold uppercase tracking-[0.3pt] text-[#0F1F3D]">
              {settings.companyName}
            </h1>
            <p className="text-xs font-semibold uppercase tracking-[0.3pt] text-[#B8942C]">
              Client Salary Summary — Manpower Billing
            </p>
            {settings.address ? (
              <p className="text-[10pt] text-neutral-500">{settings.address}</p>
            ) : null}
            <p className="text-[10pt] text-neutral-500">
              {[settings.phone, settings.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[10pt] font-semibold uppercase tracking-[0.3pt] text-neutral-500">
            Billing Period
          </p>
          <p className="text-base font-bold text-[#0F1F3D]">{periodLabel}</p>
          <p className="mt-2 text-[10pt] font-semibold uppercase tracking-[0.3pt] text-neutral-500">
            Grand Total (incl. {vatPercent}% VAT)
          </p>
          <p className="text-xl font-bold tabular-nums">{money(group.grandTotal)}</p>
        </div>
      </div>
      <div className="mt-[3px] h-[3px] w-28 bg-[#D4AF37]" aria-hidden />

      {/* Bill-To block */}
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10pt] font-semibold uppercase tracking-[0.3pt] text-neutral-500">
            Bill To
          </p>
          <p className="mt-0.5 text-base font-bold text-[#0F1F3D]">{group.clientName}</p>
          <p className="text-[11pt] leading-relaxed text-[#1D2433]">
            {[
              group.address,
              group.city,
              group.contactPerson ? `Attn: ${group.contactPerson}` : null,
              group.phone,
              group.email,
              group.crNumber ? `CR No: ${group.crNumber}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </p>
        </div>
        <div className="text-right text-[11pt] text-[#1D2433]">
          <p>
            <span className="font-semibold text-neutral-800">Workers:</span>{' '}
            {group.workerCount}
          </p>
          <p>
            <span className="font-semibold text-neutral-800">Projects:</span>{' '}
            {group.projectCount}
          </p>
          <p>
            <span className="font-semibold text-neutral-800">Total Hours:</span>{' '}
            {fmtHours(group.hours)}
            {group.otHours > 0 ? ` + ${fmtHours(group.otHours)} OT` : ''}
          </p>
          <p className="text-[9pt] text-[#6B7488]">
            Generated: {formatDateTime(new Date())}
          </p>
        </div>
      </div>

      {/* Billing table — one line per worker (× project) */}
      <table className="mt-4 w-full border-collapse text-[11pt]">
        <thead>
          <tr>
            <th className={`${th} text-center`}>SN</th>
            <th className={th}>Worker</th>
            <th className={th}>Position</th>
            <th className={th}>Project</th>
            <th className={thR}>Hours</th>
            <th className={thR}>OT Hrs</th>
            <th className={thR}>Rate / Hr</th>
            <th className={thR}>OT Rate</th>
            <th className={thR}>Amount ({settings.currency})</th>
          </tr>
        </thead>
        <tbody>
          {byProject.map((p) => (
            <Fragment key={p.name}>
              {p.rows.map((r, i) => (
                <tr key={`${r.staffId}-${r.projectId}`} className="break-inside-avoid">
                  <td className={`${td} text-center tabular-nums`}>{i + 1}</td>
                  <td className={td}>
                    <span className="font-semibold">{r.fullName}</span>
                    <span className="block text-[9pt] text-neutral-500">
                      IQAMA: {r.iqamaId}
                    </span>
                  </td>
                  <td className={td}>{r.position ?? '—'}</td>
                  <td className={td}>
                    <span className="font-medium">{r.projectName}</span>
                  </td>
                  <td className={tdR}>{fmtHours(r.hours)}</td>
                  <td className={tdR}>{r.otHours > 0 ? fmtHours(r.otHours) : '—'}</td>
                  <td className={tdR}>{formatNumber(r.clientRate)}</td>
                  <td className={tdR}>{r.otHours > 0 ? formatNumber(r.clientOtRate) : '—'}</td>
                  <td className={`${tdR} font-semibold`}>{money(r.amount)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className={`${td} bg-neutral-50`} colSpan={4}>
              <span className="font-semibold">SUBTOTAL — {group.workerCount} worker{group.workerCount === 1 ? '' : 's'}</span>
            </td>
            <td className={`${tdR} bg-neutral-50 font-semibold`}>{fmtHours(group.hours)}</td>
            <td className={`${tdR} bg-neutral-50 font-semibold`}>
              {group.otHours > 0 ? fmtHours(group.otHours) : '—'}
            </td>
            <td className={`${tdR} bg-neutral-50`}></td>
            <td className={`${tdR} bg-neutral-50`}></td>
            <td className={`${tdR} bg-neutral-50 font-semibold`}>
              {money(group.billedAmount)}
            </td>
          </tr>
          <tr>
            <td
              className={`${td} bg-neutral-50`}
              colSpan={8}
            >
              <span className="font-semibold">VAT ({vatPercent}%)</span>
            </td>
            <td className={`${tdR} bg-neutral-50 font-semibold`}>{money(group.vatAmount)}</td>
          </tr>
          <tr className="bg-[#0F1F3D] font-bold text-white">
            <td className="border border-[#0F1F3D] px-1.5 py-1.5" colSpan={8}>
              GRAND TOTAL (incl. {vatPercent}% VAT)
            </td>
            <td className="border border-[#0F1F3D] px-1.5 py-1.5 text-right tabular-nums">
              {money(group.grandTotal)}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Amount in words */}
      <p className="mt-3 text-[11pt] text-[#1D2433]">
        <span className="font-semibold">Amount in Words: </span>
        <span className="uppercase">{amountInWords(group.grandTotal, settings.currency)}</span>
      </p>

      {/* Payment note */}
      <p className="mt-2 text-[10pt] leading-relaxed text-neutral-500">
        This statement covers manpower supply services for {periodLabel}: each worker&apos;s
        payroll hours (regular{hasOt ? ' + overtime' : ''}) × the agreed client rate per hour.
        Hours match the {periodLabel} payroll exactly. Worker salaries are disbursed separately
        by {settings.companyName} under its own payroll.
      </p>

      {/* Signature blocks */}
      <div className="mt-12 grid grid-cols-3 gap-8">
        {SIGNATURES.map((s) => (
          <div key={s.label}>
            <div className="h-10" aria-hidden="true" />
            <div className="border-t border-dashed border-neutral-600" />
            <p className="mt-1.5 text-xs font-semibold">{s.label}</p>
            <p className="text-[10pt] text-neutral-500">{s.title}</p>
          </div>
        ))}
      </div>

      {/* Footer note */}
      <p className="mt-8 border-t border-neutral-200 pt-2 text-center text-[9pt] text-[#6B7488]">
        This client salary summary is computer-generated by the {settings.companyName}{' '}
        Workforce, Payroll &amp; Accounts System · Generated on{' '}
        {formatDateTime(new Date())}
      </p>
    </div>
  )
}

export function ClientSummaryPrintDialog({
  open,
  onOpenChange,
  group,
  month,
  year,
  vatRate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: ClientSalaryGroup | null
  month: number
  year: number
  vatRate: number
}) {
  const settings = useAppStore((s) => s.settings)

  const [tpl, setTpl] = useState<ClientSummaryTemplateId>('classic')
  const [showOt, setShowOt] = useState(true)
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)
  const isClassic = tpl === 'classic'

  // Classic keeps the print pipeline's flow behaviour (A4 portrait with the
  // app margins); the By-Category template renders fixed A4 sheets at 0 margin.
  usePageRule(open, isClassic ? 'size: A4 portrait; margin: 10mm;' : 'size: A4; margin: 0;')

  // reset the working template + OT preference whenever a summary opens:
  // template ← the module default from Settings; OT columns ← auto-detected
  // (ON when any worker has OT hours at a rate different from their normal rate)
  const [openKey, setOpenKey] = useState<string | null>(null)
  if (!open && openKey !== null) {
    setOpenKey(null)
  }
  if (open && group) {
    const key = `${group.clientId ?? '_none'}-${month}-${year}`
    if (key !== openKey) {
      setOpenKey(key)
      setTpl(resolveClientSummaryTemplate(settings.clientSummaryDefaultTemplate))
      setShowOt(hasDistinctOtRates(group.rows))
    }
  }

  // letterhead artwork for the By-Category template (Classic keeps its own
  // brand header — untouched)
  useEffect(() => {
    if (!open || isClassic || letterhead) return
    let alive = true
    api
      .get<LetterheadConfig>('/api/letterhead')
      .then((lh) => {
        if (alive) setLetterhead(lh)
      })
      .catch(() => {
        /* without letterhead config the reserved bands stay empty */
      })
    return () => {
      alive = false
    }
  }, [open, isClassic, letterhead])

  if (!group) return null

  const otAuto = hasDistinctOtRates(group.rows)
  const periodLabel = `${monthName(month)} ${year}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Client summary print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable monthly billing summary for {group.clientName}
        </DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">{group.clientName} — Billing Statement</h2>
            <p className="text-xs text-muted-foreground">
              {periodLabel} · {group.workerCount} worker{group.workerCount === 1 ? '' : 's'} ·{' '}
              {fmtHours(group.hours)} hours
              {group.otHours > 0 ? ` + ${fmtHours(group.otHours)} OT` : ''} · A4 portrait
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={tpl} onValueChange={(v) => setTpl(v as ClientSummaryTemplateId)}>
              <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Summary template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLIENT_SUMMARY_TEMPLATES.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button
              variant="outline"
              onClick={(e) =>
                void downloadPrintAreaAsPdf(
                  `Client-Summary-${group.clientName}-${monthName(month)}-${year}`,
                  e.currentTarget
                )
              }
            >
              <FileDown className="h-4 w-4" />
              Download PDF
            </Button>
            <Button onClick={(e) => printPrintArea(e.currentTarget)}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
          </div>
          {/* OT-column control — By-Category template only (print option, never stored) */}
          {!isClassic ? (
            <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-1">
              <label
                className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium"
                title="Force the OT columns on or off for this print"
              >
                <Checkbox
                  checked={showOt}
                  onCheckedChange={(v) => setShowOt(v === true)}
                  aria-label="Show OT columns"
                />
                Show OT columns
              </label>
              {otAuto ? (
                <span className="text-xs italic text-muted-foreground">
                  OT columns shown because some OT rates differ from normal rates
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Scrollable preview */}
        <div className="nice-scrollbar flex-1 overflow-auto bg-neutral-100 p-3 sm:p-6 print:overflow-visible print:bg-white print:p-0">
          {isClassic ? (
            <ClientSummaryClassicDocument
              group={group}
              month={month}
              year={year}
              vatRate={vatRate}
              settings={settings}
            />
          ) : (
            <ClientSummaryByCategoryDocument
              group={group}
              month={month}
              year={year}
              vatRate={vatRate}
              settings={settings}
              letterhead={letterhead ?? DEFAULT_LETTERHEAD}
              showOt={showOt}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Renders one client salary summary in the selected print template. The SAME
 * billing data (client details, period, every worker's stored hours / OT
 * hours / rates / server-calculated amount, the group's subtotal / VAT /
 * grand total) flows to whichever template is chosen; only the layout
 * changes. Used by the print dialog and the Settings template previews.
 * Classic renders the ORIGINAL document (byte-identical).
 */
export function ClientSummaryTemplateDocument({
  template,
  group,
  month,
  year,
  vatRate,
  settings,
  letterhead,
  showOt,
}: {
  template: string | null | undefined
  group: ClientSalaryGroup
  month: number
  year: number
  vatRate: number
  settings: AppSettings
  letterhead?: LetterheadConfig | null
  showOt?: boolean
}) {
  const tpl = resolveClientSummaryTemplate(template)
  if (tpl === 'bycategory') {
    return (
      <ClientSummaryByCategoryDocument
        group={group}
        month={month}
        year={year}
        vatRate={vatRate}
        settings={settings}
        letterhead={letterhead ?? DEFAULT_LETTERHEAD}
        showOt={showOt ?? hasDistinctOtRates(group.rows)}
      />
    )
  }
  return (
    <ClientSummaryClassicDocument
      group={group}
      month={month}
      year={year}
      vatRate={vatRate}
      settings={settings}
    />
  )
}
