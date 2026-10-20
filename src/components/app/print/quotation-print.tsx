'use client'

// Quotation print preview — the boss's template design (upload/Quotation_Template.png)
// rendered as a multi-page A4 portrait business document.
//
//   • Navy/Gold chevron title bar — "QUOTATION" + gold subject subtitle on the
//     navy side; Quotation No / Date / Valid Until / Your Ref meta rows on the
//     gold side (slanted chevron edge).
//   • QUOTATION TO | PROJECT DETAILS boxes with the gold left accent bar.
//   • Items table with navy header + zebra rows. Hourly manpower columns
//     (TRADE | PER HOURS | RATE SAR + total-hours row) appear automatically
//     when the rate basis is present; generic quotations fall back to the
//     classic column set (Description / Qty / Unit / Unit Price / Line Total).
//   • Terms (auto-numbered) + totals box: Subtotal / VAT / TOTAL row
//     on solid gold / Contract Value (N months) / currency line.
//   • INCLUDED | EXCLUDED bullet boxes.
//   • APPROVED BY (Name / Designation / Date + dashed Company Stamp circle) |
//     ACCEPTED BY — CLIENT (+ dashed Client Stamp circle).
//
// Pagination model: EXPLICIT A4 pages (210 × 296.5mm — 0.5mm slack prevents
// blank interleaved pages in Chrome's print pipeline). Items are chunked with
// a conservative row-height estimator. The tail (terms|totals → included|
// excluded → signatures) then FLOWS block-by-block onto the last items page
// while it fits, and continues on a fresh page that starts at the TOP under a
// "Continued" strip — no stranded voids. Leftover room on each items page is
// given back to the table rows (capped stretch) so short documents fill the
// A4 nicely instead of leaving a hole. Every page repeats the table header,
// carries the letterhead artwork and a "Page X of Y" footer. Signature/stamp
// assets are absolutely positioned on the LAST page using percent-of-page
// coordinates saved per quotation — exactly reproducing the AssetPlacer canvas.
//
// Letterhead modes: 'none' (styled typed header) | 'header' | 'header_footer'
// | 'full' (full-page background). Content is padded inside the reserved
// top/bottom bands so it never overlaps the artwork.
import { Printer, FileSpreadsheet, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { amountInWords } from '@/lib/amount-words'
import { formatDate, formatMoney, formatNumber, round2 } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type {
  AppSettings,
  DocItemRow,
  LetterheadConfig,
  QuotationAssetRow,
  QuotationRow,
} from '@/lib/types'

/** Full quotation as returned by GET /api/quotations/[id] (items + client + assets). */
export type QuotationDetail = QuotationRow & {
  itemCount?: number
  client?: {
    id: string
    name: string
    contactPerson: string | null
    phone: string | null
    email: string | null
    address: string | null
    city: string | null
    crNumber: string | null
    vatNumber: string | null
  } | null
}

const DEFAULT_LETTERHEAD: LetterheadConfig = {
  mode: 'none',
  headerImage: null,
  footerImage: null,
  fullPageImage: null,
  showCompanyDetails: true,
  headerHeightMm: 30,
  footerHeightMm: 18,
}

export { DEFAULT_LETTERHEAD }

// ── Brand palette (same family as the E-Invoice module) ────────────────────
const NAVY = '#132A4A'
const DARK_NAVY = '#0C1D33'
const GOLD = '#C0934C'
const DARK_GOLD = '#8E6420'
const LIGHT_GOLD = '#E1B169'
const LIGHT_BG = '#F2F5FA'
const BORDER = '#DDE3EC'
const MUTED = '#6B7488'

// ── A4 pagination geometry ──────────────────────────────────────────────────
const PAGE_W_MM = 210
const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (see header comment)
const SIDE_PAD_MM = 12

// "Continued" strip reserved at the top of every page ≥ 2
const CONT_HEADER_MM = 12
// head-room required before a tail block may join the last items page
const PLACE_BUFFER_MM = 5
// slack kept in reserve when stretching rows (estimator safety)
const STRETCH_SAFE_MM = 5
// per-row stretch cap — keeps the stretched table tasteful
const MAX_ROW_STRETCH = 6.5
// items-table TOTAL row height
const TOTAL_ROW_MM = 8
// signatures + computer-generated line (calibrated against real prints)
const SIGNATURES_MM = 48
// a final page with this much slack gets the roomier signature treatment
const ROOMY_SLACK_MM = 70

type PageGeometry = {
  padTop: number
  padBottom: number
  page1Fixed: number
}

// page1Fixed values are calibrated against real Chrome A4 prints of this
// template (typed header ≈ 23mm + chevron ≈ 23mm + party boxes ≈ 35mm +
// items heading ≈ 7mm + inter-section margins). Over-reserving is safe
// (rows are themselves over-estimated); under-reserving clips content.
function geometryFor(letterhead: LetterheadConfig): PageGeometry {
  switch (letterhead.mode) {
    case 'full':
      return {
        padTop: letterhead.headerHeightMm + 4,
        padBottom: Math.max(letterhead.footerHeightMm + 4, 12),
        page1Fixed: 87,
      }
    case 'header':
      return {
        padTop: letterhead.headerHeightMm + 3,
        padBottom: 12,
        page1Fixed: 87,
      }
    case 'header_footer':
      return {
        padTop: letterhead.headerHeightMm + 3,
        padBottom: letterhead.footerHeightMm + 3,
        page1Fixed: 87,
      }
    default:
      return { padTop: 10, padBottom: 13, page1Fixed: 97 }
  }
}

/** Conservative table-row height estimate in mm (over-estimate = safe page breaks). */
function rowHeightMm(it: DocItemRow): number {
  const CHARS_PER_LINE = 46
  const SUB_CHARS_PER_LINE = 60
  const lines = Math.max(1, Math.ceil(it.description.length / CHARS_PER_LINE))
  const subLines = it.subText ? Math.max(1, Math.ceil(it.subText.length / SUB_CHARS_PER_LINE)) : 0
  return 7 + 4 * (lines - 1) + 3.5 * subLines
}

/** Wrapped line count for a text block at ~charsPerLine characters per line. */
function lineCount(text: string | null | undefined, charsPerLine: number): number {
  if (!text) return 0
  return text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.trim().length / charsPerLine)), 0)
}

/** Split a bullet-list text into trimmed non-empty lines. */
function bulletLines(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/**
 * Terms lines with automatic numbering — lines that already start with
 * "1." / "2)" keep their own number, plain lines get one assigned.
 */
function numberedTerms(terms: string): Array<{ n: string; text: string }> {
  const lines = terms
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  let auto = 0
  return lines.map((l) => {
    const m = /^(\d{1,2})[.)]\s*(.+)$/.exec(l)
    if (m) return { n: `${m[1]}.`, text: m[2] }
    auto += 1
    return { n: `${auto}.`, text: l }
  })
}

/** Tail sections that flow after the items table, in document order. */
type TailBlock = 'termsTotals' | 'incExc' | 'signatures'

/** One explicit A4 page: its item chunk, stretched row height and tail blocks. */
type PagePlan = {
  items: DocItemRow[]
  /** extra mm given to every item row on this page (fills the A4 nicely) */
  rowExtraMm: number
  /** tail blocks rendered on this page, in order */
  blocks: TailBlock[]
  /** final page with lots of slack → roomier signature area */
  roomy: boolean
}

/**
 * Flow-fill pagination:
 *   1. chunk items across pages (conservative row estimates → safe breaks);
 *   2. flow the tail blocks, in order, onto the last items page while they
 *      fit (with a placement buffer); the rest continues on a fresh page
 *      that starts at the TOP — signatures never strand alone on a page;
 *   3. hand each page's leftover room back to its item rows (capped), so
 *      pages fill nicely instead of ending two-thirds down;
 *   4. flag a sparse final page so the signature area can breathe.
 */
function planPages(
  items: DocItemRow[],
  geo: PageGeometry,
  tail: { termsTotals: number; incExc: number; hasIncExc: boolean }
): PagePlan[] {
  const availFirst = PAGE_H_MM - geo.padTop - geo.padBottom - geo.page1Fixed
  const availRest = PAGE_H_MM - geo.padTop - geo.padBottom - CONT_HEADER_MM

  // 1) chunk items
  const chunks: DocItemRow[][] = []
  let cur: DocItemRow[] = []
  let used = 0
  let limit = availFirst
  for (const it of items) {
    const h = rowHeightMm(it)
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

  // 2) flow tail blocks onto the last items page while they fit
  const cap = chunks.length === 1 ? availFirst : availRest
  const blockH: Record<TailBlock, number> = {
    termsTotals: tail.termsTotals,
    incExc: tail.incExc,
    signatures: SIGNATURES_MM,
  }
  const order: TailBlock[] = [
    'termsTotals',
    ...(tail.hasIncExc ? (['incExc'] as TailBlock[]) : []),
    'signatures',
  ]
  const blocks: TailBlock[] = []
  const deferred: TailBlock[] = []
  let flowing = true
  for (const b of order) {
    if (flowing && used + TOTAL_ROW_MM + blockH[b] + PLACE_BUFFER_MM <= cap) {
      blocks.push(b)
      used += blockH[b]
    } else {
      flowing = false
      deferred.push(b)
    }
  }
  // signatures should not be stranded alone on a fresh page
  if (deferred.length === 1 && deferred[0] === 'signatures' && blocks.length > 0) {
    deferred.unshift(blocks.pop() as TailBlock)
  }

  const pages: PagePlan[] = chunks.map((c) => ({
    items: c,
    rowExtraMm: 0,
    blocks: [] as TailBlock[],
    roomy: false,
  }))
  pages[pages.length - 1].blocks = blocks
  if (deferred.length > 0) {
    pages.push({ items: [], rowExtraMm: 0, blocks: deferred, roomy: false })
  }

  // 3) give leftover room back to the rows (fills the A4 nicely)
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]
    if (p.items.length === 0) continue
    const pageCap = i === 0 ? availFirst : availRest
    const rowsMm = p.items.reduce((s, it) => s + rowHeightMm(it), 0) + TOTAL_ROW_MM
    const blocksMm = p.blocks.reduce((s, b) => s + blockH[b], 0)
    const slack = pageCap - rowsMm - blocksMm
    if (slack > STRETCH_SAFE_MM) {
      p.rowExtraMm = Math.min((slack - STRETCH_SAFE_MM) / p.items.length, MAX_ROW_STRETCH)
    }
  }

  // 4) sparse final page → roomier signature treatment
  const fin = pages[pages.length - 1]
  const finCap = pages.length === 1 ? availFirst : availRest
  const finRows =
    fin.items.reduce((s, it) => s + rowHeightMm(it), 0) + (fin.items.length ? TOTAL_ROW_MM : 0)
  const finBlocks = fin.blocks.reduce((s, b) => s + blockH[b], 0)
  fin.roomy = finCap - finRows - finBlocks > ROOMY_SLACK_MM

  return pages
}

/** Status stamp — rotated bordered chip on the document header. */
function StatusStamp({ status }: { status: string }) {
  const styles: Record<string, string> = {
    accepted:
      'border-emerald-600 text-emerald-700 shadow-[inset_0_0_0_1.5px_rgba(5,150,105,0.35)]',
    sent: 'border-sky-600 text-sky-700 shadow-[inset_0_0_0_1.5px_rgba(2,132,199,0.35)]',
    rejected: 'border-rose-600 text-rose-700 shadow-[inset_0_0_0_1.5px_rgba(225,29,72,0.35)]',
    expired: 'border-amber-500 text-amber-600 shadow-[inset_0_0_0_1.5px_rgba(217,119,6,0.35)]',
    draft: 'border-neutral-500 text-neutral-600 shadow-[inset_0_0_0_1.5px_rgba(115,115,115,0.3)]',
  }
  const labels: Record<string, string> = {
    accepted: 'Accepted',
    sent: 'Sent',
    rejected: 'Rejected',
    expired: 'Expired',
    draft: 'Draft',
  }
  return (
    <span
      className={`inline-block -rotate-6 rounded-md border-[3px] bg-white/85 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-[0.2em] ${styles[status] ?? styles.draft}`}
    >
      {labels[status] ?? status}
    </span>
  )
}

/**
 * Full-screen dialog rendering the paginated A4 quotation.
 * Purely presentational — the parent supplies the company letterhead config
 * (fetched in its open/preview event handlers) and the quotation document.
 * Print button calls window.print() — only the `.print-area` is printed.
 */
export function QuotationPrintDialog({
  quotation,
  letterhead,
  open,
  onOpenChange,
}: {
  quotation: QuotationDetail | null
  letterhead?: LetterheadConfig | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const user = useAppStore((s) => s.user)

  usePageRule(open, 'size: A4 portrait; margin: 0;')

  const isDraft = !quotation || quotation.id === 'draft'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] print:static print:max-h-none print:w-full print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Quotation print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable A4 quotation with letterhead, chevron title bar, line items, totals, terms, signature and stamp.
        </DialogDescription>

        {/* Top button bar — hidden when printing */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {quotation ? `Quotation — ${quotation.quoteNumber}` : 'Quotation'}
              {isDraft && quotation ? (
                <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Draft preview
                </span>
              ) : null}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {quotation
                ? `${quotation.clientName} · ${formatMoney(quotation.total, settings.currency || 'SAR')}`
                : 'Select a quotation to preview the document'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isDraft ? (
              <Button variant="outline" size="sm" asChild>
                <a href={`/api/quotations/${quotation?.id}/excel`} download>
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </a>
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button size="sm" onClick={() => window.print()} disabled={!quotation}>
              <Printer className="h-4 w-4" />
              Print / Save as PDF
            </Button>
          </div>
        </div>

        {/* Scrollable preview area — stacked A4 pages */}
        <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900 print:flex-none print:overflow-visible print:bg-transparent print:p-0">
          {quotation ? (
            <QuotationDocument
              quotation={quotation}
              letterhead={letterhead ?? DEFAULT_LETTERHEAD}
              settings={settings}
              preparedBy={user?.name ?? ''}
            />
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-neutral-400">
              No quotation selected.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── The document ────────────────────────────────────────────────────────────

export function QuotationDocument({
  quotation,
  letterhead,
  settings,
  preparedBy,
}: {
  quotation: QuotationDetail
  letterhead: LetterheadConfig
  settings: AppSettings
  preparedBy: string
}) {
  const currency = settings.currency || 'SAR'
  const q = quotation
  const companyName = settings.companyName || 'Landmark Inter Gulf'
  const client = q.client
  const vatPercent = Math.round(q.vatRate * 100)
  const items = q.items ?? []
  const assets = (q.assets ?? []).filter((a) => a.visible)
  const netTotal = round2(q.subtotal - q.discount)
  const money = (n: number) => formatNumber(n) // template style: plain numbers — SAR lives in headers only
  const geo = geometryFor(letterhead)

  // Template columns appear when any line carries the rate basis
  const hasRateBasis = items.some((it) => it.ratePerHour != null || it.hoursPerMonth != null)
  const showDiscountCol = items.some((it) => (it.discount ?? 0) > 0) || q.discount > 0
  const totalHours = round2(items.reduce((s, it) => s + (it.hoursPerMonth ?? 0), 0))
  const inclusions = bulletLines(q.inclusions)
  const exclusions = bulletLines(q.exclusions)
  const terms = q.terms ? numberedTerms(q.terms) : []
  const contractMonths = q.contractMonths && q.contractMonths > 0 ? q.contractMonths : null
  const contractValue = contractMonths ? round2(q.total * contractMonths) : null
  const subjectLine = (q.subject || 'Manpower Supply Proposal').toUpperCase()

  // Tail block heights — calibrated against real Chrome A4 prints (kept a
  // touch generous so page breaks stay safe), fed to the flow-fill paginator.
  const termsLines = terms.reduce((n, t) => n + lineCount(t.text, 66), 0)
  const notesLines = lineCount(q.notes, 66)
  const termsBoxMm = 11.4 + termsLines * 4.2 + (q.notes ? 12.8 + notesLines * 4.2 : 0)
  const totalsBoxMm = (2 + (q.discount > 0 ? 2 : 0) + (contractMonths ? 1 : 0)) * 6.2 + 21
  const hasIncExc = inclusions.length > 0 || exclusions.length > 0
  const incLines = inclusions.reduce((n, l) => n + lineCount(l, 64), 0)
  const excLines = exclusions.reduce((n, l) => n + lineCount(l, 64), 0)
  const plans = planPages(items, geo, {
    termsTotals: Math.max(termsBoxMm, totalsBoxMm) + 10.5,
    incExc: 13.7 + Math.max(incLines, excLines) * 3.4,
    hasIncExc,
  })
  // The last page that actually carries items — the table's TOTAL row goes there
  const lastItemsPageIdx = plans.reduce((acc, p, i) => (p.items.length > 0 ? i : acc), 0)

  // Shared box style: gold left accent + light background (template boxes)
  const boxCls = 'rounded-[4px] border border-l-[1.4mm] p-[3mm]'
  const boxStyle = { borderColor: BORDER, borderLeftColor: GOLD, background: LIGHT_BG }
  const boxHeaderCls =
    'text-[8.5px] font-extrabold uppercase tracking-[0.22em]'

  const metaRows: Array<[string, string, boolean]> = [
    ['Quotation No.', q.quoteNumber, true],
    ['Date', formatDate(q.issueDate), false],
    ['Valid Until', q.validityDate ? formatDate(q.validityDate) : '—', false],
    ['Your Ref.', q.referenceNo || '—', true],
  ]

  // Project box rows (falls back to subject/notes context when unused)
  const projectRows: Array<[string, string]> = []
  if (q.projectName) projectRows.push(['Project', q.projectName])
  if (q.projectLocation) projectRows.push(['Location', q.projectLocation])
  if (q.contractPeriod) projectRows.push(['Contract Period', q.contractPeriod])
  if (q.mobilization) projectRows.push(['Mobilization', q.mobilization])
  if (projectRows.length === 0 && q.subject) projectRows.push(['Subject', q.subject])

  const thCls =
    'px-1.5 py-[5px] text-left align-middle font-extrabold uppercase tracking-[0.07em] text-white'
  const tdCls = 'px-1.5 py-[4.5px] align-top'

  return (
    <div className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:gap-0">
      {plans.map((plan, pageIdx) => {
        const chunk = plan.items
        const isLast = pageIdx === plans.length - 1
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
            {/* ── letterhead artwork ── */}
            {letterhead.mode === 'full' && letterhead.fullPageImage ? (
              <img
                src={letterhead.fullPageImage}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 h-full w-full object-fill"
              />
            ) : null}
            {letterhead.mode !== 'none' && letterhead.mode !== 'full' && letterhead.headerImage ? (
              <img
                src={letterhead.headerImage}
                alt=""
                aria-hidden
                className="pointer-events-none absolute left-0 top-0 w-full object-fill"
                style={{ height: `${letterhead.headerHeightMm}mm` }}
              />
            ) : null}
            {letterhead.mode === 'header_footer' && letterhead.footerImage ? (
              <img
                src={letterhead.footerImage}
                alt=""
                aria-hidden
                className="pointer-events-none absolute bottom-0 left-0 w-full object-fill"
                style={{ height: `${letterhead.footerHeightMm}mm` }}
              />
            ) : null}

            {/* ── content ── */}
            <div
              className="absolute inset-x-0 top-0 flex flex-col"
              style={{
                paddingTop: `${geo.padTop}mm`,
                paddingBottom: `${geo.padBottom}mm`,
                paddingLeft: `${SIDE_PAD_MM}mm`,
                paddingRight: `${SIDE_PAD_MM}mm`,
                height: '100%',
              }}
            >
              {pageIdx === 0 ? (
                <>
                  {/* typed header for 'none' mode */}
                  {letterhead.mode === 'none' ? (
                    <header className="flex items-start justify-between gap-3 border-b-2 pb-2" style={{ borderColor: NAVY }}>
                      <div className="flex items-start gap-3">
                        <img
                          src={settings.logo ?? '/logo-mark.png'}
                          alt={`${companyName} logo`}
                          className="h-[13mm] w-[13mm] shrink-0 object-contain"
                        />
                        <div className="min-w-0">
                          <h2 className="text-[15px] font-extrabold uppercase tracking-wide" style={{ color: NAVY }}>
                            {companyName}
                          </h2>
                          {letterhead.showCompanyDetails && settings.address ? (
                            <p className="mt-0.5 max-w-[100mm] text-[8.5px] leading-relaxed" style={{ color: MUTED }}>
                              {settings.address}
                            </p>
                          ) : null}
                          {letterhead.showCompanyDetails ? (
                            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[8.5px]" style={{ color: MUTED }}>
                              {settings.phone ? <span>Tel: {settings.phone}</span> : null}
                              {settings.email ? <span>Email: {settings.email}</span> : null}
                              {settings.vatNumber ? <span>VAT: {settings.vatNumber}</span> : null}
                              {settings.crNumber ? <span>CR: {settings.crNumber}</span> : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5 pt-1">
                        <StatusStamp status={q.status} />
                      </div>
                    </header>
                  ) : (
                    /* artwork modes: status stamp floats right, clear of the artwork */
                    <div className="flex justify-end pb-1">
                      <StatusStamp status={q.status} />
                    </div>
                  )}

                  {/* ── chevron title bar (navy + gold) ──
                      min-h keeps the bar tall enough for the 4 meta rows
                      (line-boxes ≈ 16mm + gaps) — without it the rows
                      overflowed the chevron and the clip-path sliced the
                      first (Quotation No.) and last (Your Ref.) rows. */}
                  <div
                    className="relative mt-2.5 flex min-h-[23mm] overflow-hidden rounded-[3px]"
                    style={{ background: NAVY }}
                  >
                    {/* navy side — title + subject subtitle */}
                    <div className="flex min-w-0 flex-1 flex-col justify-center py-[3mm] pl-[4mm] pr-[66mm]">
                      <p className="text-[23px] font-extrabold uppercase leading-none tracking-[0.16em] text-white">
                        Quotation
                      </p>
                      <p
                        className="mt-[1.6mm] text-[8.5px] font-bold uppercase leading-none tracking-[0.24em]"
                        style={{ color: LIGHT_GOLD }}
                      >
                        {subjectLine}
                      </p>
                    </div>
                    {/* gold chevron side — meta rows (slanted left edge reveals the navy) */}
                    <div
                      className="absolute inset-y-0 right-0 w-[62mm] py-[2.2mm] pl-[10mm] pr-[3.5mm]"
                      style={{
                        background: `linear-gradient(115deg, ${GOLD} 0%, ${LIGHT_GOLD} 55%, ${GOLD} 100%)`,
                        clipPath: 'polygon(7mm 0%, 100% 0%, 100% 100%, 0% 100%)',
                      }}
                    >
                      <div className="flex h-full flex-col justify-center gap-[1.2mm]">
                        {metaRows.map(([label, value, mono]) => (
                          <div key={label} className="flex items-baseline justify-between gap-2">
                            <span className="text-[8px] font-semibold uppercase leading-[1.25] tracking-[0.06em] text-white/85">
                              {label}
                            </span>
                            <span
                              className={`text-[9.5px] font-bold leading-[1.25] text-white ${mono ? 'font-mono' : 'tabular-nums'}`}
                            >
                              {value}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ── QUOTATION TO | PROJECT DETAILS ── */}
                  <div className="mt-[3mm] grid grid-cols-2 gap-[3mm]">
                    <div className={boxCls} style={boxStyle}>
                      <p className={boxHeaderCls} style={{ color: DARK_GOLD }}>
                        Quotation To
                      </p>
                      <p className="mt-[1.4mm] text-[12.5px] font-bold leading-tight" style={{ color: NAVY }}>
                        {q.clientName}
                      </p>
                      <dl className="mt-[1.2mm] space-y-[1.4mm]">
                        {client?.contactPerson ? (
                          <div className="flex items-baseline gap-[2mm]">
                            <dt className="w-[17mm] shrink-0 text-[8.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: MUTED }}>
                              Attention
                            </dt>
                            <dd className="text-[9.5px] font-semibold leading-snug" style={{ color: DARK_NAVY }}>
                              {client.contactPerson}
                            </dd>
                          </div>
                        ) : null}
                        {client?.address || client?.city ? (
                          <div className="flex items-baseline gap-[2mm]">
                            <dt className="w-[17mm] shrink-0 text-[8.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: MUTED }}>
                              Address
                            </dt>
                            <dd className="text-[9.5px] leading-snug text-neutral-700">
                              {[client?.address, client?.city].filter(Boolean).join(', ')}
                            </dd>
                          </div>
                        ) : null}
                        {client?.phone || client?.email ? (
                          <div className="flex items-baseline gap-[2mm]">
                            <dt className="w-[17mm] shrink-0 text-[8.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: MUTED }}>
                              Contact
                            </dt>
                            <dd className="text-[9.5px] leading-snug text-neutral-700">
                              {[client?.phone, client?.email].filter(Boolean).join(' · ')}
                            </dd>
                          </div>
                        ) : null}
                        {client?.crNumber || client?.vatNumber ? (
                          <div className="flex items-baseline gap-[2mm]">
                            <dt className="w-[17mm] shrink-0 text-[8.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: MUTED }}>
                              CR / VAT
                            </dt>
                            <dd className="text-[9px] leading-snug" style={{ color: MUTED }}>
                              {client.crNumber ? `CR No: ${client.crNumber}` : ''}
                              {client.crNumber && client.vatNumber ? ' · ' : ''}
                              {client.vatNumber ? `VAT No: ${client.vatNumber}` : ''}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>

                    <div className={boxCls} style={boxStyle}>
                      <p className={boxHeaderCls} style={{ color: DARK_GOLD }}>
                        Project Details
                      </p>
                      {projectRows.length > 0 ? (
                        <dl className="mt-[1.4mm] space-y-[1.4mm]">
                          {projectRows.map(([label, value]) => (
                            <div key={label} className="flex items-baseline gap-2">
                              <dt className="w-[26mm] shrink-0 text-[9px] font-semibold uppercase tracking-[0.04em]" style={{ color: MUTED }}>
                                {label}
                              </dt>
                              <dd className="text-[10px] font-semibold leading-snug" style={{ color: NAVY }}>
                                {value}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="mt-[1.4mm] text-[10px]" style={{ color: MUTED }}>
                          As per the attached scope of work.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* items table heading */}
                  <h3
                    className="mb-[1.2mm] mt-[3mm] text-[8.5px] font-extrabold uppercase tracking-[0.18em]"
                    style={{ color: MUTED }}
                  >
                    {hasRateBasis ? 'Manpower Hourly Rates \u2014 SAR' : 'Manpower Rates \u2014 Monthly Amounts'}
                  </h3>
                </>
              ) : (
                /* continuation strip on EVERY later page — items or tail-only */
                <div
                  className="mb-[3mm] flex items-center justify-between gap-3 border-b-2 pb-[1.8mm]"
                  style={{ borderColor: NAVY }}
                >
                  <div className="flex min-w-0 items-center gap-[2.5mm]">
                    {letterhead.mode === 'none' ? (
                      <img
                        src={settings.logo ?? '/logo-mark.png'}
                        alt=""
                        aria-hidden
                        className="h-[8mm] w-[8mm] shrink-0 object-contain"
                      />
                    ) : null}
                    <p
                      className="truncate text-[11px] font-extrabold uppercase tracking-[0.12em]"
                      style={{ color: NAVY }}
                    >
                      {companyName} — Quotation <span className="font-mono">{q.quoteNumber}</span>
                      <span className="mx-[2mm] font-normal" style={{ color: MUTED }}>
                        ·
                      </span>
                      <span
                        className="font-semibold normal-case tracking-normal"
                        style={{ color: DARK_NAVY }}
                      >
                        {q.clientName}
                      </span>
                    </p>
                  </div>
                  <p
                    className="shrink-0 rounded-[2px] px-[2mm] py-[0.7mm] text-[7.5px] font-bold uppercase tracking-[0.22em] text-white"
                    style={{ background: GOLD }}
                  >
                    Continued
                  </p>
                </div>
              )}

              {/* items chunk — thead repeats on every page (tail-only pages skip the table) */}
              {chunk.length > 0 || pageIdx === 0 ? (
                <table className="w-full border-collapse text-[10px]">
                  <thead>
                    <tr style={{ background: NAVY }}>
                      <th className={`${thCls} w-[8mm] text-center`}>#</th>
                      {hasRateBasis ? (
                        <>
                          {/* hourly manpower rate card — the boss's column set */}
                          <th className={thCls}>Trade</th>
                          <th className={`${thCls} w-[38mm] text-center`}>Per Hours</th>
                          <th className={`${thCls} w-[42mm] text-right`}>Rate (SAR)</th>
                        </>
                      ) : (
                        <>
                          <th className={thCls}>Description of Goods / Services</th>
                          <th className={`${thCls} w-[15mm] text-center`}>Qty</th>
                          <th className={`${thCls} w-[16mm]`}>Unit</th>
                          <th className={`${thCls} w-[24mm] text-right`}>Unit Price</th>
                          {showDiscountCol ? (
                            <th className={`${thCls} w-[16mm] text-right`}>Disc.</th>
                          ) : null}
                          <th className={`${thCls} w-[25mm] text-right`}>Line Total</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {chunk.length === 0 ? (
                      <tr>
                        <td
                          className={`${tdCls} text-center`}
                          style={{ color: MUTED }}
                          colSpan={hasRateBasis ? 4 : showDiscountCol ? 7 : 6}
                        >
                          No line items yet
                        </td>
                      </tr>
                    ) : (
                      chunk.map((it, i) => (
                        <tr
                          key={it.id ?? `${it.sr}-${it.description.slice(0, 12)}`}
                          className="break-inside-avoid"
                          style={{
                            background: i % 2 === 1 ? LIGHT_BG : '#FFFFFF',
                            borderBottom: `0.3mm solid ${BORDER}`,
                            // flow-fill: leftover page room → taller, airier rows
                            ...(plan.rowExtraMm > 0.4
                              ? { height: `${rowHeightMm(it) + plan.rowExtraMm}mm` }
                              : null),
                          }}
                        >
                          <td className={`${tdCls} text-center tabular-nums`} style={{ color: MUTED }}>
                            {it.sr}
                          </td>
                          {hasRateBasis ? (
                            <>
                              <td className={tdCls}>
                                <p className="text-[10.5px] font-bold" style={{ color: DARK_NAVY }}>
                                  {it.description}
                                </p>
                                {it.subText ? (
                                  <p className="mt-px text-[8.5px] italic" style={{ color: MUTED }}>
                                    {it.subText}
                                  </p>
                                ) : null}
                              </td>
                              <td className={`${tdCls} text-center text-[10.5px] tabular-nums`}>
                                {it.hoursPerMonth != null ? it.hoursPerMonth.toLocaleString('en-US') : '—'}
                              </td>
                              <td
                                className={`${tdCls} text-right text-[10.5px] font-bold tabular-nums`}
                                style={{ color: DARK_NAVY }}
                              >
                                {it.ratePerHour != null ? money(it.ratePerHour) : '—'}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className={tdCls}>
                                <p className="text-[10.5px] font-bold" style={{ color: DARK_NAVY }}>
                                  {it.description}
                                </p>
                                {it.subText ? (
                                  <p className="mt-px text-[8.5px] italic" style={{ color: MUTED }}>
                                    {it.subText}
                                  </p>
                                ) : null}
                              </td>
                              <td className={`${tdCls} text-center tabular-nums font-semibold`}>
                                {it.quantity.toLocaleString('en-US')}
                              </td>
                              <td className={tdCls}>{it.unit ?? '—'}</td>
                              <td className={`${tdCls} text-right tabular-nums`}>{money(it.unitPrice)}</td>
                              {showDiscountCol ? (
                                <td className={`${tdCls} text-right tabular-nums`}>
                                  {(it.discount ?? 0) > 0 ? `-${money(it.discount ?? 0)}` : '—'}
                                </td>
                              ) : null}
                              <td className={`${tdCls} text-right font-bold tabular-nums`} style={{ color: DARK_NAVY }}>
                                {money(it.lineTotal)}
                              </td>
                            </>
                          )}
                        </tr>
                      ))
                    )}
                    {/* total row on the last items chunk — hourly quotes total
                        the PER HOURS column (money totals live in the totals box) */}
                    {chunk.length > 0 && pageIdx === lastItemsPageIdx ? (
                      <tr
                        className="break-inside-avoid"
                        style={{ background: LIGHT_BG, borderTop: `0.6mm solid ${NAVY}` }}
                      >
                        {hasRateBasis ? (
                          <>
                            <td className={tdCls} />
                            <td
                              className={`${tdCls} text-[10.5px] font-extrabold uppercase tracking-wide`}
                              style={{ color: NAVY }}
                            >
                              Total Hours
                            </td>
                            <td
                              className={`${tdCls} text-center font-extrabold tabular-nums`}
                              style={{ color: NAVY }}
                            >
                              {totalHours.toLocaleString('en-US')}
                            </td>
                            <td className={tdCls} />
                          </>
                        ) : (
                          <>
                            <td className={tdCls} />
                            <td
                              className={`${tdCls} text-[10.5px] font-extrabold uppercase tracking-wide`}
                              style={{ color: NAVY }}
                            >
                              Total Amount
                            </td>
                            <td className={tdCls} />
                            <td className={tdCls} />
                            {showDiscountCol ? <td /> : null}
                            <td
                              className={`${tdCls} text-right font-extrabold tabular-nums`}
                              style={{ color: NAVY }}
                            >
                              {money(q.subtotal)}
                            </td>
                          </>
                        )}
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : null}

              {/* ── tail blocks — flow after the items table, page by page ── */}
              {plan.blocks.includes('termsTotals') ? (
                <>
                  {/* TERMS (left) | TOTALS box (right) */}
                  <section className="mt-[3.5mm] grid grid-cols-[1fr_86mm] items-start gap-[3mm]">
                    <div className={boxCls} style={boxStyle}>
                      <p className={boxHeaderCls} style={{ color: DARK_GOLD }}>
                        Terms &amp; Conditions
                      </p>
                      {terms.length > 0 ? (
                        <ol className="mt-[1.4mm] space-y-[1mm]">
                          {terms.map((t) => (
                            <li key={`${t.n}-${t.text.slice(0, 12)}`} className="flex gap-[1.5mm] text-[9px] leading-snug text-neutral-700">
                              <span className="shrink-0 font-bold" style={{ color: DARK_GOLD }}>
                                {t.n}
                              </span>
                              <span>{t.text}</span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className="mt-[1.4mm] text-[9px]" style={{ color: MUTED }}>
                          As mutually agreed between the parties.
                        </p>
                      )}
                      {q.notes ? (
                        <div className="mt-[2mm] border-t pt-[1.5mm]" style={{ borderColor: BORDER }}>
                          <p className={boxHeaderCls} style={{ color: MUTED }}>
                            Notes
                          </p>
                          <p className="mt-[1mm] whitespace-pre-line text-[9px] leading-snug text-neutral-700">
                            {q.notes}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <div className="overflow-hidden rounded-[4px] border" style={{ borderColor: BORDER }}>
                      {/* rows */}
                      <div className="flex items-center justify-between border-b px-3 py-[1.6mm] text-[9.5px]" style={{ borderColor: BORDER, background: '#FFFFFF' }}>
                        <span className="text-neutral-700">
                          Subtotal <span style={{ color: MUTED }}>(excl. VAT)</span>
                        </span>
                        <span className="font-semibold tabular-nums">{money(q.subtotal)}</span>
                      </div>
                      {q.discount > 0 ? (
                        <div className="flex items-center justify-between border-b px-3 py-[1.6mm] text-[9.5px]" style={{ borderColor: BORDER, background: '#FFFFFF' }}>
                          <span className="text-neutral-700">Discount</span>
                          <span className="font-semibold tabular-nums text-rose-700">-{money(q.discount)}</span>
                        </div>
                      ) : null}
                      {q.discount > 0 ? (
                        <div className="flex items-center justify-between border-b px-3 py-[1.6mm] text-[9.5px]" style={{ borderColor: BORDER, background: '#FFFFFF' }}>
                          <span className="text-neutral-700">Net Amount</span>
                          <span className="font-semibold tabular-nums">{money(netTotal)}</span>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between border-b px-3 py-[1.6mm] text-[9.5px]" style={{ borderColor: BORDER, background: '#FFFFFF' }}>
                        <span className="text-neutral-700">VAT ({vatPercent}%)</span>
                        <span className="font-semibold tabular-nums">{money(q.vatAmount)}</span>
                      </div>
                      {/* TOTAL row — solid gold, the template's highlight */}
                      <div
                        className="flex items-center justify-between px-3 py-[2.2mm] text-white"
                        style={{ background: `linear-gradient(115deg, ${GOLD} 0%, ${LIGHT_GOLD} 55%, ${GOLD} 100%)` }}
                      >
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.08em]">
                          Total incl. VAT
                        </span>
                        <span className="text-[13px] font-extrabold tabular-nums">{money(q.total)}</span>
                      </div>
                      {contractMonths && contractValue != null ? (
                        <div className="flex items-center justify-between border-b px-3 py-[1.6mm] text-[9.5px]" style={{ borderColor: BORDER, background: LIGHT_BG }}>
                          <span className="font-semibold text-neutral-700">
                            Contract Value ({contractMonths} Months) incl. VAT
                          </span>
                          <span className="font-extrabold tabular-nums" style={{ color: NAVY }}>
                            {money(contractValue)}
                          </span>
                        </div>
                      ) : null}
                      <div className="px-3 py-[1.4mm] text-center text-[8.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: MUTED, background: '#FFFFFF' }}>
                        Currency: Saudi Riyal ({currency})
                      </div>
                    </div>
                  </section>

                  <p className="mt-[1.6mm] text-[8.5px] italic leading-snug" style={{ color: MUTED }}>
                    <span className="font-semibold not-italic uppercase tracking-wide">Amount in words:</span>{' '}
                    {amountInWords(q.total, currency)}
                  </p>
                </>
              ) : null}

              {/* INCLUDED | EXCLUDED — breathes a little more on a sparse
                  final page (roomy) so the top of the page carries weight */}
              {plan.blocks.includes('incExc') ? (
                    <section
                      className={`mt-[2.5mm] grid grid-cols-2 gap-[3mm] ${plan.roomy ? 'gap-y-[1mm]' : ''}`}
                    >
                      <div className={plan.roomy ? 'rounded-[4px] border border-l-[1.4mm] p-[4.5mm]' : boxCls} style={boxStyle}>
                        <p className={boxHeaderCls} style={{ color: DARK_GOLD }}>
                          Included
                        </p>
                        {inclusions.length > 0 ? (
                          <ul className={`mt-[1.2mm] ${plan.roomy ? 'space-y-[1.8mm]' : 'space-y-[0.8mm]'}`}>
                            {inclusions.map((l) => (
                              <li key={l} className="flex gap-[1.5mm] text-[9px] leading-snug text-neutral-700">
                                <span className="mt-[0.7mm] h-[1.4mm] w-[1.4mm] shrink-0 rounded-full" style={{ background: GOLD }} />
                                <span>{l}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-[1.2mm] text-[9px]" style={{ color: MUTED }}>—</p>
                        )}
                      </div>
                      <div className={plan.roomy ? 'rounded-[4px] border border-l-[1.4mm] p-[4.5mm]' : boxCls} style={boxStyle}>
                        <p className={boxHeaderCls} style={{ color: DARK_GOLD }}>
                          Excluded
                        </p>
                        {exclusions.length > 0 ? (
                          <ul className={`mt-[1.2mm] ${plan.roomy ? 'space-y-[1.8mm]' : 'space-y-[0.8mm]'}`}>
                            {exclusions.map((l) => (
                              <li key={l} className="flex gap-[1.5mm] text-[9px] leading-snug text-neutral-700">
                                <span className="mt-[0.7mm] h-[1.4mm] w-[1.4mm] shrink-0 rounded-full" style={{ background: MUTED }} />
                                <span>{l}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-[1.2mm] text-[9px]" style={{ color: MUTED }}>—</p>
                        )}
                      </div>
                    </section>
              ) : null}

              {/* SIGNATURES — APPROVED BY | ACCEPTED BY (dashed stamp circles).
                  mt-auto pins them to the foot of the page; on a sparse final
                  page (roomy) the signature lines and stamp circles grow so the
                  bottom of the document carries more presence. */}
              {plan.blocks.includes('signatures') ? (
                <div className="mt-auto" style={{ paddingTop: plan.roomy ? '10mm' : '4mm' }}>
                  <section className="grid grid-cols-2 gap-[6mm]">
                    <div className="rounded-[4px] border p-[3mm]" style={{ borderColor: BORDER }}>
                      <p className={boxHeaderCls} style={{ color: DARK_GOLD }}>
                        Approved By &mdash; {companyName}
                      </p>
                      <div className="mt-[2.5mm] flex items-end justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-[1.6mm]">
                          <div className="border-b border-neutral-500" style={{ height: plan.roomy ? '12.5mm' : '9mm' }} />
                          <p className="text-[9px] text-neutral-700">
                            <span className="font-semibold" style={{ color: MUTED }}>Name: </span>
                            {settings.authorizedSignatory || q.createdByName || preparedBy || '_____________________'}
                          </p>
                          <p className="text-[9px] text-neutral-700">
                            <span className="font-semibold" style={{ color: MUTED }}>Designation: </span>
                            {settings.signatoryTitle || 'Manager'}
                          </p>
                          <p className="text-[9px] text-neutral-700">
                            <span className="font-semibold" style={{ color: MUTED }}>Date: </span>
                            ____ / ____ / ________
                          </p>
                        </div>
                        <div
                          className={`flex ${plan.roomy ? 'h-[26mm] w-[26mm]' : 'h-[22mm] w-[22mm]'} shrink-0 items-center justify-center rounded-full border-[0.5mm] border-dashed text-center text-[7px] font-bold uppercase leading-tight tracking-wide`}
                          style={{ borderColor: GOLD, color: DARK_GOLD }}
                        >
                          Company
                          <br />
                          Stamp
                        </div>
                      </div>
                    </div>

                    <div className="rounded-[4px] border p-[3mm]" style={{ borderColor: BORDER }}>
                      <p className={boxHeaderCls} style={{ color: DARK_GOLD }}>
                        Accepted By &mdash; Client
                      </p>
                      <div className="mt-[2.5mm] flex items-end justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-[1.6mm]">
                          <div className="border-b border-neutral-500" style={{ height: plan.roomy ? '12.5mm' : '9mm' }} />
                          <p className="text-[9px] text-neutral-700">
                            <span className="font-semibold" style={{ color: MUTED }}>Name: </span>
                            _____________________
                          </p>
                          <p className="text-[9px] text-neutral-700">
                            <span className="font-semibold" style={{ color: MUTED }}>Title: </span>
                            _____________________
                          </p>
                          <p className="text-[9px] text-neutral-700">
                            <span className="font-semibold" style={{ color: MUTED }}>Date: </span>
                            ____ / ____ / ________
                          </p>
                        </div>
                        <div
                          className={`flex ${plan.roomy ? 'h-[26mm] w-[26mm]' : 'h-[22mm] w-[22mm]'} shrink-0 items-center justify-center rounded-full border-[0.5mm] border-dashed text-center text-[7px] font-bold uppercase leading-tight tracking-wide`}
                          style={{ borderColor: GOLD, color: DARK_GOLD }}
                        >
                          Client
                          <br />
                          Stamp
                        </div>
                      </div>
                    </div>
                  </section>

                  <p className="mt-[2mm] text-center text-[8px]" style={{ color: MUTED }}>
                    This is a computer-generated quotation from {companyName}.
                  </p>
                </div>
              ) : null}
            </div>

            {/* ── signature / stamp assets (percent-of-page, last page) ── */}
            {isLast
              ? assets.map((a, i) => (
                  <img
                    key={a.id ?? `${a.type}-${i}`}
                    src={a.dataUrl}
                    alt={a.type === 'stamp' ? 'Company stamp' : 'Authorized signature'}
                    className="pointer-events-none absolute"
                    style={{
                      left: `${a.posX}%`,
                      top: `${a.posY}%`,
                      width: `${a.width}%`,
                      transform: `rotate(${a.rotation}deg)`,
                      transformOrigin: 'center',
                      zIndex: 20,
                    }}
                  />
                ))
              : null}

            {/* ── page footer strip ── */}
            <div
              className="pointer-events-none absolute inset-x-[12mm] bottom-[3.5mm] flex items-center justify-between border-t pt-[1mm] text-[8px]"
              style={{ borderColor: BORDER, color: MUTED }}
            >
              <span className="truncate">
                {companyName} · {q.quoteNumber}
                {q.referenceNo ? ` · Ref ${q.referenceNo}` : ''}
              </span>
              <span className="shrink-0 tabular-nums">
                Page {pageIdx + 1} of {plans.length}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
