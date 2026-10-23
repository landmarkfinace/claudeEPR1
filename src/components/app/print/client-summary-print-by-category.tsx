// Client Salary Summary print template "BY CATEGORY" — reference design
// Client_Summary_By_Category (No-OT PNG/HTML + the OT-column variant written
// spec, both provided by the boss).
//
//   • page 1 top: "MANPOWER BILLING / CLIENT SALARY SUMMARY" (navy) +
//     "BILLING PERIOD / <period>" (right)
//   • folder sections with navy tabs (gold text, angled corner):
//       01 · BILL TO & PERIOD — client name, address, attention, phone,
//           C.R., email, workers · categories, total hours, project(s)
//       02 · WORKERS BY CATEGORY — the worker table grouped by PROJECT then
//           by CATEGORY (project header + subtotal rows; category header
//           (cream) + total rows (light blue)); SN runs continuously and
//           workers sort by name inside each alphabetical category
//       03 · CATEGORY SUMMARY — Category | Workers | Total Hours | (OT Hrs)
//           | Amount + "All categories" total row
//       04 · BILLING SUMMARY (gold tab) — amount in words, note, subtotal,
//           VAT %, grand total
//       05 · APPROVAL — Prepared by / Approved by / Accepted by, pinned to
//           the bottom of the last page directly above the footer
//   • OT variant (automatic when any worker has OT hours at a rate ≠ the
//     normal rate, or forced from the print dialog): columns
//     SN | Worker | Hours | OT Hrs | Rate/Hr | OT Rate | Amount and category
//     totals carry Hours / OT Hrs / Amount; workers with 0 OT show "—"
//   • page 2+: small "CLIENT SALARY SUMMARY · client · period · continued"
//     header + the 02 tab (continued) with the table header repeated
//   • tabs 03/04/05 only on the LAST page; "Page X of Y" on every page
//
// DATA GUARANTEE: renders the SAME billing data as Classic — every worker's
// stored hours / OT hours / effective client rate / OT rate and the
// SERVER-CALCULATED amount; the group's stored subtotal / VAT / grand
// total. "Total Hours" is a display sum of stored regular + OT hours
// exactly like the reference; nothing is ever recomputed on the print.
// Letterhead artwork + geometry come from Settings; without artwork the
// reserved bands stay EMPTY (never placeholder text).
import { formatDateTime } from '@/lib/format'
import type { AppSettings, ClientSalaryGroup } from '@/lib/types'
import {
  ClientSummaryDocPage,
  ClientSummaryFontsStyle,
  CssTabBox,
  CAT_TOTAL_BG,
  CAT_TOTAL_BORDER,
  CREAM,
  CREAM_BORDER,
  DARK_GOLD,
  EN_FONT,
  GOLD,
  HR,
  INK,
  INK_SOFT,
  LIGHT_GOLD,
  MONO,
  NAVY,
  PAGE_H_MM,
  PROJ_TOTAL_BG,
  buildCssEntries,
  clientSummaryAmountInWords,
  clientSummaryGeometryFor,
  cssPeriodLabel,
  cssTailMm,
  fmtAmt,
  fmtHours,
  fmtSn,
  groupByProjectThenCategory,
  planCssPages,
  rollupCategories,
} from './client-summary-print-shared'

// ── Fixed furniture heights (mm) — CALIBRATED against real renders ──────────
const TOP_BLOCK_MM = 11.5 // "MANPOWER BILLING / CLIENT SALARY SUMMARY" + period (measured 10.9)
const TAB01_BASE_MM = 28 // 01 · BILL TO & PERIOD box incl. its 5.6mm margin (measured 27.5)
const TAB02_LEAD_MM = 10.9 // 02 box 5.6mm margin + thead (measured 9.9)
const CONT_MM = 6.5 // page-2+ continuation header (measured 5.7)
const FOOT_MM = 6.5 // footer line incl. 2.2mm margin (measured 5.6)

/** Shared table header cells. */
function WorkersThead({ ot }: { ot: boolean }) {
  const th = (extra?: React.CSSProperties): React.CSSProperties => ({
    fontSize: '6.7pt',
    fontWeight: 700,
    color: NAVY,
    letterSpacing: '0.3pt',
    padding: '0 1.6mm 1.3mm',
    borderBottom: `1.4px solid ${NAVY}`,
    ...extra,
  })
  const thL = th({ textAlign: 'left' })
  const thR = th({ textAlign: 'right' })
  return (
    <thead>
      <tr>
        <th style={{ ...thL, width: '10mm' }}>SN</th>
        <th style={thL}>Worker</th>
        {ot ? (
          <>
            <th style={{ ...thR, width: '20mm' }}>Hours</th>
            <th style={{ ...thR, width: '18mm' }}>OT Hrs</th>
            <th style={{ ...thR, width: '20mm' }}>Rate/Hr</th>
            <th style={{ ...thR, width: '20mm' }}>OT Rate</th>
          </>
        ) : (
          <>
            <th style={{ ...thR, width: '28mm' }}>Total Hours</th>
            <th style={{ ...thR, width: '28mm' }}>Rate/Hr</th>
          </>
        )}
        <th style={{ ...thR, width: ot ? '30mm' : '36mm' }}>Amount (SAR)</th>
      </tr>
    </thead>
  )
}

/** The worker table body for one page's entry range. */
function WorkersTbody({
  entries,
  ot,
}: {
  entries: ReturnType<typeof buildCssEntries>
  ot: boolean
}) {
  const td = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: '0.85mm 1.6mm',
    borderBottom: `1px solid ${HR}`,
    verticalAlign: 'middle',
    ...extra,
  })
  const tdR = td({ textAlign: 'right', fontFamily: MONO, whiteSpace: 'nowrap' })
  const colspan = ot ? 7 : 5
  return (
    <tbody>
      {entries.map((e, i) => {
        if (e.t === 'pj') {
          return (
            <tr key={`pj-${i}`}>
              <td
                colSpan={colspan}
                style={{
                  background: CREAM,
                  borderTop: `1px solid ${CREAM_BORDER}`,
                  fontSize: '7.2pt',
                  fontWeight: 700,
                  color: DARK_GOLD,
                  padding: '1.2mm 1.6mm',
                  letterSpacing: '0.3pt',
                }}
              >
                {e.label.toUpperCase()}
                <span style={{ color: INK_SOFT, fontWeight: 600, marginLeft: '2mm', letterSpacing: 0 }}>
                  {e.workers} worker{e.workers === 1 ? '' : 's'}
                </span>
              </td>
            </tr>
          )
        }
        if (e.t === 'gh') {
          return (
            <tr key={`gh-${i}`}>
              <td
                colSpan={colspan}
                style={{
                  background: CREAM,
                  borderTop: `1px solid ${CREAM_BORDER}`,
                  fontSize: '7.4pt',
                  fontWeight: 700,
                  color: DARK_GOLD,
                  padding: '1.1mm 1.6mm',
                  letterSpacing: '0.3pt',
                }}
              >
                {e.category.toUpperCase()}
                <span style={{ color: INK_SOFT, fontWeight: 600, marginLeft: '2mm', letterSpacing: 0 }}>
                  {e.workers} worker{e.workers === 1 ? '' : 's'}
                </span>
              </td>
            </tr>
          )
        }
        if (e.t === 'w') {
          const r = e.row
          return (
            <tr key={`w-${i}`}>
              <td style={td({ fontFamily: MONO, fontWeight: 700, color: GOLD, whiteSpace: 'nowrap' })}>
                {fmtSn(e.sn)}
              </td>
              <td style={td()}>
                <b style={{ fontWeight: 600, color: NAVY }}>{r.fullName}</b>
                <small
                  style={{
                    display: 'block',
                    fontSize: '6.5pt',
                    color: INK_SOFT,
                    fontFamily: MONO,
                  }}
                >
                  Iqama {r.iqamaId}
                </small>
              </td>
              {ot ? (
                <>
                  <td style={tdR}>{fmtHours(r.hours)}</td>
                  <td style={tdR}>{r.otHours > 0 ? fmtHours(r.otHours) : '—'}</td>
                  <td style={tdR}>{fmtAmt(r.clientRate)}</td>
                  <td style={tdR}>{r.otHours > 0 ? fmtAmt(r.clientOtRate) : '—'}</td>
                </>
              ) : (
                <>
                  <td style={tdR}>{fmtHours(r.hours + r.otHours)}</td>
                  <td style={tdR}>{fmtAmt(r.clientRate)}</td>
                </>
              )}
              <td style={tdR}>
                <b style={{ fontWeight: 700, color: NAVY }}>{fmtAmt(r.amount)}</b>
              </td>
            </tr>
          )
        }
        if (e.t === 'gt' || e.t === 'pt') {
          const label =
            e.t === 'gt' ? `Total ${e.category} · ${e.workers} worker${e.workers === 1 ? '' : 's'}` : `Total ${e.label} · ${e.workers} worker${e.workers === 1 ? '' : 's'}`
          const base: React.CSSProperties =
            e.t === 'gt'
              ? {
                  background: CAT_TOTAL_BG,
                  fontWeight: 700,
                  color: NAVY,
                  borderBottom: `1.4px solid ${CAT_TOTAL_BORDER}`,
                  padding: '1.1mm 1.6mm',
                }
              : {
                  background: PROJ_TOTAL_BG,
                  fontWeight: 700,
                  color: NAVY,
                  borderTop: `1.4px solid ${NAVY}`,
                  borderBottom: `1.4px solid ${NAVY}`,
                  padding: '1.2mm 1.6mm',
                }
          const num: React.CSSProperties = { ...base, textAlign: 'right', fontFamily: MONO, whiteSpace: 'nowrap' }
          return (
            <tr key={`${e.t}-${i}`}>
              <td style={base} colSpan={2}>
                <span style={{ fontSize: '7.3pt' }}>{label}</span>
              </td>
              {ot ? (
                <>
                  <td style={num}>{fmtHours(e.hours)}</td>
                  <td style={num}>{e.otHours > 0 ? fmtHours(e.otHours) : '—'}</td>
                  <td style={num}></td>
                  <td style={num}></td>
                </>
              ) : (
                <>
                  <td style={num}>{fmtHours(e.hours + e.otHours)}</td>
                  <td style={num}></td>
                </>
              )}
              <td style={num}>{fmtAmt(e.amount)}</td>
            </tr>
          )
        }
        return null
      })}
    </tbody>
  )
}

/** 01 · BILL TO & PERIOD grid. */
function BillToBox({
  group,
  periodLabel,
  totalHours,
  categories,
  projectNames,
}: {
  group: ClientSalaryGroup
  periodLabel: string
  totalHours: number
  categories: number
  projectNames: string[]
}) {
  const small: React.CSSProperties = {
    display: 'block',
    fontSize: '6.4pt',
    color: INK_SOFT,
    fontWeight: 600,
  }
  const addr = [group.address, group.city].filter(Boolean).join(', ')
  return (
    <CssTabBox label="01 · BILL TO & PERIOD">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.6fr 1fr 1fr 1fr',
          gap: '4mm',
          fontSize: '7.3pt',
          lineHeight: 1.35,
          fontFamily: EN_FONT,
          color: INK,
        }}
      >
        <div>
          <small style={small}>Client</small>
          <b style={{ color: NAVY, fontSize: '8.6pt', fontWeight: 700 }}>{group.clientName}</b>
          <br />
          {addr || '—'}
          {group.contactPerson || group.phone ? (
            <>
              <br />
              {[group.contactPerson ? `Attn: ${group.contactPerson}` : null, group.phone]
                .filter(Boolean)
                .join(' · ')}
            </>
          ) : null}
        </div>
        <div>
          <small style={small}>C.R. No.</small>
          <span style={{ fontFamily: MONO, fontSize: '9pt' }}>{group.crNumber || '—'}</span>
          <small style={{ ...small, marginTop: '1mm' }}>Email</small>
          {group.email || '—'}
        </div>
        <div>
          <small style={small}>Workers · Categories</small>
          <span style={{ fontFamily: MONO, fontSize: '9pt' }}>
            {group.workerCount} · {categories}
          </span>
          <small style={{ ...small, marginTop: '1mm' }}>Total Hours</small>
          <span style={{ fontFamily: MONO, fontSize: '9pt' }}>{fmtHours(totalHours)}</span>
        </div>
        <div>
          <small style={small}>Project</small>
          {projectNames.length <= 1 ? (
            <b style={{ color: NAVY, fontSize: '8pt', fontWeight: 700 }}>
              {projectNames[0] ?? '—'}
            </b>
          ) : (
            <>
              <b style={{ color: NAVY, fontSize: '8pt', fontWeight: 700 }}>
                {projectNames.length} projects
              </b>
              {projectNames.map((n) => (
                <span key={n} style={{ display: 'block', color: INK }}>
                  {n}
                </span>
              ))}
            </>
          )}
        </div>
      </div>
      <span className="sr-only">Billing period {periodLabel}</span>
    </CssTabBox>
  )
}

/** 03 · CATEGORY SUMMARY table. */
function CategorySummaryBox({
  categories,
  group,
  ot,
}: {
  categories: ReturnType<typeof rollupCategories>
  group: ClientSalaryGroup
  ot: boolean
}) {
  const th = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: NAVY,
    color: '#fff',
    fontSize: '6.7pt',
    fontWeight: 700,
    letterSpacing: '0.3pt',
    padding: '1.5mm 1.6mm',
    textAlign: 'right',
    ...extra,
  })
  const td = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: '1.3mm 1.6mm',
    borderBottom: `1px solid ${HR}`,
    verticalAlign: 'middle',
    ...extra,
  })
  const tdR = (extra?: React.CSSProperties): React.CSSProperties =>
    td({ textAlign: 'right', fontFamily: MONO, whiteSpace: 'nowrap', ...extra })
  return (
    <CssTabBox label="03 · CATEGORY SUMMARY">
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: '7.9pt',
          fontFamily: EN_FONT,
          lineHeight: 1.2,
        }}
      >
        <thead>
          <tr>
            <th style={th({ textAlign: 'left', borderRadius: '1.5mm 0 0 1.5mm' })}>Category</th>
            <th style={th()}>Workers</th>
            <th style={th()}>Total Hours</th>
            {ot ? <th style={th()}>OT Hrs</th> : null}
            <th style={th({ borderRadius: '0 1.5mm 1.5mm 0' })}>Amount (SAR)</th>
          </tr>
        </thead>
        <tbody>
          {categories.map((c) => (
            <tr key={c.category}>
              <td style={td({ fontWeight: 700, color: NAVY })}>{c.category}</td>
              <td style={tdR()}>{c.workers}</td>
              <td style={tdR()}>{fmtHours(c.hours + c.otHours)}</td>
              {ot ? <td style={tdR()}>{c.otHours > 0 ? fmtHours(c.otHours) : '—'}</td> : null}
              <td style={tdR()}>
                <b style={{ fontWeight: 700, color: NAVY }}>{fmtAmt(c.amount)}</b>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td
              style={td({
                fontWeight: 700,
                color: NAVY,
                borderTop: `1.6px solid ${NAVY}`,
                borderBottom: 0,
                paddingTop: '1.8mm',
              })}
            >
              All categories
            </td>
            <td
              style={tdR({
                fontWeight: 700,
                color: NAVY,
                borderTop: `1.6px solid ${NAVY}`,
                borderBottom: 0,
                paddingTop: '1.8mm',
              })}
            >
              {group.workerCount}
            </td>
            <td
              style={tdR({
                fontWeight: 700,
                color: NAVY,
                borderTop: `1.6px solid ${NAVY}`,
                borderBottom: 0,
                paddingTop: '1.8mm',
              })}
            >
              {fmtHours(group.hours + group.otHours)}
            </td>
            {ot ? (
              <td
                style={tdR({
                  fontWeight: 700,
                  color: NAVY,
                  borderTop: `1.6px solid ${NAVY}`,
                  borderBottom: 0,
                  paddingTop: '1.8mm',
                })}
              >
                {group.otHours > 0 ? fmtHours(group.otHours) : '—'}
              </td>
            ) : null}
            <td
              style={tdR({
                fontWeight: 700,
                color: NAVY,
                borderTop: `1.6px solid ${NAVY}`,
                borderBottom: 0,
                paddingTop: '1.8mm',
              })}
            >
              {fmtAmt(group.billedAmount)}
            </td>
          </tr>
        </tfoot>
      </table>
    </CssTabBox>
  )
}

/** 04 · BILLING SUMMARY (gold tab) — words + note left, totals right. */
function BillingSummaryBox({
  group,
  settings,
  periodLabel,
  vatPercent,
  hasOt,
}: {
  group: ClientSalaryGroup
  settings: AppSettings
  periodLabel: string
  vatPercent: number
  hasOt: boolean
}) {
  const totRow: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '8pt',
    padding: '0.6mm 0',
    borderBottom: `1px dotted ${HR}`,
    color: INK,
  }
  return (
    <CssTabBox label="04 · BILLING SUMMARY" gold>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 70mm', gap: '5mm', alignItems: 'center' }}>
        <div style={{ fontSize: '7.3pt', lineHeight: 1.5, color: INK, fontFamily: EN_FONT }}>
          <span style={{ fontSize: '6.6pt', fontWeight: 700, color: DARK_GOLD, letterSpacing: '0.8pt' }}>
            AMOUNT IN WORDS
          </span>
          <br />
          {clientSummaryAmountInWords(group.grandTotal, settings.currency)}
          <div
            style={{
              fontSize: '6.9pt',
              color: INK_SOFT,
              fontStyle: 'italic',
              marginTop: '1.4mm',
              lineHeight: 1.45,
            }}
          >
            This statement covers manpower supply services for {periodLabel}: each worker&apos;s
            payroll hours (regular{hasOt ? ' + overtime' : ''}) × the agreed client rate per hour.
            Hours match the {periodLabel} payroll exactly. Worker salaries are disbursed separately
            by {settings.companyName} under its own payroll.
          </div>
        </div>
        <div>
          <div style={totRow}>
            <span>Subtotal</span>
            <b style={{ fontFamily: MONO }}>{fmtAmt(group.billedAmount)}</b>
          </div>
          <div style={totRow}>
            <span>VAT {vatPercent}%</span>
            <b style={{ fontFamily: MONO }}>{fmtAmt(group.vatAmount)}</b>
          </div>
          <div
            style={{
              background: NAVY,
              color: '#fff',
              borderRadius: '1.8mm',
              padding: '2.2mm 3mm',
              marginTop: '1.2mm',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '8pt',
              fontFamily: EN_FONT,
            }}
          >
            <span style={{ fontWeight: 700, letterSpacing: '0.3pt' }}>GRAND TOTAL (SAR)</span>
            <b style={{ fontFamily: MONO, color: LIGHT_GOLD, fontSize: '11.5pt' }}>
              {fmtAmt(group.grandTotal)}
            </b>
          </div>
        </div>
      </div>
    </CssTabBox>
  )
}

/** 05 · APPROVAL — pinned to the bottom of the last page above the footer. */
function ApprovalBox() {
  const cell = (label: string, sub: string) => (
    <div className="min-w-0">
      <div style={{ borderBottom: `1px solid ${NAVY}`, height: '8mm' }} />
      <div
        style={{
          fontSize: '6.8pt',
          fontWeight: 700,
          color: DARK_GOLD,
          letterSpacing: '0.8pt',
          marginTop: '1.3mm',
          textTransform: 'uppercase',
          fontFamily: EN_FONT,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: '7.2pt', color: INK_SOFT, marginTop: '0.3mm', fontFamily: EN_FONT }}>
        {sub}
      </div>
      <div style={{ fontSize: '7.2pt', color: INK_SOFT, marginTop: '0.3mm', fontFamily: EN_FONT }}>
        Name &amp; Date: ______________
      </div>
    </div>
  )
  return (
    <CssTabBox label="05 · APPROVAL">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7mm' }}>
        {cell('Prepared by', 'Accounts Department')}
        {cell('Approved by', 'General Manager')}
        {cell('Accepted by', 'Client Representative')}
      </div>
    </CssTabBox>
  )
}

/**
 * The By-Category client salary summary document — one or more fixed A4
 * sheets (`.doc-page`, auto-detected by the PDF pipeline's sheets mode).
 * All amounts/hours come from the stored group values; nothing is
 * recomputed. `showOt` decides the worker-table variant (the dialog
 * auto-enables it when OT rates differ, per the boss's rule).
 */
export function ClientSummaryByCategoryDocument({
  group,
  month,
  year,
  vatRate,
  settings,
  letterhead,
  showOt,
}: {
  group: ClientSalaryGroup
  month: number
  year: number
  vatRate: number
  settings: AppSettings
  letterhead: LetterheadConfigLike
  showOt: boolean
}) {
  const periodLabel = cssPeriodLabel(month, year)
  const vatPercent = Math.round(vatRate * 100)
  const geo = clientSummaryGeometryFor(letterhead)
  const contentH = PAGE_H_MM - geo.topMm - geo.bottomMm

  const projects = groupByProjectThenCategory(group.rows)
  const categories = rollupCategories(projects)
  const entries = buildCssEntries(projects)
  const projectNames = projects.map((p) => p.projectName)
  const totalHours = group.hours + group.otHours
  const hasOt = group.otHours > 0 || group.rows.some((r) => r.otHours > 0)

  // tab-01 height grows with extra projects (each name on its own line)
  const tab01Mm = TAB01_BASE_MM + Math.max(0, projectNames.length - 1) * 3.5
  const tailMm = cssTailMm(categories.length)

  const { pages } = planCssPages({
    availFirst: contentH - TOP_BLOCK_MM - tab01Mm - TAB02_LEAD_MM - FOOT_MM,
    availRest: contentH - CONT_MM - TAB02_LEAD_MM - FOOT_MM,
    entries,
    tailMm,
  })
  const totalPages = pages.length

  return (
    <div
      className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
      data-cs-bycategory
    >
      <ClientSummaryFontsStyle />
      {pages.map((page, pi) => {
        const isLast = pi === totalPages - 1
        const pageEntries = entries.slice(page.from, page.to)
        const footLeft = isLast
          ? `Generated ${formatDateTime(new Date())}`
          : 'Continued on next page'
        return (
          <ClientSummaryDocPage key={pi} letterhead={letterhead} isLast={isLast}>
            <div
              className="absolute flex flex-col"
              style={{
                top: `${geo.topMm}mm`,
                left: '14mm',
                right: '14mm',
                bottom: `${geo.bottomMm}mm`,
              }}
            >
              {/* page 1: title stack · page 2+: continuation header */}
              {pi === 0 ? (
                <div
                  className="flex shrink-0 items-end justify-between"
                  style={{ marginBottom: '0.6mm', fontFamily: EN_FONT }}
                >
                  <div style={{ fontSize: '14pt', fontWeight: 700, color: NAVY }}>
                    <small
                      style={{
                        display: 'block',
                        fontSize: '6.6pt',
                        color: DARK_GOLD,
                        letterSpacing: '1.2pt',
                        fontWeight: 700,
                      }}
                    >
                      MANPOWER BILLING
                    </small>
                    CLIENT SALARY SUMMARY
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <small
                      style={{
                        display: 'block',
                        fontSize: '6.5pt',
                        color: INK_SOFT,
                        fontWeight: 600,
                      }}
                    >
                      BILLING PERIOD
                    </small>
                    <b style={{ fontSize: '10pt', color: NAVY }}>{periodLabel}</b>
                  </div>
                </div>
              ) : (
                <div
                  className="flex shrink-0 items-center justify-between"
                  style={{
                    fontSize: '7.2pt',
                    color: INK_SOFT,
                    paddingBottom: '1.6mm',
                    borderBottom: `1px solid ${HR}`,
                    fontFamily: EN_FONT,
                  }}
                >
                  <span>
                    <b style={{ color: NAVY }}>CLIENT SALARY SUMMARY</b> · {group.clientName} ·{' '}
                    {periodLabel}
                  </span>
                  <span>continued</span>
                </div>
              )}

              {/* 01 · BILL TO & PERIOD — page 1 only */}
              {pi === 0 ? (
                <BillToBox
                  group={group}
                  periodLabel={periodLabel}
                  totalHours={totalHours}
                  categories={categories.length}
                  projectNames={projectNames}
                />
              ) : null}

              {/* 02 · WORKERS BY CATEGORY (continued on later pages) */}
              {pageEntries.length > 0 ? (
                <CssTabBox label={pi === 0 ? '02 · WORKERS BY CATEGORY' : '02 · WORKERS BY CATEGORY (continued)'}>
                  <table
                    style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '7.9pt',
                      fontFamily: EN_FONT,
                      lineHeight: 1.2,
                    }}
                  >
                    <WorkersThead ot={showOt} />
                    <WorkersTbody entries={pageEntries} ot={showOt} />
                  </table>
                </CssTabBox>
              ) : null}

              {/* 03 + 04 — last page only */}
              {page.hasTail ? (
                <>
                  <CategorySummaryBox categories={categories} group={group} ot={showOt} />
                  <BillingSummaryBox
                    group={group}
                    settings={settings}
                    periodLabel={periodLabel}
                    vatPercent={vatPercent}
                    hasOt={hasOt}
                  />
                </>
              ) : null}

              {/* spacer pushes 05 (last page) / the footer to the bottom */}
              <div style={{ flex: 1 }} />

              {/* 05 · APPROVAL — pinned above the footer on the last page */}
              {page.hasTail ? <ApprovalBox /> : null}

              {/* footer line */}
              <div
                className="flex shrink-0 items-center justify-between"
                style={{
                  fontSize: '6.4pt',
                  color: INK_SOFT,
                  marginTop: '2.2mm',
                  fontFamily: EN_FONT,
                }}
              >
                <span>{footLeft}</span>
                <span>
                  Page {pi + 1} of {totalPages}
                </span>
              </div>
            </div>
          </ClientSummaryDocPage>
        )
      })}
    </div>
  )
}

// Local structural type (avoids importing the client-only dialog file just
// for the letterhead prop type).
type LetterheadConfigLike = Parameters<typeof clientSummaryGeometryFor>[0]
