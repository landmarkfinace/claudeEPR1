'use client'

// Name List print template "FOLDER" — reference design
// Name_List_Template_2_Folder (HTML + PNG provided by the boss).
//
//   • top row: "NAME LIST قائمة الأسماء" + the subject pill (data-driven
//     subject colour) left · LIST NO. right
//   • tabbed sections with folder tabs:
//       01 · DETAILS  — two 4-cell grids (Client / Project / Date / Positions
//                       or Reference; Location / Contact / Transport / Subject)
//       02 · WORKERS  — the table; page 2+ continues this tab with
//                       (continued · تابع), the thead repeats, a row is never
//                       split
//       03 · SUMMARY (gold) — trade chips + navy TOTAL box, LAST page only
//       04 · SIGN-OFF — the signature grid (no stamp boxes), pinned to the
//                       BOTTOM of the last page 3mm above the footer line
//   • status stamp on page 1 when status ≠ draft (beside nothing — above the
//     content start, so it can never overlap the title or table)
//
// DATA GUARANTEE: reads the SAME list data as Classic (shared model) — the
// list number, client, project, dates, every worker's name, Iqama, mobile,
// results, the trade summary and the total are IDENTICAL across templates.
// Missing optional values keep Classic's "—" in the fixed grids; letterhead
// artwork + geometry come from Settings; without letterhead the reserved
// bands stay EMPTY (never placeholder text).
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
  SPACER_MIN_MM,
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

// ── Folder palette (from the reference) ────────────────────────────────────
const INK = '#1D2433'
const INK_SOFT = '#4A5468'
const HR = '#DDE3EC'
const CHIP_BG = '#FAF7F1'
const CHIP_BORDER = '#E6DFCF'

// ── Folder tab (reference .tab) ─────────────────────────────────────────────
function FolderTab({
  en,
  ar,
  continued,
  gold,
}: {
  en: string
  ar: string
  continued?: boolean
  gold?: boolean
}) {
  const bg = gold ? GOLD : NAVY
  const fg = gold ? '#fff' : LIGHT_GOLD
  return (
    <span
      className="absolute flex items-center gap-[2mm]"
      style={{
        top: '-5mm',
        left: '-1px',
        height: '5mm',
        background: bg,
        color: fg,
        fontSize: '7pt',
        fontWeight: 700,
        letterSpacing: '.8pt',
        padding: '0 4mm 0 3mm',
        borderRadius: '2mm 2mm 0 0',
      }}
    >
      {en}
      {continued ? (
        <span className="font-normal" style={{ letterSpacing: 0, color: gold ? '#fff' : '#fff' }}>
          {' '}
          (continued ·{' '}
          <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
            تابع
          </span>
          )
        </span>
      ) : null}
      <span
        lang="ar"
        dir="rtl"
        style={{ letterSpacing: 0, color: '#fff', fontWeight: 400, fontSize: '7.5pt', marginLeft: continued ? '1mm' : 0 }}
      >
        {ar}
      </span>
      {/* the tab's folded corner */}
      <i
        aria-hidden
        className="absolute"
        style={{
          right: '-3mm',
          bottom: 0,
          width: '3mm',
          height: '5mm',
          background: bg,
          clipPath: 'polygon(0 0, 0 100%, 100% 100%)',
        }}
      />
    </span>
  )
}

/** One details-grid cell (reference .g3 > div). */
function DetailCell({ label, labelAr, value }: { label: string; labelAr: string; value: string }) {
  return (
    <div className="min-w-0">
      <small
        className="flex justify-between"
        style={{ fontSize: '6.6pt', color: INK_SOFT, fontWeight: 600 }}
      >
        <span>{label}</span>
        <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
          {labelAr}
        </span>
      </small>
      <b className="mt-[.4mm] block break-words" style={{ fontSize: '8pt', color: INK, fontWeight: 600 }}>
        {value}
      </b>
    </div>
  )
}

// ── The workers table (reference styling) ───────────────────────────────────
function FolderTable({
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

  // auto table layout like the reference — columns size to their content
  const thBase = {
    color: NAVY,
    fontSize: '7pt',
    fontWeight: 700,
    padding: '0 1.3mm 1.4mm',
    lineHeight: 1.3,
    borderBottom: `1.4px solid ${NAVY}`,
  }

  return (
    <table className="w-full border-collapse" style={{ fontSize: '8pt' }}>
      <thead style={{ display: 'table-header-group' }}>
        <tr>
          <th className="text-left" style={{ ...thBase, width: '7mm' }}>
            #
          </th>
          <th className="text-left" style={{ ...thBase }}>
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
            <tr
              key={w.id}
              style={{ borderBottom: last ? 0 : `1px solid ${HR}`, breakInside: 'avoid' }}
            >
              <td
                className="text-left"
                style={{
                  padding: '1.6mm 1.3mm',
                  fontFamily: DOC_MONO,
                  fontSize: '7pt',
                  fontWeight: 700,
                  color: DARK_GOLD,
                }}
              >
                {String(idx + 1).padStart(2, '0')}
              </td>
              <td className="text-left break-words" style={{ padding: '1.6mm 1.3mm', fontWeight: 700, color: NAVY }}>
                {w.staff.fullName}
              </td>
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={`${LEFT_KEYS.has(c.key) ? 'text-left' : 'text-center'} align-top`}
                  style={{ padding: '1.6mm 1.3mm', color: INK }}
                >
                  <TplCell colKey={c.key} w={w} isMob={isMob} hasResultBoxes={hasResultBoxes} />
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
export function NLFolderDocument({
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

  // pagination — measured budgets with the shared planner
  const page1FixedMm = 48 // top row + 01 DETAILS box + 02 box overhead + thead
  const contHeaderMm = 17 // continuation 02 box (tab overhang + padding + thead)
  const tailMm = 51 // 03 SUMMARY box + spacer + 04 SIGN-OFF box + 3mm + note
  const availFirst = PAGE_H_MM - geo.topMm - (geo.bottomMm + FOOTER_MM) - page1FixedMm
  const availRest = PAGE_H_MM - geo.topMm - (geo.bottomMm + FOOTER_MM) - contHeaderMm

  const rowsMm = list.workers.map((w) =>
    tplRowHeightMm(w, !isMob && hasResultCol && !w.result, hasRemarks)
  )
  const planned = planNlPages({ availFirst, availRest, rowsMm, tailMm })
  const pages = planned.pages
  const totalPages = planned.totalPages

  const trades = tradeCounts(list.workers)
  const sig = nlSignatureTitles(list.subjectKind)

  const contactName = list.clientContact ?? list.client?.contactPerson ?? null
  const contactPhone = list.clientPhone ?? list.client?.phone ?? null
  const contact = [contactName, contactPhone].filter(Boolean).join(' · ') || '—'
  const reference = isMob
    ? [
        list.refInterviewListNo ? `Interview ${list.refInterviewListNo}` : null,
        list.refPoNo ? `PO ${list.refPoNo}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || '—'
    : list.positions.join(', ') || '—'

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
            stampRightMm={14}
          >
            <div
              className="absolute inset-x-0 top-0 z-10 flex h-full flex-col [&>*]:shrink-0"
              style={{
                paddingTop: `${geo.topMm}mm`,
                paddingBottom: `${geo.bottomMm + 1}mm`,
                paddingLeft: '14mm',
                paddingRight: '14mm',
              }}
            >
              {pageIdx === 0 ? (
                <>
                  {/* top row: title + subject pill · list no */}
                  <div className="flex items-end justify-between gap-3">
                    <p className="m-0" style={{ fontSize: '15pt', fontWeight: 700, color: NAVY, lineHeight: 1.1 }}>
                      {NL_TPL_LABELS.docTitle.en}
                      <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT, fontSize: '12pt', color: DARK_GOLD, marginLeft: '3mm' }}>
                        {NL_TPL_LABELS.docTitle.ar}
                      </span>
                      <span
                        className="inline-block align-[3pt]"
                        style={{
                          marginLeft: '3mm',
                          fontSize: '6.6pt',
                          fontWeight: 700,
                          color: '#fff',
                          background: list.subjectColor,
                          borderRadius: '1mm',
                          padding: '.6mm 2.4mm',
                          letterSpacing: '.8pt',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {list.subjectName.toUpperCase()}
                      </span>
                    </p>
                    <p className="m-0 text-right">
                      <small className="block" style={{ fontSize: '6.6pt', color: INK_SOFT, fontWeight: 600 }}>
                        {NL_TPL_LABELS.listNo.en} ·{' '}
                        <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
                          {NL_TPL_LABELS.listNo.ar}
                        </span>
                      </small>
                      <b className="block" style={{ fontFamily: DOC_MONO, fontSize: '11pt', color: NAVY }}>
                        {list.listNo}
                      </b>
                    </p>
                  </div>

                  {/* 01 · DETAILS */}
                  <div
                    className="relative"
                    style={{
                      marginTop: '5.6mm',
                      border: `1px solid ${NAVY}`,
                      borderRadius: '0 2.5mm 2.5mm 2.5mm',
                      padding: '2mm 3.5mm',
                    }}
                  >
                    <FolderTab en="01 · DETAILS" ar="التفاصيل" />
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: '1.2fr 1.3fr 1fr .9fr', gap: '3mm' }}
                    >
                      <DetailCell label="Client" labelAr="العميل" value={list.clientName} />
                      <DetailCell
                        label={isMob ? 'Project / Site' : 'Project'}
                        labelAr={isMob ? 'المشروع / الموقع' : 'المشروع'}
                        value={
                          isMob
                            ? list.projectName ?? list.location ?? '—'
                            : list.projectName ?? '—'
                        }
                      />
                      {/* the project's Arabic name is not stored — the AR
                          sub-line hides (English project name only) */}
                      <DetailCell
                        label={isMob ? 'Mobilization Date' : 'Date & Time'}
                        labelAr={isMob ? 'تاريخ التعبئة' : 'التاريخ'}
                        value={tplDateTime(list.date, list.time)}
                      />
                      <DetailCell
                        label={isMob ? 'Reference' : 'Positions'}
                        labelAr={isMob ? 'المرجع' : 'المهن'}
                        value={reference}
                      />
                    </div>
                    <div style={{ height: '1px', background: HR, margin: '1.5mm 0' }} />
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: '1.2fr 1.3fr 1fr .9fr', gap: '3mm' }}
                    >
                      <DetailCell label="Location" labelAr="الموقع" value={list.location ?? '—'} />
                      <DetailCell label="Client Contact" labelAr="جهة الاتصال" value={contact} />
                      <DetailCell label="Transport" labelAr="النقل" value={list.transport ?? '—'} />
                      <DetailCell label="Subject" labelAr="الموضوع" value={list.subjectName} />
                    </div>
                  </div>

                  {/* 02 · WORKERS */}
                  <div
                    className="relative"
                    style={{
                      marginTop: '5.6mm',
                      border: `1px solid ${NAVY}`,
                      borderRadius: '0 2.5mm 2.5mm 2.5mm',
                      padding: '2mm 3.5mm',
                    }}
                  >
                    <FolderTab en="02 · WORKERS" ar="العمال" />
                    <FolderTable list={list} cols={cols} rowIdxs={plan.rows} isMob={isMob} />
                  </div>
                </>
              ) : (
                <>
                  {/* page 2+ — the 02 · WORKERS tab continues */}
                  <div
                    className="relative"
                    style={{
                      marginTop: '5.6mm',
                      border: `1px solid ${NAVY}`,
                      borderRadius: '0 2.5mm 2.5mm 2.5mm',
                      padding: '2mm 3.5mm',
                    }}
                  >
                    <FolderTab en="02 · WORKERS" ar="العمال" continued />
                    <FolderTable list={list} cols={cols} rowIdxs={plan.rows} isMob={isMob} />
                  </div>
                </>
              )}

              {/* tail — LAST PAGE ONLY: 03 · SUMMARY (gold), then the pinned
                  04 · SIGN-OFF, 3mm, and the footer line */}
              {plan.hasTail ? (
                <div
                  className="relative"
                  style={{
                    marginTop: '5.6mm',
                    border: `1px solid ${GOLD}`,
                    borderRadius: '0 2.5mm 2.5mm 2.5mm',
                    padding: '2mm 3.5mm',
                  }}
                  data-nl-chips
                >
                  <FolderTab en="03 · SUMMARY" ar="الملخص" gold />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-[1.6mm]">
                      {[...trades.entries()].map(([t, n]) => (
                        <span
                          key={t}
                          className="text-[7pt]"
                          style={{
                            color: INK_SOFT,
                            background: CHIP_BG,
                            border: `1px solid ${CHIP_BORDER}`,
                            borderRadius: '1.2mm',
                            padding: '.8mm 2.4mm',
                          }}
                        >
                          {t} <b style={{ color: NAVY }}>{n}</b>
                        </span>
                      ))}
                    </div>
                    <span
                      style={{
                        background: NAVY,
                        color: '#fff',
                        borderRadius: '1.6mm',
                        padding: '1.6mm 4mm',
                        fontSize: '8pt',
                      }}
                    >
                      {NL_TPL_LABELS.total.en}
                      <b style={{ color: LIGHT_GOLD, fontSize: '11pt', margin: '0 1.5mm' }}>
                        {list.workers.length}
                      </b>
                      {NL_TPL_LABELS.workers.en.toUpperCase()}
                    </span>
                  </div>
                </div>
              ) : null}

              {plan.hasTail ? (
                <div className="w-full" style={{ flex: '1 1 0', minHeight: `${SPACER_MIN_MM}mm` }} />
              ) : null}

              {plan.hasTail ? (
                <div
                  className="relative"
                  style={{
                    marginTop: '6mm',
                    border: `1px solid ${NAVY}`,
                    borderRadius: '0 2.5mm 2.5mm 2.5mm',
                    padding: '2mm 3.5mm',
                  }}
                  data-nl-signatures
                >
                  <FolderTab en="04 · SIGN-OFF" ar="الاعتماد" />
                  <div className="grid grid-cols-2 gap-[8mm]">
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
                      <p
                        className="mt-[1.4mm] flex justify-between"
                        style={{ fontSize: '7.4pt', color: INK_SOFT }}
                      >
                        <span>Name: ______________________</span>
                        <span>Date: ___ / ___ / ______</span>
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
                      <p
                        className="mt-[1.4mm] flex justify-between"
                        style={{ fontSize: '7.4pt', color: INK_SOFT }}
                      >
                        <span>Name: ______________________</span>
                        <span>Date: ___ / ___ / ______</span>
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {plan.hasTail ? <div style={{ height: `${GAP_SIG_NOTE_MM}mm` }} /> : null}

              {/* footer line — every page, pinned to the column bottom */}
              <p
                className="mt-auto flex flex-wrap items-center justify-between gap-x-[4mm]"
                style={{ fontSize: '6.6pt', color: INK_SOFT }}
                data-nl-note
              >
                <span className="whitespace-nowrap">
                  {tplFooterLine(settings)} · {list.listNo}
                </span>
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
            </div>
          </NLTplPage>
        )
      })}
    </>
  )
}
