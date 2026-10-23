// Pay slip print SHARED module — the ONE palette, fonts, geometry, letterhead
// resolution, line-derivation and page furniture used by the 2 NEW pay slip
// templates (Sidebar, Folder). The Classic template (salary-slip.tsx) does
// NOT import this file — its rendering is untouched and stays byte-identical.
//
// DATA GUARANTEE: every template renders the SAME payroll data — the stored
// hours, rates, earning and deduction lines and the server-calculated
// gross/deductions/net totals. Regular/overtime PAY LINES are derived for
// DISPLAY with the exact same arithmetic Classic's slip uses
// (round2(hours × rate)); totals are NEVER recalculated — the stored
// grossPay / totalDeductions / netPay print as-is. Zero-amount lines print
// in light grey (as in the references) but are NEVER removed. Letterhead
// artwork + geometry come from the shared Settings config; without artwork
// the reserved bands stay EMPTY (never placeholder text).
import type { LetterheadConfig, AppSettings } from '@/lib/types'
import { AGREEMENT_FONT_FACES_CSS } from '@/lib/agreement-fonts'
import type { SlipPayroll } from '@/components/app/print/salary-slip'
import { PAY_TYPE_LABELS } from '@/lib/types'
import { formatMoney, formatNumber, monthName, round2 } from '@/lib/format'
import {
  DEFAULT_PAYSLIP_ACK_TEXT,
  interpolatePayslipAck,
} from '@/lib/payslip-print-templates'

// ── Brand palette (the same family as the reference designs) ────────────────
export const NAVY = '#132A4A'
export const GOLD = '#C0934C'
export const LIGHT_GOLD = '#E1B169'
export const DARK_GOLD = '#8E6420'
export const ORANGE = '#D9822B'
export const GREEN = '#2E7D5B'
export const RED = '#B83A3A'
export const INK = '#1D2433'
export const INK_SOFT = '#4A5468'
export const ZERO = '#A3ABBA' // zero-amount rows (light grey, as in the references)
export const HR = '#DDE3EC'
export const CREAM = '#FAF7F1'
export const CREAM_BORDER = '#E6DFCF'
export const CREAM_DOT = '#D8CFBE'
export const EQ_BG = '#F5F7FA'
export const NET_NOTE = '#C9D3E3'

// ── Fonts — the SAME embedded Noto Sans face the other print templates use ──
export const EN_FONT = "'Noto Sans', Arial, Helvetica, sans-serif"
export const MONO = "'DejaVu Sans Mono', ui-monospace, 'Cascadia Mono', monospace"

/** Mounts the embedded Noto Sans @font-face rules (self-contained: renders
 *  identically in the app, window.print() and the headless render daemon). */
export function PayslipFontsStyle() {
  return <style dangerouslySetInnerHTML={{ __html: AGREEMENT_FONT_FACES_CSS }} />
}

// ── A4 page geometry ────────────────────────────────────────────────────────
export const PAGE_W_MM = 210
export const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (Chrome blank-page fix)

export const DEFAULT_LETTERHEAD: LetterheadConfig = {
  mode: 'none',
  headerImage: null,
  footerImage: null,
  fullPageImage: null,
  showCompanyDetails: true,
  headerHeightMm: 30,
  footerHeightMm: 18,
}

/** Content geometry from the shared letterhead config. Without artwork the
 *  reserved bands stay EMPTY (never placeholder text) — modest margins keep
 *  the page balanced. */
export function payslipGeometryFor(letterhead: LetterheadConfig): {
  topMm: number
  bottomMm: number
} {
  const hasFull = letterhead.mode === 'full' && letterhead.fullPageImage
  const hasHeader =
    (letterhead.mode === 'header' || letterhead.mode === 'header_footer') && letterhead.headerImage
  const hasFooter = letterhead.mode === 'header_footer' && letterhead.footerImage
  if (hasFull) {
    return {
      topMm: letterhead.headerHeightMm + 4,
      bottomMm: Math.max(letterhead.footerHeightMm + 4, 12),
    }
  }
  if (hasHeader && hasFooter) {
    return { topMm: letterhead.headerHeightMm + 3, bottomMm: letterhead.footerHeightMm + 3 }
  }
  if (hasHeader) return { topMm: letterhead.headerHeightMm + 3, bottomMm: 14 }
  return { topMm: 16, bottomMm: 14 }
}

// ── Date / label helpers ────────────────────────────────────────────────────
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Render-time "Printed" date for the NEW templates — same format family as
 *  the reference ("Oct 23, 2026"). A reprint is therefore never mistaken for
 *  the original issue date (Classic keeps its own "Issued" label untouched). */
export function payslipPrintedDate(d = new Date()): string {
  return `${MONTHS_EN[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`
}

/** Stored pay date (ISO) → "Oct 24, 2026" (null → '—', as in the references). */
export function payslipPayDate(iso: string | null): string {
  if (!iso) return '—'
  const dt = new Date(iso)
  if (isNaN(dt.getTime())) return '—'
  return `${MONTHS_EN[dt.getMonth()]} ${String(dt.getDate()).padStart(2, '0')}, ${dt.getFullYear()}`
}

// ── Derived display lines (the SAME arithmetic Classic's slip uses) ─────────
export type PayslipLines = {
  /** display pay lines — stored hours × stored rates, rounded like Classic */
  regularPay: number
  overtimePay: number
  otherDedAmount: number
  /** stored totals — NEVER recalculated */
  grossPay: number
  totalDeductions: number
  netPay: number
  totalHours: number
  overtimeHours: number
  hoursWorked: number // regular + overtime (display sum)
  regularPct: number // hours-bar split (navy / gold), 0–100
  overtimePct: number
  periodLabel: string
  methodLabel: string
  /** "(1.5×)" only when the stored OT rate is exactly 1.5× the regular rate */
  otMultiplier: string
}

export function payslipLines(p: SlipPayroll): PayslipLines {
  const regularPay = round2(p.totalHours * p.hourlyRateSnapshot)
  const overtimePay = round2(p.overtimeHours * p.overtimeRateSnapshot)
  const otherDedAmount =
    p.otherDeductionAmount ??
    (p.otherDeductionType === 'percent'
      ? round2((p.grossPay * p.otherDeductionValue) / 100)
      : round2(p.otherDeductionValue))
  const hoursWorked = round2(p.totalHours + p.overtimeHours)
  const total = p.totalHours + p.overtimeHours
  const regularPct = total > 0 ? Math.min(100, (p.totalHours / total) * 100) : 100
  const overtimePct = total > 0 ? Math.max(0, 100 - regularPct) : 0
  const otMultiplier =
    p.hourlyRateSnapshot > 0 &&
    Math.abs(p.overtimeRateSnapshot - p.hourlyRateSnapshot * 1.5) < 0.005
      ? ' (1.5×)'
      : ''
  return {
    regularPay,
    overtimePay,
    otherDedAmount,
    grossPay: p.grossPay,
    totalDeductions: p.totalDeductions,
    netPay: p.netPay,
    totalHours: p.totalHours,
    overtimeHours: p.overtimeHours,
    hoursWorked,
    regularPct,
    overtimePct,
    periodLabel: `${monthName(p.month)} ${p.year}`,
    methodLabel: PAY_TYPE_LABELS[p.payType] ?? p.payType,
    otMultiplier,
  }
}

// ── Page furniture ──────────────────────────────────────────────────────────

/** One fixed A4 sheet with the letterhead artwork layers from Settings.
 *  Without artwork the reserved bands stay COMPLETELY EMPTY (the boss's
 *  rule — never placeholder text). */
export function PayslipDocPage({
  letterhead,
  isLast,
  children,
}: {
  letterhead: LetterheadConfig
  isLast: boolean
  children: React.ReactNode
}) {
  const letterheadArt = letterhead.mode === 'full' && letterhead.fullPageImage
  const headerArt =
    (letterhead.mode === 'header' || letterhead.mode === 'header_footer') && letterhead.headerImage
  const footerArt = letterhead.mode === 'header_footer' && letterhead.footerImage
  return (
    <div
      className="doc-page relative shrink-0 overflow-hidden bg-white text-neutral-900 shadow-sm print:shadow-none"
      style={{
        width: `${PAGE_W_MM}mm`,
        height: `${PAGE_H_MM}mm`,
        breakAfter: isLast ? 'auto' : 'page',
        breakInside: 'avoid',
      }}
    >
      {letterheadArt ? (
        <img
          src={letterhead.fullPageImage as string}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-fill"
        />
      ) : (
        <>
          {headerArt ? (
            <img
              src={letterhead.headerImage as string}
              alt=""
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 z-0 w-full object-fill"
              style={{ height: `${letterhead.headerHeightMm}mm` }}
            />
          ) : null}
          {footerArt ? (
            <img
              src={letterhead.footerImage as string}
              alt=""
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-0 z-0 w-full object-fill"
              style={{ height: `${letterhead.footerHeightMm}mm` }}
            />
          ) : null}
        </>
      )}
      {children}
    </div>
  )
}

/** Status chip — PENDING (orange) / PAID (green), as in the references.
 *  The payroll status model only knows pending|paid — APPROVED never prints. */
export function PayslipStatusChip({
  status,
  fontSize = '6.2pt',
}: {
  status: string
  fontSize?: string
}) {
  const paid = status === 'paid'
  const color = paid ? GREEN : ORANGE
  return (
    <span
      className="inline-block whitespace-nowrap"
      style={{
        fontSize,
        fontWeight: 700,
        color,
        border: `1.2px solid ${color}`,
        borderRadius: '1mm',
        padding: '0.3mm 1.8mm',
        letterSpacing: '1pt',
        fontFamily: EN_FONT,
      }}
    >
      {paid ? 'PAID' : 'PENDING'}
    </span>
  )
}

// ── Earnings / Deductions tables (the shared reference tables) ──────────────
// Zero-amount lines print in light grey but are NEVER removed; totals are the
// STORED values. Amount cells show bare numbers ("14,840.00") exactly like
// the references — the surrounding labels carry the currency.

const TH: React.CSSProperties = {
  fontSize: '6.8pt',
  color: INK_SOFT,
  fontWeight: 700,
  textAlign: 'left',
  padding: '0 2mm 1.4mm',
  borderBottom: `1.4px solid ${NAVY}`,
  letterSpacing: '0.4pt',
}
const TH_R: React.CSSProperties = { ...TH, textAlign: 'right' }

function tdStyle(zero: boolean, right = false): React.CSSProperties {
  return {
    padding: '1.6mm 2mm',
    borderBottom: `1px solid ${HR}`,
    verticalAlign: 'top',
    ...(right ? { textAlign: 'right', fontFamily: MONO, whiteSpace: 'nowrap' } : null),
    ...(zero ? { color: ZERO } : null),
  }
}

export function PayslipEarningsTable({
  p,
  lines,
}: {
  p: SlipPayroll
  lines: PayslipLines
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.3pt', fontFamily: EN_FONT }}>
      <thead>
        <tr>
          <th style={TH}>Description</th>
          <th style={TH_R}>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={tdStyle(false)}>
            <b style={{ fontWeight: 600, color: INK }}>Regular Work Hours</b>
            <small style={{ display: 'block', fontSize: '7pt', color: INK_SOFT, marginTop: '0.3mm' }}>
              {p.totalHours.toFixed(1)} hrs @ {formatNumber(p.hourlyRateSnapshot)}/hr
            </small>
          </td>
          <td style={tdStyle(false, true)}>{formatNumber(lines.regularPay)}</td>
        </tr>
        <tr>
          <td style={tdStyle(false)}>
            <b style={{ fontWeight: 600, color: INK }}>Overtime Hours</b>
            <small style={{ display: 'block', fontSize: '7pt', color: INK_SOFT, marginTop: '0.3mm' }}>
              {p.overtimeHours.toFixed(1)} hrs @ {formatNumber(p.overtimeRateSnapshot)}/hr
              {lines.otMultiplier}
            </small>
          </td>
          <td style={tdStyle(false, true)}>{formatNumber(lines.overtimePay)}</td>
        </tr>
        <tr>
          <td style={tdStyle(p.otherEarnings === 0)}>
            <b style={{ fontWeight: p.otherEarnings === 0 ? 400 : 600, color: INK }}>
              Other Earnings / Bonus
            </b>
          </td>
          <td style={tdStyle(p.otherEarnings === 0, true)}>{formatNumber(p.otherEarnings)}</td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td
            style={{
              fontWeight: 700,
              borderBottom: 0,
              borderTop: `1.6px solid ${NAVY}`,
              padding: '2mm 2mm 0',
              color: INK,
            }}
          >
            Total Gross Pay
          </td>
          <td
            style={{
              fontWeight: 700,
              borderBottom: 0,
              borderTop: `1.6px solid ${NAVY}`,
              padding: '2mm 2mm 0',
              textAlign: 'right',
              fontFamily: MONO,
              whiteSpace: 'nowrap',
              color: INK,
            }}
          >
            {formatNumber(lines.grossPay)}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

export function PayslipDeductionsTable({
  p,
  lines,
}: {
  p: SlipPayroll
  lines: PayslipLines
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8.3pt', fontFamily: EN_FONT }}>
      <thead>
        <tr>
          <th style={TH}>Description</th>
          <th style={TH_R}>Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={tdStyle(p.advance === 0)}>Advance Deduction</td>
          <td style={tdStyle(p.advance === 0, true)}>{formatNumber(p.advance)}</td>
        </tr>
        <tr>
          <td style={tdStyle(p.absentPenalty === 0)}>Absent Penalty</td>
          <td style={tdStyle(p.absentPenalty === 0, true)}>{formatNumber(p.absentPenalty)}</td>
        </tr>
        <tr>
          <td style={tdStyle(p.ptAmount === 0)}>PT</td>
          <td style={tdStyle(p.ptAmount === 0, true)}>{formatNumber(p.ptAmount)}</td>
        </tr>
        <tr>
          <td style={tdStyle(p.unionFees === 0)}>Union Fees</td>
          <td style={tdStyle(p.unionFees === 0, true)}>{formatNumber(p.unionFees)}</td>
        </tr>
        <tr>
          <td style={tdStyle(lines.otherDedAmount === 0)}>
            {p.otherDeductionType === 'percent'
              ? `Other Deductions (${p.otherDeductionValue}%)`
              : 'Other Deductions'}
          </td>
          <td style={tdStyle(lines.otherDedAmount === 0, true)}>
            {formatNumber(lines.otherDedAmount)}
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr>
          <td
            style={{
              fontWeight: 700,
              borderBottom: 0,
              borderTop: `1.6px solid ${NAVY}`,
              padding: '2mm 2mm 0',
              color: RED,
            }}
          >
            Total Deductions
          </td>
          <td
            style={{
              fontWeight: 700,
              borderBottom: 0,
              borderTop: `1.6px solid ${NAVY}`,
              padding: '2mm 2mm 0',
              textAlign: 'right',
              fontFamily: MONO,
              whiteSpace: 'nowrap',
              color: RED,
            }}
          >
            {formatNumber(lines.totalDeductions)}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

/** Signature row — Prepared by | Approved by | Received by, pinned at the
 *  bottom of the page directly above the footer (the caller adds the spacer).
 *  Prepared by = the logged-in user + "Payroll Department"; Approved by = the
 *  Settings authorized signatory + title; Received by = the staff member. */
export function PayslipSignatureRow({
  preparedBy,
  approvedName,
  approvedTitle,
  staffName,
  iqama,
}: {
  preparedBy: string
  approvedName: string
  approvedTitle: string
  staffName: string
  iqama: string
}) {
  const cell = (label: string, name: string, subs: string[]) => (
    <div className="min-w-0">
      <div style={{ borderBottom: `1px solid ${NAVY}`, height: '11mm' }} />
      <div
        style={{
          fontSize: '6.8pt',
          fontWeight: 700,
          color: DARK_GOLD,
          letterSpacing: '0.8pt',
          marginTop: '1.4mm',
          textTransform: 'uppercase',
          fontFamily: EN_FONT,
        }}
      >
        {label}
      </div>
      {name ? (
        <div
          style={{
            fontSize: '8.5pt',
            fontWeight: 700,
            color: NAVY,
            marginTop: '0.4mm',
            fontFamily: EN_FONT,
          }}
        >
          {name}
        </div>
      ) : null}
      {subs.map((s, i) => (
        <div
          key={i}
          style={{ fontSize: '7.2pt', color: INK_SOFT, marginTop: '0.3mm', fontFamily: EN_FONT }}
        >
          {s}
        </div>
      ))}
    </div>
  )
  return (
    <div
      data-payslip-signatures
      className="grid shrink-0"
      style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '7mm' }}
    >
      {cell('Prepared by', preparedBy, ['Payroll Department', 'Date: ____________'])}
      {cell('Approved by', approvedName, [approvedTitle, 'Date: ____________'])}
      {cell('Received by', staffName, [`Iqama: ${iqama}`, 'Date: ____________'])}
    </div>
  )
}

/** Mini footer line — slip no. / notes · Page 1 of 1. */
export function PayslipMiniFooter({ left, middle }: { left: string; middle?: string }) {
  return (
    <div
      data-payslip-footer
      className="flex shrink-0 items-center justify-between"
      style={{ fontSize: '6.4pt', color: INK_SOFT, marginTop: '2.4mm', fontFamily: EN_FONT }}
    >
      <span className="whitespace-nowrap">{left}</span>
      {middle ? (
        <span className="min-w-0 truncate" style={{ padding: '0 3mm' }}>
          {middle}
        </span>
      ) : null}
      <span className="whitespace-nowrap">Page 1 of 1</span>
    </div>
  )
}

// ── Shared props for the 2 new templates ────────────────────────────────────
export type PayslipTemplateProps = {
  payroll: SlipPayroll
  settings: AppSettings
  /** the logged-in user's name (Prepared by) */
  preparedBy: string
  letterhead: LetterheadConfig
}

/** Common derived values for a template render. */
export function payslipTemplateValues(props: PayslipTemplateProps) {
  const { payroll: p, settings, preparedBy } = props
  const currency = settings.currency || 'SAR'
  const lines = payslipLines(p)
  const ackText = settings.payrollAcknowledgmentText?.trim() || DEFAULT_PAYSLIP_ACK_TEXT
  // {netPay} substitutes the BARE amount ("15,295.00") so the default text's
  // "of SAR {netPay}" renders "of SAR 15,295.00" — never a doubled currency
  const ack = interpolatePayslipAck(ackText, {
    netPay: formatNumber(p.netPay),
    period: lines.periodLabel,
    method: lines.methodLabel,
    project: p.project?.name ?? '',
    client: p.project?.clientName ?? '',
  })
  return {
    p,
    currency,
    lines,
    preparedBy: preparedBy || '',
    approvedName: settings.authorizedSignatory?.trim() || '',
    approvedTitle: settings.signatoryTitle?.trim() || 'Authorized Signatory',
    companyName: settings.companyName || 'Landmark Inter Gulf',
    ack,
  }
}
