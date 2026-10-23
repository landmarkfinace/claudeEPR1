// Client Salary Summary print SHARED module — the ONE palette, fonts,
// geometry, letterhead resolution, grouping model, OT detection and
// pagination planner used by the "By Category" print template. The Classic
// template (client-summary-print.tsx) does NOT import this file — its
// rendering is untouched and stays byte-identical.
//
// DATA GUARANTEE: the template renders the SAME billing data as Classic —
// every worker's STORED hours / OT hours / effective client rate / OT rate
// and the SERVER-CALCULATED per-worker amount, plus the group's stored
// subtotal / VAT / grand total. Nothing is ever recomputed as
// Hours × Rate on the print: the "Total Hours" column is a display sum of
// the stored regular + OT hours exactly like the reference design.
//
// Letterhead artwork + geometry come from the shared Settings config;
// without artwork the reserved bands stay EMPTY (never placeholder text).
import type { LetterheadConfig } from '@/lib/types'
import { AGREEMENT_FONT_FACES_CSS } from '@/lib/agreement-fonts'
import type { ClientBillingLine } from '@/lib/types'
import { formatNumber, monthName, round2 } from '@/lib/format'

// ── Brand palette (the same family as the reference design) ──────────────────
export const NAVY = '#132A4A'
export const GOLD = '#C0934C'
export const LIGHT_GOLD = '#E1B169'
export const DARK_GOLD = '#8E6420'
export const INK = '#1D2433'
export const INK_SOFT = '#4A5468'
export const HR = '#DDE3EC'
export const CREAM = '#FAF7F1'
export const CREAM_BORDER = '#E6DFCF'
export const CAT_TOTAL_BG = '#F2F5FA'
export const CAT_TOTAL_BORDER = '#C9D3E3'
export const PROJ_TOTAL_BG = '#E9EEF6'

// ── Fonts — the SAME embedded Noto Sans face the other print templates use ──
export const EN_FONT = "'Noto Sans', Arial, Helvetica, sans-serif"
export const MONO = "'DejaVu Sans Mono', ui-monospace, 'Cascadia Mono', monospace"

/** Mounts the embedded Noto Sans @font-face rules (self-contained: renders
 *  identically in the app, window.print() and the headless render daemon). */
export function ClientSummaryFontsStyle() {
  return <style dangerouslySetInnerHTML={{ __html: AGREEMENT_FONT_FACES_CSS }} />
}

// ── A4 page geometry ──────────────────────────────────────────────────────────
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
 *  the page balanced. With the live 45/25 header+footer config this yields
 *  the reference design's own 48/28 content box. */
export function clientSummaryGeometryFor(letterhead: LetterheadConfig): {
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

// ── Amount in words (the reference wording: "Saudi Riyals … Halalas Only") ───
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

/** "Saudi Riyals One Hundred Forty-Five Thousand One Hundred Thirty-Six and
 *  Ninety Halalas Only" — the currency prints as words for SAR (as in the
 *  reference design); any other configured currency prints its code. */
export function clientSummaryAmountInWords(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100
  const units = Math.floor(rounded)
  const halalas = Math.round((rounded - units) * 100)
  const label = (currency || 'SAR').toUpperCase() === 'SAR' ? 'Saudi Riyals' : currency
  let s = `${label} ${toWords(units)}`
  if (halalas > 0) s += ` and ${toWords(halalas)} Halalas`
  return `${s} Only`
}

// ── Number formatting — exactly like the reference design ────────────────────
/** Hours columns: integers stay clean with grouping ("182", "2,498");
 *  fractions keep 2 decimals ("212.50"). */
export function fmtHours(n: number): string {
  return Number.isInteger(n) ? formatNumber(n, 0) : formatNumber(n, 2)
}

/** Rates and amounts: always 2 decimals with grouping ("30.00", "5,505.00"). */
export function fmtAmt(n: number): string {
  return formatNumber(n, 2)
}

/** SN zero-padded to 2 digits ("01" … "30"), exactly like the reference. */
export function fmtSn(n: number): string {
  return String(n).padStart(2, '0')
}

// ── Category model — "category" = Staff.position, then staffCategory, then
//    "Uncategorized" (the boss-approved fallback; manual rows carry neither).
export const UNCATEGORIZED = 'Uncategorized'

export function categoryOfRow(r: ClientBillingLine): string {
  const position = r.position?.trim()
  if (position) return position
  const category = r.categoryName?.trim()
  if (category) return category
  return UNCATEGORIZED
}

/** Alphabetical category order (case-insensitive), like the reference. */
export function compareCategories(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase())
}

export type CssCategoryGroup = {
  category: string
  rows: ClientBillingLine[]
  /** distinct staff billed in this category (a worker on 2 rows counts once) */
  workers: number
  hours: number
  otHours: number
  amount: number
}

export type CssProjectGroup = {
  projectId: string
  projectName: string
  categories: CssCategoryGroup[]
  workers: number
  hours: number
  otHours: number
  amount: number
}

/**
 * Group a client's billing lines for the By-Category template:
 * project first (sorted by name), then category inside each project
 * (alphabetical), workers inside each category sorted by name. Every
 * amount/hours figure is a sum of the STORED row values — never recomputed
 * from hours × rate.
 */
export function groupByProjectThenCategory(rows: ClientBillingLine[]): CssProjectGroup[] {
  const projects = new Map<string, { projectId: string; projectName: string; rows: ClientBillingLine[] }>()
  for (const r of rows) {
    let p = projects.get(r.projectId)
    if (!p) {
      p = { projectId: r.projectId, projectName: r.projectName, rows: [] }
      projects.set(r.projectId, p)
    }
    p.rows.push(r)
  }
  const out: CssProjectGroup[] = []
  for (const p of Array.from(projects.values()).sort((a, b) =>
    a.projectName.localeCompare(b.projectName)
  )) {
    const byCat = new Map<string, ClientBillingLine[]>()
    for (const r of p.rows) {
      const cat = categoryOfRow(r)
      let arr = byCat.get(cat)
      if (!arr) {
        arr = []
        byCat.set(cat, arr)
      }
      arr.push(r)
    }
    const categories: CssCategoryGroup[] = Array.from(byCat.entries())
      .sort((a, b) => compareCategories(a[0], b[0]))
      .map(([category, catRows]) => {
        catRows.sort((a, b) => a.fullName.localeCompare(b.fullName))
        return {
          category,
          rows: catRows,
          workers: new Set(catRows.map((r) => r.staffId)).size,
          hours: round2(catRows.reduce((s, r) => s + r.hours, 0)),
          otHours: round2(catRows.reduce((s, r) => s + r.otHours, 0)),
          amount: round2(catRows.reduce((s, r) => s + r.amount, 0)),
        }
      })
    out.push({
      projectId: p.projectId,
      projectName: p.projectName,
      categories,
      workers: new Set(p.rows.map((r) => r.staffId)).size,
      hours: round2(p.rows.reduce((s, r) => s + r.hours, 0)),
      otHours: round2(p.rows.reduce((s, r) => s + r.otHours, 0)),
      amount: round2(p.rows.reduce((s, r) => s + r.amount, 0)),
    })
  }
  return out
}

/** Client-level category rollup for tab 03 (across ALL projects). */
export function rollupCategories(projects: CssProjectGroup[]): CssCategoryGroup[] {
  const byCat = new Map<string, CssCategoryGroup>()
  for (const p of projects) {
    for (const c of p.categories) {
      let g = byCat.get(c.category)
      if (!g) {
        g = {
          category: c.category,
          rows: [],
          workers: 0,
          hours: 0,
          otHours: 0,
          amount: 0,
        }
        byCat.set(c.category, g)
      }
      g.rows.push(...c.rows)
      g.hours = round2(g.hours + c.hours)
      g.otHours = round2(g.otHours + c.otHours)
      g.amount = round2(g.amount + c.amount)
    }
  }
  // distinct workers per category (a worker on 2 projects counts once)
  for (const g of byCat.values()) {
    g.workers = new Set(g.rows.map((r) => r.staffId)).size
  }
  return Array.from(byCat.values()).sort((a, b) => compareCategories(a.category, b.category))
}

// ── OT-column detection (the boss's rule) ─────────────────────────────────────
/** True when ANY worker in this summary has OT hours billed at a rate
 *  different from their normal rate — in that case Hours × Rate would not
 *  equal Amount, so the OT version of the worker table is shown. */
export function hasDistinctOtRates(rows: ClientBillingLine[]): boolean {
  return rows.some(
    (r) => r.otHours > 0 && Math.abs(r.clientOtRate - r.clientRate) > 0.005
  )
}

// ── Row-height estimation — CALIBRATED against the real rendered heights
// (measured with the embedded Noto Sans at lineHeight 1.2) plus print-render
// headroom, so pages always break a little EARLIER than the true capacity.
export const ROW_MM = {
  worker: 8.3, // measured 7.9 (+0.4 headroom)
  workerWrap: 2.6, // extra wrapped name line
  catHeader: 5.8, // measured 5.5
  catTotal: 6.1, // measured 5.8
  projHeader: 6.0, // measured 5.7
  projTotal: 6.1, // measured ~5.8
  thead: 4.8, // measured 4.3
  /** worker-name characters per line in the narrower OT-mode column
   *  (conservative for the wider non-OT table too) */
  nameChars: 34,
} as const

/** Estimated print height (mm) of one worker row (long names wrap). */
export function workerRowMm(r: ClientBillingLine): number {
  const lines = Math.max(1, Math.ceil((r.fullName ?? '').length / ROW_MM.nameChars))
  return ROW_MM.worker + (lines - 1) * ROW_MM.workerWrap
}

// ── Pagination planner ────────────────────────────────────────────────────────
/** One logical table line: project header / category header / worker /
 *  category total / project subtotal. */
export type CssEntry =
  | { t: 'pj'; label: string; workers: number; h: number }
  | { t: 'gh'; category: string; workers: number; h: number }
  | { t: 'w'; row: ClientBillingLine; sn: number; h: number }
  | { t: 'gt'; category: string; workers: number; hours: number; otHours: number; amount: number; h: number }
  | { t: 'pt'; label: string; workers: number; hours: number; otHours: number; amount: number; h: number }

/** Flatten the grouped rows into table entries with the keep rules of the
 *  boss's print spec: a worker row is never split; a category header never
 *  separates from its first worker; a category total never sits alone at
 *  the top of a page (bound to its last worker); a project subtotal is
 *  bound to the category total above it. */
export function buildCssEntries(projects: CssProjectGroup[]): CssEntry[] {
  const entries: CssEntry[] = []
  let sn = 0
  for (const p of projects) {
    entries.push({ t: 'pj', label: p.projectName, workers: p.workers, h: ROW_MM.projHeader })
    for (const c of p.categories) {
      entries.push({ t: 'gh', category: c.category, workers: c.workers, h: ROW_MM.catHeader })
      for (const r of c.rows) {
        sn += 1
        entries.push({ t: 'w', row: r, sn, h: workerRowMm(r) })
      }
      entries.push({
        t: 'gt',
        category: c.category,
        workers: c.workers,
        hours: c.hours,
        otHours: c.otHours,
        amount: c.amount,
        h: ROW_MM.catTotal,
      })
    }
    entries.push({
      t: 'pt',
      label: p.projectName,
      workers: p.workers,
      hours: p.hours,
      otHours: p.otHours,
      amount: p.amount,
      h: ROW_MM.projTotal,
    })
  }
  return entries
}

/** entry i must stay on the same page as entry i+1 (keep-with-next). */
function keepNext(entries: CssEntry[], i: number): boolean {
  const e = entries[i]
  const n = entries[i + 1]
  if (!n) return false
  if (e.t === 'pj' || e.t === 'gh') return true
  if (e.t === 'w') return n.t === 'gt'
  if (e.t === 'gt') return n.t === 'pt'
  return false
}

export type CssPagePlan = {
  /** entry index range [from, to) rendered on this page (empty → tail-only) */
  from: number
  to: number
  /** tabs 03/04/05 render on this page */
  hasTail: boolean
}

/**
 * Pure planner:
 *  • entries are chunked into atomic keep-units (see keepNext) and whole
 *    units are placed on pages against the first/rest budgets — a worker
 *    row is never split and the keep rules above are always honoured;
 *  • the tail (03 · CATEGORY SUMMARY + 04 · BILLING SUMMARY + 05 · APPROVAL)
 *    lives on the LAST worker page only when the whole stack fits;
 *    otherwise it gets a fresh page of its own.
 */
export function planCssPages(opts: {
  availFirst: number
  availRest: number
  entries: CssEntry[]
  tailMm: number
}): { pages: CssPagePlan[]; totalPages: number } {
  const { availFirst, availRest, entries, tailMm } = opts

  // atomic units (runs joined by keepNext)
  const units: { from: number; to: number; h: number }[] = []
  {
    let start = 0
    let h = 0
    for (let i = 0; i < entries.length; i++) {
      h += entries[i].h
      if (!keepNext(entries, i)) {
        units.push({ from: start, to: i + 1, h })
        start = i + 1
        h = 0
      }
    }
    if (start < entries.length) units.push({ from: start, to: entries.length, h })
  }

  // chunk units into pages
  const chunks: { from: number; to: number; used: number }[] = []
  let cur: { from: number; to: number; used: number } | null = null
  let limit = availFirst
  for (const u of units) {
    if (cur && cur.used + u.h > limit) {
      chunks.push(cur)
      cur = null
      limit = availRest
    }
    if (!cur) cur = { from: u.from, to: u.to, used: 0 }
    cur.to = u.to
    cur.used += u.h
  }
  if (cur) chunks.push(cur)

  const lastUsed = chunks.length ? chunks[chunks.length - 1].used : 0
  const lastCap = chunks.length <= 1 ? availFirst : availRest
  const tailOnLast = lastUsed + tailMm <= lastCap
  const pages: CssPagePlan[] = chunks.map((c, i) => ({
    from: c.from,
    to: c.to,
    hasTail: i === chunks.length - 1 && tailOnLast,
  }))
  if (!tailOnLast) {
    pages.push({ from: entries.length, to: entries.length, hasTail: true })
  }
  return { pages, totalPages: pages.length }
}

/** Estimated tail height (mm): tabs 03 + 04 + 05 with their margins —
 *  calibrated against real renders (8 categories measured 121mm) + headroom. */
export function cssTailMm(categoryCount: number): number {
  const tab03 = 5.6 + 5.0 + categoryCount * 5.8 + 6.2 + 3.0 // margin + thead + rows + tfoot + padding
  const tab04 = 5.6 + 27 // margin + words/note + totals stack (measured 30.8 total)
  const tab05 = 5.6 + 21 // margin + signature cells (measured 24.8 total)
  return tab03 + tab04 + tab05
}

// ── Page furniture ────────────────────────────────────────────────────────────

/** One fixed A4 sheet with the letterhead artwork layers from Settings.
 *  Without artwork the reserved bands stay COMPLETELY EMPTY (the boss's
 *  rule — never placeholder text). */
export function ClientSummaryDocPage({
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

/** Folder box — bordered panel with the tab on its top-left corner
 *  (navy + gold text, or gold + white for the BILLING SUMMARY tab). */
export function CssTabBox({
  label,
  gold = false,
  marginTop = '5.6mm',
  children,
}: {
  label: string
  gold?: boolean
  marginTop?: string
  children: React.ReactNode
}) {
  const tabBg = gold ? GOLD : NAVY
  return (
    <div
      className="relative shrink-0"
      style={{
        marginTop,
        border: `1px solid ${tabBg}`,
        borderRadius: '0 2.5mm 2.5mm 2.5mm',
        padding: '1.6mm 3.2mm',
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

/** Period label "September 2026" from month/year. */
export function cssPeriodLabel(month: number, year: number): string {
  return `${monthName(month)} ${year}`
}
