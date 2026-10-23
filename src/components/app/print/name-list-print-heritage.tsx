'use client'

// Name List print template "HERITAGE" — reference design
// Name_List_Template_1_Heritage (HTML + PNG provided by the boss).
//
//   • navy title band with the geometric star pattern and cut corners
//   • gold hexagon capsule carrying the list number
//   • serif EN display title + gold subject subtitle, gold gradient rule
//   • ✦-separated info grid (Client / Project / Date & Time / Subject /
//     Workers) + the reference line (Location · Contact · Transport — or the
//     mobilization Reference); every item hides when its value is missing
//   • workers table: cream thead with a gold rule + double gold underline,
//     gold mono # numbers, mono Iqama/mobile cells, ✦ markers never behind
//     data; columns follow the subject kind exactly like Classic and the
//     Columns setting (hidden columns never appear)
//   • trade chips + patterned navy TOTAL box (last page only)
//   • signature grid (no stamp boxes) pinned to the BOTTOM of the LAST page,
//     3mm above the footer line; page 2+ repeats a small title band
//     (NAME LIST + list no. + continued · تابع)
//
// DATA GUARANTEE: reads the SAME list data as Classic (shared model) — the
// list number, client, project, dates, every worker's name, Iqama, mobile,
// results, the trade summary and the total are IDENTICAL across templates.
// Optional values that are missing hide their line (worker cells keep
// Classic's "—"). Letterhead artwork + geometry come from Settings; without
// letterhead the reserved bands stay EMPTY (never placeholder text).
import type {
  AppSettings,
  LetterheadConfig,
  NameListColumnKey,
  NameListColumns,
  NameListDetail,
} from '@/lib/types'
import { nlOrderedColumns, nlFormatDate } from '@/lib/name-list-utils'
import {
  CLIP_CORNERS,
  CLIP_HEXAGON,
  CLIP_SOFT,
  CLIP_TOTAL,
  DARK_GOLD,
  DOC_FONT,
  DOC_MONO,
  DOC_SERIF,
  FOOTER_MM,
  GAP_SIG_NOTE_MM,
  GOLD,
  LIGHT_GOLD,
  NAVY,
  PAGE_H_MM,
  SPACER_MIN_MM,
  STAR_PATTERN,
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

// ── Heritage palette (from the reference) ───────────────────────────────────
const INK = '#1D2433'
const INK_SOFT = '#4A5468'
const PAPER = '#EFE8D8'
const RULE = '#E2D6B5'

/** Serif stack for Arabic display text (Latin serifs carry no Arabic
 *  glyphs, so Arabic falls through to the Cairo webfont — correct shaping). */
const AR_SERIF = `'DejaVu Serif', Georgia, var(--font-cairo), 'Cairo', 'Noto Sans Arabic', serif`

// ── The title band (reference .band) ────────────────────────────────────────
function TitleBand({ list }: { list: NameListDetail }) {
  return (
    <div
      className="relative grid text-white"
      style={{
        background: `${NAVY} ${STAR_PATTERN}`,
        backgroundRepeat: 'repeat',
        height: '21mm',
        gridTemplateColumns: '1fr 46mm 1fr',
        alignItems: 'center',
        padding: '0 5mm',
        clipPath: CLIP_CORNERS,
      }}
    >
      <div className="break-words" style={{ fontFamily: DOC_SERIF, fontSize: '14.5pt', letterSpacing: '2.5pt', lineHeight: 1.15 }}>
        {NL_TPL_LABELS.docTitle.en}
        <small
          className="block"
          style={{
            fontFamily: DOC_FONT,
            fontSize: '7pt',
            color: LIGHT_GOLD,
            letterSpacing: '1.2pt',
            marginTop: '.8mm',
          }}
        >
          {list.subjectName.toUpperCase()} LIST
        </small>
      </div>
      <div
        className="flex flex-col items-center justify-center"
        style={{
          justifySelf: 'center',
          background: LIGHT_GOLD,
          color: NAVY,
          width: '44mm',
          height: '14mm',
          clipPath: CLIP_HEXAGON,
        }}
      >
        <small className="text-[6.4pt] font-bold" style={{ letterSpacing: '.6pt' }}>
          {NL_TPL_LABELS.listNo.en} ·{' '}
          <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
            {NL_TPL_LABELS.listNo.ar}
          </span>
        </small>
        <b className="mt-[.4mm] font-bold" style={{ fontFamily: DOC_MONO, fontSize: '10.5pt' }}>
          {list.listNo}
        </b>
      </div>
      <div
        lang="ar"
        dir="rtl"
        className="break-words text-right"
        style={{ fontFamily: AR_SERIF, fontSize: '14pt', color: LIGHT_GOLD, lineHeight: 1.3 }}
      >
        {NL_TPL_LABELS.docTitle.ar}
        {/* the subject's Arabic name is not stored — the small AR subtitle
            hides (missing optional values never print a placeholder) */}
      </div>
    </div>
  )
}

/** Small continuation band (page 2+): NAME LIST + list no. + continued · تابع */
function MiniBand({ list }: { list: NameListDetail }) {
  return (
    <div
      className="relative flex items-center justify-between text-white"
      style={{
        background: `${NAVY} ${STAR_PATTERN}`,
        backgroundRepeat: 'repeat',
        height: '11mm',
        padding: '0 5mm',
        clipPath: CLIP_CORNERS,
      }}
    >
      <span style={{ fontFamily: DOC_SERIF, fontSize: '10pt', letterSpacing: '1.5pt' }}>
        {NL_TPL_LABELS.docTitle.en}
      </span>
      <span className="text-[7.6pt] font-bold" style={{ fontFamily: DOC_MONO, color: LIGHT_GOLD }}>
        {list.listNo}
        <span className="ml-[2mm] font-sans" style={{ fontFamily: DOC_FONT, color: '#fff' }}>
          · {NL_TPL_LABELS.continued}
        </span>
      </span>
    </div>
  )
}

/** gold gradient rule (reference .gl). */
function GoldRule() {
  return (
    <div
      style={{
        height: '1.4mm',
        marginTop: '1mm',
        background:
          'linear-gradient(90deg, transparent, #C0934C 15%, #E1B169 50%, #C0934C 85%, transparent)',
      }}
    />
  )
}

// ── The reference line (Location · Contact · Transport — or the mobilization
//    Reference). Each item hides entirely when its value is missing. ────────
function Sub2Line({ list, isMob }: { list: NameListDetail; isMob: boolean }) {
  const contactName = list.clientContact ?? list.client?.contactPerson ?? null
  const contactPhone = list.clientPhone ?? list.client?.phone ?? null
  const contact = [contactName, contactPhone].filter(Boolean).join(' · ') || null
  const items: { label: string; value: string | null }[] = isMob
    ? [
        {
          label: 'Reference',
          value:
            [
              list.refInterviewListNo ? `Interview ${list.refInterviewListNo}` : null,
              list.refPoNo ? `PO ${list.refPoNo}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || null,
        },
        { label: 'Contact', value: contact },
        { label: 'Transport', value: list.transport },
      ]
    : [
        { label: 'Location', value: list.location },
        { label: 'Contact', value: contact },
        { label: 'Transport', value: list.transport },
      ]
  const shown = items.filter((i) => i.value)
  if (shown.length === 0) return null
  return (
    <div
      className="flex flex-wrap justify-center gap-x-[6mm] gap-y-[1mm] text-center"
      style={{
        fontSize: '7.5pt',
        color: INK_SOFT,
        marginTop: '2.4mm',
        padding: '1.6mm 0',
        borderTop: `1px solid ${RULE}`,
        borderBottom: `1px solid ${RULE}`,
      }}
    >
      {shown.map((i) => (
        <span key={i.label} className="whitespace-nowrap">
          {i.label}: <b style={{ color: INK, fontWeight: 600 }}>{i.value}</b>
        </span>
      ))}
    </div>
  )
}

/** One ✦-separated info cell (reference .info > div). */
function InfoCell({
  label,
  labelAr,
  value,
  first,
}: {
  label: string
  labelAr: string
  value: string
  first?: boolean
}) {
  return (
    <div className="relative min-w-0 px-[1.5mm] text-center">
      {first ? null : (
        <span
          aria-hidden
          style={{ position: 'absolute', left: '-1.5mm', top: '2.4mm', color: GOLD, fontSize: '7pt' }}
        >
          ✦
        </span>
      )}
      <small className="block" style={{ fontSize: '6.6pt', color: INK_SOFT, fontWeight: 600 }}>
        {label}
        {' · '}
        <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
          {labelAr}
        </span>
      </small>
      <b className="mt-[.5mm] block break-words" style={{ fontSize: '8.4pt', color: NAVY, fontWeight: 700 }}>
        {value}
      </b>
    </div>
  )
}

// ── The workers table (reference styling) ───────────────────────────────────
function HeritageTable({
  list,
  cols,
  rowIdxs,
  isMob,
}: {
  list: NameListDetail
  cols: { key: NameListColumnKey; label: string }[]
  rowIdxs: number[]
  isMob: boolean
}) {
  const hasResultCol = cols.some((c) => c.key === 'result')
  // reference .l columns (left-aligned headers/cells); the rest centre
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
  // (mono numbers nowrap, the tick-box triple one line, the name column
  // takes the rest), so nothing is ever clipped or wrapped mid-number.
  const thBase = {
    background: CREAM,
    color: NAVY,
    fontSize: '7pt',
    fontWeight: 700,
    padding: '1.6mm 1.3mm',
    borderTop: `1px solid ${GOLD}`,
    borderBottom: `3px double ${GOLD}`,
    lineHeight: 1.3,
  }

  return (
    <table
      className="w-full border-collapse"
      style={{ marginTop: '3mm', fontSize: '8pt' }}
    >
      <thead style={{ display: 'table-header-group' }}>
        <tr>
          <th className="text-left" style={{ ...thBase, width: '7mm' }}>
            #
          </th>
          <th className="text-left" style={{ ...thBase }}>
            {NL_TPL_LABELS.columns.name.en}
            <span lang="ar" dir="rtl" className="block" style={{ fontFamily: DOC_FONT, fontWeight: 400, color: DARK_GOLD, fontSize: '7pt' }}>
              {NL_TPL_LABELS.columns.name.ar}
            </span>
          </th>
          {cols.map((c) => {
            const L = NL_TPL_LABELS.columns[c.key]
            return (
              <th
                key={c.key}
                className={LEFT_KEYS.has(c.key) ? 'text-left' : 'text-center'}
                style={{ ...thBase, textAlign: LEFT_KEYS.has(c.key) ? 'left' : 'center' }}
              >
                {c.key === 'experience' ? 'Exp.' : L.en}
                <span lang="ar" dir="rtl" className="block" style={{ fontFamily: DOC_FONT, fontWeight: 400, color: DARK_GOLD, fontSize: '7pt' }}>
                  {L.ar}
                </span>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {rowIdxs.map((idx) => {
          const w = list.workers[idx]
          const hasResultBoxes = hasResultCol && !w.result
          return (
            <tr key={w.id} style={{ borderBottom: `1px solid ${PAPER}`, breakInside: 'avoid' }}>
              <td className="text-left" style={{ padding: '1.75mm 1.3mm', color: GOLD, fontFamily: DOC_MONO, fontWeight: 700, fontSize: '7.5pt' }}>
                {String(idx + 1).padStart(2, '0')}
              </td>
              <td className="text-left break-words" style={{ padding: '1.75mm 1.3mm', fontWeight: 700, color: NAVY }}>
                {w.staff.fullName}
              </td>
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={`${LEFT_KEYS.has(c.key) ? 'text-left' : 'text-center'} align-top`}
                  style={{ padding: '1.75mm 1.3mm', color: INK }}
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
export function NLHeritageDocument({
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
  const page1FixedMm = 21 + 2.4 + 13 + 8 + 7.2 + 3.6 // band + rule + info grid + sub2 + thead + spacings
  const contHeaderMm = 11 + 7.2 + 2 // miniband + thead + spacing
  const tailMm = 9 + 2.2 + SPACER_MIN_MM + 24 + GAP_SIG_NOTE_MM + 3.5 // chips + spacer + sigs + 3mm + note
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
                  <TitleBand list={list} />
                  <GoldRule />
                  {/* ✦-separated info grid */}
                  <div
                    className="grid"
                    style={{
                      gridTemplateColumns: '1.3fr 1.2fr .9fr .6fr .6fr',
                      marginTop: '3mm',
                      textAlign: 'center',
                    }}
                  >
                    <InfoCell first label="Client" labelAr="العميل" value={list.clientName} />
                    <InfoCell
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
                    <InfoCell
                      label={isMob ? 'Mobilization Date' : 'Date & Time'}
                      labelAr={isMob ? 'تاريخ التعبئة' : 'التاريخ'}
                      value={tplDateTime(list.date, list.time)}
                    />
                    <InfoCell label="Subject" labelAr="الموضوع" value={list.subjectName} />
                    <InfoCell
                      label="Workers"
                      labelAr="العمال"
                      value={String(list.workers.length)}
                    />
                  </div>
                  <Sub2Line list={list} isMob={isMob} />
                  <HeritageTable list={list} cols={cols} rowIdxs={plan.rows} isMob={isMob} />
                </>
              ) : (
                <>
                  <MiniBand list={list} />
                  <HeritageTable list={list} cols={cols} rowIdxs={plan.rows} isMob={isMob} />
                </>
              )}

              {/* tail — LAST PAGE ONLY: chips + patterned TOTAL box, then the
                  pinned signature grid, 3mm, and the footer line */}
              {plan.hasTail ? (
                <div
                  className="mt-[2.2mm] flex flex-wrap items-center justify-between gap-2"
                  data-nl-chips
                >
                  <div className="flex flex-wrap items-center gap-[1.6mm]">
                    {[...trades.entries()].map(([t, n]) => (
                      <span
                        key={t}
                        className="text-[7pt]"
                        style={{
                          color: INK_SOFT,
                          border: `1px solid ${RULE}`,
                          padding: '.8mm 2.4mm',
                          clipPath: CLIP_SOFT,
                          background: CREAM,
                        }}
                      >
                        {t} <b style={{ color: NAVY }}>{n}</b>
                      </span>
                    ))}
                  </div>
                  <span
                    style={{
                      background: `${NAVY} ${STAR_PATTERN}`,
                      backgroundRepeat: 'repeat',
                      color: '#fff',
                      padding: '1.8mm 4mm',
                      fontFamily: DOC_SERIF,
                      fontSize: '8.5pt',
                      clipPath: CLIP_TOTAL,
                    }}
                  >
                    {NL_TPL_LABELS.total.en}
                    <b style={{ color: LIGHT_GOLD, fontSize: '11pt', margin: '0 1.5mm' }}>
                      {list.workers.length}
                    </b>
                    {NL_TPL_LABELS.workers.en.toUpperCase()}
                  </span>
                </div>
              ) : null}

              {plan.hasTail ? (
                <div className="w-full" style={{ flex: '1 1 0', minHeight: `${SPACER_MIN_MM}mm` }} />
              ) : null}

              {plan.hasTail ? (
                <div className="grid grid-cols-2 gap-[10mm]" data-nl-signatures>
                  <div>
                    <p
                      className="flex items-center gap-[2mm]"
                      style={{ fontFamily: DOC_SERIF, fontSize: '8.2pt', color: NAVY, fontWeight: 700 }}
                    >
                      {sig.left.en}
                      <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT, color: DARK_GOLD, fontSize: '7.5pt' }}>
                        {sig.left.ar}
                      </span>
                      <span className="flex-1" style={{ height: '1px', background: 'linear-gradient(90deg, #C0934C, transparent)' }} />
                    </p>
                    <div style={{ borderBottom: `1px solid ${NAVY}`, height: '13mm' }} />
                    <p
                      className="mt-[1.4mm] flex justify-between"
                      style={{ fontSize: '7.4pt', color: INK_SOFT }}
                    >
                      <span>Name: ________________________</span>
                      <span>Date: ___ / ___ / ______</span>
                    </p>
                  </div>
                  <div>
                    <p
                      className="flex items-center gap-[2mm]"
                      style={{ fontFamily: DOC_SERIF, fontSize: '8.2pt', color: NAVY, fontWeight: 700 }}
                    >
                      {sig.right.en}
                      <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT, color: DARK_GOLD, fontSize: '7.5pt' }}>
                        {sig.right.ar}
                      </span>
                      <span className="flex-1" style={{ height: '1px', background: 'linear-gradient(90deg, #C0934C, transparent)' }} />
                    </p>
                    <div style={{ borderBottom: `1px solid ${NAVY}`, height: '13mm' }} />
                    <p
                      className="mt-[1.4mm] flex justify-between"
                      style={{ fontSize: '7.4pt', color: INK_SOFT }}
                    >
                      <span>Name: ________________________</span>
                      <span>Date: ___ / ___ / ______</span>
                    </p>
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
