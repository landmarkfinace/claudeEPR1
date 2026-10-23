'use client'

// E-Invoice print preview — the boss's "Mirror EN-AR" A4 portrait template,
// restructured to the auto 1-page / multi-page layout spec:
//
//   A. Title row (TAX INVOICE + invoice-number capsule + فاتورة ضريبية + status)
//   B. Dates bar (Issue Date · Supply Date · Due Date · Currency)
//   C. Supplier + Customer boxes
//   D. References bar (P.O. / Contract Ref · Project · Payment Terms · Method)
//   E. Items table (Description ≈34% — EN line 1 / AR line 2, 2mm row padding)
//   F. Closing group: Amount in Words + Bank Details (left) | Totals (right)
//      — ONE unit, never split
//   G. Signature row: ZATCA QR (30×30mm) | Receiver | Authorized | Stamp —
//      ONE unit, never split, pinned to the BOTTOM of the LAST page
//   H. Note line ("Company · INV-xxxx · Page X of Y · Printed date") at the
//      foot of EVERY page
//
// Pagination is MEASURED, not estimated: the document first renders hidden at
// the exact content width (194mm) and the real height of every block is read
// back from the DOM (after webfonts + images are ready). A pure planner then
// decides the page count:
//   • A–H all fit → ONE page (row padding may squeeze to 1.5mm first);
//   • else page 1 carries A–D + as many WHOLE item rows as fit; later pages
//     carry a small continuation header + the repeated table header + the
//     remaining rows; F + G always ride on the LAST page — and if the items
//     all fit on page 1 but F + G do not, at least the last item row moves to
//     page 2 with them (a page never opens with only totals);
//   • a single item row is never split across pages.
//
// The last page is a flex column: content at the top, a flexible spacer, then
// the signature row + note line pinned to the bottom — empty space goes
// BETWEEN the closing group and the signature row, never below it.
//
// Letterhead: the E-Invoice module's OWN letterhead (Settings → Company
// Letterhead — E-Invoice: 45 mm header band + 25 mm footer band artwork + a
// watermark centered behind the body) prints on EVERY page; any uploaded slot
// activates the letterhead layout: 45/25 mm full-width bands, 5 mm gaps (body
// 50–267 mm), 12 mm side margins and a bilingual page number line just above
// the footer. It takes priority over an e-invoice-specific full-page upload
// (Settings → E-Invoice) and over the SHARED company letterhead — with all
// three slots empty the invoice works exactly as it does now (full-page →
// shared bands → completely empty 45 mm / 25 mm zones: no placeholder text,
// no stripes, no borders).
//
// "Print with letterhead" (checkbox in the print dialog, default checked)
// hides the header / footer / watermark artwork but keeps the exact same
// margins — for pre-printed letterhead paper.
//
// The watermark layer sits BEHIND all body content (above the letterhead
// artwork, below the content column), centered in the body area, ≈120 mm
// wide, aspect ratio kept, opacity 10–100 % (Settings), on/off in Settings.
//
// The component is purely presentational: the parent (e-invoices view)
// fetches the document, the e-invoice print config, the shared letterhead
// config and the ZATCA QR data URL and passes them as props — no data
// fetching happens in here. The vector PDF pipeline (serialize .print-area →
// headless Chromium → page.pdf) is unchanged; the measured page plan is baked
// into the very DOM it serializes.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileDown, Paperclip, Printer, X } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { amountInWordsBoth } from '@/lib/arabic-words'
import { formatNumber, round2 } from '@/lib/format'
import { downloadPrintAreaAsPdf, printPrintArea } from '@/lib/print-to-pdf'
import { useAppStore } from '@/lib/store'
import type {
  AppSettings,
  EInvoiceConfig,
  EInvoiceItemRow,
  EInvoiceLetterheadConfig,
  EInvoiceRow,
  LetterheadConfig,
} from '@/lib/types'

// ── Brand palette (exact codes from the boss) ───────────────────────────────
const NAVY = '#132A4A'
const DARK_NAVY = '#0C1D33'
const GOLD = '#C0934C'
const LIGHT_GOLD = '#E1B169'
const DARK_GOLD = '#8E6420'
const LIGHT_BG = '#F2F5FA'
const BORDER = '#DDE3EC'
const ROW_SEP = '#E8ECF2'
const MUTED = '#6B7488'
// warm cream — the template's soft beige for bars and card headers
const CREAM = '#FBF9F3'

const DOC_FONT = "var(--font-inter), var(--font-cairo), 'Cairo', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif"

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
const PAGE_W_MM = 210
const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (see quotation-print)
const SIDE_PAD_MM = 8
/** content width — the width the measure rig renders at */
const CONTENT_W_MM = PAGE_W_MM - 2 * SIDE_PAD_MM
/** breathing room between the letterhead band and the content column */
const BAND_GAP_TOP_MM = 1
const BAND_GAP_BOTTOM_MM = 1.5
// ── the E-Invoice letterhead layout (Settings → Company Letterhead — E-Invoice)
// 45 mm header band + 25 mm footer band, 5 mm gaps (body 50–267 mm),
// 12 mm side margins, dedicated page number line above the footer ─────────
const EI_LH_HEADER_MM = 45
const EI_LH_FOOTER_MM = 25
const EI_LH_GAP_MM = 5
const EI_LH_SIDE_MM = 12
/** watermark print width (mm) — centered in the body area, aspect kept */
const EI_LH_WATERMARK_W_MM = 120
/** fixed vertical rhythm (these gaps are included in the measured heights) */
const GAP_TABLE_CLOSING_MM = 2.5 // items table → closing group
const GAP_SIG_NOTE_MM = 1.5 // signature row → note line
/** cross-renderer safety slack when deciding "fits on one page" (mm) */
const SAFETY_MM = 1
/** items-table row padding (mm, top+bottom); compact is the last resort
 *  before adding a second page (never smaller, fonts never shrink) */
type RowPad = 2 | 1.5

const DOC_TITLES: Record<string, { en: string; ar: string }> = {
  invoice: { en: 'TAX INVOICE', ar: 'فاتورة ضريبية' },
  credit_note: { en: 'CREDIT NOTE', ar: 'إشعار دائن' },
  debit_note: { en: 'DEBIT NOTE', ar: 'إشعار مدين' },
}

/** Arabic names for the currency cell of the date & currency bar. */
const CURRENCY_AR: Record<string, string> = {
  SAR: 'ريال سعودي',
  USD: 'دولار أمريكي',
  EUR: 'يورو',
  GBP: 'جنيه إسترليني',
  AED: 'درهم إماراتي',
}

/** DD / MM / YYYY — the e-invoice document date format. */
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())} / ${pad(date.getMonth() + 1)} / ${date.getFullYear()}`
}

/** Quantity: integers stay clean, fractions keep 2 decimals. */
function fmtQty(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : formatNumber(n)
}

/** Short brand name for the note line — "Landmark Inter Gulf Co. LLC" →
 *  "Landmark Inter Gulf" (the full legal name still prints in the supplier
 *  box; the note line uses the compact form). */
function shortCompanyName(name: string): string {
  const stripped = name
    .replace(/\s*(Co\.?\s*LLC|L\.L\.C\.?|LLC|Co\.,?\s*Ltd\.?|Ltd\.?)\s*$/i, '')
    .trim()
  return stripped || name
}

/** Bilingual label: EN + '|' + AR on one line; wraps the Arabic onto a
 *  second line in narrow cells — never clipped. */
function BiLabel({ en, ar, center }: { en: string; ar: string; center?: boolean }) {
  return (
    <span
      className={`flex flex-wrap gap-x-1.5 gap-y-[0.3mm] text-[7.5pt] font-semibold uppercase leading-snug tracking-[0.3pt] ${center ? 'justify-center' : ''}`}
      style={{ color: MUTED }}
    >
      <span className="break-words">{en}</span>
      <span className="text-[#6B7488]">|</span>
      <span lang="ar" dir="rtl" className="normal-case tracking-normal">
        {ar}
      </span>
    </span>
  )
}

/** Small solid gold diamond — the template's recurring ornament. */
function GoldDiamond({ size = 5 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rotate-45"
      style={{ width: `${size}px`, height: `${size}px`, background: GOLD }}
    />
  )
}

/** Rotated status stamp chip — floats over the title row's right side. */
function StatusStamp({ status, overdue }: { status: string; overdue: boolean }) {
  const map: Record<string, { label: string; border: string; color: string }> = {
    draft: { label: 'DRAFT', border: '#737373', color: '#525252' },
    issued: { label: 'ISSUED', border: '#d97706', color: '#b45309' },
    partially_paid: { label: 'PARTIALLY PAID', border: '#0d9488', color: '#0f766e' },
    paid: { label: 'PAID', border: '#059669', color: '#047857' },
  }
  const entry = overdue
    ? { label: 'OVERDUE', border: '#e11d48', color: '#be123c' }
    : (map[status] ?? map.draft)
  return (
    <span
      className="absolute -top-3 right-0 z-20 inline-block rounded border-[2.5px] bg-white/95 px-2 py-px text-[8.5pt] font-black uppercase tracking-[0.3pt] shadow-[inset_0_0_0_1.5px_rgba(0,0,0,0.06)]"
      style={{ borderColor: entry.border, color: entry.color, transform: 'rotate(-3deg)' }}
    >
      {entry.label}
    </span>
  )
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
type ResolvedLetterhead = {
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

function resolveLetterhead(
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
type Measured = {
  /** A–D incl. the spacing between D and the items table */
  headMm: number
  /** continuation header incl. its spacing */
  contMm: number
  /** items table fixed overhead (border box + thead) */
  tableMm: number
  /** one height per item row, measured at 2mm padding */
  rowsMm: number[]
  /** gap + closing group F */
  closingMm: number
  /** signature row G */
  sigMm: number
  /** note line H */
  noteMm: number
}

/** The decided page layout: item indexes per page (last page also carries
 *  F + G + H) and whether rows use the compact 1.5mm padding. */
type LayoutPlan = {
  pages: number[][]
  compact: boolean
}

/**
 * Pure planner over the measured heights:
 *   1. ONE page if A–H fit (first at 2mm row padding, then squeezed to
 *      1.5mm — the last resort before a second page);
 *   2. else page 1 = A–D + thead + as many WHOLE rows as fit; later pages =
 *      continuation header + thead + more rows; F + G live on the LAST page;
 *      when the rows all fit on page 1 but F + G don't, at least the last
 *      row moves with them (never a totals-only page opener).
 */
function planLayout(m: Measured, columnH: number): LayoutPlan {
  const budget = columnH - m.noteMm - GAP_SIG_NOTE_MM - SAFETY_MM
  const tail = m.closingMm + m.sigMm
  const rows = m.rowsMm
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
  const all = rows.map((_, i) => i)

  // 1) everything on ONE page at the normal 2mm row padding
  if (m.headMm + m.tableMm + sum(rows) + tail <= budget) {
    return { pages: [all], compact: false }
  }
  // 2) squeeze rows to 1.5mm padding (each row −1mm) before adding a page
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

  // F + G must share the final items page — otherwise they get a fresh page
  const last = chunks[chunks.length - 1]
  const lastCap = chunks.length === 1 ? cap1 : capN
  if (sum(last.map((i) => rows[i])) + tail > lastCap) {
    // pull AT LEAST the last item row forward so the new page never opens
    // with only totals (skipped only in the degenerate case where even one
    // row + F + G cannot fit)
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

// ── Document model (shared by every block + the measure rig) ────────────────
type DocModel = {
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

function buildModel(
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

// ── Block A–D: title row + dates bar + party boxes + references bar ─────────
function InvoiceHead({ m }: { m: DocModel }) {
  const { inv, title, supplier } = m
  return (
    <>
      {/* A ─ mirror title row: EN title (≤35%) · invoice-no pill badge
          (centre) · AR title (≤35%) — grid zones never overlap */}
      <div className="relative grid grid-cols-[minmax(0,35fr)_auto_minmax(0,35fr)] items-center gap-3">
        <StatusStamp status={inv.status} overdue={inv.overdue} />
        <h1
          className="break-words text-[16pt] font-extrabold uppercase leading-[1.15] tracking-[0.04em]"
          style={{ color: NAVY }}
        >
          {title.en}
        </h1>
        {/* pill badge — gold ring outside, navy fill inside */}
        <div className="shrink-0 rounded-full p-[2px]" style={{ background: GOLD }}>
          <div className="rounded-full px-4 text-center py-[2.5px]" style={{ background: NAVY }}>
            <p
              className="whitespace-nowrap text-[7.5pt] font-bold uppercase tracking-[0.3pt]"
              style={{ color: LIGHT_GOLD }}
            >
              {title.en.includes('TAX') ? 'Invoice No.' : 'Document No.'}{' '}
              <span lang="ar" dir="rtl" className="tracking-normal">
                رقم الفاتورة
              </span>
            </p>
            <p className="mt-[1px] whitespace-nowrap font-mono text-[11pt] font-extrabold leading-tight text-white">
              {inv.invoiceNumber}
            </p>
          </div>
        </div>
        <h1
          lang="ar"
          dir="rtl"
          className="break-words text-[14pt] font-extrabold leading-[1.3]"
          style={{ color: NAVY }}
        >
          {title.ar}
        </h1>
      </div>
      {inv.relatedInvoiceNumber ? (
        <p className="mt-1 text-center text-[8.5pt] font-semibold" style={{ color: MUTED }}>
          Original Invoice:{' '}
          <span className="font-mono font-bold" style={{ color: NAVY }}>
            {inv.relatedInvoiceNumber}
          </span>
          <span className="mx-1.5 text-[#6B7488]">|</span>
          <span lang="ar" dir="rtl">الفاتورة الأصلية: </span>
          <span lang="ar" dir="rtl" className="font-mono font-bold" style={{ color: NAVY }}>
            {inv.relatedInvoiceNumber}
          </span>
        </p>
      ) : null}
      {inv.docType !== 'invoice' && inv.noteReason ? (
        <p className="mt-0.5 text-center text-[8.5pt]" style={{ color: MUTED }}>
          Reason <span lang="ar" dir="rtl">(السبب)</span>:{' '}
          <span className="font-semibold" style={{ color: NAVY }}>
            {inv.noteReason}
          </span>
        </p>
      ) : null}

      {/* gold rule broken by a centre diamond */}
      <div className="mt-1 flex items-center gap-2">
        <div className="h-[2px] flex-1 rounded-full" style={{ background: GOLD }} />
        <GoldDiamond size={6} />
        <div className="h-[2px] flex-1 rounded-full" style={{ background: GOLD }} />
      </div>

      {/* B ─ dates & currency bar (cream, rounded, 4 cells) */}
      <div
        className="mt-1 grid grid-cols-4 rounded-lg border"
        style={{ borderColor: BORDER, background: CREAM }}
      >
        {(
          [
            ['Issue Date', 'تاريخ الإصدار', fmtDate(inv.issueDate)],
            ['Supply Date', 'تاريخ التوريد', fmtDate(inv.supplyDate)],
            ['Due Date', 'تاريخ الاستحقاق', fmtDate(inv.dueDate)],
            ['Currency', 'العملة', m.currencyAr ? `${m.currency} · ${m.currencyAr}` : m.currency],
          ] as Array<[string, string, string]>
        ).map(([en, ar, value]) => (
          <div
            key={en}
            className="border-r px-1.5 py-[2.5px] text-center last:border-r-0"
            style={{ borderColor: BORDER }}
          >
            <BiLabel en={en} ar={ar} center />
            <p
              className="break-words text-[9pt] font-bold tabular-nums leading-snug"
              style={{ color: NAVY }}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* C ─ SUPPLIER ◆ | CUSTOMER ◆ cards (cream header, dotted fields) */}
      <div className="mt-1 grid grid-cols-2 gap-2">
        {(
          [
            {
              label: 'Supplier',
              labelAr: 'المورد',
              nameEn: supplier.nameEn,
              nameAr: supplier.nameAr,
              vat: supplier.vat,
              cr: supplier.cr,
              addressEn: supplier.addressEn,
              addressAr: supplier.addressAr,
            },
            {
              label: 'Customer',
              labelAr: 'العميل',
              nameEn: inv.clientNameEn,
              nameAr: inv.clientNameAr,
              vat: inv.clientVatNumber,
              cr: inv.clientCrNumber,
              addressEn: m.buyerAddr,
              addressAr: inv.clientAddressAr,
            },
          ] as Array<{
            label: string
            labelAr: string
            nameEn: string
            nameAr: string
            vat: string | null
            cr: string | null
            addressEn: string | null
            addressAr: string | null
          }>
        ).map((box) => (
          <div
            key={box.label}
            className="rounded-lg border"
            style={{ borderColor: BORDER, background: 'white' }}
          >
            <div
              className="flex flex-wrap items-center justify-center gap-x-2 gap-y-[0.3mm] rounded-t-[7px] border-b px-2.5 py-[2px]"
              style={{ borderColor: BORDER, background: CREAM }}
            >
              <p
                className="text-[8.5pt] font-extrabold uppercase tracking-[0.3pt]"
                style={{ color: DARK_GOLD }}
              >
                {box.label}
              </p>
              <GoldDiamond size={5} />
              <p
                lang="ar"
                dir="rtl"
                className="text-[8.5pt] font-bold leading-none"
                style={{ color: DARK_GOLD }}
              >
                {box.labelAr}
              </p>
            </div>
            <div className="space-y-[0.5px] px-2.5 py-[2.5px]">
              <p className="break-words text-[9pt] font-bold leading-snug" style={{ color: NAVY }}>
                {box.nameEn || '—'}
              </p>
              {box.nameAr ? (
                <p
                  lang="ar"
                  dir="rtl"
                  className="break-words text-[9pt] font-semibold leading-snug"
                  style={{ color: NAVY }}
                >
                  {box.nameAr}
                </p>
              ) : null}
              <div
                className="space-y-[0.5px] border-t border-dotted pt-[1.5px] leading-[1.35]"
                style={{ borderColor: '#C7CFDC' }}
              >
                {/* VAT + C.R. — label above value: never wraps chaotically */}
                <div className="grid grid-cols-2 gap-x-2">
                  <div>
                    <p className="break-words text-[7.5pt] font-semibold leading-[1.4]" style={{ color: MUTED }}>
                      VAT No. <span lang="ar" dir="rtl">الرقم الضريبي</span>
                    </p>
                    <p className="break-all font-mono text-[9pt] font-semibold">{box.vat || '—'}</p>
                  </div>
                  <div>
                    <p className="break-words text-[7.5pt] font-semibold leading-[1.4]" style={{ color: MUTED }}>
                      C.R. No. <span lang="ar" dir="rtl">السجل التجاري</span>
                    </p>
                    <p className="break-all font-mono text-[9pt] font-semibold">{box.cr || '—'}</p>
                  </div>
                </div>
                {/* full-width line — the inline label rides the first value line */}
                <p className="break-words text-[9pt] leading-[1.35] text-neutral-800">
                  <span className="text-[7.5pt] font-semibold leading-[1.4]" style={{ color: MUTED }}>
                    Address <span lang="ar" dir="rtl">العنوان</span>:{' '}
                  </span>
                  {box.addressEn || '—'}
                </p>
                {box.addressAr ? (
                  <p lang="ar" dir="rtl" className="break-words text-[9pt] leading-[1.35] text-neutral-800">
                    {box.addressAr}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* D ─ references bar (P.O. / Contract · Project · Terms · Method) */}
      <div
        className="mt-1 grid grid-cols-4 rounded-lg border"
        style={{ borderColor: BORDER, background: CREAM }}
      >
        <div className="border-r px-1.5 py-[2.5px] text-center last:border-r-0" style={{ borderColor: BORDER }}>
          <BiLabel en="P.O. / Contract Ref" ar="رقم أمر الشراء" center />
          <p className="break-words text-[9pt] font-bold leading-[1.4]" style={{ color: NAVY }}>
            {inv.poRef || '—'}
          </p>
          {inv.contractRef ? (
            <p className="break-words text-[8.5pt] leading-[1.4]" style={{ color: MUTED }}>
              Contract <span lang="ar" dir="rtl">العقد</span>: {inv.contractRef}
            </p>
          ) : null}
        </div>
        <div className="border-r px-1.5 py-[2.5px] text-center last:border-r-0" style={{ borderColor: BORDER }}>
          <BiLabel en="Project" ar="المشروع" center />
          <p className="break-words text-[9pt] font-semibold leading-[1.4]" style={{ color: NAVY }}>
            {inv.projectEn || '—'}
            {inv.projectAr ? (
              <span className="font-normal" style={{ color: MUTED }}>
                {' '}
                · <span lang="ar" dir="rtl">{inv.projectAr}</span>
              </span>
            ) : null}
          </p>
        </div>
        <div className="border-r px-1.5 py-[2.5px] text-center last:border-r-0" style={{ borderColor: BORDER }}>
          <BiLabel en="Payment Terms" ar="شروط الدفع" center />
          <p className="break-words text-[9pt] font-semibold leading-[1.4]" style={{ color: NAVY }}>
            {inv.paymentTermsEn || '—'}
            {inv.paymentTermsAr ? (
              <span className="font-normal" style={{ color: MUTED }}>
                {' '}
                · <span lang="ar" dir="rtl">{inv.paymentTermsAr}</span>
              </span>
            ) : null}
          </p>
        </div>
        <div className="px-1.5 py-[2.5px] text-center">
          <BiLabel en="Payment Method" ar="طريقة الدفع" center />
          <p className="break-words text-[9pt] font-semibold leading-[1.4]" style={{ color: NAVY }}>
            {inv.paymentMethodEn || '—'}
            {inv.paymentMethodAr ? (
              <span className="font-normal" style={{ color: MUTED }}>
                {' '}
                · <span lang="ar" dir="rtl">{inv.paymentMethodAr}</span>
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {/* spacing between D and the items table — a REAL box so the measured
          head height includes it (an empty mt-* div's margin collapses out) */}
      <div style={{ height: '1mm' }} />
    </>
  )
}

// ── Continuation header (every page after the first) ────────────────────────
function ContinuationHeader({
  m,
  page,
  of,
  dedicatedPageNo,
}: {
  m: DocModel
  page: number
  of: number
  /** the page number lives on the dedicated line just above the footer */
  dedicatedPageNo?: boolean
}) {
  return (
    <>
      <div
        className="flex flex-wrap items-baseline justify-between gap-x-2 border-b pb-1"
        style={{ borderColor: BORDER }}
      >
        <p
          className="break-words text-[8.5pt] font-bold uppercase tracking-[0.3pt]"
          style={{ color: NAVY }}
        >
          {m.title.en} <span className="mx-1 text-[#6B7488]">·</span>{' '}
          <span className="font-mono">{m.inv.invoiceNumber}</span>{' '}
          <span className="font-normal" style={{ color: MUTED }}>
            · continued · <span lang="ar" dir="rtl">تابع</span>
          </span>
        </p>
        {dedicatedPageNo ? null : (
          <p className="shrink-0 text-[7.5pt] tabular-nums" style={{ color: MUTED }}>
            Page {page} of {of}
            <span className="mx-1.5 text-[#6B7488]">/</span>
            <span lang="ar" dir="rtl" className="tracking-normal">
              صفحة {page} من {of}
            </span>
          </p>
        )}
      </div>
      <div style={{ height: '1.5mm' }} />
    </>
  )
}

// ── Block E: items table ────────────────────────────────────────────────────
// Description ≈34% (EN line 1 / AR line 2), numbers right-aligned and never
// wrapped, row padding 2mm top/bottom (1.5mm when the planner squeezes the
// invoice onto a single page). The navy thead repeats on every page.
function ItemsTable({
  m,
  items,
  pad,
  empty,
  rowRefs,
}: {
  m: DocModel
  items: EInvoiceItemRow[]
  pad: RowPad
  /** render the "No line items yet" row (first page of an itemless invoice) */
  empty: boolean
  /** optional per-row ref collector (used by the measure rig) */
  rowRefs?: (i: number, el: HTMLTableRowElement | null) => void
}) {
  const th = 'px-1 py-[1.5px] text-center align-middle leading-[1.3]'
  const padCls = pad === 2 ? 'py-[2mm]' : 'py-[1.5mm]'
  const td = `px-1 ${padCls} align-top text-[9pt] leading-[1.35] text-neutral-900`
  const tdR = `${td} whitespace-nowrap text-right tabular-nums`
  const { currency, vatLabel } = m

  return (
    <div className="rounded-lg border" style={{ borderColor: BORDER, background: 'white' }}>
      <table className="w-full table-fixed border-collapse" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '34%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '6.5%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '7.5%' }} />
          <col style={{ width: '10.5%' }} />
          <col style={{ width: '10.5%' }} />
          <col style={{ width: '11%' }} />
        </colgroup>
        <thead style={{ display: 'table-header-group', background: DARK_NAVY }}>
          <tr>
            <th className={th}>
              <p className="text-[8pt] font-bold text-white">#</p>
            </th>
            <th className={`${th} text-left`}>
              <p className="text-[8pt] font-bold leading-[1.3] text-white">Description</p>
              <p lang="ar" dir="rtl" className="text-[8pt] font-semibold leading-[1.3]" style={{ color: LIGHT_GOLD }}>
                الوصف
              </p>
            </th>
            <th className={th}>
              <p className="text-[8pt] font-bold leading-[1.3] text-white">Unit</p>
              <p lang="ar" dir="rtl" className="text-[8pt] font-semibold leading-[1.3]" style={{ color: LIGHT_GOLD }}>
                الوحدة
              </p>
            </th>
            <th className={th}>
              <p className="text-[8pt] font-bold leading-[1.3] text-white">Qty</p>
              <p lang="ar" dir="rtl" className="text-[8pt] font-semibold leading-[1.3]" style={{ color: LIGHT_GOLD }}>
                الكمية
              </p>
            </th>
            <th className={th}>
              <p className="text-[8pt] font-bold leading-[1.3] text-white">Unit Price</p>
              <p lang="ar" dir="rtl" className="text-[8pt] font-semibold leading-[1.3]" style={{ color: LIGHT_GOLD }}>
                السعر
              </p>
            </th>
            <th className={th}>
              <p className="text-[8pt] font-bold leading-[1.3] text-white">Discount</p>
              <p lang="ar" dir="rtl" className="text-[8pt] font-semibold leading-[1.3]" style={{ color: LIGHT_GOLD }}>
                الخصم
              </p>
            </th>
            <th className={th}>
              <p className="text-[8pt] font-bold leading-[1.3] text-white">Taxable</p>
              <p lang="ar" dir="rtl" className="text-[8pt] font-semibold leading-[1.3]" style={{ color: LIGHT_GOLD }}>
                الخاضعة
              </p>
            </th>
            <th className={th}>
              <p className="text-[8pt] font-bold leading-[1.3] text-white">{`VAT${vatLabel ? ` ${vatLabel}` : ''}`}</p>
              <p lang="ar" dir="rtl" className="text-[8pt] font-semibold leading-[1.3]" style={{ color: LIGHT_GOLD }}>
                الضريبة
              </p>
            </th>
            <th className={th}>
              <p className="text-[8pt] font-bold leading-[1.3] text-white">{`Total (${currency})`}</p>
              <p lang="ar" dir="rtl" className="text-[8pt] font-semibold leading-[1.3]" style={{ color: LIGHT_GOLD }}>
                الإجمالي
              </p>
            </th>
          </tr>
        </thead>
        <tbody>
          {empty && items.length === 0 ? (
            <tr>
              <td
                className={`${td} border-b py-2 text-center text-[#6B7488]`}
                colSpan={9}
                style={{ borderColor: ROW_SEP }}
              >
                No line items yet
              </td>
            </tr>
          ) : (
            items.map((it, i) => (
              <tr
                key={it.id ?? `${it.sr}-${i}`}
                ref={rowRefs ? (el) => rowRefs(i, el) : undefined}
                className="break-inside-avoid"
                style={{ background: i % 2 === 1 ? '#FAFBFD' : 'white' }}
              >
                <td className={`${td} border-b text-center`} style={{ borderColor: ROW_SEP }}>
                  {/* index inside a thin gold ring — the template's touch */}
                  <span
                    className="inline-flex h-[13px] w-[13px] items-center justify-center rounded-full border-[1.3px] text-[8pt] font-bold tabular-nums"
                    style={{ borderColor: GOLD, color: NAVY }}
                  >
                    {it.sr}
                  </span>
                </td>
                <td className={`${td} border-b`} style={{ borderColor: ROW_SEP }}>
                  <p className="break-words text-[9pt] leading-[1.35] text-neutral-900">{it.descriptionEn}</p>
                  {it.descriptionAr ? (
                    <p
                      lang="ar"
                      dir="rtl"
                      className="mt-px break-words text-[8.5pt] leading-[1.35]"
                      style={{ color: MUTED }}
                    >
                      {it.descriptionAr}
                    </p>
                  ) : null}
                  {it.taxCategory && it.taxCategory !== 'S' ? (
                    <p className="mt-px text-[8pt] italic" style={{ color: MUTED }}>
                      {it.taxCategory === 'Z' ? 'Zero-rated' : it.taxCategory === 'E' ? 'VAT exempt' : 'Not subject to VAT'}
                      {it.exemptionReason ? ` — ${it.exemptionReason}` : ''}
                    </p>
                  ) : null}
                </td>
                <td
                  className={`${td} whitespace-nowrap border-b text-center`}
                  style={{ borderColor: ROW_SEP }}
                >
                  <p className="whitespace-nowrap">{it.unitEn || '—'}</p>
                  {it.unitAr ? (
                    <p lang="ar" dir="rtl" className="whitespace-nowrap text-[8pt] leading-[1.35]" style={{ color: MUTED }}>
                      {it.unitAr}
                    </p>
                  ) : null}
                </td>
                <td className={`${tdR} border-b`} style={{ borderColor: ROW_SEP }}>
                  {fmtQty(it.quantity)}
                </td>
                <td className={`${tdR} border-b`} style={{ borderColor: ROW_SEP }}>
                  {m.money(it.unitPrice)}
                </td>
                <td className={`${tdR} border-b`} style={{ borderColor: ROW_SEP }}>
                  {it.discount > 0 ? `-${m.money(it.discount)}` : '—'}
                </td>
                <td className={`${tdR} border-b`} style={{ borderColor: ROW_SEP }}>
                  {m.money(it.taxableAmount)}
                </td>
                <td className={`${tdR} border-b`} style={{ borderColor: ROW_SEP }}>
                  {m.money(it.vatAmount)}
                  {m.rates.length > 1 ? (
                    <p className="text-[8pt]" style={{ color: MUTED }}>
                      {Math.round(it.vatPercent)}%
                    </p>
                  ) : null}
                </td>
                <td className={`${tdR} border-b font-bold`} style={{ borderColor: ROW_SEP }}>
                  {m.money(it.lineTotal)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Block F: closing group — words + bank (left) | totals (right) ────────────
// ONE unit: the planner never splits it across pages.
function ClosingGroup({ m }: { m: DocModel }) {
  const { inv, settings } = m
  const anyBank = Boolean(
    settings.bankName ||
      settings.bankIban ||
      settings.bankAccountNumber ||
      settings.bankAccountName ||
      settings.bankSwiftCode
  )
  return (
    <div className="grid grid-cols-5 gap-2 break-inside-avoid">
      {/* left column (60%): amount in words + bank details */}
      <div className="col-span-3 space-y-1.5">
        <div className="rounded-lg border p-[6px]" style={{ borderColor: BORDER, background: 'white' }}>
          <p
            className="flex flex-wrap items-center gap-x-2 gap-y-[0.3mm] text-[8.5pt] font-extrabold uppercase tracking-[0.3pt]"
            style={{ color: DARK_GOLD }}
          >
            Amount in Words
            <GoldDiamond size={4} />
            <span lang="ar" dir="rtl" className="tracking-normal">
              المبلغ كتابةً
            </span>
          </p>
          <p
            className="mt-[1.5px] break-words text-[8.5pt] font-semibold leading-snug"
            style={{ color: NAVY }}
          >
            {m.words.en}
          </p>
          <p
            lang="ar"
            dir="rtl"
            className="mt-[1px] break-words text-[8.5pt] font-semibold leading-snug"
            style={{ color: NAVY }}
          >
            {m.words.ar}
          </p>
        </div>

        <div className="rounded-lg border p-[6px]" style={{ borderColor: BORDER, background: 'white' }}>
          <p
            className="flex flex-wrap items-center gap-x-2 gap-y-[0.3mm] text-[8.5pt] font-extrabold uppercase tracking-[0.3pt]"
            style={{ color: DARK_GOLD }}
          >
            Bank Details
            <GoldDiamond size={4} />
            <span lang="ar" dir="rtl" className="tracking-normal">
              بيانات البنك
            </span>
          </p>
          {anyBank ? (
            <div className="mt-[1.5px] grid grid-cols-4 gap-x-3 gap-y-[2px] leading-[1.35]">
              <div>
                <p className="break-words text-[7.5pt] font-semibold leading-[1.4]" style={{ color: MUTED }}>
                  Account
                </p>
                <p className="break-words text-[9pt] font-semibold" style={{ color: NAVY }}>
                  {settings.bankAccountName || '—'}
                </p>
              </div>
              <div className="col-span-3">
                <p className="break-words text-[7.5pt] font-semibold leading-[1.4]" style={{ color: MUTED }}>
                  Bank
                </p>
                <p className="break-words text-[9pt] font-semibold" style={{ color: NAVY }}>
                  {settings.bankName || '—'}
                </p>
              </div>
              <div>
                <p className="break-words text-[7.5pt] font-semibold leading-[1.4]" style={{ color: MUTED }}>
                  A/C No.
                </p>
                <p className="break-all font-mono text-[9pt] font-semibold" style={{ color: NAVY }}>
                  {settings.bankAccountNumber || '—'}
                </p>
              </div>
              <div>
                <p className="break-words text-[7.5pt] font-semibold leading-[1.4]" style={{ color: MUTED }}>
                  SWIFT
                </p>
                <p className="break-all font-mono text-[9pt] font-semibold" style={{ color: NAVY }}>
                  {settings.bankSwiftCode || '—'}
                </p>
              </div>
              <div className="col-span-2">
                <p className="break-words text-[7.5pt] font-semibold leading-[1.4]" style={{ color: MUTED }}>
                  IBAN
                </p>
                <p className="break-all font-mono text-[9pt] font-semibold" style={{ color: NAVY }}>
                  {settings.bankIban || '—'}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-[8.5pt]" style={{ color: MUTED }}>
              —
            </p>
          )}
        </div>
      </div>

      {/* right column (40%): totals box */}
      <div className="col-span-2 rounded-lg border" style={{ borderColor: BORDER, background: 'white' }}>
        {(
          [
            ['Subtotal', 'المجموع', m.money(inv.subtotal)],
            ['Discount', 'الخصم', inv.totalDiscount > 0 ? `-${m.money(inv.totalDiscount)}` : m.money(0)],
            ['Taxable Amount', 'المبلغ الخاضع للضريبة', m.money(inv.taxableAmount)],
            [`VAT ${m.vatLabel}`.trim(), 'ضريبة القيمة المضافة', m.money(inv.vatAmount)],
          ] as Array<[string, string, string]>
        ).map(([en, ar, value], i) => (
          <div
            key={en}
            className={`flex flex-nowrap items-center justify-between gap-x-2 border-b px-2.5 ${i === 0 ? 'rounded-t-[7px] ' : ''}py-[3px] text-[9.5pt] leading-[1.3]`}
            style={{ borderColor: BORDER, background: LIGHT_BG }}
          >
            <span className="min-w-0 break-words text-right text-[7.5pt] font-semibold leading-[1.3]" style={{ color: MUTED }}>
              {en} <span lang="ar" dir="rtl">{ar}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums" style={{ color: NAVY }}>
              {value}
            </span>
          </div>
        ))}
        {/* TOTAL DUE — navy row, white label (EN over AR), gold amount */}
        <div
          className="flex flex-nowrap items-center justify-between gap-x-2 border-b px-2.5 py-[4px]"
          style={{ borderColor: BORDER, background: DARK_NAVY }}
        >
          <span className="min-w-0 text-[9.5pt] font-extrabold uppercase leading-[1.25] tracking-[0.3pt] text-white">
            Total Due
            <br />
            <span lang="ar" dir="rtl" className="tracking-normal normal-case">الإجمالي المستحق</span>
          </span>
          <span className="shrink-0 whitespace-nowrap text-[13pt] font-extrabold leading-[1.2] tabular-nums" style={{ color: LIGHT_GOLD }}>
            {m.money(inv.totalDue)}
          </span>
        </div>
        <div
          className="flex flex-nowrap items-center justify-between gap-x-2 border-b px-2.5 py-[3px] text-[9.5pt] leading-[1.3]"
          style={{ borderColor: BORDER, background: 'white' }}
        >
          <span className="min-w-0 text-[7.5pt] font-semibold" style={{ color: MUTED }}>
            Amount Paid <span lang="ar" dir="rtl">المدفوع</span>
          </span>
          <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums" style={{ color: NAVY }}>
            {m.money(inv.paidAmount)}
          </span>
        </div>
        <div
          className="flex flex-nowrap items-center justify-between gap-x-2 px-2.5 py-[4px] text-[9.5pt] leading-[1.3]"
          style={{ background: LIGHT_BG }}
        >
          <span className="min-w-0 font-bold" style={{ color: NAVY }}>
            Balance Due <span lang="ar" dir="rtl">الرصيد المستحق</span>
          </span>
          <span className="shrink-0 whitespace-nowrap font-extrabold tabular-nums" style={{ color: NAVY }}>
            {m.money(m.balanceDue)}
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Block G: signature row — QR | Receiver | Authorized | Stamp ──────────────
// ONE unit: the planner never splits it. Rendered on the LAST page only,
// pinned to the bottom of the flex column (directly above the note line).
function SignatureRow({ m }: { m: DocModel }) {
  const { inv, config } = m
  const receiver = inv.showReceiverSignature
  return (
    <div
      className={`grid items-stretch gap-[4mm] break-inside-avoid ${
        receiver
          ? 'grid-cols-[34mm_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]'
          : 'grid-cols-[34mm_minmax(0,1fr)_minmax(0,1fr)]'
      }`}
    >
      {/* ZATCA QR — exactly 30×30mm, pure black on white, 4-module quiet zone
          built into the PNG; fully inside the content area, never covered by
          the watermark (content layer sits above it). */}
      <div className="flex flex-col items-center">
        {m.qrDataUrl ? (
          <img
            src={m.qrDataUrl}
            alt="ZATCA QR code"
            className="block"
            style={{ width: '30mm', height: '30mm' }}
          />
        ) : (
          <div
            className="flex flex-col items-center justify-center gap-1 rounded border border-dashed p-2 text-center"
            style={{ width: '30mm', height: '30mm', borderColor: BORDER }}
          >
            <span className="text-[8pt] font-semibold" style={{ color: MUTED }}>
              QR appears
              <br />
              after issuing
            </span>
            <span lang="ar" dir="rtl" className="text-[8pt]" style={{ color: MUTED }}>
              يظهر الرمز بعد الإصدار
            </span>
          </div>
        )}
        {m.zatcaNotice ? (
          <p className="mt-[1px] max-w-[34mm] text-center text-[8pt] font-bold leading-tight text-red-700">
            {m.zatcaNotice}
          </p>
        ) : null}
        <p className="mt-[1px] text-center text-[8pt] leading-[1.4]" style={{ color: MUTED }}>
          Scan · <span lang="ar" dir="rtl">امسح للتحقق</span>
        </p>
      </div>

      {/* Receiver signature (only when enabled — the other boxes stay
          balanced on the 3-column grid when hidden) */}
      {receiver ? (
        <div className="flex flex-col">
          <p className="text-center text-[8.5pt] font-bold leading-[1.4]" style={{ color: NAVY }}>
            Receiver Signature
            <br />
            <span lang="ar" dir="rtl">توقيع المستلم</span>
          </p>
          <div className="min-h-[7mm] flex-1" />
          <div className="w-full border-t-2" style={{ borderColor: NAVY }} />
          <p className="mt-[1px] text-center text-[8pt] leading-[1.4]" style={{ color: MUTED }}>
            Name &amp; Date <span className="mx-0.5 text-[#6B7488]">|</span>{' '}
            <span lang="ar" dir="rtl">الاسم والتاريخ</span>
          </p>
        </div>
      ) : null}

      {/* Authorized signature — uploaded signature image (if any) sits on the line */}
      <div className="flex flex-col">
        <p className="text-center text-[8.5pt] font-bold leading-[1.4]" style={{ color: NAVY }}>
          Authorized Signature
          <br />
          <span lang="ar" dir="rtl">التوقيع المعتمد</span>
        </p>
        <div className="flex min-h-[7mm] flex-1 items-end justify-center">
          {config.signature ? (
            <img
              src={config.signature}
              alt="Authorized signature"
              className="block max-h-10 object-contain"
            />
          ) : null}
        </div>
        <div className="mt-[1px] w-full border-t-2" style={{ borderColor: NAVY }} />
        <p className="mt-[1px] text-center text-[8pt] leading-[1.4]" style={{ color: MUTED }}>
          Name &amp; Date <span className="mx-0.5 text-[#6B7488]">|</span>{' '}
          <span lang="ar" dir="rtl">الاسم والتاريخ</span>
        </p>
      </div>

      {/* Company stamp — dashed gold circle, per the template */}
      <div className="flex flex-col">
        <p className="text-center text-[8.5pt] font-bold leading-[1.4]" style={{ color: NAVY }}>
          Company Stamp
          <br />
          <span lang="ar" dir="rtl">ختم الشركة</span>
        </p>
        <div className="flex min-h-[7mm] flex-1 items-end justify-center">
          <div
            className="flex h-[17mm] w-[17mm] items-center justify-center overflow-hidden rounded-full border-2 border-dashed"
            style={{ borderColor: GOLD }}
          >
            {config.stamp ? (
              <img
                src={config.stamp}
                alt="Company stamp"
                className="h-[15mm] w-[15mm] object-contain"
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Block H: note line — the foot of EVERY page ─────────────────────────────
function NoteLine({
  m,
  page,
  of,
  dedicatedPageNo,
}: {
  m: DocModel
  page: number
  of: number
  /** the page number lives on the dedicated line just above the footer */
  dedicatedPageNo?: boolean
}) {
  return (
    <p
      className="break-words text-center text-[7.5pt] leading-snug"
      style={{ color: MUTED }}
    >
      {m.noteCompany} · <span className="font-mono">{m.inv.invoiceNumber}</span>
      {dedicatedPageNo ? null : (
        <>
          {' '}· Page {page} of {of}
          <span className="mx-1.5 text-[#6B7488]">/</span>
          <span lang="ar" dir="rtl" className="tracking-normal">
            صفحة {page} من {of}
          </span>
        </>
      )}
      {' '}· Printed {fmtDate(m.printedAt.toISOString())}
    </p>
  )
}

// ── Measure rig ─────────────────────────────────────────────────────────────
// Renders every block ONCE, hidden, at the exact content width of the ACTIVE
// letterhead path (194 mm legacy / 186 mm E-Invoice letterhead); the real DOM
// heights are read back after webfonts + images are ready and handed to the
// planner. The rig lives OUTSIDE .print-area, so it can never leak into the
// serialized print DOM. Re-measures whenever the model OR the resolved
// letterhead (→ content width / page-number flags) changes.
function MeasureRig({
  m,
  lh,
  onMeasured,
}: {
  m: DocModel
  lh: ResolvedLetterhead
  onMeasured: (m: DocModel, lh: ResolvedLetterhead, value: Measured) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const calRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLDivElement>(null)
  const contRef = useRef<HTMLDivElement>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef<HTMLDivElement>(null)
  const sigRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([])

  useLayoutEffect(() => {
    let cancelled = false
    const run = async () => {
      // webfonts first — Arabic metrics shift line heights
      try {
        await document.fonts.ready
      } catch {}
      const root = rootRef.current
      if (!root || cancelled) return
      // then every image in the rig (QR / signature / stamp data URLs)
      const imgs = [...root.querySelectorAll('img')]
      await Promise.all(
        imgs.map((im) =>
          im.complete
            ? undefined
            : new Promise<void>((r) => {
                im.onload = () => r()
                im.onerror = () => r()
              })
        )
      )
      // two frames for a stable layout after font/image swaps
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      if (cancelled || !rootRef.current) return
      const pxPerMm = (calRef.current?.getBoundingClientRect().height || 378) / 100
      const mm = (el: HTMLElement | null) =>
        el ? el.getBoundingClientRect().height / pxPerMm : 0
      const value = {
        headMm: mm(headRef.current),
        contMm: mm(contRef.current),
        tableMm: mm(tableRef.current),
        // slice to the current item count — ref slots left over from a
        // previous model must never leak into the plan
        rowsMm: rowRefs.current
          .slice(0, Math.max(m.items.length, m.items.length === 0 ? 1 : 0))
          .map((el) => mm(el)),
        closingMm: mm(closingRef.current),
        sigMm: mm(sigRef.current),
        noteMm: mm(noteRef.current),
      }
      onMeasured(m, lh, value)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [m, lh, onMeasured])

  return (
    <div
      ref={rootRef}
      aria-hidden
      data-print-measure-rig=""
      className="pointer-events-none absolute top-0"
      style={{
        left: '-10000px',
        width: `${lh.contentWMm}mm`,
        visibility: 'hidden',
        fontFamily: DOC_FONT,
      }}
    >
      <div ref={calRef} style={{ height: '100mm' }} />
      <div ref={headRef}>
        <InvoiceHead m={m} />
      </div>
      <div ref={contRef}>
        <ContinuationHeader m={m} page={2} of={2} dedicatedPageNo={lh.dedicatedPageNo} />
      </div>
      {/* fixed table overhead: border box + thead */}
      <div ref={tableRef}>
        <ItemsTable m={m} items={[]} pad={2} empty={false} />
      </div>
      {/* every row, measured individually */}
      <ItemsTable
        m={m}
        items={m.items}
        pad={2}
        empty={m.items.length === 0}
        rowRefs={(i, el) => {
          rowRefs.current[i] = el
        }}
      />
      <div ref={closingRef}>
        <div style={{ height: `${GAP_TABLE_CLOSING_MM}mm` }} />
        <ClosingGroup m={m} />
      </div>
      <div ref={sigRef}>
        <SignatureRow m={m} />
      </div>
      <div ref={noteRef}>
        <NoteLine m={m} page={1} of={1} dedicatedPageNo={lh.dedicatedPageNo} />
      </div>
    </div>
  )
}

// ── The document ────────────────────────────────────────────────────────────

export function EInvoiceDocument({
  invoice,
  config,
  settings,
  qrDataUrl,
  letterhead,
  eiLetterhead,
  withLetterhead = true,
}: {
  invoice: EInvoiceRow
  config: EInvoiceConfig
  settings: AppSettings
  qrDataUrl: string | null
  /** shared company letterhead (Settings → the letterhead manager) */
  letterhead?: LetterheadConfig | null
  /** the E-Invoice module's own letterhead (header / footer / watermark) */
  eiLetterhead?: EInvoiceLetterheadConfig | null
  /** "Print with letterhead" — false hides the artwork, keeps the margins */
  withLetterhead?: boolean
}) {
  const lh = useMemo(
    () => resolveLetterhead(config, letterhead, eiLetterhead, withLetterhead),
    [config, letterhead, eiLetterhead, withLetterhead]
  )
  const m = useMemo(
    () => buildModel(invoice, config, settings, qrDataUrl),
    [invoice, config, settings, qrDataUrl]
  )
  // measured heights, keyed by the model AND the resolved letterhead they
  // were measured at — a new model (different invoice/config/QR) or a new
  // letterhead (different content width) invalidates synchronously during
  // render, so a stale page plan is never shown
  const [measured, setMeasured] = useState<{
    m: DocModel
    lh: ResolvedLetterhead
    value: Measured
  } | null>(null)

  const handleMeasured = useCallback(
    (mm: DocModel, lhead: ResolvedLetterhead, value: Measured) =>
      setMeasured({ m: mm, lh: lhead, value }),
    []
  )

  const plan = useMemo(() => {
    if (!measured || measured.m !== m || measured.lh !== lh) return null
    // itemless invoice (an unsaved draft) always renders one page
    if (m.items.length === 0) return { pages: [[]] as number[][], compact: false }
    return planLayout(measured.value, PAGE_H_MM - lh.topPadMm - lh.bottomPadMm)
  }, [measured, m, lh])

  const columnStyle = {
    paddingTop: `${lh.topPadMm}mm`,
    paddingBottom: `${lh.bottomPadMm}mm`,
    paddingLeft: `${lh.sidePadMm}mm`,
    paddingRight: `${lh.sidePadMm}mm`,
  }

  return (
    <>
      <div
        className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:gap-0"
        style={{
          fontFamily: DOC_FONT,
          // keeps the print root measurable while the first layout pass runs
          minHeight: plan ? undefined : `${PAGE_H_MM}mm`,
        }}
      >
        {plan
          ? plan.pages.map((idxs, pageIdx) => {
              const isLast = pageIdx === plan.pages.length - 1
              const chunk = idxs.map((i) => m.items[i])
              return (
                <div
                  key={pageIdx}
                  className="doc-page relative shrink-0 overflow-hidden bg-white text-neutral-900 shadow-sm print:shadow-none"
                  style={{
                    width: `${PAGE_W_MM}mm`,
                    height: `${PAGE_H_MM}mm`,
                    breakAfter: isLast ? 'auto' : 'page',
                    breakInside: 'avoid',
                  }}
                >
                  {/* ── letterhead artwork (every page) ──
                      the E-Invoice's own bands → full-page override → shared
                      bands → nothing at all (the 45 mm / 25 mm zones stay
                      completely empty). "Print with letterhead" off → the
                      artwork is skipped but every margin stays the same. */}
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

                  {/* ── company watermark (every page) ── centered in the body
                      area, ≈120 mm wide, aspect ratio kept, BEHIND all body
                      content (above the letterhead artwork z-0, below the
                      content column z-10 — never on top of text) */}
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

                  {/* ── DRAFT watermark (drafts only — behind the content,
                      never above the QR which sits in the content layer) ── */}
                  {m.inv.status === 'draft' ? (
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

                  {/* ── page number — just above the footer band on EVERY page
                      (E-Invoice letterhead layout only; the legacy paths keep
                      the page number inside the note line / continuation
                      header exactly as before) ── */}
                  {lh.dedicatedPageNo ? (
                    <p
                      aria-hidden
                      className="pointer-events-none absolute left-0 right-0 z-[6] text-center text-[7.5pt] leading-snug tabular-nums"
                      style={{ bottom: `${lh.bottomBandMm + 1}mm`, color: MUTED }}
                    >
                      Page {pageIdx + 1} of {plan.pages.length}
                      <span className="mx-1.5 text-[#6B7488]">/</span>
                      <span lang="ar" dir="rtl" className="tracking-normal">
                        صفحة {pageIdx + 1} من {plan.pages.length}
                      </span>
                    </p>
                  ) : null}

                  {/* ── content column — a flex column of the full content
                      area: blocks at the top, flexible spacer, signature row
                      + note line pinned to the bottom on the last page ── */}
                  <div
                    className="absolute inset-0 z-10 flex flex-col [&>*]:shrink-0"
                    style={columnStyle}
                  >
                    {pageIdx === 0 ? (
                      <InvoiceHead m={m} />
                    ) : (
                      <ContinuationHeader
                        m={m}
                        page={pageIdx + 1}
                        of={plan.pages.length}
                        dedicatedPageNo={lh.dedicatedPageNo}
                      />
                    )}

                    <ItemsTable
                      m={m}
                      items={chunk}
                      pad={plan.compact ? 1.5 : 2}
                      empty={m.items.length === 0 && pageIdx === 0}
                    />

                    {isLast ? (
                      <>
                        <div style={{ height: `${GAP_TABLE_CLOSING_MM}mm` }} />
                        <ClosingGroup m={m} />
                      </>
                    ) : null}

                    {/* the flexible spacer — empty space goes BETWEEN the
                        closing group and the signature row, never below it */}
                    <div className="min-h-0 w-full" style={{ flex: '1 1 0' }} />

                    {isLast ? (
                      <>
                        <SignatureRow m={m} />
                        <div style={{ height: `${GAP_SIG_NOTE_MM}mm` }} />
                      </>
                    ) : null}

                    <NoteLine
                      m={m}
                      page={pageIdx + 1}
                      of={plan.pages.length}
                      dedicatedPageNo={lh.dedicatedPageNo}
                    />
                  </div>
                </div>
              )
            })
          : null}
      </div>
      {!plan ? <MeasureRig m={m} lh={lh} onMeasured={handleMeasured} /> : null}
    </>
  )
}

// ── Print dialog ────────────────────────────────────────────────────────────

/**
 * Full-screen dialog rendering the paginated A4 e-invoice. Parent supplies:
 * the full EInvoiceRow (items included), the e-invoice print config, the
 * E-Invoice letterhead config, the shared letterhead config and the ZATCA QR
 * data URL (null for the unsaved-draft preview → placeholder box). Print
 * button renders the server PDF (vector, headless Chromium) and prints that.
 * The "Print with letterhead" checkbox (default checked, reset on every
 * open) hides the header / footer / watermark artwork while keeping the
 * exact same margins — for pre-printed letterhead paper.
 */
export function EInvoicePrintDialog({
  invoice,
  config,
  letterhead,
  eiLetterhead,
  qrDataUrl,
  open,
  onOpenChange,
}: {
  invoice: EInvoiceRow | null
  config: EInvoiceConfig | null
  letterhead?: LetterheadConfig | null
  eiLetterhead?: EInvoiceLetterheadConfig | null
  qrDataUrl: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const [signedOpen, setSignedOpen] = useState(false)
  const [withLetterhead, setWithLetterhead] = useState(true)

  // "Print with letterhead" defaults to CHECKED on every open: the reset
  // happens on the CLOSE edge (event-handler context — every close path
  // routes through handleDialogOpenChange), so the next open always starts
  // checked, no matter how the dialog was closed before.
  function handleDialogOpenChange(v: boolean) {
    if (!v) setWithLetterhead(true)
    onOpenChange(v)
  }

  usePageRule(open, 'size: A4 portrait; margin: 0;')

  const isDraft = !invoice || invoice.id === 'draft'

  function handlePrint(anchor?: HTMLElement | null) {
    void printPrintArea(anchor ?? null)
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] print:static print:max-h-none print:w-full print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">E-Invoice print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable A4 bilingual tax invoice with letterhead, items, totals, ZATCA QR and signatures.
        </DialogDescription>

        {/* Top button bar — hidden when printing */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {invoice ? `E-Invoice — ${invoice.invoiceNumber}` : 'E-Invoice'}
              {isDraft && invoice ? (
                <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10pt] font-bold uppercase tracking-wider text-amber-700">
                  Draft preview
                </span>
              ) : null}
              {invoice && (invoice.zatcaPhase ?? 1) === 2 ? (
                <span className="ml-2 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10pt] font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                  Phase 2
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              A4 · Bilingual EN/AR · ZATCA QR
              {invoice ? ` · ${invoice.clientNameEn}` : ''}
              {invoice?.zatcaStatus
                ? ` · ZATCA ${invoice.zatcaStatus}${
                    invoice.zatcaSubmittedAt
                      ? ` (${new Date(invoice.zatcaSubmittedAt).toLocaleDateString('en-GB')})`
                      : ''
                  }`
                : ''}
            </p>
            {/* "Print with letterhead" — default checked. Unchecked → the
                header / footer / watermark artwork is hidden on screen AND in
                every output (browser print / PDF download) while every margin
                stays the same — for pre-printed letterhead paper. */}
            <label
              className="mt-1 inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium"
              title="Uncheck for pre-printed letterhead paper — the artwork is hidden but the layout stays identical"
            >
              <Checkbox
                checked={withLetterhead}
                onCheckedChange={(v) => setWithLetterhead(v === true)}
                aria-label="Print with letterhead"
              />
              Print with letterhead
            </label>
          </div>
          <div className="flex items-center gap-2">
            {invoice?.signedCopyImage ? (
              <Button variant="outline" size="sm" onClick={() => setSignedOpen(true)}>
                <Paperclip className="h-4 w-4" />
                Signed copy
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => handleDialogOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) =>
                void downloadPrintAreaAsPdf(
                  `E-Invoice-${invoice?.invoiceNumber ?? 'draft'}`,
                  e.currentTarget
                )
              }
              disabled={!invoice}
            >
              <FileDown className="h-4 w-4" />
              Download PDF
            </Button>
            <Button size="sm" onClick={(e) => handlePrint(e.currentTarget)} disabled={!invoice}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Scrollable preview area — stacked A4 pages */}
        <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900 print:flex-none print:overflow-visible print:bg-transparent print:p-0">
          {invoice ? (
            <EInvoiceDocument
              invoice={invoice}
              config={config ?? DEFAULT_EI_CONFIG}
              settings={settings}
              qrDataUrl={qrDataUrl}
              letterhead={letterhead}
              eiLetterhead={eiLetterhead}
              withLetterhead={withLetterhead}
            />
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-[#6B7488]">
              No e-invoice selected.
            </div>
          )}
        </div>

        {/* Signed copy preview (proof of delivery) */}
        {invoice?.signedCopyImage ? (
          <Dialog open={signedOpen} onOpenChange={setSignedOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogTitle className="text-base">
                Signed copy — {invoice.invoiceNumber}
              </DialogTitle>
              <DialogDescription>
                Signed / stamped delivery copy attached to this issued e-invoice.
              </DialogDescription>
              <div className="overflow-hidden rounded-lg border bg-white">
                <img
                  src={invoice.signedCopyImage}
                  alt={`Signed copy of ${invoice.invoiceNumber}`}
                  className="max-h-[60vh] w-full object-contain"
                />
              </div>
            </DialogContent>
          </Dialog>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}


