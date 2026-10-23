'use client'

// Name List print SHARED module — the ONE palette, geometry, letterhead
// resolution, row-height model, pagination planner and page furniture used
// by every name list print template (Classic, Heritage, Folder, Sidebar).
//
// Extraction guarantee: the Classic constants and logic in this file were
// moved VERBATIM out of name-list-sheet-print.tsx (the Classic template) —
// same values, same math, same markup. Only the location changed, so every
// template renders from the exact same model: the list number, client,
// project, dates, every worker's name, Iqama, mobile, results, the trade
// summary and the total are IDENTICAL across all templates by construction
// — only the layout differs.
//
// The Heritage / Folder / Sidebar templates (references
// Name_List_Template_1_Heritage / _2_Folder / _3_Sidebar) are new LAYOUT
// files that read the SAME list data as Classic. They never re-derive or
// reformat anything — missing optional values hide their line (worker cells
// keep Classic's "—"), letterhead artwork + geometry come from the shared
// config (Settings), and without letterhead the reserved bands stay EMPTY
// (never placeholder text).
import type {
  AppSettings,
  LetterheadConfig,
  NameListColumnKey,
  NameListWorkerRow,
} from '@/lib/types'
import { nlFormatDate, formatSaudiMobile } from '@/lib/name-list-utils'

// ── Brand palette (the boss's specified values — shared by all templates) ────
export const NAVY = '#132A4A'
export const DARK_NAVY = '#0C1D33'
export const GOLD = '#C0934C'
export const LIGHT_GOLD = '#E1B169'
export const CREAM = '#FAF7F1'
export const BORDER = '#E6E1D6'
export const MUTED = '#6B7488'
export const DARK_GOLD = '#8E6420'
export const ROW_SEP = '#EFEAE0'
export const STRIPE_A = '#F3F5F8'
export const STRIPE_CAPTION = '#9AA5B5'
export const BLOOD_BG = '#FBE9E7'
export const BLOOD_FG = '#B03A2E'

export const DOC_FONT =
  "var(--font-inter), var(--font-cairo), 'Cairo', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif"
/** Heritage serif display face (EN titles) — DejaVu Serif exists in the
 *  print container; browsers fall through to Georgia/Times. Arabic text never
 *  uses this stack (it stays on DOC_FONT for correct shaping). */
export const DOC_SERIF =
  "'DejaVu Serif', Georgia, 'Liberation Serif', 'Times New Roman', serif"
/** Reference mono face for numbers/ids (digits + Latin only — no Arabic). */
export const DOC_MONO = "'DejaVu Sans Mono', ui-monospace, 'Cascadia Mono', monospace"

// ── A4 pagination geometry ──────────────────────────────────────────────────
export const PAGE_W_MM = 210
export const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (Chrome blank-page fix)
export const SIDE_PAD_MM = 8
/** LEGACY bottom budget kept ONLY inside the pagination formulas so the row
 *  chunking (rows per page) stays byte-identical to the previous layout. */
export const FOOTER_MM = 4
/** real render gap between the note line and the letterhead footer band */
export const BAND_GAP_BOTTOM_MM = 1
/** signature blocks bottom edge → note line: the boss's 3mm */
export const GAP_SIG_NOTE_MM = 3
/** note line height estimate (7.5pt leading-snug ≈ 3.6mm real) */
export const NOTE_MM = 3
/** minimum breathing room kept between the trade summary and the signatures */
export const SPACER_MIN_MM = 2.4

export const DEFAULT_LETTERHEAD: LetterheadConfig = {
  mode: 'none',
  headerImage: null,
  footerImage: null,
  fullPageImage: null,
  showCompanyDetails: true,
  headerHeightMm: 30,
  footerHeightMm: 18,
}

export function geometryFor(letterhead: LetterheadConfig): { topMm: number; bottomMm: number } {
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
  if (hasHeader) return { topMm: letterhead.headerHeightMm + 3, bottomMm: 12 }
  // 'none' — the boss's mockup: striped zones, top 35mm / bottom 22mm
  return { topMm: 35, bottomMm: 22 }
}

/** Small solid gold diamond — the recurring ornament (Classic keeps its own
 *  inline copy; the new templates import this one). */
export function GoldDiamond({ size = 5 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rotate-45"
      style={{ width: `${size}px`, height: `${size}px`, background: GOLD }}
    />
  )
}

// ── Column geometry (Classic's exact widths — shared reference) ─────────────
/** Preferred mm widths per column (name gets the remainder). */
export const COL_W: Record<NameListColumnKey, number> = {
  trade: 17,
  experience: 9,
  nationality: 15,
  iqama: 20,
  passport: 17,
  mobile: 19,
  blood: 11,
  iqamaExpiry: 18,
  employeeId: 26,
  result: 26,
  remarks: 24,
}

// ── Row height estimation for pagination ─────────────────────────────────────
export function estLines(text: string, charsPerLine: number): number {
  if (!text) return 1
  const lines = Math.ceil(text.length / charsPerLine)
  return Math.max(1, Math.min(4, lines))
}

/** Classic's row height model — verbatim (base 9.8 / tick-boxes 12.0). */
export function rowHeightMm(
  w: NameListWorkerRow,
  hasResultBoxes: boolean,
  remarksShown: boolean
): number {
  let h = 9.8 // base row (name + padding) — raised with the 7pt-floor print fonts
  if (hasResultBoxes) h = 12.0 // tick-box triple needs more room
  if (remarksShown) h += Math.max(0, estLines(w.remarks ?? '', 14) - 1) * 2.6
  h += Math.max(0, estLines(w.staff.fullName, 22) - 1) * 2.6
  return h
}

/** Row height model for the Heritage / Folder / Sidebar tables — the
 *  reference designs use one compact line per row (8.5pt body, 1.75mm cell
 *  padding), with the tick-box triple on a single line like the reference
 *  (.res is one flex row). Keeps the same wrapped-line extras so long names
 *  and remarks still paginate safely. */
export type NLRowSpec = {
  base: number
  resultBoxes: number
  perNameLine: number
  perRemarkLine: number
  nameCharsPerLine: number
  remarkCharsPerLine: number
}
export const TPL_ROW_SPEC: NLRowSpec = {
  base: 8.0,
  resultBoxes: 8.8,
  perNameLine: 3.0,
  perRemarkLine: 3.0,
  nameCharsPerLine: 24,
  remarkCharsPerLine: 30,
}
export function tplRowHeightMm(
  w: NameListWorkerRow,
  hasResultBoxes: boolean,
  remarksShown: boolean,
  spec: NLRowSpec = TPL_ROW_SPEC
): number {
  let h = spec.base
  if (hasResultBoxes) h = spec.resultBoxes
  if (remarksShown) h += Math.max(0, estLines(w.remarks ?? '', spec.remarkCharsPerLine) - 1) * spec.perRemarkLine
  h += Math.max(0, estLines(w.staff.fullName, spec.nameCharsPerLine) - 1) * spec.perNameLine
  return h
}

// ── Pagination planner (generalized from Classic's inline chunking) ─────────
export type NLPagePlan = { rows: number[]; hasTail: boolean }

/**
 * Pure planner — the SAME algorithm Classic has always used:
 *   • chunk whole rows against the first/rest page budgets (a row is never
 *     split);
 *   • the tail (trade summary + spacer + signatures + note) lives on the LAST
 *     items page only when the whole bottom stack fits; otherwise it gets a
 *     fresh page of its own.
 */
export function planNlPages(opts: {
  availFirst: number
  availRest: number
  rowsMm: number[]
  tailMm: number
}): { pages: NLPagePlan[]; totalPages: number } {
  const { availFirst, availRest, rowsMm, tailMm } = opts
  const chunks: number[][] = []
  let cur: number[] = []
  let used = 0
  let limit = availFirst
  for (let i = 0; i < rowsMm.length; i++) {
    const h = rowsMm[i]
    if (used + h > limit && cur.length > 0) {
      chunks.push(cur)
      cur = []
      used = 0
      limit = availRest
    }
    cur.push(i)
    used += h
  }
  chunks.push(cur)

  const lastChunkUsed = used
  const cap = chunks.length === 1 ? availFirst : availRest
  let tailOnLastItemsPage = lastChunkUsed + tailMm <= cap
  const pages: NLPagePlan[] = chunks.map((rows, i) => ({
    rows,
    hasTail: i === chunks.length - 1 && tailOnLastItemsPage,
  }))
  if (!tailOnLastItemsPage) {
    pages.push({ rows: [], hasTail: true })
    tailOnLastItemsPage = true
  }
  return { pages, totalPages: pages.length }
}

/** Trade summary counts — Classic's computation, verbatim (shared by all
 *  templates so the chips/box always show the same numbers). */
export function tradeCounts(workers: NameListWorkerRow[]): Map<string, number> {
  const trades = new Map<string, number>()
  for (const w of workers) {
    const t = w.staff.categoryName ?? w.staff.position ?? 'Uncategorized'
    trades.set(t, (trades.get(t) ?? 0) + 1)
  }
  return trades
}

// ── Page furniture (Classic's markup, verbatim — shared by all templates) ────

/** The "Page X of Y | صفحة X من Y" note line — bottom of the content column
 *  on EVERY page (Classic behaviour). */
export function NoteLine({ pageIdx, totalPages }: { pageIdx: number; totalPages: number }) {
  return (
    <p
      className="break-words text-center text-[7.5pt] font-semibold leading-snug tracking-[0.3pt] uppercase"
      style={{ color: MUTED }}
      data-nl-note
    >
      Page {pageIdx + 1} of {totalPages}
      <span className="mx-1.5 opacity-50">|</span>
      <span lang="ar" dir="rtl" className="tracking-normal">
        صفحة {pageIdx + 1} من {totalPages}
      </span>
    </p>
  )
}

/** The status stamp on page 1 when status ≠ draft (Classic behaviour: small
 *  rotated bordered chip over the letterhead zone, above the content start —
 *  it can never overlap the title, list number, table or any text). */
export function StatusStamp({
  status,
  topMm,
  rightMm,
}: {
  status: string
  topMm: number
  rightMm: number
}) {
  if (status === 'draft') return null
  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ top: `${Math.max(topMm - 7, 2)}mm`, right: `${rightMm}mm` }}
    >
      <span
        className="inline-block rounded border-[2.5px] bg-white/95 px-2 py-px text-[8.5pt] font-black uppercase tracking-[0.3pt]"
        style={{
          borderColor:
            status === 'sent' ? '#d97706' : status === 'completed' ? '#059669' : '#737373',
          color:
            status === 'sent' ? '#b45309' : status === 'completed' ? '#047857' : '#525252',
          transform: 'rotate(-3deg)',
        }}
      >
        {status}
      </span>
    </div>
  )
}

/** Saved-result colour coding — Classic's exact colours (shared so every
 *  template prints the same result text in the same colour). */
export function nlResultColor(result: string): string {
  return (
    result === 'selected'
      ? '#047857'
      : result === 'rejected'
        ? '#BE123C'
        : result === 'absent'
          ? '#B45309'
          : '#6D28D9' // onhold
  )
}

/** Signature titles by subject kind (the boss's spec):
 *   Interview/Trade Test/Medical → "Prepared by · Landmark" + "Interviewed by · Client"
 *   Mobilization/Demobilization  → "Prepared by · Landmark" + "Received by · Client / Site"
 *  Signatures only — the new templates have NO stamp boxes. */
export function nlSignatureTitles(kind: string): {
  left: { en: string; ar: string }
  right: { en: string; ar: string }
} {
  if (kind === 'mobilization' || kind === 'demobilization') {
    return {
      left: { en: 'Prepared by · Landmark', ar: 'أعده' },
      right: { en: 'Received by · Client / Site', ar: 'استلمه العميل / الموقع' },
    }
  }
  return {
    left: { en: 'Prepared by · Landmark', ar: 'أعده' },
    right: { en: 'Interviewed by · Client', ar: 'قابله العميل' },
  }
}

// ── Bilingual labels for the Heritage / Folder / Sidebar templates ───────────
// Fixed template labels (never data) — the same strings the reference
// designs print. Data-backed values (client, project, dates, workers…) come
// from the list row only.
export const NL_TPL_LABELS = {
  docTitle: { en: 'NAME LIST', ar: 'قائمة الأسماء' },
  listNo: { en: 'LIST NO.', ar: 'رقم القائمة' },
  workers: { en: 'WORKERS', ar: 'العمال' },
  totalWorkers: { en: 'TOTAL WORKERS', ar: 'إجمالي العمال' },
  total: { en: 'TOTAL', ar: 'الإجمالي' },
  continued: 'continued · تابع',
  printed: { en: 'Printed', ar: 'طبع' },
  columns: {
    name: { en: 'Employee Name', ar: 'اسم العامل' },
    trade: { en: 'Trade', ar: 'المهنة' },
    experience: { en: 'Exp.', ar: 'الخبرة' },
    nationality: { en: 'Nationality', ar: 'الجنسية' },
    iqama: { en: 'Iqama No.', ar: 'رقم الإقامة' },
    passport: { en: 'Passport No.', ar: 'جواز السفر' },
    mobile: { en: 'Mobile', ar: 'الجوال' },
    blood: { en: 'Blood Group', ar: 'فئة الدم' },
    result: { en: 'Result', ar: 'النتيجة' },
    remarks: { en: 'Remarks', ar: 'ملاحظات' },
    iqamaExpiry: { en: 'Iqama Expiry', ar: 'انتهاء الإقامة' },
    employeeId: { en: 'Employee ID', ar: 'رقم الموظف' },
  } as { name: { en: string; ar: string } } & Record<
    'trade' | 'experience' | 'nationality' | 'iqama' | 'passport' | 'mobile' | 'blood' | 'result' | 'remarks' | 'iqamaExpiry' | 'employeeId',
    { en: string; ar: string }
  >,
  info: {
    client: { en: 'Client', ar: 'العميل' },
    project: { en: 'Project / Site', ar: 'المشروع / الموقع' },
    dateTime: { en: 'Date & Time', ar: 'التاريخ' },
    subject: { en: 'Subject', ar: 'الموضوع' },
    workers: { en: 'Workers', ar: 'العمال' },
    location: { en: 'Location', ar: 'الموقع' },
    contact: { en: 'Client Contact', ar: 'جهة الاتصال' },
    transport: { en: 'Transport', ar: 'النقل' },
    positions: { en: 'Positions', ar: 'المهن' },
    reference: { en: 'Reference', ar: 'المرجع' },
    mobDate: { en: 'Mobilization Date', ar: 'تاريخ التعبئة' },
  },
  resultBoxes: ['Selected', 'Rejected', 'Absent'] as const,
}

/** Reference date+time join — "21 / 10 / 2026 · 09:00" (time hidden when
 *  empty, exactly like Classic). */
export function tplDateTime(date: string | Date, time: string | null | undefined): string {
  return time ? `${nlFormatDate(date)} · ${time}` : nlFormatDate(date)
}

/** Reference mobile formatting (Saudi spacing like Classic's cells). */
export function tplMobile(v: string | null | undefined): string {
  return formatSaudiMobile(v)
}


// ── One table cell for the Heritage / Folder / Sidebar tables ────────────────
// Classic's rendering rules, reference styling: saved results print their
// text (colour-coded like Classic); unsaved interview results print the
// three tick boxes; the blood group prints in a light-red capsule; numbers
// print in the mono face; missing values keep Classic's "—".
export function TplCell({
  colKey,
  w,
  isMob,
  hasResultBoxes,
  resSoft,
}: {
  colKey: NameListColumnKey
  w: NameListWorkerRow
  isMob: boolean
  hasResultBoxes: boolean
  /** Sidebar: let the tick-box triple wrap to 2 lines (narrow main column) */
  resSoft?: boolean
}) {
  switch (colKey) {
    case 'trade':
      return <>{w.staff.categoryName ?? w.staff.position ?? '—'}</>
    case 'experience':
      return <>{w.staff.experienceYears != null ? w.staff.experienceYears : '—'}</>
    case 'nationality':
      return <>{w.staff.nationality ?? '—'}</>
    case 'iqama':
      return (
        <span className="tabular-nums whitespace-nowrap" style={{ fontFamily: DOC_MONO, fontSize: '7.5pt' }}>
          {w.staff.iqamaId}
        </span>
      )
    case 'passport':
      return (
        <span className="tabular-nums whitespace-nowrap" style={{ fontFamily: DOC_MONO, fontSize: '7.5pt' }}>
          {w.staff.passportNo ?? '—'}
        </span>
      )
    case 'mobile':
      return (
        <span className="tabular-nums whitespace-nowrap" style={{ fontFamily: DOC_MONO, fontSize: '7.5pt' }}>
          {tplMobile(w.staff.phone)}
        </span>
      )
    case 'blood':
      return w.staff.bloodGroup ? (
        <span
          className="inline-block break-words rounded-full px-[1.5mm] py-[0.5px] text-[7.5pt] font-bold"
          style={{ background: BLOOD_BG, color: BLOOD_FG }}
        >
          {w.staff.bloodGroup}
        </span>
      ) : (
        <>—</>
      )
    case 'iqamaExpiry':
      return <>{w.staff.iqamaExpiry ? nlFormatDate(w.staff.iqamaExpiry) : '—'}</>
    case 'employeeId':
      return (
        <span className="tabular-nums" style={{ fontFamily: DOC_MONO, fontSize: '7.5pt' }}>
          {w.staff.id}
        </span>
      )
    case 'result':
      if (w.result) {
        return (
          <span
            className="break-words font-bold uppercase"
            style={{ fontSize: '7.5pt', color: nlResultColor(w.result) }}
          >
            {w.result === 'onhold' ? 'On hold' : w.result}
          </span>
        )
      }
      if (!hasResultBoxes) return null
      return (
        <span
          className={`inline-flex items-center gap-[1.6mm] ${resSoft ? '' : 'whitespace-nowrap'}`}
          style={{ fontSize: '6.2pt', color: '#4A5468' }}
        >
          {NL_TPL_LABELS.resultBoxes.map((r) => (
            <span key={r} className="inline-flex items-center gap-[.7mm]">
              <i
                className="inline-block"
                style={{
                  width: '2.8mm',
                  height: '2.8mm',
                  border: '1px solid #8C95A6',
                  borderRadius: '.6mm',
                  background: '#fff',
                }}
              />
              {r}
            </span>
          ))}
        </span>
      )
    case 'remarks':
      return <span className="text-left">{w.remarks ?? ''}</span>
    default:
      return null
  }
}

// ── Page frame for the Heritage / Folder / Sidebar templates ────────────────
// One fixed A4 sheet + the letterhead artwork layers from Settings. Without
// artwork the reserved bands stay COMPLETELY EMPTY — never placeholder text
// (the boss's rule). No DRAFT watermark in the new templates (Classic never
// had one); the status stamp stays available on page 1.
export function NLTplPage({
  letterhead,
  geo,
  status,
  pageIdx,
  totalPages,
  isLast,
  stampRightMm = 14,
  children,
}: {
  letterhead: LetterheadConfig
  geo: { topMm: number; bottomMm: number }
  status: string
  pageIdx: number
  totalPages: number
  isLast: boolean
  /** right offset for the status stamp (template side margin) */
  stampRightMm?: number
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
      {/* letterhead artwork (every page) — empty bands when not configured */}
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

      {/* status stamp — page 1 only, over the letterhead zone (above the
          content start: it can never overlap the title, number, table, text) */}
      {pageIdx === 0 ? (
        <StatusStamp status={status} topMm={geo.topMm} rightMm={stampRightMm} />
      ) : null}

      {children}
    </div>
  )
}

/** Compact brand name for the new templates' footer line —
 *  "Landmark Inter Gulf Co. LLC" → "Landmark Inter Gulf". */
export function shortCompanyName(name: string): string {
  const stripped = name
    .replace(/\s*(Co\.?\s*LLC|L\.L\.C\.?|LLC|Co\.,?\s*Ltd\.?|Ltd\.?)\s*$/i, '')
    .trim()
  return stripped || name
}

/** The new templates' footer line data (same on every page of a template). */
export function tplFooterLine(settings: AppSettings): string {
  return shortCompanyName(settings.companyName || 'Landmark Inter Gulf')
}

/** Heritage's geometric star pattern — two overlapping squares rotated 45°,
 *  thin light-gold strokes at 35% opacity (same data-URI as the reference).
 *  Used ONLY as a light background inside the title band / TOTAL box —
 *  never behind table numbers or text. */
export const STAR_PATTERN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><g fill='none' stroke='%23E1B169' stroke-width='.6' opacity='.35'><rect x='4' y='4' width='10' height='10'/><rect x='4' y='4' width='10' height='10' transform='rotate(45 9 9)'/></g></svg>\")"

/** Heritage clip paths (reference: 3mm chamfers / gold hexagon / soft
 *  chamfered chips / 1.8mm box). */
export const CLIP_CORNERS =
  'polygon(3mm 0, calc(100% - 3mm) 0, 100% 3mm, 100% calc(100% - 3mm), calc(100% - 3mm) 100%, 3mm 100%, 0 calc(100% - 3mm), 0 3mm)'
export const CLIP_HEXAGON =
  'polygon(4mm 0, calc(100% - 4mm) 0, 100% 50%, calc(100% - 4mm) 100%, 4mm 100%, 0 50%)'
export const CLIP_SOFT =
  'polygon(1.2mm 0, calc(100% - 1.2mm) 0, 100% 1.2mm, 100% calc(100% - 1.2mm), calc(100% - 1.2mm) 100%, 1.2mm 100%, 0 calc(100% - 1.2mm), 0 1.2mm)'
export const CLIP_TOTAL =
  'polygon(1.8mm 0, calc(100% - 1.8mm) 0, 100% 1.8mm, 100% calc(100% - 1.8mm), calc(100% - 1.8mm) 100%, 1.8mm 100%, 0 calc(100% - 1.8mm), 0 1.8mm)'
