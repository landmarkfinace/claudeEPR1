// Agreement print SHARED module — the ONE palette, fonts, geometry,
// letterhead resolution, text estimator, pagination planner and page
// furniture used by the 3 new agreement print templates (Bilingual Cards,
// Official Form, Key Terms). The Classic template (agreement-print.tsx +
// agreement-template.ts) does NOT import this file — its rendering is
// untouched and stays byte-identical.
//
// DATA GUARANTEE: every template renders the SAME agreement data — the
// agreement number, dates, both parties, the preamble and every article's
// English and Arabic text EXACTLY AS STORED (bold "Label:" prefixes are a
// render-time style, never a text change; {PRICE}/{PERIOD} tokens are
// substituted from the STRUCTURED price/period fields exactly like Classic —
// article text is never parsed). Letterhead artwork + geometry come from the
// shared Settings config; without artwork the reserved bands stay EMPTY
// (never placeholder text).

import type { LetterheadConfig } from '@/lib/types'
import type { TemplateAgreement, TemplateParty } from '@/lib/agreement-template'
import { AGREEMENT_FONT_FACES_CSS } from '@/lib/agreement-fonts'

// ── Brand palette (the same family as the reference designs) ────────────────
export const NAVY = '#132A4A'
export const DARK_NAVY = '#0C1D33'
export const GOLD = '#C0934C'
export const LIGHT_GOLD = '#E1B169'
export const DARK_GOLD = '#8E6420'
export const INK = '#1D2433'
export const INK_SOFT = '#4A5468'
export const HR = '#DDE3EC'
export const ROW_SEP = '#E8ECF2'
export const CREAM = '#FAF7F1'
export const CREAM_BORDER = '#E6DFCF'
export const KEYGRAY = '#F7F8FA'
export const MUTED = '#6B7488'

// ── Fonts — the SAME embedded faces Classic uses (correct Arabic shaping) ───
export const EN_FONT = "'Noto Sans', Arial, Helvetica, sans-serif"
export const AR_FONT = "'Noto Naskh Arabic', 'Amiri', 'Traditional Arabic', Arial, sans-serif"
/** EN display serif for titles (references use a serif face; Arabic NEVER
 *  uses this stack — it stays on AR_FONT). */
export const EN_SERIF = "'DejaVu Serif', Georgia, 'Liberation Serif', 'Times New Roman', serif"
export const MONO = "'DejaVu Sans Mono', ui-monospace, 'Cascadia Mono', monospace"

/** Mounts the embedded Noto Naskh Arabic + Noto Sans @font-face rules (the
 *  same CSS string Classic's sheet mounts — one per document is enough). */
export function AgreementFontsStyle() {
  return <style dangerouslySetInnerHTML={{ __html: AGREEMENT_FONT_FACES_CSS }} />
}

// ── A4 page geometry ────────────────────────────────────────────────────────
export const PAGE_W_MM = 210
export const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (Chrome blank-page fix)
/** gap between the signature block's bottom edge and the page footer line */
export const GAP_SIG_FOOTER_MM = 3
/** fixed height allowance for the per-page footer line (Initials + Page X of Y) */
export const FOOTER_LINE_MM = 6

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
export function agrGeometryFor(letterhead: LetterheadConfig): {
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

// ── Date / token helpers — the SAME formatting Classic prints ───────────────
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']

function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}
export function agrDateEn(iso: string): string {
  if (!iso) return ''
  const p = parts(iso)
  return `${MONTHS_EN[p.m - 1]} ${String(p.d).padStart(2, '0')}, ${p.y}`
}
export function agrDateAr(iso: string): string {
  if (!iso) return ''
  const p = parts(iso)
  return `${String(p.d).padStart(2, '0')} ${MONTHS_AR[p.m - 1]} ${p.y}`
}

/** {PERIOD} / {PRICE} substitution — the STRUCTURED fields only (Classic's
 *  fill() logic; article text is never parsed). */
export function agrFillClauses(a: TemplateAgreement): { en: string; ar: string }[] {
  const periodEn = `${agrDateEn(a.periodFrom)} to ${agrDateEn(a.periodTo)}`
  const periodAr = `من ${agrDateAr(a.periodFrom)} إلى ${agrDateAr(a.periodTo)}`
  return a.clauses.map((c) => ({
    en: c.en.replace('{PERIOD}', periodEn).replace('{PRICE}', a.contractPrice.en),
    ar: c.ar.replace('{PERIOD}', periodAr).replace('{PRICE}', a.contractPrice.ar),
  }))
}

// ── Arabic-Indic digits (article numbers on the Arabic side) ────────────────
const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩']
export function arabicDigits(n: number): string {
  return String(n)
    .split('')
    .map((ch) => (/^\d$/.test(ch) ? AR_DIGITS[Number(ch)] : ch))
    .join('')
}

// ── Bold "Label:" prefix — render-time styling only, text unchanged ─────────
/** Split a stored clause into { bold, rest } when it starts with a short
 *  "Label:" prefix (EN or AR). The stored text is NEVER modified. */
export function splitBoldLabel(text: string): { bold: string; rest: string } | null {
  const m = text.match(/^([\p{L}\p{M}\p{N}\s/&().,'’\-]{1,48}?:)\s+(.+)$/u)
  if (!m) return null
  return { bold: m[1], rest: m[2] }
}

// ── Text height estimation (per-template tuned parameters) ──────────────────
export function estLines(text: string, charsPerLine: number): number {
  if (!text) return 1
  return Math.max(1, Math.ceil(text.length / charsPerLine))
}

export type AgrTextSpec = { charsPerLine: number; lineMm: number }

/** Height (mm) of a bilingual article row = the TALLER side + row padding. */
export function estArticleMm(
  art: { en: string; ar: string },
  enSpec: AgrTextSpec,
  arSpec: AgrTextSpec,
  padMm: number
): number {
  const enMm = estLines(art.en, enSpec.charsPerLine) * enSpec.lineMm
  const arMm = estLines(art.ar, arSpec.charsPerLine) * arSpec.lineMm
  return Math.max(enMm, arMm, arSpec.lineMm) + padMm
}

/** Height (mm) of a single-language text block. */
export function estTextMm(text: string, spec: AgrTextSpec): number {
  return estLines(text, spec.charsPerLine) * spec.lineMm
}

/** Bilingual block (EN + AR side by side) height = taller side. */
export function estBiMm(
  en: string,
  ar: string,
  enSpec: AgrTextSpec,
  arSpec: AgrTextSpec
): number {
  return Math.max(estTextMm(en, enSpec), estTextMm(ar, arSpec), arSpec.lineMm)
}

// ── Pagination planner ──────────────────────────────────────────────────────
//   • article rows are NEVER split across pages;
//   • the tail (language clause + signature block) lives on the LAST page
//     together with AT LEAST the last article — if the tail does not fit
//     after the last article, the last article moves with it to a fresh
//     page (the signature block is never alone on an empty page; only a
//     physically oversized single article can end up alone above it).

export type AgrPagePlan = { arts: number[]; hasTail: boolean }

export function planAgrPages(opts: {
  availFirst: number
  availRest: number
  artsMm: number[]
  tailMm: number
}): { pages: AgrPagePlan[]; totalPages: number } {
  const { availFirst, availRest, artsMm, tailMm } = opts
  const chunks: number[][] = []
  let cur: number[] = []
  let used = 0
  let limit = availFirst
  for (let i = 0; i < artsMm.length; i++) {
    const h = artsMm[i]
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

  // tail placement — must sit under at least the LAST article
  const cap = chunks.length === 1 ? availFirst : availRest
  const lastChunk = chunks[chunks.length - 1]
  const lastUsed = lastChunk.reduce((s, i) => s + artsMm[i], 0)
  let tailOnLast = lastUsed + tailMm <= cap
  const pages: AgrPagePlan[] = chunks.map((arts, i) => ({
    arts,
    hasTail: i === chunks.length - 1 && tailOnLast,
  }))
  if (!tailOnLast) {
    // move the last article(s) with the tail: pop one article from the last
    // chunk (dropping an empty chunk) and start the final page with it
    const moved: number[] = []
    if (lastChunk.length > 0) moved.push(lastChunk.pop() as number)
    if (pages.length > 1 && (pages[pages.length - 1] as AgrPagePlan).arts.length === 0) {
      pages.pop()
    }
    // if the moved article alone + tail still exceeds a full page, the tail
    // gets its own page (physically oversized article — realistic clauses
    // never hit this)
    const movedMm = moved.reduce((s, i) => s + artsMm[i], 0)
    pages.push({ arts: moved, hasTail: movedMm + tailMm <= availRest })
    if (!pages[pages.length - 1].hasTail) {
      pages.push({ arts: [], hasTail: true })
    }
  }
  return { pages, totalPages: pages.length }
}

// ── Page furniture ──────────────────────────────────────────────────────────

/** One fixed A4 sheet with the letterhead artwork layers from Settings.
 *  Without artwork the reserved bands stay COMPLETELY EMPTY (the boss's
 *  rule — never placeholder text). */
export function AgrTplPage({
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

/** Per-page footer — agreement no. | Initials (2 boxes) | Page X of Y. */
export function AgrPageFooter({
  agreementNo,
  pageIdx,
  totalPages,
}: {
  agreementNo: string
  pageIdx: number
  totalPages: number
}) {
  return (
    <div
      data-agr-footer
      className="mt-auto flex flex-wrap items-center justify-between gap-x-[6mm] gap-y-[1mm] pt-[1.6mm]"
      style={{ borderTop: `1px solid ${HR}`, fontSize: '6.8pt', color: INK_SOFT, fontFamily: EN_FONT }}
    >
      <span className="whitespace-nowrap tabular-nums" style={{ fontFamily: MONO }}>
        {agreementNo}
      </span>
      <span className="inline-flex flex-wrap items-center gap-[1.5mm] whitespace-nowrap">
        <span style={{ fontWeight: 700 }}>
          Initials ·{' '}
          <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
            الأحرف الأولى
          </span>
        </span>
        <span className="inline-flex items-center gap-[1mm]">
          1<sup>st</sup> Party
          <i className="inline-block" style={{ width: '13mm', height: '4.6mm', border: `1px solid #AEB8C7`, borderRadius: '1mm' }} />
        </span>
        <span className="inline-flex items-center gap-[1mm]">
          2<sup>nd</sup> Party
          <i className="inline-block" style={{ width: '13mm', height: '4.6mm', border: `1px solid #AEB8C7`, borderRadius: '1mm' }} />
        </span>
      </span>
      <span className="whitespace-nowrap tabular-nums">
        Page {pageIdx + 1} of {totalPages} ·{' '}
        <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
          صفحة {arabicDigits(pageIdx + 1)} من {arabicDigits(totalPages)}
        </span>
      </span>
    </div>
  )
}

/** Page 2+ small header — agreement title + no. + continued · تابع. */
export function AgrContinuationHeader({
  titleEn,
  titleAr,
  agreementNo,
  variant = 'line',
}: {
  titleEn: string
  titleAr: string
  agreementNo: string
  variant?: 'line' | 'plain'
}) {
  return (
    <div
      data-agr-cont
      className="mb-[3mm] flex flex-wrap items-center justify-between gap-x-[6mm] gap-y-[1mm] pb-[1.4mm]"
      style={{
        borderBottom: variant === 'line' ? `1px solid ${HR}` : undefined,
        fontSize: '7.6pt',
        fontFamily: EN_FONT,
        color: INK_SOFT,
      }}
    >
      <span className="min-w-0 truncate" style={{ fontWeight: 700, color: NAVY }}>
        {titleEn}
        {titleAr ? (
          <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, color: DARK_GOLD, marginLeft: '3mm' }}>
            {titleAr}
          </span>
        ) : null}
        <span style={{ fontWeight: 400, color: INK_SOFT, marginLeft: '3mm' }}>
          continued · <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>تابع</span>
        </span>
      </span>
      <span className="whitespace-nowrap tabular-nums" style={{ fontFamily: MONO, color: INK }}>
        {agreementNo}
      </span>
    </div>
  )
}

// ── Shared signature values (the stored party snapshot only) ────────────────
export function sigLines(p: TemplateParty): {
  nameEn: string
  nameAr: string
  titleEn: string
  titleAr: string
  signatureImg: string
  stampImg: string
} {
  return {
    nameEn: p.signatory.name.en,
    nameAr: p.signatory.name.ar,
    titleEn: p.signatory.title.en,
    titleAr: p.signatory.title.ar,
    signatureImg: p.signatureImg,
    stampImg: p.stampImg,
  }
}

/** Language-clause line — the SAME fixed bilingual line Classic prints. */
export const AGR_LANGUAGE_CLAUSE = {
  en: 'This agreement is made in two languages; both texts are equally valid.',
  ar: 'حُرر هذا العقد باللغتين، ولكلا النصين الحجية ذاتها.',
}
