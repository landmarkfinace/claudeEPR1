'use client'

// Shared plumbing for the quotation print templates (Classic + Sidebar
// Cream + Sidebar Navy). Everything here is data-neutral: given the SAME
// QuotationDetail every template prints the SAME values — only the layout
// differs.
//
// The constants/helpers were lifted verbatim from quotation-print.tsx
// (Classic) so all three templates share ONE trade dictionary, ONE date
// format and ONE letterhead geometry — the Arabic trade names are identical
// in every template by construction.

import { formatNumber } from '@/lib/format'
import type { DocItemRow, LetterheadConfig, QuotationRow } from '@/lib/types'

// ── Document types (shared by every template) ──────────────────────────────

/** Full quotation as returned by GET /api/quotations/[id] (items + client + assets). */
export type QuotationDetail = QuotationRow & {
  itemCount?: number
  client?: {
    id: string
    name: string
    nameAr: string | null
    contactPerson: string | null
    phone: string | null
    email: string | null
    address: string | null
    city: string | null
    crNumber: string | null
    vatNumber: string | null
  } | null
}

/** Approved-by signatory printed from Settings › Signatories. */
export type ApprovedBy = { name: string; designation: string } | null

// ── Brand palette (same family across templates) ───────────────────────────
export const NAVY = '#132A4A'
export const DARK_NAVY = '#0C1D33'
export const GOLD = '#C0934C'
export const LIGHT_GOLD = '#E1B169'
export const DARK_GOLD = '#8E6420'
export const MUTED = '#6B7488'
export const BORDER = '#DDE3EC'
export const ROW_SEP = '#E8ECF2'
export const INK = '#1D2433'
export const INK_SOFT = '#4A5468'
export const CREAM = '#FBF9F3'
// sidebar-template cream tints (reference designs)
export const SIDE_CREAM = '#FAF7F1'
export const SIDE_CREAM_BORDER = '#E6DFCF'
export const SIDE_CREAM_DOT = '#D8CFBE'

export const DOC_FONT =
  "var(--font-inter), var(--font-cairo), 'Cairo', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif"

// ── A4 pagination geometry ──────────────────────────────────────────────────
export const PAGE_W_MM = 210
export const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (same as Classic)

/** Arabic names for the currency cell. */
export const CURRENCY_AR: Record<string, string> = {
  SAR: 'ريال سعودي',
  USD: 'دولار أمريكي',
  EUR: 'يورو',
  GBP: 'جنيه إسترليني',
  AED: 'درهم إماراتي',
}

/** Inline Arabic trade names for the items table (best-effort, exact match).
 *  ONE dictionary shared by all templates — the Arabic trade names are
 *  identical in Classic, Sidebar Cream and Sidebar Navy. */
export const TRADE_AR: Record<string, string> = {
  HELPER: 'مساعد',
  'HELPER 1': 'مساعد',
  CARPENTER: 'نجار',
  WELDER: 'لحام',
  ELECTRICIAN: 'كهربائي',
  PLUMBER: 'سباك',
  PAINTER: 'دهان',
  MASON: 'بناء',
  'STEEL FIXER': 'حداد مسلح',
  'STEEL FIXERS': 'حداد مسلح',
  DRIVER: 'سائق',
  FOREMAN: 'مراقب',
  SURVEYOR: 'مساح',
  LABOURER: 'عامل',
  LABORER: 'عامل',
  CLEANER: 'عامل نظافة',
  MECHANIC: 'ميكانيكي',
  TECHNICIAN: 'فني',
  OPERATOR: 'مشغل',
  RIGGER: 'عامل رفع',
  SCAFFOLDER: 'عامل سقالات',
  'STORE KEEPER': 'أمين مستودع',
  'SAFETY OFFICER': 'ضابط سلامة',
  ACCOUNTANT: 'محاسب',
  'ADMIN CLERK': 'كاتب إداري',
  'QA/QC': 'مراقب جودة',
}

/** DD / MM / YYYY — the templates' date format. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())} / ${pad(date.getMonth() + 1)} / ${date.getFullYear()}`
}

/** Wrapped line count for a text block at ~charsPerLine characters per line. */
export function estLines(text: string | null | undefined, charsPerLine: number): number {
  if (!text) return 0
  return text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.trim().length / charsPerLine)), 0)
}

/** Money with 2 decimals ("35.00"). */
export function fmtRate(n: number): string {
  return formatNumber(n)
}

// ── Letterhead geometry ─────────────────────────────────────────────────────
// 'none' (default) renders the striped placeholder zones at the full
// 35/22mm; artwork modes honour the configured heights instead.
export function geometryFor(letterhead: LetterheadConfig): { topMm: number; bottomMm: number } {
  const hasFull = letterhead.mode === 'full' && letterhead.fullPageImage
  const hasHeader =
    (letterhead.mode === 'header' || letterhead.mode === 'header_footer') &&
    letterhead.headerImage
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
  if (hasHeader) {
    return { topMm: letterhead.headerHeightMm + 3, bottomMm: 12 }
  }
  // 'none' — striped zones: top 35mm / bottom 22mm
  return { topMm: 35, bottomMm: 22 }
}

// striped letterhead placeholder hatching + caption tone (all templates)
const STRIPE_A = '#F3F5F8'
const STRIPE_CAPTION = '#6B7488'

/**
 * Letterhead artwork layers for one A4 page (identical behaviour to the
 * Classic template): full-page image, or header/footer images with striped
 * placeholder zones where no artwork is configured. Rendered behind the
 * content (z-0).
 */
export function LetterheadLayers({
  letterhead,
  geo,
}: {
  letterhead: LetterheadConfig
  geo: { topMm: number; bottomMm: number }
}) {
  const hasFullArt = letterhead.mode === 'full' && letterhead.fullPageImage
  const hasHeaderArt =
    (letterhead.mode === 'header' || letterhead.mode === 'header_footer') && letterhead.headerImage
  const hasFooterArt = letterhead.mode === 'header_footer' && letterhead.footerImage

  if (hasFullArt) {
    return (
      <img
        src={letterhead.fullPageImage as string}
        alt=""
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 h-full w-full object-fill"
      />
    )
  }
  return (
    <>
      {hasHeaderArt ? (
        <img
          src={letterhead.headerImage as string}
          alt=""
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-0 w-full object-fill"
          style={{ height: `${letterhead.headerHeightMm}mm` }}
        />
      ) : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-0 flex flex-col items-center justify-center gap-[2px]"
          style={{
            height: `${geo.topMm}mm`,
            background: `repeating-linear-gradient(45deg, ${STRIPE_A} 0px, ${STRIPE_A} 5px, #ffffff 5px, #ffffff 11px)`,
            borderBottom: '1px dashed #C9D2DE',
          }}
        >
          <p
            className="text-center text-[7.5pt] font-semibold uppercase tracking-[0.3pt]"
            style={{ color: STRIPE_CAPTION }}
          >
            Letterhead Header Area
            <span className="mx-1.5 opacity-50">|</span>
            <span lang="ar" dir="rtl" className="tracking-normal">
              مساحة رأس الخطاب
            </span>
          </p>
        </div>
      )}
      {hasFooterArt ? (
        <img
          src={letterhead.footerImage as string}
          alt=""
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 z-0 w-full object-fill"
          style={{ height: `${letterhead.footerHeightMm}mm` }}
        />
      ) : letterhead.mode !== 'header' ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-0 flex flex-col items-center justify-center gap-[2px]"
          style={{
            height: `${geo.bottomMm}mm`,
            background: `repeating-linear-gradient(45deg, ${STRIPE_A} 0px, ${STRIPE_A} 5px, #ffffff 5px, #ffffff 11px)`,
            borderTop: '1px dashed #C9D2DE',
          }}
        >
          <p
            className="text-center text-[7.5pt] font-semibold uppercase tracking-[0.3pt]"
            style={{ color: STRIPE_CAPTION }}
          >
            Letterhead Footer Area
            <span className="mx-1.5 opacity-50">|</span>
            <span lang="ar" dir="rtl" className="tracking-normal">
              مساحة ذيل الخطاب
            </span>
          </p>
        </div>
      ) : null}
    </>
  )
}

// ── Sidebar-template pagination planner ─────────────────────────────────────

/** One explicit A4 page of a sidebar template: its item chunk + tail flag. */
export type SidebarPagePlan = {
  items: DocItemRow[]
  /** TERMS & CONDITIONS + signature boxes render on this page (last page). */
  tail: boolean
}

/**
 * Flow-fill pagination for the sidebar templates:
 *   1. chunk items across pages (conservative row estimates → safe breaks;
 *      the table header repeats on every page that carries items);
 *   2. TERMS & CONDITIONS + the signature boxes move TOGETHER — both fit on
 *      the last items page, or both move to a fresh final page (never split,
 *      never stranded). The signature boxes pin to the bottom of that page,
 *      directly above the letterhead footer band.
 *
 * `tailMm` must already include the T&C block, signature boxes, the foot
 * line and their margins — everything that follows the last item row.
 */
export function planSidebarPages(args: {
  items: DocItemRow[]
  rowMm: (it: DocItemRow) => number
  /** fixed mm on page 1 above the first item row (title block + thead) */
  page1FixedMm: number
  /** fixed mm on later pages above the first item row (repeated thead) */
  restFixedMm: number
  /** total tail height incl. margins (T&C + signatures + foot line) */
  tailMm: number
  topMm: number
  bottomMm: number
  /** small placement headroom for wrap variance (default 3mm) */
  toleranceMm?: number
}): SidebarPagePlan[] {
  const { items, rowMm, page1FixedMm, restFixedMm, tailMm, topMm, bottomMm } = args
  const tolerance = args.toleranceMm ?? 3
  // foot line + its gap live at the bottom of the main column
  const avail = PAGE_H_MM - topMm - (bottomMm + 6)
  const availFirst = Math.max(40, avail - page1FixedMm)
  const availRest = Math.max(40, avail - restFixedMm)

  const chunks: DocItemRow[][] = []
  let cur: DocItemRow[] = []
  let used = 0
  let limit = availFirst
  for (const it of items) {
    const h = rowMm(it)
    if (used + h > limit && cur.length > 0) {
      chunks.push(cur)
      cur = []
      used = 0
      limit = availRest
    }
    cur.push(it)
    used += h
  }
  chunks.push(cur)

  const cap = chunks.length === 1 ? availFirst : availRest
  const lastRows = chunks[chunks.length - 1].reduce((s, it) => s + rowMm(it), 0)
  const tailWithLast = lastRows + tailMm <= cap + tolerance

  const pages: SidebarPagePlan[] = chunks.map((c) => ({ items: c, tail: false }))
  if (tailWithLast) {
    pages[pages.length - 1].tail = true
  } else {
    pages.push({ items: [], tail: true })
  }
  return pages
}
