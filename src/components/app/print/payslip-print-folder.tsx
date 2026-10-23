// Pay slip print template "FOLDER" — reference design
// Payslip_Template_3_Folder (HTML + PNG provided by the boss).
//
//   • top row: "SALARY PAY SLIP" (15pt navy) + status chip (PENDING orange /
//     PAID green) · right: SLIP NO. (display-only, deterministic per row)
//   • folder sections with navy tabs (gold text, angled corner):
//       01 · EMPLOYEE — 4-cell grid (staff name, Iqama, category, hourly
//           rate, pay period, assigned project, client company,
//           Payment · Printed)
//       02 · EARNINGS & DEDUCTIONS — the two tables side by side with a
//           dashed divider (zero-amount lines in light grey — never removed)
//       03 · NET PAY (gold tab) — Gross − Deductions line, disbursement
//           note, navy amount box
//       04 · ACKNOWLEDGMENT — the configurable text from Settings
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
  payslipPrintedDate,
  DARK_GOLD,
  EN_FONT,
  GOLD,
  HR,
  INK,
  INK_SOFT,
  LIGHT_GOLD,
  MONO,
  NAVY,
  type PayslipTemplateProps,
} from './payslip-print-shared'

/** Folder box — bordered panel with the tab on its top-left corner. */
function FolderBox({
  label,
  gold = false,
  children,
}: {
  label: string
  gold?: boolean
  children: React.ReactNode
}) {
  const tabBg = gold ? GOLD : NAVY
  return (
    <div
      className="relative"
      style={{
        marginTop: '5.6mm',
        border: `1px solid ${tabBg}`,
        borderRadius: '0 2.5mm 2.5mm 2.5mm',
        padding: '2.2mm 3.5mm',
      }}
    >
      {/* tab */}
      <div
        className="absolute flex items-center"
        style={{
          top: '-5mm',
          left: '-1px',
          height: '5mm',
          background: tabBg,
          color: gold ? '#fff' : LIGHT_GOLD,
          fontSize: '6.6pt',
          fontWeight: 700,
          letterSpacing: '0.8pt',
          padding: '0 4mm 0 3mm',
          borderRadius: '2mm 2mm 0 0',
          fontFamily: EN_FONT,
        }}
      >
        {label}
        {/* angled tab corner */}
        <span
          aria-hidden
          className="absolute"
          style={{
            right: '-3mm',
            bottom: 0,
            width: '3mm',
            height: '5mm',
            background: tabBg,
            clipPath: 'polygon(0 0, 0 100%, 100% 100%)',
          }}
        />
      </div>
      {children}
    </div>
  )
}

function gridCell(label: string, value: React.ReactNode) {
  return (
    <div className="min-w-0">
      <small style={{ display: 'block', fontSize: '6.4pt', color: INK_SOFT, fontWeight: 600 }}>
        {label}
      </small>
      <b className="block break-words" style={{ fontSize: '8.2pt', fontWeight: 600, marginTop: '0.3mm', color: INK }}>
        {value}
      </b>
    </div>
  )
}

/** One A4 page of the Folder pay slip. */
export function PayslipFolderDocument({
  payroll,
  settings,
  preparedBy,
  letterhead,
}: PayslipTemplateProps) {
  const v = payslipTemplateValues({ payroll, settings, preparedBy, letterhead })
  const { p, currency, lines } = v
  const geo = payslipGeometryFor(letterhead)
  const no = payslipNo(p)

  return (
    <PayslipDocPage letterhead={letterhead} isLast>
      <PayslipFontsStyle />
      <div
        className="absolute inset-0 z-10 flex flex-col"
        style={{ paddingTop: `${geo.topMm}mm`, paddingBottom: `${geo.bottomMm}mm`, paddingLeft: '14mm', paddingRight: '14mm', fontFamily: EN_FONT }}
      >
        {/* top row — title + status · slip no. */}
        <div className="flex items-end justify-between" style={{ marginBottom: '1mm' }}>
          <div className="flex items-center" style={{ fontSize: '15pt', fontWeight: 700, color: NAVY }}>
            SALARY PAY SLIP
            <span style={{ marginLeft: '3mm' }}>
              <PayslipStatusChip status={p.status} fontSize="6.4pt" />
            </span>
          </div>
          <div style={{ textAlign: 'right', fontSize: '7pt', color: INK_SOFT }}>
            SLIP NO.
            <b className="block" style={{ fontFamily: MONO, fontSize: '10pt', color: NAVY }}>
              {no}
            </b>
          </div>
        </div>

        {/* 01 · EMPLOYEE */}
        <FolderBox label="01 · EMPLOYEE">
          <div
            className="grid"
            style={{ gridTemplateColumns: '1.1fr 1fr 1fr 1fr', gap: '2mm 4mm' }}
          >
            {gridCell(
              'Staff Name',
              <span style={{ fontSize: '9.5pt', color: NAVY }}>{p.staff.fullName}</span>
            )}
            {gridCell('Iqama ID', <span style={{ fontFamily: MONO }}>{p.staff.iqamaId}</span>)}
            {gridCell('Category', p.staff.staffCategory?.name ?? '—')}
            {gridCell(
              'Hourly Rate',
              <span style={{ fontFamily: MONO }}>
                {formatMoney(p.hourlyRateSnapshot, currency)}/hr
              </span>
            )}
            {gridCell('Pay Period', lines.periodLabel)}
            {gridCell('Assigned Project', p.project?.name ?? '—')}
            {gridCell('Client Company', p.project?.clientName ?? '—')}
            {gridCell(
              'Payment · Printed',
              `${lines.methodLabel} · ${payslipPrintedDate()}`
            )}
          </div>
        </FolderBox>

        {/* 02 · EARNINGS & DEDUCTIONS */}
        <FolderBox label="02 · EARNINGS & DEDUCTIONS">
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '6mm' }}>
            <div>
              <div
                style={{
                  fontSize: '6.8pt',
                  fontWeight: 700,
                  color: NAVY,
                  letterSpacing: '0.8pt',
                  marginBottom: '1mm',
                }}
              >
                EARNINGS
              </div>
              <PayslipEarningsTable p={p} lines={lines} />
            </div>
            <div style={{ borderLeft: `1px dashed ${HR}`, paddingLeft: '6mm' }}>
              <div
                style={{
                  fontSize: '6.8pt',
                  fontWeight: 700,
                  color: NAVY,
                  letterSpacing: '0.8pt',
                  marginBottom: '1mm',
                }}
              >
                DEDUCTIONS
              </div>
              <PayslipDeductionsTable p={p} lines={lines} />
            </div>
          </div>
        </FolderBox>

        {/* 03 · NET PAY (gold tab) */}
        <FolderBox label="03 · NET PAY" gold>
          <div className="flex items-center justify-between gap-[6mm]">
            <div style={{ fontSize: '7.4pt', color: INK_SOFT, lineHeight: 1.6 }}>
              Gross Pay <b style={{ fontFamily: MONO, color: INK }}>{formatMoney(lines.grossPay, currency)}</b>{' '}
              − Deductions{' '}
              <b style={{ fontFamily: MONO, color: INK }}>
                {formatMoney(lines.totalDeductions, currency)}
              </b>
              <br />
              Disbursement for {lines.periodLabel} by {lines.methodLabel}
            </div>
            <div
              className="shrink-0"
              style={{ background: NAVY, color: '#fff', borderRadius: '2mm', padding: '2.4mm 5mm', textAlign: 'right' }}
            >
              <small
                style={{
                  display: 'block',
                  fontSize: '6.4pt',
                  color: LIGHT_GOLD,
                  fontWeight: 700,
                  letterSpacing: '0.6pt',
                }}
              >
                NET SALARY PAYABLE
              </small>
              <b className="block" style={{ fontFamily: MONO, fontSize: '15pt' }}>
                {formatMoney(lines.netPay, currency)}
              </b>
            </div>
          </div>
        </FolderBox>

        {/* 04 · ACKNOWLEDGMENT */}
        <FolderBox label="04 · ACKNOWLEDGMENT">
          <p style={{ fontSize: '7.8pt', lineHeight: 1.55, color: INK }}>{v.ack}</p>
        </FolderBox>

        {/* spacer + pinned signature row + mini footer */}
        <div style={{ flex: 1 }} />
        <PayslipSignatureRow
          preparedBy={v.preparedBy}
          approvedName={v.approvedName}
          approvedTitle={v.approvedTitle}
          staffName={p.staff.fullName}
          iqama={p.staff.iqamaId}
        />
        <PayslipMiniFooter
          left={`${v.companyName} · ${no}`}
          middle="This is a computer-generated pay slip."
        />
      </div>
    </PayslipDocPage>
  )
}
