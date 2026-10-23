'use client'

// E-Invoice print SHARED module — the ONE data model, letterhead resolution,
// pagination planner and geometry constants used by every e-invoice print
// template (Classic, Heritage, Folder).
//
// Extraction guarantee: this code was moved VERBATIM out of
// e-invoice-print.tsx (the Classic template) — same constants, same logic,
// same output. Only the location changed, so every template renders from the
// exact same DocModel: the invoice number, every amount, the VAT, the
// totals, the amount in words, the customer and bank data and the ZATCA QR
// are IDENTICAL across all templates by construction — only the layout
// differs.
//
// Why it exists: the Heritage and Folder templates (reference designs
// E-Invoice_Template_D_Heritage / _F_Folder) are new LAYOUT files that read
// the SAME invoice data as Classic. They must never re-derive, reformat or
// re-round anything — they consume this module's DocModel only.
import type {
  AppSettings,
  EInvoiceConfig,
  EInvoiceItemRow,
  EInvoiceRow,
  LetterheadConfig,
  EInvoiceLetterheadConfig,
} from '@/lib/types'
import { amountInWordsBoth } from '@/lib/arabic-words'
import { formatNumber, round2 } from '@/lib/format'

// ── Brand palette (exact codes from the boss — shared by all templates) ─────
export const NAVY = '#132A4A'
export const DARK_NAVY = '#0C1D33'
export const GOLD = '#C0934C'
export const LIGHT_GOLD = '#E1B169'
export const DARK_GOLD = '#8E6420'
export const LIGHT_BG = '#F2F5FA'
export const BORDER = '#DDE3EC'
export const ROW_SEP = '#E8ECF2'
export const MUTED = '#6B7488'
// warm cream — Classic's soft beige for bars and card headers
export const CREAM = '#FBF9F3'
// Heritage/Folder warm neutrals (from the reference designs)
export const HERITAGE_INK = '#1D2433'
export const HERITAGE_INK_SOFT = '#4A5468'
export const HERITAGE_CREAM = '#FAF7F1'
export const HERITAGE_PAPER = '#EFE8D8'
export const HERITAGE_RULE = '#E2D6B5'

export const DOC_FONT =
  "var(--font-inter), var(--font-cairo), 'Cairo', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif"
/** Heritage serif display face (EN titles) — DejaVu Serif exists in the
 *  print container; browsers fall through to Georgia/Times. Arabic text never
 *  uses this stack (it stays on DOC_FONT for correct shaping). */
export const DOC_SERIF =
  "'DejaVu Serif', Georgia, 'Liberation Serif', 'Times New Roman', serif"
/** Reference mono face for numbers/ids (digits + Latin only — no Arabic). */
export const DOC_MONO = "'DejaVu Sans Mono', ui-monospace, 'Cascadia Mono', monospace"

export const DEFAULT_EI_CONFIG: EInvoiceConfig = {
  letterhead: '',
  topMm: 45,
  bottomMm: 25,
  signature: '',
  stamp: '',
  showReceiverSignature: true,
  translateProvider: 'builtin',
  translateApiKeySet: false,
}

// ── A4 pagination geometry ──────────────────────────────────────────────────
export const PAGE_W_MM = 210
export const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (see quotation-print)
export const SIDE_PAD_MM = 8
/** content width — the width the measure rig renders at */
export const CONTENT_W_MM = PAGE_W_MM - 2 * SIDE_PAD_MM
/** breathing room between the letterhead band and the content column */
export const BAND_GAP_TOP_MM = 1
export const BAND_GAP_BOTTOM_MM = 1.5
// ── the E-Invoice letterhead layout (Settings → Company Letterhead — E-Invoice)
// 45 mm header band + 25 mm footer band, 5 mm gaps (body 50–267 mm),
// 12 mm side margins, dedicated page number line above the footer ─────────
export const EI_LH_HEADER_MM = 45
export const EI_LH_FOOTER_MM = 25
export const EI_LH_GAP_MM = 5
export const EI_LH_SIDE_MM = 12
/** watermark print width (mm) — centered in the body area, aspect kept */
export const EI_LH_WATERMARK_W_MM = 120
/** cross-renderer safety slack when deciding "fits on one page" (mm) */
export const SAFETY_MM = 1

export const DOC_TITLES: Record<string, { en: string; ar: string }> = {
  invoice: { en: 'TAX INVOICE', ar: 'فاتورة ضريبية' },
  credit_note: { en: 'CREDIT NOTE', ar: 'إشعار دائن' },
  debit_note: { en: 'DEBIT NOTE', ar: 'إشعار مدين' },
}

/** Arabic names for the currency cell of the date & currency bar. */
export const CURRENCY_AR: Record<string, string> = {
  SAR: 'ريال سعودي',
  USD: 'دولار أمريكي',
  EUR: 'يورو',
  GBP: 'جنيه إسترليني',
  AED: 'درهم إماراتي',
}

/** DD / MM / YYYY — the e-invoice document date format. */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())} / ${pad(date.getMonth() + 1)} / ${date.getFullYear()}`
}

/** Quantity: integers stay clean, fractions keep 2 decimals. */
export function fmtQty(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : formatNumber(n)
}

/** Short brand name for the note line — "Landmark Inter Gulf Co. LLC" →
 *  "Landmark Inter Gulf" (the full legal name still prints in the supplier
 *  box; the note line uses the compact form). */
export function shortCompanyName(name: string): string {
  const stripped = name
    .replace(/\s*(Co\.?\s*LLC|L\.L\.C\.?|LLC|Co\.,?\s*Ltd\.?|Ltd\.?)\s*$/i, '')
    .trim()
  return stripped || name
}

// ── Letterhead resolution ───────────────────────────────────────────────────
// Priority: the E-Invoice module's OWN letterhead (Settings → Company
// Letterhead — E-Invoice — ANY uploaded slot of header / footer / enabled
// watermark activates the letterhead layout) → the module's full-page upload
// (Settings → E-Invoice) → the SHARED company letterhead → completely empty
// reserved bands. Without artwork the 45 mm / 25 mm zones print NOTHING.
//
// The watermark is resolved INDEPENDENTLY of the band source — it layers on
// every path (centered in that path's body area).
//
// "Print with letterhead" (withLetterhead) only gates the ARTWORK — every
// geometry value (bands, gaps, side margins, page-number line) stays exactly
// the same, so unchecking it is safe for pre-printed letterhead paper.
export type ResolvedLetterhead = {
  kind: 'full' | 'bands' | 'empty'
  fullImg: string | null
  headerImg: string | null
  footerImg: string | null
  /** artwork band heights (mm) — the zones reserved on every page */
  topBandMm: number
  bottomBandMm: number
  /** content column insets (mm) — band + breathing gap */
  topPadMm: number
  bottomPadMm: number
  /** content column side margins (mm) */
  sidePadMm: number
  /** content width (mm) — the width the measure rig renders at */
  contentWMm: number
  /** dedicated bilingual page-number line just above the footer band */
  dedicatedPageNo: boolean
  /** watermark layer (already gated by withLetterhead + the Settings toggle) */
  watermarkImg: string | null
  watermarkOpacityPct: number
}

export function resolveLetterhead(
  config: EInvoiceConfig,
  lh?: LetterheadConfig | null,
  eiLh?: EInvoiceLetterheadConfig | null,
  withLetterhead = true
): ResolvedLetterhead {
  // watermark layer — independent of the band source; hidden with the
  // letterhead checkbox or the Settings on/off toggle
  const wmImg =
    withLetterhead && eiLh?.watermark && eiLh.watermarkEnabled ? eiLh.watermark : null
  const wmOpacity = eiLh?.watermarkOpacity ?? 100

  const headerH = lh?.headerHeightMm || 45
  const footerH = lh?.footerHeightMm || 25

  // 1) the E-Invoice's own letterhead — any uploaded slot activates the
  //    letterhead layout (45/25 mm bands, 5 mm gaps, 12 mm sides, dedicated
  //    page number above the footer). Slots not uploaded stay EMPTY.
  if (eiLh && (eiLh.header || eiLh.footer || (eiLh.watermark && eiLh.watermarkEnabled))) {
    return {
      kind: 'bands',
      fullImg: null,
      headerImg: withLetterhead ? eiLh.header || null : null,
      footerImg: withLetterhead ? eiLh.footer || null : null,
      topBandMm: EI_LH_HEADER_MM,
      bottomBandMm: EI_LH_FOOTER_MM,
      topPadMm: EI_LH_HEADER_MM + EI_LH_GAP_MM, // body starts 50 mm from the top
      bottomPadMm: EI_LH_FOOTER_MM + EI_LH_GAP_MM, // body ends 30 mm from the bottom
      sidePadMm: EI_LH_SIDE_MM,
      contentWMm: PAGE_W_MM - 2 * EI_LH_SIDE_MM,
      dedicatedPageNo: true,
      watermarkImg: wmImg,
      watermarkOpacityPct: wmOpacity,
    }
  }
  // 2) module-specific full-page upload (legacy path — geometry unchanged)
  if (config.letterhead) {
    return {
      kind: 'full',
      fullImg: withLetterhead ? config.letterhead : null,
      headerImg: null,
      footerImg: null,
      topBandMm: config.topMm,
      bottomBandMm: config.bottomMm,
      topPadMm: config.topMm + BAND_GAP_TOP_MM,
      bottomPadMm: config.bottomMm + BAND_GAP_BOTTOM_MM,
      sidePadMm: SIDE_PAD_MM,
      contentWMm: CONTENT_W_MM,
      dedicatedPageNo: false,
      watermarkImg: wmImg,
      watermarkOpacityPct: wmOpacity,
    }
  }
  // 3) shared company letterhead (legacy path — geometry unchanged)
  if (lh?.mode === 'full' && lh.fullPageImage) {
    return {
      kind: 'full',
      fullImg: withLetterhead ? lh.fullPageImage : null,
      headerImg: null,
      footerImg: null,
      topBandMm: headerH,
      bottomBandMm: footerH,
      topPadMm: headerH + 3,
      bottomPadMm: footerH + 3,
      sidePadMm: SIDE_PAD_MM,
      contentWMm: CONTENT_W_MM,
      dedicatedPageNo: false,
      watermarkImg: wmImg,
      watermarkOpacityPct: wmOpacity,
    }
  }
  const headerImg =
    lh?.mode === 'header' || lh?.mode === 'header_footer' ? lh.headerImage : null
  const footerImg = lh?.mode === 'header_footer' ? lh.footerImage : null
  return {
    kind: headerImg || footerImg ? 'bands' : 'empty',
    fullImg: null,
    headerImg: withLetterhead ? headerImg : null,
    footerImg: withLetterhead ? footerImg : null,
    topBandMm: headerH,
    bottomBandMm: footerH,
    topPadMm: headerH + BAND_GAP_TOP_MM,
    bottomPadMm: footerH + BAND_GAP_BOTTOM_MM,
    sidePadMm: SIDE_PAD_MM,
    contentWMm: CONTENT_W_MM,
    dedicatedPageNo: false,
    watermarkImg: wmImg,
    watermarkOpacityPct: wmOpacity,
  }
}

// ── Measured pagination ─────────────────────────────────────────────────────
/** Real DOM heights (mm) of every block, read from the measure rig. */
export type Measured = {
  /** head blocks incl. the spacing between them and the items table */
  headMm: number
  /** continuation header incl. its spacing */
  contMm: number
  /** items table fixed overhead (border box + thead) */
  tableMm: number
  /** one height per item row, measured at normal padding */
  rowsMm: number[]
  /** gap + closing group (words + bank | totals) */
  closingMm: number
  /** signature row (QR | Received | Authorized | Stamp) */
  sigMm: number
  /** note line */
  noteMm: number
}

/** The decided page layout: item indexes per page (last page also carries
 *  the closing group + signature row) and whether rows use compact padding. */
export type LayoutPlan = {
  pages: number[][]
  compact: boolean
}

/**
 * Pure planner over the measured heights:
 *   1. ONE page if everything fits (first at normal row padding, then
 *      squeezed −1mm/row — the last resort before a second page);
 *   2. else page 1 = head + thead + as many WHOLE rows as fit; later pages =
 *      continuation header + thead + more rows; closing + signature live on
 *      the LAST page; when the rows all fit on page 1 but the tail does not,
 *      at least the last row moves with them (never a totals-only opener);
 *   3. a single item row is never split across pages.
 */
export function planLayout(m: Measured, columnH: number): LayoutPlan {
  const budget = columnH - m.noteMm - SAFETY_MM
  const tail = m.closingMm + m.sigMm
  const rows = m.rowsMm
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
  const all = rows.map((_, i) => i)

  // 1) everything on ONE page at the normal row padding
  if (m.headMm + m.tableMm + sum(rows) + tail <= budget) {
    return { pages: [all], compact: false }
  }
  // 2) squeeze rows by 1mm each before adding a page
  const compactRows = rows.map((h) => Math.max(h - 1, 4))
  if (rows.length > 0 && m.headMm + m.tableMm + sum(compactRows) + tail <= budget) {
    return { pages: [all], compact: true }
  }
  // 3) multi-page — rows back at the normal padding
  const cap1 = budget - m.headMm - m.tableMm
  const capN = budget - m.contMm - m.tableMm
  const chunks: number[][] = []
  let cur: number[] = []
  let used = 0
  let cap = cap1

  for (let i = 0; i < rows.length; i++) {
    if (cur.length > 0 && used + rows[i] > cap) {
      chunks.push(cur)
      cur = []
      used = 0
      cap = capN
    }
    cur.push(i)
    used += rows[i]
  }
  if (cur.length > 0 || chunks.length === 0) chunks.push(cur)

  // closing + signature must share the final items page — otherwise they get
  // a fresh page
  const last = chunks[chunks.length - 1]
  const lastCap = chunks.length === 1 ? cap1 : capN
  if (sum(last.map((i) => rows[i])) + tail > lastCap) {
    // pull AT LEAST the last item row forward so the new page never opens
    // with only totals (skipped only in the degenerate case where even one
    // row + the tail cannot fit)
    const moved: number[] = []
    const i = last[last.length - 1]
    if (i !== undefined && rows[i] <= capN - tail) {
      last.pop()
      moved.unshift(i)
    }
    chunks.push(moved)
  }
  return { pages: chunks, compact: false }
}

// ── Document model (shared by every template + the measure rigs) ────────────
export type DocModel = {
  inv: EInvoiceRow
  items: EInvoiceItemRow[]
  title: { en: string; ar: string }
  currency: string
  currencyAr: string
  settings: AppSettings
  supplier: {
    nameEn: string
    nameAr: string
    vat: string
    cr: string
    addressEn: string
    addressAr: string
  }
  buyerAddr: string
  vatLabel: string
  rates: number[]
  words: { en: string; ar: string }
  balanceDue: number
  money: (n: number) => string
  config: EInvoiceConfig
  qrDataUrl: string | null
  zatcaNotice: string | null
  /** compact brand name for the note line */
  noteCompany: string
  printedAt: Date
}

export function buildModel(
  invoice: EInvoiceRow,
  config: EInvoiceConfig,
  settings: AppSettings,
  qrDataUrl: string | null
): DocModel {
  const inv = invoice
  const items = inv.items ?? []
  const currency = settings.currency || 'SAR'
  const title =
    inv.invoiceKind === 'simplified' && inv.docType === 'invoice'
      ? { en: 'SIMPLIFIED TAX INVOICE', ar: 'فاتورة ضريبية مبسطة' }
      : (DOC_TITLES[inv.docType] ?? DOC_TITLES.invoice)
  // Phase 2 standard invoices are only valid for the client after ZATCA clearance
  const zatcaNotice =
    inv.status === 'draft'
      ? null
      : inv.zatcaStatus === 'local_only' || inv.zatcaSubmissionMode === 'local'
        ? 'LOCAL TEST — not valid with ZATCA'
        : inv.hasSignedXml && inv.invoiceKind !== 'simplified' && inv.zatcaStatus !== 'cleared'
          ? 'Not yet cleared by ZATCA — do not give to the client'
          : null
  // Buyer national address (structured) when entered, else the free-text address
  const buyerNational = [
    [inv.buyerBuildingNo, inv.buyerStreet].filter(Boolean).join(' '),
    inv.buyerDistrict,
    [inv.buyerCity, inv.buyerPostalCode].filter(Boolean).join(' '),
    inv.buyerCountry && inv.buyerCountry !== 'SA' ? inv.buyerCountry : '',
  ]
    .filter(Boolean)
    .join(', ')
  const companyName = settings.companyName || 'Landmark Inter Gulf'

  return {
    inv,
    items,
    title,
    currency,
    currencyAr: CURRENCY_AR[currency] ?? '',
    settings,
    supplier: {
      nameEn: companyName,
      nameAr: settings.companyNameAr || '',
      vat: settings.vatNumber || '',
      cr: settings.crNumber || '',
      addressEn: settings.address || '',
      addressAr: settings.addressAr || '',
    },
    buyerAddr: buyerNational || inv.clientAddressEn || '',
    vatLabel:
      [...new Set(items.map((it) => Math.round(it.vatPercent)))].length === 1
        ? `${Math.round(items[0]?.vatPercent ?? 15)}%`
        : '',
    rates: [...new Set(items.map((it) => Math.round(it.vatPercent)))],
    words: amountInWordsBoth(inv.totalDue, currency),
    balanceDue: round2(inv.totalDue - inv.paidAmount),
    money: (n: number) => formatNumber(n),
    config,
    qrDataUrl,
    zatcaNotice,
    noteCompany: shortCompanyName(companyName),
    printedAt: new Date(),
  }
}

/** ZATCA BR-CO-17 rounding reconciliation: signed difference between the
 *  header VAT (category-level rounding) and the Σ per-line VAT, whenever the
 *  two differ by more than a halala. All 3 templates show the SAME row so
 *  every amount is identical across templates (Classic behaviour). */
export function vatRoundingDelta(inv: EInvoiceRow): number {
  const lineSum = round2((inv.items ?? []).reduce((s, it) => s + it.vatAmount, 0))
  return round2(inv.vatAmount - lineSum)
}

// ── Page shell (Heritage + Folder — Classic keeps its own inline version) ──
// One fixed A4 sheet with the letterhead artwork layers, the company
// watermark, the DRAFT watermark (drafts only) and the dedicated bilingual
// page-number line — IDENTICAL layering rules to Classic:
//   z-0 letterhead artwork → z-1 watermark → z-5 DRAFT → z-6 page number
//   → z-10 content column.
// The geometric pattern of the new templates lives INSIDE their content
// blocks (band / TOTAL DUE box) and never sits behind the QR or numbers.
export function DocPageShell({
  lh,
  isLast,
  draft,
  pageIdx,
  totalPages,
  children,
}: {
  lh: ResolvedLetterhead
  isLast: boolean
  draft: boolean
  pageIdx: number
  totalPages: number
  children: React.ReactNode
}) {
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
      {/* letterhead artwork (every page) — E-Invoice's own bands → full-page
          override → shared bands → nothing at all */}
      {lh.kind === 'full' && lh.fullImg ? (
        <img
          src={lh.fullImg}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 h-full w-full object-fill"
        />
      ) : lh.kind === 'bands' ? (
        <>
          {lh.headerImg ? (
            <img
              src={lh.headerImg}
              alt=""
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 z-0 w-full object-fill"
              style={{ height: `${lh.topBandMm}mm` }}
            />
          ) : null}
          {lh.footerImg ? (
            <img
              src={lh.footerImg}
              alt=""
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-0 z-0 w-full object-fill"
              style={{ height: `${lh.bottomBandMm}mm` }}
            />
          ) : null}
        </>
      ) : null}

      {/* company watermark — centered in the body area, BEHIND all body
          content (above the letterhead artwork, below the content column) */}
      {lh.watermarkImg ? (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[1] flex items-center justify-center"
          style={{
            top: `${lh.topPadMm}mm`,
            bottom: `${lh.bottomPadMm}mm`,
            left: 0,
            right: 0,
          }}
        >
          <img
            src={lh.watermarkImg}
            alt=""
            className="block"
            style={{
              width: `${EI_LH_WATERMARK_W_MM}mm`,
              maxHeight: '100%',
              objectFit: 'contain',
              opacity: lh.watermarkOpacityPct / 100,
            }}
          />
        </div>
      ) : null}

      {/* DRAFT watermark (drafts only — same behaviour as Classic) */}
      {draft ? (
        <div
          className="pointer-events-none absolute inset-0 z-[5] flex flex-col items-center justify-center gap-10"
          aria-hidden
        >
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="select-none whitespace-nowrap text-[46px] font-black uppercase tracking-[0.3em] text-neutral-400/20"
              style={{ transform: `rotate(-22deg) scale(${i === 1 ? 1 : 0.55})` }}
            >
              DRAFT · <span lang="ar" dir="rtl">مسودة</span>
            </span>
          ))}
        </div>
      ) : null}

      {/* page number — just above the footer band on EVERY page (E-Invoice
          letterhead layout only; otherwise the note line carries it) */}
      {lh.dedicatedPageNo ? (
        <p
          aria-hidden
          className="pointer-events-none absolute left-0 right-0 z-[6] text-center text-[7.5pt] leading-snug tabular-nums"
          style={{ bottom: `${lh.bottomBandMm + 1}mm`, color: MUTED }}
        >
          Page {pageIdx + 1} of {totalPages}
          <span className="mx-1.5 text-[#6B7488]">/</span>
          <span lang="ar" dir="rtl" className="tracking-normal">
            صفحة {pageIdx + 1} من {totalPages}
          </span>
        </p>
      ) : null}

      {children}
    </div>
  )
}
