// Pay slip print template "SIDEBAR" — reference design
// Payslip_Template_1_Sidebar (HTML + PNG provided by the boss).
//
//   • cream sidebar (60mm) with a gold gradient edge on the left: "SALARY
//     PAY SLIP" overline + big "PAY SLIP" stack, period row with the status
//     chip (PENDING orange / PAID green), EMPLOYEE / ASSIGNMENT / PAYMENT
//     sections (dotted separators; optional values show '—' when empty),
//     navy NET SALARY PAYABLE box pinned to the sidebar bottom
//   • main column: "Earnings & Deductions" header, EARNINGS table, DEDUCTIONS
//     table (zero-amount lines in light grey — never removed), the
//     Gross − Deductions = Net equation bar, the hours bar (regular navy,
//     overtime gold — proportional display of the STORED hours), the
//     acknowledgment panel (configurable text from Settings)
//   • signature row (Prepared by | Approved by | Received by) pinned to the
//     bottom of the page directly above the mini footer
//
// DATA GUARANTEE: reads the SAME payroll data as Classic — stored hours,
// rates, earning/deduction lines and the server-calculated totals. Pay lines
// are derived for display with Classic's exact arithmetic; totals are never
// recalculated. Letterhead artwork + geometry come from Settings; without
// artwork the reserved bands stay EMPTY (never placeholder text). The
// render-time date is labelled "Printed" (a reprint is never mistaken for
// the original issue date).
import type { LetterheadConfig } from '@/lib/types'
import { formatMoney, formatNumber } from '@/lib/format'
import { payslipNo } from '@/lib/payslip-print-templates'
import {
  PayslipFontsStyle,
  PayslipDocPage,
  PayslipEarningsTable,
  PayslipDeductionsTable,
  PayslipSignatureRow,
  PayslipMiniFooter,
  PayslipStatusChip,
  payslipGeometryFor,
  payslipTemplateValues,
  payslipPayDate,
  payslipPrintedDate,
  CREAM,
  CREAM_BORDER,
  CREAM_DOT,
  DARK_GOLD,
  EN_FONT,
  EQ_BG,
  GOLD,
  GREEN,
  HR,
  INK,
  INK_SOFT,
  LIGHT_GOLD,
  MONO,
  NAVY,
  NET_NOTE,
  type PayslipTemplateProps,
} from './payslip-print-shared'

/** One A4 page of the Sidebar pay slip. */
export function PayslipSidebarDocument({
  payroll,
  settings,
  preparedBy,
  letterhead,
}: PayslipTemplateProps) {
  const v = payslipTemplateValues({ payroll, settings, preparedBy, letterhead })
  const { p, currency, lines } = v
  const geo = payslipGeometryFor(letterhead)
  const no = payslipNo(p)

  const kv = (label: string, value: string, mono = false) => (
    <div
      className="flex items-baseline justify-between gap-[2mm]"
      style={{ fontSize: '7.6pt', padding: '1mm 0', borderBottom: `1px dotted ${CREAM_DOT}` }}
    >
      <span style={{ color: INK_SOFT, whiteSpace: 'nowrap', fontFamily: EN_FONT }}>{label}</span>
      <b
        className="min-w-0 text-right"
        style={{
          fontWeight: 600,
          color: INK,
          fontFamily: mono ? MONO : EN_FONT,
          ...(mono ? { whiteSpace: 'nowrap' } : null),
        }}
      >
        {value}
      </b>
    </div>
  )
  const secLabel = (text: string) => (
    <div
      style={{
        fontSize: '6.4pt',
        fontWeight: 700,
        color: DARK_GOLD,
        letterSpacing: '0.6pt',
        marginBottom: '0.8mm',
      }}
    >
      {text}
    </div>
  )

  return (
    <PayslipDocPage letterhead={letterhead} isLast>
      <PayslipFontsStyle />
      {/* content grid between the letterhead bands: 60mm sidebar + main */}
      <div
        className="absolute z-10 grid"
        style={{
          top: `${geo.topMm}mm`,
          bottom: `${geo.bottomMm}mm`,
          left: 0,
          right: 0,
          gridTemplateColumns: '60mm 1fr',
          fontFamily: EN_FONT,
        }}
      >
        {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
        <aside
          className="relative flex flex-col"
          style={{
            background: CREAM,
            borderRight: `1px solid ${CREAM_BORDER}`,
            padding: '4mm 5mm 4mm 14mm',
          }}
        >
          {/* gold gradient edge */}
          <span
            aria-hidden
            className="absolute bottom-0 left-0 top-0"
            style={{ width: '3mm', background: `linear-gradient(${LIGHT_GOLD}, ${DARK_GOLD})` }}
          />
          <div style={{ fontSize: '6.8pt', fontWeight: 700, color: DARK_GOLD, letterSpacing: '1.2pt' }}>
            SALARY PAY SLIP
          </div>
          <div
            style={{
              fontSize: '17pt',
              fontWeight: 700,
              color: NAVY,
              lineHeight: 1.05,
              marginTop: '1.4mm',
            }}
          >
            PAY
            <br />
            SLIP
          </div>
          <div
            className="flex items-center justify-between"
            style={{
              fontSize: '10pt',
              fontWeight: 700,
              color: NAVY,
              marginTop: '2.4mm',
              padding: '1.4mm 0',
              borderTop: '1.2px solid #C0934C',
              borderBottom: '1.2px solid #C0934C',
            }}
          >
            <span>{lines.periodLabel}</span>
            <PayslipStatusChip status={p.status} />
          </div>

          <div style={{ marginTop: '3mm' }}>
            {secLabel('EMPLOYEE')}
            <div style={{ fontSize: '11pt', fontWeight: 700, color: NAVY }}>{p.staff.fullName}</div>
            {kv('Iqama ID', p.staff.iqamaId, true)}
            {kv('Category', p.staff.staffCategory?.name ?? '—')}
            {kv('Hourly Rate', formatMoney(p.hourlyRateSnapshot, currency), true)}
          </div>

          <div style={{ marginTop: '3mm' }}>
            {secLabel('ASSIGNMENT')}
            {kv('Project', p.project?.name ?? '—')}
            {kv('Client', p.project?.clientName ?? '—')}
          </div>

          <div style={{ marginTop: '3mm' }}>
            {secLabel('PAYMENT')}
            {kv('Method', lines.methodLabel)}
            {kv('Pay Date', payslipPayDate(p.payDate))}
            {kv('Printed', payslipPrintedDate())}
            {kv('Slip No.', no, true)}
          </div>

          {/* NET box — pinned to the sidebar bottom */}
          <div
            className="mt-auto"
            style={{ background: NAVY, color: '#fff', borderRadius: '2.5mm', padding: '3.2mm 3.5mm' }}
          >
            <small
              style={{
                display: 'block',
                fontSize: '6.5pt',
                color: LIGHT_GOLD,
                fontWeight: 700,
                letterSpacing: '0.6pt',
              }}
            >
              NET SALARY PAYABLE
            </small>
            <b className="block" style={{ fontFamily: MONO, fontSize: '15pt', marginTop: '1mm' }}>
              {formatMoney(lines.netPay, currency)}
            </b>
            <i style={{ fontStyle: 'normal', fontSize: '6.8pt', color: NET_NOTE }}>
              Disbursement for {lines.periodLabel}
            </i>
          </div>
        </aside>

        {/* ── MAIN ────────────────────────────────────────────────────────── */}
        <main className="flex flex-col" style={{ padding: '4mm 14mm 0 6mm' }}>
          <div
            className="flex items-baseline justify-between"
            style={{ paddingBottom: '2mm', borderBottom: `1px solid ${HR}` }}
          >
            <b style={{ fontSize: '10pt', color: NAVY }}>Earnings &amp; Deductions</b>
            <span style={{ fontSize: '7.2pt', color: INK_SOFT }}>All amounts in {currency}</span>
          </div>

          <div style={{ marginTop: '3.4mm' }}>
            <div
              style={{
                fontSize: '7pt',
                fontWeight: 700,
                color: NAVY,
                letterSpacing: '0.8pt',
                marginBottom: '1.2mm',
              }}
            >
              EARNINGS
            </div>
            <PayslipEarningsTable p={p} lines={lines} />
          </div>

          <div style={{ marginTop: '3.4mm' }}>
            <div
              style={{
                fontSize: '7pt',
                fontWeight: 700,
                color: NAVY,
                letterSpacing: '0.8pt',
                marginBottom: '1.2mm',
              }}
            >
              DEDUCTIONS
            </div>
            <PayslipDeductionsTable p={p} lines={lines} />
          </div>

          {/* equation bar — the STORED totals */}
          <div
            className="grid items-center"
            style={{
              marginTop: '3.6mm',
              gridTemplateColumns: '1fr auto 1fr auto 1.2fr',
              gap: '2.5mm',
              background: EQ_BG,
              borderRadius: '2mm',
              padding: '2.6mm 3.5mm',
            }}
          >
            <div>
              <small style={{ display: 'block', fontSize: '6.4pt', color: INK_SOFT, fontWeight: 600 }}>
                GROSS PAY
              </small>
              <b style={{ fontFamily: MONO, fontSize: '10pt', color: NAVY }}>
                {formatNumber(lines.grossPay)}
              </b>
            </div>
            <span style={{ fontSize: '13pt', color: GOLD, fontWeight: 700 }}>−</span>
            <div>
              <small style={{ display: 'block', fontSize: '6.4pt', color: INK_SOFT, fontWeight: 600 }}>
                DEDUCTIONS
              </small>
              <b style={{ fontFamily: MONO, fontSize: '10pt', color: NAVY }}>
                {formatNumber(lines.totalDeductions)}
              </b>
            </div>
            <span style={{ fontSize: '13pt', color: GOLD, fontWeight: 700 }}>=</span>
            <div>
              <small style={{ display: 'block', fontSize: '6.4pt', color: INK_SOFT, fontWeight: 600 }}>
                NET PAY ({currency})
              </small>
              <b style={{ fontFamily: MONO, fontSize: '11pt', color: GREEN }}>
                {formatNumber(lines.netPay)}
              </b>
            </div>
          </div>

          {/* hours bar — proportional display of the STORED hours */}
          <div style={{ marginTop: '3mm', fontSize: '7pt', color: INK_SOFT }}>
            Hours worked: <b style={{ color: NAVY }}>{lines.hoursWorked.toFixed(1)} hrs</b> ·
            Regular {lines.totalHours.toFixed(1)} · Overtime {lines.overtimeHours.toFixed(1)}
            <div
              className="flex"
              style={{ height: '3mm', borderRadius: '2mm', overflow: 'hidden', marginTop: '1mm' }}
            >
              {lines.overtimePct > 0 ? (
                <>
                  <i className="block" style={{ width: `${lines.regularPct}%`, background: NAVY }} />
                  <i className="block" style={{ width: `${lines.overtimePct}%`, background: GOLD }} />
                </>
              ) : (
                <i className="block" style={{ width: '100%', background: NAVY }} />
              )}
            </div>
          </div>

          {/* acknowledgment — configurable text from Settings */}
          <div
            style={{
              marginTop: '3.4mm',
              fontSize: '7.8pt',
              lineHeight: 1.55,
              borderLeft: `2px solid ${GOLD}`,
              paddingLeft: '3mm',
              color: INK,
            }}
          >
            <div
              style={{
                fontSize: '6.8pt',
                fontWeight: 700,
                color: DARK_GOLD,
                letterSpacing: '0.8pt',
                marginBottom: '0.6mm',
              }}
            >
              ACKNOWLEDGMENT
            </div>
            {v.ack}
          </div>

          {/* spacer + pinned signature row + mini footer */}
          <div style={{ flex: 1 }} />
          <PayslipSignatureRow
            preparedBy={v.preparedBy}
            approvedName={v.approvedName}
            approvedTitle={v.approvedTitle}
            staffName={p.staff.fullName}
            iqama={p.staff.iqamaId}
          />
          <PayslipMiniFooter left={`${no} · This is a computer-generated pay slip.`} />
        </main>
      </div>
    </PayslipDocPage>
  )
}
