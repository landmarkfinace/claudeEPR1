'use client'

// Name List print template "SIDEBAR" — reference design
// Name_List_Template_3_Sidebar (HTML + PNG provided by the boss).
//
//   • full-height cream sidebar on EVERY page (gold gradient edge, flush to
//     the page's left edge): kicker + stacked "NAME LIST" title + Arabic
//     title + subject pill (data-driven colour) + list number + info
//     sections; the navy TOTAL WORKERS box (with the per-trade breakdown)
//     lives at the sidebar's bottom on the LAST page only
//   • page 2+ sidebar is minimal: list number + client + continued · تابع
//   • main column: headline row, the workers table (auto layout like the
//     reference — the tick-box result column takes the room it needs), and
//     the signature grid pinned to the BOTTOM of the LAST page 3mm above
//     the footer line
//
// DATA GUARANTEE: reads the SAME list data as Classic (shared model) — the
// list number, client, project, dates, every worker's name, Iqama, mobile,
// results, the trade summary and the total are IDENTICAL across templates.
// Missing optional values hide their line (worker cells keep Classic's "—");
// letterhead artwork + geometry come from Settings; without letterhead the
// reserved bands stay EMPTY (never placeholder text).
import type {
  AppSettings,
  LetterheadConfig,
  NameListColumns,
  NameListDetail,
} from '@/lib/types'
import { nlOrderedColumns, nlFormatDate } from '@/lib/name-list-utils'
import {
  DARK_GOLD,
  DOC_FONT,
  DOC_MONO,
  FOOTER_MM,
  GAP_SIG_NOTE_MM,
  GOLD,
  LIGHT_GOLD,
  NAVY,
  PAGE_H_MM,
  PAGE_W_MM,
  SPACER_MIN_MM,
  CREAM,
  NLTplPage,
  TplCell,
  geometryFor,
  nlSignatureTitles,
  planNlPages,
  tplDateTime,
  tplFooterLine,
  tradeCounts,
  tplRowHeightMm,
  NL_TPL_LABELS,
} from './name-list-print-shared'

// ── Sidebar palette / geometry (from the reference) ────────────────────────
const INK = '#1D2433'
const INK_SOFT = '#4A5468'
const HR = '#DDE3EC'
const SIDE_EDGE = '#E6DFCF'
const SIDE_W_MM = 56
const SIDE_PAD_R_MM = 12 // main column's right margin (reference .pg right)
const CNT_ROW = '#C9D3E3'

/** Sidebar row spec — auto table layout wraps names a little more, so the
 *  height model is slightly more generous than the other templates. */
const SIDE_ROW_SPEC = {
  base: 9.0,
  resultBoxes: 12,
  perNameLine: 4,
  perRemarkLine: 3.0,
  nameCharsPerLine: 12,
  remarkCharsPerLine: 26,
}

// ── The gold gradient edge (reference .side:before) ─────────────────────────
function SideEdge() {
  return (
    <span
      aria-hidden
      className="absolute"
      style={{
        left: 0,
        top: 0,
        bottom: 0,
        width: '3mm',
        background: `linear-gradient(${LIGHT_GOLD}, ${DARK_GOLD})`,
      }}
    />
  )
}

/** One sidebar section (reference .sec). */
function SideSec({ en, ar, children }: { en: string; ar: string; children: React.ReactNode }) {
  return (
    <div className="mt-[3.4mm]">
      <p
        className="flex justify-between"
        style={{ fontSize: '6.5pt', fontWeight: 700, color: DARK_GOLD, letterSpacing: '.5pt', marginBottom: '1mm' }}
      >
        <span>{en}</span>
        <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT, letterSpacing: 0, fontSize: '7pt' }}>
          {ar}
        </span>
      </p>
      <div className="break-words" style={{ fontSize: '8pt', fontWeight: 600, color: INK, lineHeight: 1.4 }}>
        {children}
      </div>
    </div>
  )
}

// ── The workers table (reference styling — auto layout) ────────────────────
function SidebarTable({
  list,
  cols,
  rowIdxs,
  isMob,
}: {
  list: NameListDetail
  cols: { key: Parameters<typeof TplCell>[0]['colKey']; label: string }[]
  rowIdxs: number[]
  isMob: boolean
}) {
  const hasResultCol = cols.some((c) => c.key === 'result')
  const LEFT_KEYS = new Set([
    'trade',
    'nationality',
    'iqama',
    'passport',
    'mobile',
    'result',
    'remarks',
  ])

  const thBase = {
    color: NAVY,
    fontSize: '7pt',
    fontWeight: 700,
    padding: '0 1.1mm 1.4mm',
    lineHeight: 1.3,
    textAlign: 'center',
    borderBottom: `1.6px solid ${NAVY}`,
  }

  return (
    <table
      className="w-full border-collapse"
      style={{ marginTop: '2.6mm', fontSize: '8pt' }}
    >
      <thead style={{ display: 'table-header-group' }}>
        <tr>
          <th className="text-left" style={{ ...thBase, textAlign: 'left', width: '7mm' }}>
            #
          </th>
          <th className="text-left" style={{ ...thBase, textAlign: 'left' }}>
            {NL_TPL_LABELS.columns.name.en}
            <span lang="ar" dir="rtl" className="block" style={{ fontFamily: DOC_FONT, fontWeight: 400, color: INK_SOFT, fontSize: '7pt' }}>
              {NL_TPL_LABELS.columns.name.ar}
            </span>
          </th>
          {cols.map((c) => {
            const L = NL_TPL_LABELS.columns[c.key]
            return (
              <th
                key={c.key}
                style={{ ...thBase, textAlign: LEFT_KEYS.has(c.key) ? 'left' : 'center' }}
              >
                {c.key === 'experience' ? 'Exp.' : L.en}
                <span lang="ar" dir="rtl" className="block" style={{ fontFamily: DOC_FONT, fontWeight: 400, color: INK_SOFT, fontSize: '7pt' }}>
                  {L.ar}
                </span>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {rowIdxs.map((idx, i) => {
          const w = list.workers[idx]
          const hasResultBoxes = hasResultCol && !w.result
          const last = i === rowIdxs.length - 1
          return (
            <tr key={w.id} style={{ borderBottom: last ? 0 : `1px solid ${HR}`, breakInside: 'avoid' }}>
              <td
                className="text-left"
                style={{
                  padding: '1.85mm 1.1mm',
                  color: GOLD,
                  fontFamily: DOC_MONO,
                  fontWeight: 700,
                  fontSize: '7.5pt',
                }}
              >
                {String(idx + 1).padStart(2, '0')}
              </td>
              <td className="text-left break-words" style={{ padding: '1.85mm 1.1mm', fontWeight: 700, color: NAVY }}>
                {w.staff.fullName}
              </td>
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={`${LEFT_KEYS.has(c.key) ? 'text-left' : 'text-center'} align-top`}
                  style={{ padding: '1.85mm 1.1mm', color: INK }}
                >
                  <TplCell colKey={c.key} w={w} isMob={isMob} hasResultBoxes={hasResultBoxes} resSoft />
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── The document ────────────────────────────────────────────────────────────
export function NLSidebarDocument({
  list,
  columns,
  letterhead,
  settings,
}: {
  list: NameListDetail
  columns: NameListColumns
  letterhead: LetterheadConfig
  settings: AppSettings
}) {
  const geo = geometryFor(letterhead)
  const isMob = list.subjectKind === 'mobilization'
  const cols = nlOrderedColumns(list.subjectKind, columns)
  const hasResultCol = cols.some((c) => c.key === 'result')
  const hasRemarks = cols.some((c) => c.key === 'remarks')

  // pagination — measured budgets with the shared planner (main column)
  const page1FixedMm = 18 // headline row + spacing + thead
  const contHeaderMm = 17 // continuation header + thead
  const tailMm = 34 // spacer + signature grid + 3mm + footer line
  const availFirst = PAGE_H_MM - geo.topMm - (geo.bottomMm + FOOTER_MM) - page1FixedMm
  const availRest = PAGE_H_MM - geo.topMm - (geo.bottomMm + FOOTER_MM) - contHeaderMm

  const rowsMm = list.workers.map((w) =>
    tplRowHeightMm(w, !isMob && hasResultCol && !w.result, hasRemarks, SIDE_ROW_SPEC)
  )
  const planned = planNlPages({ availFirst, availRest, rowsMm, tailMm })
  const pages = planned.pages
  const totalPages = planned.totalPages

  const trades = tradeCounts(list.workers)
  const sig = nlSignatureTitles(list.subjectKind)

  const contactName = list.clientContact ?? list.client?.contactPerson ?? null
  const contactPhone = list.clientPhone ?? list.client?.phone ?? null

  return (
    <>
      {pages.map((plan, pageIdx) => {
        const isLast = pageIdx === totalPages - 1
        return (
          <NLTplPage
            key={pageIdx}
            letterhead={letterhead}
            geo={geo}
            status={list.status}
            pageIdx={pageIdx}
            totalPages={totalPages}
            isLast={isLast}
            stampRightMm={SIDE_PAD_R_MM}
          >
            {/* grid: sidebar flush to the page's left edge + main column */}
            <div
              className="absolute inset-x-0 top-0 z-10 flex h-full"
              style={{
                paddingTop: `${geo.topMm}mm`,
                paddingBottom: `${geo.bottomMm + 1}mm`,
              }}
            >
              <aside
                className="relative flex shrink-0 flex-col"
                style={{
                  width: `${SIDE_W_MM}mm`,
                  background: CREAM,
                  borderRight: `1px solid ${SIDE_EDGE}`,
                  padding: '4mm 4.5mm 4mm 12mm',
                }}
              >
                <SideEdge />
                {pageIdx === 0 ? (
                  <>
                    <p style={{ fontSize: '6.6pt', fontWeight: 700, color: DARK_GOLD, letterSpacing: '1pt' }}>
                      WORKERS DEPLOYMENT
                    </p>
                    <p className="mt-[1.4mm]" style={{ fontSize: '17pt', fontWeight: 700, color: NAVY, lineHeight: 1.05 }}>
                      NAME
                      <br />
                      LIST
                    </p>
                    <p lang="ar" dir="rtl" className="mt-[.6mm]" style={{ fontFamily: DOC_FONT, fontSize: '10pt', fontWeight: 700, color: NAVY }}>
                      {NL_TPL_LABELS.docTitle.ar}
                    </p>
                    <span
                      className="mt-[2mm] self-start"
                      style={{
                        fontSize: '6.6pt',
                        fontWeight: 700,
                        color: '#fff',
                        background: list.subjectColor,
                        borderRadius: '10mm',
                        padding: '.6mm 2.8mm',
                        letterSpacing: '.8pt',
                      }}
                    >
                      {list.subjectName.toUpperCase()}
                    </span>
                    <p
                      className="mt-[2.4mm]"
                      style={{
                        fontFamily: DOC_MONO,
                        fontSize: '10pt',
                        fontWeight: 700,
                        color: NAVY,
                        padding: '1.4mm 0',
                        borderTop: `1.2px solid ${GOLD}`,
                        borderBottom: `1.2px solid ${GOLD}`,
                      }}
                    >
                      {list.listNo}
                    </p>

                    <SideSec en="CLIENT" ar="العميل">
                      {list.clientName}
                    </SideSec>
                    <SideSec en={isMob ? 'PROJECT / SITE' : 'PROJECT'} ar={isMob ? 'المشروع / الموقع' : 'المشروع'}>
                      {isMob ? list.projectName ?? list.location ?? '—' : list.projectName ?? '—'}
                      {/* the project's Arabic name is not stored — the AR
                          sub-line hides (English project name only) */}
                    </SideSec>
                    <SideSec
                      en={isMob ? 'MOBILIZATION DATE' : 'DATE & TIME'}
                      ar={isMob ? 'تاريخ التعبئة' : 'التاريخ'}
                    >
                      <span style={{ fontFamily: DOC_MONO }}>{tplDateTime(list.date, list.time)}</span>
                    </SideSec>
                    {isMob ? (
                      <SideSec en="REFERENCE" ar="المرجع">
                        {[
                          list.refInterviewListNo ? `Interview ${list.refInterviewListNo}` : null,
                          list.refPoNo ? `PO ${list.refPoNo}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </SideSec>
                    ) : (
                      <SideSec en="LOCATION" ar="الموقع">
                        {list.location ?? '—'}
                      </SideSec>
                    )}
                    <SideSec en="CONTACT" ar="جهة الاتصال">
                      {[contactName, contactPhone].filter(Boolean).join(' · ') || '—'}
                      {list.transport ? (
                        <small className="mt-[.6mm] block" style={{ fontSize: '6.6pt', color: INK_SOFT, fontWeight: 400 }}>
                          Transport: {list.transport}
                        </small>
                      ) : null}
                    </SideSec>

                    {/* TOTAL WORKERS box — LAST PAGE ONLY, pinned to the
                        sidebar's bottom */}
                    {plan.hasTail ? (
                      <div
                        className="mt-auto"
                        style={{ background: NAVY, color: '#fff', borderRadius: '2.5mm', padding: '3mm 3.5mm' }}
                        data-nl-chips
                      >
                        <small
                          className="flex justify-between"
                          style={{ fontSize: '6.5pt', color: LIGHT_GOLD, fontWeight: 700 }}
                        >
                          <span>{NL_TPL_LABELS.totalWorkers.en}</span>
                          <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
                            {NL_TPL_LABELS.totalWorkers.ar}
                          </span>
                        </small>
                        <b className="mt-[.5mm] block" style={{ fontSize: '22pt', lineHeight: 1.1 }}>
                          {list.workers.length}
                        </b>
                        <div className="mt-[1mm]">
                          {[...trades.entries()].map(([t, n]) => (
                            <p
                              key={t}
                              className="flex justify-between"
                              style={{ fontSize: '7pt', color: CNT_ROW, padding: '.6mm 0', borderTop: '1px solid rgba(255,255,255,.12)' }}
                            >
                              <span>{t}</span>
                              <b style={{ fontSize: '7.5pt', color: '#fff' }}>{n}</b>
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    {/* page 2+ — minimal sidebar: list no + client + continued */}
                    <p
                      className="mt-[2mm]"
                      style={{
                        fontFamily: DOC_MONO,
                        fontSize: '10pt',
                        fontWeight: 700,
                        color: NAVY,
                        padding: '1.4mm 0',
                        borderTop: `1.2px solid ${GOLD}`,
                        borderBottom: `1.2px solid ${GOLD}`,
                      }}
                    >
                      {list.listNo}
                    </p>
                    <SideSec en="CLIENT" ar="العميل">
                      {list.clientName}
                    </SideSec>
                    <p
                      className="mt-[3.4mm]"
                      style={{ fontSize: '7pt', color: INK_SOFT }}
                    >
                      {NL_TPL_LABELS.continued}
                    </p>
                  </>
                )}
              </aside>

              <main
                className="flex min-w-0 flex-1 flex-col [&>*]:shrink-0"
                style={{ padding: `4mm ${SIDE_PAD_R_MM}mm 0 5mm`, width: `${PAGE_W_MM - SIDE_W_MM - SIDE_PAD_R_MM}mm` }}
              >
                {pageIdx === 0 ? (
                  <div
                    className="flex items-end justify-between gap-3 pb-[2mm]"
                    style={{ borderBottom: `1px solid ${HR}` }}
                  >
                    <b className="break-words" style={{ fontSize: '10.5pt', color: NAVY }}>
                      Workers presented — {list.subjectName}
                    </b>
                    <span lang="ar" dir="rtl" className="shrink-0" style={{ fontFamily: DOC_FONT, fontSize: '9pt', fontWeight: 700, color: DARK_GOLD }}>
                      العمال المقدمون
                    </span>
                  </div>
                ) : (
                  <div className="flex items-end justify-between gap-3 pb-[1.2mm]">
                    <p style={{ fontSize: '8.5pt', fontWeight: 700, color: NAVY }}>
                      {list.subjectName} List — continued
                    </p>
                    <p style={{ fontSize: '7.5pt', color: INK_SOFT }}>
                      {list.listNo} · {list.clientName}
                    </p>
                  </div>
                )}
                <SidebarTable list={list} cols={cols} rowIdxs={plan.rows} isMob={isMob} />

                {/* tail — LAST PAGE ONLY: the signature grid pinned to the
                    bottom of the main column, 3mm above the footer line */}
                {plan.hasTail ? (
                  <div className="w-full" style={{ flex: '1 1 0', minHeight: `${SPACER_MIN_MM}mm` }} />
                ) : null}

                {plan.hasTail ? (
                  <div className="grid grid-cols-2 gap-[6mm]" data-nl-signatures>
                    <div>
                      <p
                        className="flex justify-between"
                        style={{ fontSize: '7pt', fontWeight: 700, color: DARK_GOLD, letterSpacing: '.5pt' }}
                      >
                        <span>{sig.left.en.toUpperCase()}</span>
                        <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT, letterSpacing: 0, color: DARK_GOLD }}>
                          {sig.left.ar}
                        </span>
                      </p>
                      <div style={{ borderBottom: `1px solid ${NAVY}`, height: '12mm', marginTop: '1mm' }} />
                      <p className="mt-[1.2mm]" style={{ fontSize: '7pt', color: INK_SOFT, lineHeight: 1.6 }}>
                        Name: ________________________
                        <br />
                        Date: ____ / ____ / ________
                      </p>
                    </div>
                    <div>
                      <p
                        className="flex justify-between"
                        style={{ fontSize: '7pt', fontWeight: 700, color: DARK_GOLD, letterSpacing: '.5pt' }}
                      >
                        <span>{sig.right.en.toUpperCase()}</span>
                        <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT, letterSpacing: 0, color: DARK_GOLD }}>
                          {sig.right.ar}
                        </span>
                      </p>
                      <div style={{ borderBottom: `1px solid ${NAVY}`, height: '12mm', marginTop: '1mm' }} />
                      <p className="mt-[1.2mm]" style={{ fontSize: '7pt', color: INK_SOFT, lineHeight: 1.6 }}>
                        Name: ________________________
                        <br />
                        Date: ____ / ____ / ________
                      </p>
                    </div>
                  </div>
                ) : null}

                {plan.hasTail ? <div style={{ height: `${GAP_SIG_NOTE_MM}mm` }} /> : null}

                {/* footer line — every page, pinned to the main column bottom */}
                <p
                  className="mt-auto flex flex-wrap items-center justify-between gap-x-[4mm]"
                  style={{ fontSize: '6.6pt', color: INK_SOFT }}
                  data-nl-note
                >
                  <span className="whitespace-nowrap">{list.listNo}</span>
                  <span className="whitespace-nowrap tabular-nums">
                    Page {pageIdx + 1} of {totalPages}
                    {' · '}
                    <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
                      صفحة {pageIdx + 1} من {totalPages}
                    </span>
                  </span>
                  <span className="whitespace-nowrap">
                    {NL_TPL_LABELS.printed.en} {nlFormatDate(new Date())}
                  </span>
                </p>
              </main>
            </div>
          </NLTplPage>
        )
      })}
    </>
  )
}
