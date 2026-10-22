'use client'

// Quotation print preview — A4 portrait, one compact page per the boss's
// approved layout (upload/Quotation-QTN-2026-0002_New_Layout.pdf):
//
//   • Letterhead artwork zones (unchanged) with the 3-zone header row:
//     QUOTATION + gold subject left · navy pill badge with the quotation
//     number centre · Prepared-for + client right, then the gold rule.
//   • ONE info bar, 5 cells — Date | Valid Until | Your Reference |
//     Currency | Project/Site (wider; name + location on 2 lines). English
//     label on top, Arabic below, then the value.
//   • Full-width TO box (title bar "TO ◆ إلى", no FROM box — the letterhead
//     already carries our company block): left column = client name (bold),
//     Attention, Contact; right column = Address, VAT/C.R. Tight rows, no
//     dashed separators.
//   • Centred title line, then the items table — 6 columns for hourly
//     manpower quotes (# · Trade/Category with inline Arabic trade name ·
//     No. of Workers · Hourly Rate · Hours/Month · Amount), rows only as
//     tall as the text (~2mm padding), the workers/amount TOTAL row and the
//     "Amount = Workers × Rate × Hours per Month" footnote.
//   • AMOUNT IN WORDS box (left) beside the totals box (right).
//   • TERMS & CONDITIONS ◆ الشروط والأحكام — full width, 2 columns, 7.5pt,
//     bold item titles (replaces the old Scope & Terms card).
//   • APPROVED BY | ACCEPTED BY signature boxes — the approved-by name and
//     designation come from Settings › Signatories (empty line when unset).
//   • Bottom line (every page): computer-generated note + Page X of Y in
//     ONE line between the signature boxes and the letterhead footer,
//     with ≥3mm clear above and below.
//
// Pagination: EXPLICIT A4 pages (210 × 296.5mm), a conservative estimator
// chunks items across pages, the tail flows block-by-block — words+totals
// after the table, then TERMS & CONDITIONS + signatures placed TOGETHER
// (they move to a fresh page as a pair; a single T&C item is never split
// and the signatures are never stranded alone). Item rows are NEVER
// stretched — each row is exactly as tall as its text.
import { useEffect, useState } from 'react'
import { Printer, FileDown, FileSpreadsheet, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { amountInWordsBoth } from '@/lib/arabic-words'
import { formatMoney, formatNumber, round2 } from '@/lib/format'
import { downloadPrintAreaAsPdf, printPrintArea } from '@/lib/print-to-pdf'
import { api } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import { parseTerms, type TermItem } from '@/lib/quotation-terms'
import type {
  AppSettings,
  DocItemRow,
  LetterheadConfig,
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

/** Approved-by signatory printed from Settings › Signatories. */
export type ApprovedBy = { name: string; designation: string } | null

const DEFAULT_LETTERHEAD: LetterheadConfig = {
  mode: 'none',
  headerImage: null,
  footerImage: null,
  fullPageImage: null,
  showCompanyDetails: true,
  headerHeightMm: 45,
  footerHeightMm: 25,
}

export { DEFAULT_LETTERHEAD }

// ── Brand palette (same family as the E-Invoice Mirror module) ──────────────
const NAVY = '#132A4A'
const DARK_NAVY = '#0C1D33'
const GOLD = '#C0934C'
const LIGHT_GOLD = '#E1B169'
const DARK_GOLD = '#8E6420'
const LIGHT_BG = '#F2F5FA'
const BORDER = '#DDE3EC'
const ROW_SEP = '#E8ECF2'
const MUTED = '#6B7488'
// print-spec ink: field values / table body
const INK = '#1D2433'
// print-spec soft ink: field labels, notes, footnotes
const INK_SOFT = '#4A5468'
// warm cream — bars and card headers
const CREAM = '#FBF9F3'
// striped letterhead placeholder hatching + caption tone
const STRIPE_A = '#F3F5F8'
const STRIPE_CAPTION = '#6B7488'

const DOC_FONT = "var(--font-inter), var(--font-cairo), 'Cairo', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif"

// ── A4 pagination geometry ──────────────────────────────────────────────────
const PAGE_W_MM = 210
const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (see header comment)
const SIDE_PAD_MM = 14
// reserved at the foot of every page for the note line + its ≥3mm gaps
const FOOTER_MM = 4
// "continued" strip reserved at the top of every page ≥ 2
const CONT_HEADER_MM = 8
// buffer before a tail block may join the current page
const PLACE_BUFFER_MM = 3

/** Arabic names for the currency cell of the info bar. */
const CURRENCY_AR: Record<string, string> = {
  SAR: 'ريال سعودي',
  USD: 'دولار أمريكي',
  EUR: 'يورو',
  GBP: 'جنيه إسترليني',
  AED: 'درهم إماراتي',
}

/** Inline Arabic trade names for the items table (best-effort, exact match). */
const TRADE_AR: Record<string, string> = {
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

/** DD / MM / YYYY — the template's date format. */
function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())} / ${pad(date.getMonth() + 1)} / ${date.getFullYear()}`
}

/** Wrapped line count for a text block at ~charsPerLine characters per line. */
function estLines(text: string | null | undefined, charsPerLine: number): number {
  if (!text) return 0
  return text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.trim().length / charsPerLine)), 0)
}

/**
 * Conservative table-row height estimate in mm (calibrated against real
 * Chrome A4 renders). Rows are exactly as tall as their text: ~7.5mm pitch
 * (1.4mm padding top/bottom + a 4.1mm bilingual line box); wrapped
 * description / sub-text lines add their share.
 */
function rowHeightMm(it: DocItemRow): number {
  const lines = Math.max(1, Math.ceil(it.description.length / 38))
  const subLines = it.subText ? Math.max(1, Math.ceil(it.subText.length / 48)) : 0
  return 7.5 + 4.4 * (lines - 1) + 3.8 * subLines
}

/** TO box height estimate (data-adaptive — wrapping client fields).
 * Title bar 5.2 + content padding 2 + the TALLER inner column + borders.
 * Each label+value line renders ~3.8mm (fixed leading); fields wrap at
 * ~40 chars per line in the ~82mm column. */
function toHeightMm(q: QuotationDetail): number {
  const client = q.client
  const wrap = (label: string, value: string | null | undefined) =>
    Math.max(1, Math.ceil((label.length + (value ?? '').trim().length) / 40))
  const contact = client?.phone || client?.email ? [client?.phone, client?.email].filter(Boolean).join(' · ') : '—'
  const address = [client?.address, client?.city].filter(Boolean).join(', ')
  const vatCr = [client?.vatNumber, client?.crNumber].filter(Boolean).join(' · ')
  const leftLines =
    1 + wrap('Attention عناية: ', client?.contactPerson) + wrap('Contact التواصل: ', contact)
  const rightLines = wrap('Address العنوان: ', address) + wrap('VAT / C.R. الرقم الضريبي / السجل: ', vatCr)
  const colLines = Math.max(leftLines, rightLines)
  return 10 + colLines * 3.8 + 1.4
}

/** TERMS & CONDITIONS box height estimate (2 columns, 7.5pt, bold titles).
 *  Calibrated against a real Chrome render of the 10 standard items
 *  (measured 52.7mm; the formula reproduces it within 0.5mm). */
function termsHeightMm(items: TermItem[]): number {
  if (items.length === 0) return 19 // mt + title bar + fallback line
  const cpl = 58 // ~85mm column at 7.5pt (measured wrap rate)
  const lineCount = (t: TermItem) =>
    Math.max(1, Math.ceil(((t.title?.length ?? 0) + 2 + t.text.length) / cpl))
  const half = Math.ceil(items.length / 2)
  const cols = [items.slice(0, half), items.slice(half)]
  const colH = Math.max(
    ...cols.map(
      (c) => c.reduce((s, t) => s + lineCount(t), 0) * 3.2 + Math.max(0, c.length - 1) * 0.4
    )
  )
  // mt 2 + title bar 5 + content py 2.4 + lines + 2.5 aggregate safety
  return 2 + 5 + 2.4 + colH + 2.5
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

/** Rotated status stamp chip — floats over the letterhead zone's bottom-right
 *  corner (page-level absolute), clear of the document content. */
function StatusStamp({ status }: { status: string }) {
  const map: Record<string, { label: string; border: string; color: string }> = {
    draft: { label: 'DRAFT', border: '#737373', color: '#525252' },
    sent: { label: 'SENT', border: '#d97706', color: '#b45309' },
    accepted: { label: 'ACCEPTED', border: '#059669', color: '#047857' },
    rejected: { label: 'REJECTED', border: '#e11d48', color: '#be123c' },
    expired: { label: 'EXPIRED', border: '#a16207', color: '#854d0e' },
  }
  const entry = map[status] ?? map.draft
  return (
    <span
      className="inline-block rounded border-[2.5px] bg-white/95 px-2 py-px text-[9pt] font-black uppercase tracking-[0.3pt] shadow-[inset_0_0_0_1.5px_rgba(0,0,0,0.06)]"
      style={{ borderColor: entry.border, color: entry.color, transform: 'rotate(-3deg)' }}
    >
      {entry.label}
    </span>
  )
}

// ── Flow-fill pagination ────────────────────────────────────────────────────

/** Tail sections that flow after the items table, in document order. */
type TailBlock = 'wordsTotals' | 'terms' | 'signatures'

/** One explicit A4 page: its item chunk and the tail blocks rendered on it. */
type PagePlan = {
  items: DocItemRow[]
  blocks: TailBlock[]
}

/** Fixed mm on page 1 above the first item row (header row + rule + info
 *  bar + TO box + title line + thead). The TO box is data-adaptive; the
 *  rest is calibrated against real Chrome A4 renders. */
function page1FixedMm(toMm: number): number {
  // header row + rule 12.2 · info bar 15.2 · title 5.6 (incl. margins) ·
  // table mt 1.5 · thead 8.6 — calibrated against real Chrome A4 renders
  return 12.2 + 15.2 + toMm + 5.6 + 1.5 + 8.6
}
const TOTAL_ROW_MM = 6.5
const FOOTNOTE_MM = 4.2
// words+totals row incl. its 2mm top margin
const WORDS_TOTALS_MM = 34.5
// signature boxes + ≥3mm gap + note line
const SIG_NOTE_MM = 29
// the T&C + signature pair may ride into the 4mm foot reserve — the note
// line still clears the letterhead artwork by ≥6mm (never touches it)
const PAIR_TOLERANCE_MM = 4 // small placement headroom (wrap variance)

/**
 * Flow-fill pagination:
 *   1. chunk items across pages (conservative row estimates → safe breaks;
 *      the thead repeats on every page);
 *   2. place the words+totals row after the last items chunk while it fits;
 *   3. place TERMS & CONDITIONS + the signature boxes TOGETHER — both fit on
 *      the current page, or both move to a fresh page (a T&C item is never
 *      split across pages; the signatures are never stranded alone).
 */
function planPages(
  items: DocItemRow[],
  topMm: number,
  bottomMm: number,
  termsMm: number,
  toMm: number
): PagePlan[] {
  const avail = PAGE_H_MM - topMm - (bottomMm + FOOTER_MM)
  const availFirst = avail - page1FixedMm(toMm)
  const availRest = avail - CONT_HEADER_MM - 9 // continued strip + repeated thead

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

  // 2) + 3) flow the tail onto the last items page
  const cap = chunks.length === 1 ? availFirst : availRest
  const lastRows = chunks[chunks.length - 1].reduce((s, it) => s + rowHeightMm(it), 0)
  let tailUsed = lastRows + (chunks[chunks.length - 1].length > 0 ? TOTAL_ROW_MM + FOOTNOTE_MM : 0)

  const blocks: TailBlock[] = []
  const deferred: TailBlock[] = []
  // When the table itself continues past page 1, the boss's rule is "keep
  // totals + signatures together on the last page" — so the words+totals row
  // travels WITH the T&C + signature pair. On a single-chunk table it may
  // stay on the items page while the pair flows on.
  const singleChunk = chunks.length === 1
  if (singleChunk && tailUsed + WORDS_TOTALS_MM <= cap) {
    blocks.push('wordsTotals')
    tailUsed += WORDS_TOTALS_MM
  } else if (!singleChunk) {
    // handled together with the pair below
  } else {
    deferred.push('wordsTotals')
  }
  // TERMS & CONDITIONS + signatures move together as a pair (both heights
  // include their own margins). On multi-chunk tables the words+totals row
  // is placed with them — all three, or none.
  const wordsCost = singleChunk ? 0 : WORDS_TOTALS_MM
  if (tailUsed + wordsCost + termsMm + SIG_NOTE_MM <= cap + PAIR_TOLERANCE_MM) {
    if (wordsCost) blocks.push('wordsTotals')
    blocks.push('terms', 'signatures')
  } else {
    if (!singleChunk) deferred.push('wordsTotals')
    deferred.push('terms', 'signatures')
  }

  const pages: PagePlan[] = chunks.map((c) => ({ items: c, blocks: [] as TailBlock[] }))
  pages[pages.length - 1].blocks = blocks
  if (deferred.length > 0) {
    // a fresh page starting at the TOP: words+totals (when deferred), then
    // the T&C box, then the signatures — never split, never stranded.
    pages.push({ items: [], blocks: deferred })
  }
  return pages
}

// ── Letterhead geometry ─────────────────────────────────────────────────────
// 'none' (default) renders the striped placeholder zones at the full
// 35/22mm; artwork modes honour the configured heights instead.
function geometryFor(letterhead: LetterheadConfig): { topMm: number; bottomMm: number } {
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

/**
 * Full-screen dialog rendering the paginated A4 quotation. Purely
 * presentational apart from fetching the letterhead-approved signatory.
 * Print button renders the server PDF (vector, headless Chromium) and prints
 * that.
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
  const [approvedBy, setApprovedBy] = useState<ApprovedBy>(null)

  usePageRule(open, 'size: A4 portrait; margin: 0;')

  // Settings › Signatories → the name + designation printed in APPROVED BY.
  // No signatory configured → null → the name line stays empty.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get<{ signatories: { name: string; designation: string; isDefault: boolean }[] }>(
          '/api/signatories'
        )
        if (cancelled) return
        const def = res.signatories.find((s) => s.isDefault) ?? null
        setApprovedBy(def ? { name: def.name, designation: def.designation ?? '' } : null)
      } catch {
        if (!cancelled) setApprovedBy(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, quotation?.id])

  const isDraft = !quotation || quotation.id === 'draft'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px] print:static print:max-h-none print:w-full print:max-w-none print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Quotation print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable A4 quotation with letterhead zones, header row, info bar, TO box, line items, amount in words, totals, terms and conditions, and signature boxes.
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
              A4 · Compact one-page layout · EN/AR labels
              {quotation
                ? ` · ${quotation.clientName} · ${formatMoney(quotation.total, settings.currency || 'SAR')}`
                : ''}
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
            <Button
              variant="outline"
              size="sm"
              onClick={(e) =>
                void downloadPrintAreaAsPdf(
                  `Quotation-${quotation?.quoteNumber ?? 'draft'}`,
                  e.currentTarget
                )
              }
              disabled={!quotation}
            >
              <FileDown className="h-4 w-4" />
              Download PDF
            </Button>
            <Button size="sm" onClick={(e) => printPrintArea(e.currentTarget)} disabled={!quotation}>
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
              approvedBy={approvedBy}
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
  approvedBy,
}: {
  quotation: QuotationDetail
  letterhead: LetterheadConfig
  settings: AppSettings
  /** Default signatory from Settings › Signatories (null → empty name line). */
  approvedBy?: ApprovedBy
}) {
  const currency = settings.currency || 'SAR'
  const q = quotation
  const companyName = settings.companyName || 'Landmark Inter Gulf'
  const client = q.client
  const vatPercent = Math.round(q.vatRate * 100)
  const items = q.items ?? []
  // Visible signature/stamp artwork — anchored INTO the "Approved By" box
  // (signature sits exactly on its line, stamp beside the name/date block).
  const assets = (q.assets ?? []).filter((a) => a.visible)
  const signatureAsset = assets.find((a) => a.type === 'signature') ?? null
  const stampAsset = assets.find((a) => a.type === 'stamp') ?? null
  const netTotal = round2(q.subtotal - q.discount)
  const money = (n: number) => formatNumber(n) // plain numbers — SAR lives in headers only
  const geo = geometryFor(letterhead)

  // Hourly manpower quotes get the 6-column table, others go generic
  const hasRateBasis = items.some((it) => it.ratePerHour != null || it.hoursPerMonth != null)
  const showDiscountCol = items.some((it) => (it.discount ?? 0) > 0) || q.discount > 0
  const totalWorkers = round2(items.reduce((s, it) => s + (hasRateBasis ? it.quantity : 0), 0))
  const terms = parseTerms(q.terms)
  const contractMonths = q.contractMonths && q.contractMonths > 0 ? q.contractMonths : null
  const contractValue = contractMonths ? round2(q.total * contractMonths) : null
  const subjectLine = (q.subject || 'Manpower Supply Proposal').toUpperCase()
  // one-line signature-box title — the company's first name word keeps the
  // "APPROVED BY · …" header on a single line even with long company names
  const approverLabel = companyName.split(/\s+/)[0] || companyName
  const words = amountInWordsBoth(q.total, currency)
  const currencyAr = CURRENCY_AR[currency] ?? ''
  const printedAt = new Date()

  // uniform working-hours basis across hourly lines → drives the
  // "(10 hrs × 26 days = 260 hrs)" note under the items table.
  const hoursVals = items
    .map((it) => it.hoursPerMonth)
    .filter((h): h is number => h != null && h > 0)
  const uniformHours =
    hoursVals.length > 0 && hoursVals.every((h) => h === hoursVals[0]) ? hoursVals[0] : null
  const hpdVals = items
    .map((it) => it.hoursPerDay)
    .filter((h): h is number => h != null && h > 0)
  const uniformHpd =
    hpdVals.length > 0 && hpdVals.every((h) => h === hpdVals[0]) ? hpdVals[0] : null
  const dpmVals = items
    .map((it) => it.daysPerMonth)
    .filter((d): d is number => d != null && d > 0)
  const uniformDpm =
    dpmVals.length > 0 && dpmVals.every((d) => d === dpmVals[0]) ? dpmVals[0] : null
  const dayBasis =
    uniformHpd != null && uniformDpm != null ? round2(uniformHpd * uniformDpm) : null
  const footnoteBasis =
    dayBasis != null
      ? ` (${uniformHpd} hrs × ${uniformDpm} days = ${dayBasis} hrs)`
      : uniformHours != null
        ? ` (${uniformHours} hrs / month)`
        : ''

  // TO box field values (client snapshot + registered-client record)
  const toAddress = [client?.address, client?.city].filter(Boolean).join(', ')
  const toContact =
    client?.phone || client?.email ? [client?.phone, client?.email].filter(Boolean).join(' · ') : '—'
  const toVatCr = [client?.vatNumber, client?.crNumber].filter(Boolean).join(' · ') || '—'

  // ── pagination ──
  const termsMm = termsHeightMm(terms)
  const toMm = toHeightMm(q)
  const plans = planPages(items, geo.topMm, geo.bottomMm, termsMm, toMm)
  // The last page that actually carries items — the table's TOTAL row + the
  // calculation footnote go there.
  const lastItemsPageIdx = plans.reduce((acc, p, i) => (p.items.length > 0 ? i : acc), 0)

  // letterhead artwork layers (per the configured mode)
  const hasFullArt = letterhead.mode === 'full' && letterhead.fullPageImage
  const hasHeaderArt =
    (letterhead.mode === 'header' || letterhead.mode === 'header_footer') && letterhead.headerImage
  const hasFooterArt = letterhead.mode === 'header_footer' && letterhead.footerImage

  // table cell styles — navy header (white EN over gold AR), horizontal-only
  // row separators, rows exactly as tall as the text: fixed-mm line heights
  // (Calibrated against real Chrome renders — Arabic spans in Cairo inflate
  // natural line boxes, so explicit mm leading keeps rows at spec pitch).
  const th = 'px-1 py-[2px] text-center align-middle leading-[3.6mm]'
  const td = 'px-1 py-[1.4mm] align-top text-[9pt] leading-[4.1mm] text-[#1D2433]'
  const tdR = `${td} text-right tabular-nums`
  // TOTAL row cells — 1mm vertical padding keeps the row at ~6.5mm
  const tdT = 'px-1 py-[1mm] align-middle text-[9.5pt] leading-[4.4mm] text-[#1D2433]'

  /** The bottom note line — computer-generated note + Page X of Y in ONE
   *  line, ≥3mm clear of the signature boxes above and the letterhead
   *  footer below. Rendered at the foot of every page. */
  const noteLine = (pageIdx: number, plan: PagePlan) => (
    <p
      className={`break-words text-center text-[7.5pt] leading-snug ${
        plan.blocks.includes('signatures') ? 'mt-[3mm]' : 'mt-auto'
      }`}
      style={{ color: INK_SOFT }}
    >
      Computer-generated quotation · {companyName}
      {' · '}
      <span className="font-mono">{q.quoteNumber}</span>
      {' · '}
      Page {pageIdx + 1} of {plans.length}{' '}
      <span className="mx-0.5" style={{ color: MUTED }}>
        |
      </span>{' '}
      <span lang="ar" dir="rtl">
        صفحة {pageIdx + 1} من {plans.length}
      </span>{' '}
      · Printed {fmtDate(printedAt.toISOString())}
    </p>
  )

  return (
    <div
      className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:gap-0"
      style={{ fontFamily: DOC_FONT }}
    >
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
            {/* ── letterhead artwork (configured modes) ── */}
            {hasFullArt ? (
              <img
                src={letterhead.fullPageImage as string}
                alt=""
                aria-hidden
                className="pointer-events-none absolute inset-0 z-0 h-full w-full object-fill"
              />
            ) : (
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
                  /* ── striped letterhead placeholder zone (the template look) ── */
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
            )}

            {/* ── status stamp — over the letterhead zone's bottom-right corner ── */}
            {pageIdx === 0 ? (
              <div
                className="pointer-events-none absolute z-20"
                style={{ top: `${Math.max(geo.topMm - 7, 2)}mm`, right: `${SIDE_PAD_MM}mm` }}
              >
                <StatusStamp status={q.status} />
              </div>
            ) : null}

            {/* ── DRAFT watermark (drafts only — subtle, behind content) ── */}
            {q.status === 'draft' ? (
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

            {/* ── content ── */}
            <div
              className="absolute inset-x-0 top-0 z-10 flex h-full flex-col [&>*]:shrink-0"
              style={{
                paddingTop: `${geo.topMm}mm`,
                paddingBottom: `${geo.bottomMm + FOOTER_MM}mm`,
                paddingLeft: `${SIDE_PAD_MM}mm`,
                paddingRight: `${SIDE_PAD_MM}mm`,
              }}
            >
              {pageIdx === 0 ? (
                <>
                  {/* 1 ─ title row: QUOTATION + subject (left, ≤35%) · number
                      capsule (centre) · prepared-for (right, ≤35%, wraps). */}
                  <div className="grid grid-cols-[minmax(0,35fr)_auto_minmax(0,35fr)] items-center gap-3">
                    <div className="min-w-0">
                      <h1
                        className="text-[16pt] font-extrabold uppercase leading-[1.12] tracking-[0.04em]"
                        style={{ color: NAVY }}
                      >
                        Quotation
                      </h1>
                      <p
                        className="mt-[0.5mm] break-words text-[7.5pt] font-bold uppercase leading-snug tracking-[0.3pt]"
                        style={{ color: DARK_GOLD }}
                      >
                        {subjectLine}
                      </p>
                    </div>
                    {/* pill badge — gold ring outside, navy fill inside */}
                    <div className="shrink-0 rounded-full p-[2px]" style={{ background: GOLD }}>
                      <div
                        className="rounded-full px-4 text-center py-[3px]"
                        style={{ background: NAVY }}
                      >
                        <p
                          className="whitespace-nowrap text-[7.5pt] font-bold uppercase tracking-[0.3pt]"
                          style={{ color: LIGHT_GOLD }}
                        >
                          Quotation No.{' '}
                          <span lang="ar" dir="rtl" className="tracking-normal">
                            رقم عرض السعر
                          </span>
                        </p>
                        <p className="mt-[1px] whitespace-nowrap font-mono text-[11pt] font-extrabold leading-tight text-white">
                          {q.quoteNumber}
                        </p>
                      </div>
                    </div>
                    <div className="min-w-0 text-right">
                      <p
                        className="break-words text-[7.5pt] font-semibold uppercase leading-snug tracking-[0.3pt]"
                        style={{ color: INK_SOFT }}
                      >
                        Prepared for{' '}
                        <span className="mx-0.5" style={{ color: MUTED }}>|</span>{' '}
                        <span lang="ar" dir="rtl" className="normal-case tracking-normal">
                          أُعدّ لصالح
                        </span>
                      </p>
                      <p
                        className="mt-[0.8mm] break-words text-[9pt] font-extrabold leading-snug"
                        style={{ color: NAVY }}
                      >
                        {q.clientName}
                      </p>
                    </div>
                  </div>

                  {/* 2 ─ gold rule broken by a centre diamond */}
                  <div className="mt-[5px] flex items-center gap-2">
                    <div className="h-[2px] flex-1 rounded-full" style={{ background: GOLD }} />
                    <GoldDiamond size={6} />
                    <div className="h-[2px] flex-1 rounded-full" style={{ background: GOLD }} />
                  </div>

                  {/* 3 ─ ONE info bar, 5 cells (Date | Valid Until | Your
                      Reference | Currency | Project/Site wider). English
                      label on top, Arabic below, then the value. */}
                  <div
                    className="mt-[1mm] grid grid-cols-[18fr_18fr_18fr_18fr_28fr] rounded-lg border"
                    style={{ borderColor: BORDER, background: CREAM }}
                  >
                    {(
                      [
                        ['Date', 'التاريخ', fmtDate(q.issueDate)],
                        ['Valid Until', 'صالح حتى', fmtDate(q.validityDate)],
                        ['Your Reference', 'مرجعكم', q.referenceNo || '—'],
                        [
                          'Currency',
                          'العملة',
                          currencyAr ? `${currency} · ${currencyAr}` : currency,
                        ],
                      ] as Array<[string, string, string]>
                    ).map(([en, ar, value]) => (
                      <div
                        key={en}
                        className="border-r px-1.5 py-[3px] text-center"
                        style={{ borderColor: BORDER }}
                      >
                        <p
                          className="text-[7pt] font-semibold uppercase leading-tight tracking-[0.2pt]"
                          style={{ color: INK_SOFT }}
                        >
                          {en}
                        </p>
                        <p lang="ar" dir="rtl" className="text-[7pt] leading-[2.8mm]" style={{ color: MUTED }}>
                          {ar}
                        </p>
                        <p
                          className="mt-[1px] break-words text-[9pt] font-bold tabular-nums leading-[3.6mm]"
                          style={{ color: NAVY }}
                        >
                          {value}
                        </p>
                      </div>
                    ))}
                    {/* Project / Site — wider cell, 2 value lines */}
                    <div className="px-1.5 py-[3px] text-center">
                      <p
                        className="text-[7pt] font-semibold uppercase leading-[2.8mm] tracking-[0.2pt]"
                        style={{ color: INK_SOFT }}
                      >
                        Project / Site
                      </p>
                      <p lang="ar" dir="rtl" className="text-[7pt] leading-[2.8mm]" style={{ color: MUTED }}>
                        المشروع / الموقع
                      </p>
                      <p
                        className="mt-[1px] break-words text-[9pt] font-bold leading-[3.6mm]"
                        style={{ color: NAVY }}
                      >
                        {q.projectName || '—'}
                      </p>
                      {q.projectLocation ? (
                        <p className="break-words text-[7.5pt] leading-[3.4mm]" style={{ color: INK_SOFT }}>
                          {q.projectLocation}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {/* 4 ─ full-width TO box (no FROM box — the letterhead
                      already carries the company block). Two inner columns,
                      tight rows, no dashed separators. */}
                  <div
                    className="mt-[1mm] rounded-lg border"
                    style={{ borderColor: BORDER, background: 'white' }}
                  >
                    <div
                      className="flex flex-wrap items-center justify-center gap-x-2 gap-y-[0.3mm] rounded-t-[7px] border-b px-[3mm] py-[2px]"
                      style={{ borderColor: BORDER, background: CREAM }}
                    >
                      <p
                        className="text-[8.5pt] font-extrabold uppercase tracking-[0.3pt]"
                        style={{ color: DARK_GOLD }}
                      >
                        To
                      </p>
                      <GoldDiamond size={5} />
                      <p
                        lang="ar"
                        dir="rtl"
                        className="text-[8.5pt] font-bold leading-none"
                        style={{ color: DARK_GOLD }}
                      >
                        إلى
                      </p>
                    </div>
                    <div className="grid grid-cols-2 px-[3mm] py-[0.8mm]">
                      {/* left — client name (bold), Attention, Contact */}
                      <div className="min-w-0 space-y-[0.6mm] pr-[3mm]">
                        <p
                          className="break-words text-[9.5pt] font-bold leading-[3.6mm]"
                          style={{ color: INK }}
                        >
                          {q.clientName}
                        </p>
                        <p className="break-words leading-[3.6mm]">
                          <span className="text-[7.5pt] font-semibold" style={{ color: INK_SOFT }}>
                            Attention <span lang="ar" dir="rtl">عناية</span>:{' '}
                          </span>
                          <span className="text-[9pt] font-semibold" style={{ color: INK }}>
                            {client?.contactPerson || '—'}
                          </span>
                        </p>
                        <p className="break-words leading-[3.6mm]">
                          <span className="text-[7.5pt] font-semibold" style={{ color: INK_SOFT }}>
                            Contact <span lang="ar" dir="rtl">التواصل</span>:{' '}
                          </span>
                          <span className="text-[9pt] font-semibold" style={{ color: INK }}>
                            {toContact}
                          </span>
                        </p>
                      </div>
                      {/* right — Address, VAT / C.R. */}
                      <div
                        className="min-w-0 space-y-[0.6mm] border-l pl-[3mm]"
                        style={{ borderColor: BORDER }}
                      >
                        <p className="break-words leading-[3.6mm]">
                          <span className="text-[7.5pt] font-semibold" style={{ color: INK_SOFT }}>
                            Address <span lang="ar" dir="rtl">العنوان</span>:{' '}
                          </span>
                          <span className="text-[9pt] font-semibold" style={{ color: INK }}>
                            {toAddress || '—'}
                          </span>
                        </p>
                        <p className="break-words leading-[3.6mm]">
                          <span className="text-[7.5pt] font-semibold" style={{ color: INK_SOFT }}>
                            VAT / C.R. <span lang="ar" dir="rtl">الرقم الضريبي / السجل</span>:{' '}
                          </span>
                          <span className="font-mono text-[9pt] font-semibold" style={{ color: INK }}>
                            {toVatCr}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 5 ─ centred quotation title line */}
                  <div className="mt-[1.2mm] text-center">
                    <p className="text-[11pt] font-extrabold leading-tight" style={{ color: NAVY }}>
                      {hasRateBasis
                        ? 'Quotation for Supply of Skilled & Unskilled Manpower'
                        : 'Quotation Details'}
                    </p>
                  </div>
                </>
              ) : (
                /* continuation header on EVERY later page (items or tail-only) */
                <div
                  className="flex flex-wrap items-baseline justify-between gap-x-2 border-b pb-[3px]"
                  style={{ borderColor: BORDER }}
                >
                  <p
                    className="break-words text-[8.5pt] font-bold uppercase tracking-[0.3pt]"
                    style={{ color: NAVY }}
                  >
                    {companyName} — Quotation <span className="font-mono">{q.quoteNumber}</span>
                  </p>
                  <p className="shrink-0 text-[7.5pt] italic" style={{ color: INK_SOFT }}>
                    continued · <span lang="ar" dir="rtl">تابع</span>
                  </p>
                </div>
              )}

              {/* 6 ─ items chunk (thead repeats; tail-only pages skip) */}
              {chunk.length > 0 || pageIdx === 0 ? (
                <div
                  className="mt-[1.5mm] rounded-lg border"
                  style={{ borderColor: BORDER, background: 'white' }}
                >
                  <table className="w-full table-fixed border-collapse" style={{ tableLayout: 'fixed' }}>
                    {hasRateBasis ? (
                      <colgroup>
                        <col style={{ width: '5%' }} />
                        <col style={{ width: '34%' }} />
                        <col style={{ width: '13%' }} />
                        <col style={{ width: '16%' }} />
                        <col style={{ width: '15%' }} />
                        <col style={{ width: '17%' }} />
                      </colgroup>
                    ) : (
                      <colgroup>
                        <col style={{ width: '5%' }} />
                        <col style={{ width: showDiscountCol ? '37%' : '41%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '13%' }} />
                        {showDiscountCol ? <col style={{ width: '9%' }} /> : null}
                        <col style={{ width: showDiscountCol ? '17%' : '22%' }} />
                      </colgroup>
                    )}
                    <thead style={{ display: 'table-header-group', background: DARK_NAVY }}>
                      {hasRateBasis ? (
                        <tr>
                          <th className={th}>
                            <p className="text-[8pt] font-bold text-white">#</p>
                          </th>
                          <th className={`${th} text-left`}>
                            <p className="text-[8pt] font-bold text-white">Trade / Category</p>
                            <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                              المهنة / الفئة
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[8pt] font-bold text-white">No. of Workers</p>
                            <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                              عدد العمال
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[8pt] font-bold text-white">Hourly Rate (SAR)</p>
                            <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                              السعر بالساعة
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[8pt] font-bold text-white">Hours / Month</p>
                            <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                              ساعات الشهر
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[8pt] font-bold text-white">Amount (SAR)</p>
                            <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                              المبلغ
                            </p>
                          </th>
                        </tr>
                      ) : (
                        <tr>
                          <th className={th}>
                            <p className="text-[8pt] font-bold text-white">#</p>
                          </th>
                          <th className={`${th} text-left`}>
                            <p className="text-[8pt] font-bold text-white">Description</p>
                            <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                              الوصف
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[8pt] font-bold text-white">Qty</p>
                            <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                              الكمية
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[8pt] font-bold text-white">Unit</p>
                            <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                              الوحدة
                            </p>
                          </th>
                          <th className={th}>
                            <p className="text-[8pt] font-bold text-white">Unit Price</p>
                            <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                              سعر الوحدة
                            </p>
                          </th>
                          {showDiscountCol ? (
                            <th className={th}>
                              <p className="text-[8pt] font-bold text-white">Disc.</p>
                              <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                                الخصم
                              </p>
                            </th>
                          ) : null}
                          <th className={th}>
                            <p className="text-[8pt] font-bold text-white">Line Total</p>
                            <p lang="ar" dir="rtl" className="text-[8pt] font-semibold" style={{ color: LIGHT_GOLD }}>
                              الإجمالي
                            </p>
                          </th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {chunk.length === 0 ? (
                        <tr>
                          <td
                            className={`${td} border-b py-2 text-center text-[#4A5468]`}
                            colSpan={hasRateBasis ? 6 : showDiscountCol ? 7 : 6}
                            style={{ borderColor: ROW_SEP }}
                          >
                            No line items yet
                          </td>
                        </tr>
                      ) : (
                        chunk.map((it, i) => {
                          const tradeAr = TRADE_AR[it.description.trim().toUpperCase()] ?? null
                          return (
                            <tr
                              key={it.id ?? `${it.sr}-${i}`}
                              className="break-inside-avoid"
                              style={{ borderBottom: `0.3mm solid ${ROW_SEP}` }}
                            >
                              <td className={`${td} text-center`}>
                                {/* index inside a thin gold ring — the template's touch */}
                                <span
                                  className="inline-flex h-[17px] w-[17px] items-center justify-center rounded-full border-[1.5px] text-[8pt] font-bold tabular-nums"
                                  style={{ borderColor: GOLD, color: NAVY }}
                                >
                                  {it.sr}
                                </span>
                              </td>
                              <td className={td}>
                                <p className="break-words text-[9pt] font-bold leading-[1.15]" style={{ color: INK }}>
                                  {it.description}
                                  {tradeAr ? (
                                    <>
                                      {' '}
                                      <span
                                        lang="ar"
                                        dir="rtl"
                                        className="text-[8pt] font-semibold"
                                        style={{ color: MUTED }}
                                      >
                                        {tradeAr}
                                      </span>
                                    </>
                                  ) : null}
                                </p>
                                {it.subText ? (
                                  <p className="break-words text-[8pt] italic leading-[1.15]" style={{ color: INK_SOFT }}>
                                    {it.subText}
                                  </p>
                                ) : null}
                              </td>
                              {hasRateBasis ? (
                                <>
                                  <td className={`${td} text-center font-semibold tabular-nums`}>
                                    {it.quantity.toLocaleString('en-US')}
                                  </td>
                                  <td className={`${tdR} font-bold`} style={{ color: INK }}>
                                    {it.ratePerHour != null ? money(it.ratePerHour) : '—'}
                                  </td>
                                  <td className={`${tdR} font-bold`} style={{ color: INK }}>
                                    {it.hoursPerMonth != null ? money(it.hoursPerMonth) : '—'}
                                  </td>
                                  <td className={`${tdR} font-bold`} style={{ color: INK }}>
                                    {money(it.lineTotal)}
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className={`${td} text-center font-semibold tabular-nums`}>
                                    {it.quantity.toLocaleString('en-US')}
                                  </td>
                                  <td className={`${td} text-center`}>{it.unit ?? '—'}</td>
                                  <td className={tdR}>{money(it.unitPrice)}</td>
                                  {showDiscountCol ? (
                                    <td className={tdR}>
                                      {(it.discount ?? 0) > 0 ? `-${money(it.discount ?? 0)}` : '—'}
                                    </td>
                                  ) : null}
                                  <td className={`${tdR} font-bold`} style={{ color: INK }}>
                                    {money(it.lineTotal)}
                                  </td>
                                </>
                              )}
                            </tr>
                          )
                        })
                      )}
                      {/* total row on the last items chunk — hourly quotes
                          total the workers and amount columns */}
                      {chunk.length > 0 && pageIdx === lastItemsPageIdx ? (
                        <tr
                          className="break-inside-avoid"
                          style={{ background: LIGHT_BG, borderTop: `0.6mm solid ${NAVY}` }}
                        >
                          {hasRateBasis ? (
                            <>
                              <td className={td} />
                              <td
                                className={`${tdT} font-extrabold uppercase tracking-[0.3pt]`}
                                style={{ color: NAVY }}
                              >
                                Total <span lang="ar" dir="rtl" className="normal-case">الإجمالي</span>
                              </td>
                              <td
                                className={`${tdT} text-center font-extrabold tabular-nums`}
                                style={{ color: NAVY }}
                              >
                                {totalWorkers.toLocaleString('en-US')}
                              </td>
                              <td className={td} />
                              <td className={td} />
                              <td
                                className={`${tdT.replace('text-[9.5pt]', 'text-[11pt]')} text-right font-extrabold tabular-nums`}
                                style={{ color: NAVY }}
                              >
                                {money(q.subtotal)}
                              </td>
                            </>
                          ) : (
                            <>
                              <td className={td} />
                              <td
                                className={`${tdT} font-extrabold uppercase tracking-[0.3pt]`}
                                style={{ color: NAVY }}
                              >
                                Total Amount <span lang="ar" dir="rtl" className="normal-case">الإجمالي</span>
                              </td>
                              <td className={td} />
                              <td className={td} />
                              {showDiscountCol ? <td className={td} /> : null}
                              <td
                                className={`${tdT.replace('text-[9.5pt]', 'text-[11pt]')} text-right font-extrabold tabular-nums`}
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
                </div>
              ) : null}

              {/* calculation note under the items table (hourly quotes) */}
              {hasRateBasis && chunk.length > 0 && pageIdx === lastItemsPageIdx ? (
                <p className="text-right text-[8pt] italic mt-[0.8mm]" style={{ color: INK_SOFT }}>
                  * Amount = No. of Workers × Hourly Rate × Hours per Month{footnoteBasis}
                </p>
              ) : null}

              {/* ── tail blocks — flow after the items table, page by page ── */}
              {plan.blocks.includes('wordsTotals') ? (
                /* AMOUNT IN WORDS (left) beside the totals box (right) */
                <section className="mt-[1.5mm] grid grid-cols-[1fr_76mm] items-start gap-[2.5mm]">
                  <div
                    className="rounded-lg border px-[3mm] py-[2mm]"
                    style={{ borderColor: BORDER, background: 'white' }}
                  >
                    <p
                      className="text-[7.5pt] font-bold uppercase leading-[3.8mm] tracking-[0.3pt]"
                      style={{ color: DARK_GOLD }}
                    >
                      Amount in Words{' '}
                      <span lang="ar" dir="rtl" className="normal-case tracking-normal">
                        المبلغ كتابةً
                      </span>
                      :
                    </p>
                    <p className="mt-[0.8mm] break-words text-[9pt] font-semibold leading-[4mm]" style={{ color: INK }}>
                      {words.en}
                    </p>
                    <p lang="ar" dir="rtl" className="mt-[0.5mm] break-words text-[9pt] leading-[4.2mm]" style={{ color: INK }}>
                      {words.ar}
                    </p>
                  </div>

                  {/* totals box (right) */}
                  <div
                    className="rounded-lg border"
                    style={{ borderColor: BORDER, background: 'white' }}
                  >
                    <div
                      className="flex flex-wrap items-baseline justify-between gap-x-2 rounded-t-[7px] border-b px-[3mm] py-[1mm]"
                      style={{ borderColor: BORDER, background: LIGHT_BG }}
                    >
                      <span className="text-[7.5pt] font-semibold leading-[3.8mm]" style={{ color: INK_SOFT }}>
                        Monthly Subtotal{' '}
                        <span lang="ar" dir="rtl" className="text-[7.5pt]">
                          المجموع الشهري
                        </span>
                      </span>
                      <span className="text-[9.5pt] font-semibold tabular-nums leading-[4.2mm]" style={{ color: NAVY }}>
                        {money(q.subtotal)}
                      </span>
                    </div>
                    <p className="px-[3mm] py-[0.2mm] text-right text-[7pt] leading-[3.2mm]" style={{ color: INK_SOFT }}>
                      excl. VAT · {currency}
                    </p>
                    {q.discount > 0 ? (
                      <>
                        <div
                          className="flex flex-wrap items-baseline justify-between gap-x-2 border-b px-[3mm] py-[1.5mm]"
                          style={{ borderColor: BORDER, background: 'white' }}
                        >
                          <span className="text-[7.5pt] font-semibold leading-[3.8mm]" style={{ color: INK_SOFT }}>
                            Discount <span lang="ar" dir="rtl" className="text-[7.5pt]">الخصم</span>
                          </span>
                          <span className="text-[9.5pt] font-semibold tabular-nums leading-[4.4mm] text-rose-700">
                            -{money(q.discount)}
                          </span>
                        </div>
                        <div
                          className="flex flex-wrap items-baseline justify-between gap-x-2 border-b px-[3mm] py-[1.5mm]"
                          style={{ borderColor: BORDER, background: 'white' }}
                        >
                          <span className="text-[7.5pt] font-semibold leading-[3.8mm]" style={{ color: INK_SOFT }}>
                            Net Amount <span lang="ar" dir="rtl" className="text-[7.5pt]">الصافي</span>
                          </span>
                          <span className="text-[9.5pt] font-semibold tabular-nums leading-[4.2mm]" style={{ color: NAVY }}>
                            {money(netTotal)}
                          </span>
                        </div>
                      </>
                    ) : null}
                    <div
                      className="flex flex-wrap items-baseline justify-between gap-x-2 border-b px-[3mm] py-[1mm]"
                      style={{ borderColor: BORDER, background: LIGHT_BG }}
                    >
                      <span className="text-[7.5pt] font-semibold leading-[3.8mm]" style={{ color: INK_SOFT }}>
                        VAT ({vatPercent}%){' '}
                        <span lang="ar" dir="rtl" className="text-[7.5pt]">
                          ضريبة القيمة المضافة
                        </span>
                      </span>
                      <span className="text-[9.5pt] font-semibold tabular-nums leading-[4.2mm]" style={{ color: NAVY }}>
                        {money(q.vatAmount)}
                      </span>
                    </div>
                    {/* TOTAL / MONTH — navy row, white label, gold amount */}
                    <div
                      className="border-b px-[3mm] py-[1mm]"
                      style={{ borderColor: BORDER, background: DARK_NAVY }}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="text-[9.5pt] font-extrabold uppercase leading-[4.4mm] tracking-[0.3pt] text-white">
                          Total / Month{' '}
                          <span lang="ar" dir="rtl" className="normal-case tracking-normal">
                            الإجمالي شهرياً
                          </span>
                        </span>
                        <span
                          className="text-[13pt] font-extrabold tabular-nums leading-[4.6mm]"
                          style={{ color: LIGHT_GOLD }}
                        >
                          {money(q.total)}
                        </span>
                      </div>
                      <p className="text-right text-[7.5pt] font-semibold leading-[3.2mm] text-white">
                        incl. VAT · {currency}
                      </p>
                    </div>
                    {contractMonths && contractValue != null ? (
                      <div
                        className="flex flex-wrap items-baseline justify-between gap-x-2 px-[3mm] py-[1.5mm]"
                        style={{ background: LIGHT_BG }}
                      >
                        <span className="text-[7.5pt] font-semibold leading-[3.8mm]" style={{ color: INK_SOFT }}>
                          Contract Value{' '}
                          <span lang="ar" dir="rtl" className="text-[7.5pt]">
                            قيمة العقد
                          </span>
                        </span>
                        <span className="text-[9.5pt] font-extrabold tabular-nums leading-[4.4mm]" style={{ color: NAVY }}>
                          {money(contractValue)}
                        </span>
                      </div>
                    ) : null}
                    {contractMonths && contractValue != null ? (
                      <p className="px-[3mm] pb-[1.5mm] text-right text-[7.5pt] leading-[3.4mm]" style={{ color: INK_SOFT }}>
                        {contractMonths} months · incl. VAT · {currency}
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}
              {/* TERMS & CONDITIONS — full width, 2 columns, 7.5pt, bold
                  item titles. Replaces the old Scope & Terms card. */}
              {plan.blocks.includes('terms') ? (
                <section
                  className="mt-[2mm] rounded-lg border"
                  style={{ borderColor: BORDER, background: 'white' }}
                >
                  <div
                    className="flex flex-wrap items-center justify-center gap-x-2 gap-y-[0.3mm] rounded-t-[7px] border-b px-[3mm] py-[3.5px]"
                    style={{ borderColor: BORDER, background: CREAM }}
                  >
                    <p
                      className="text-[8.5pt] font-extrabold uppercase tracking-[0.3pt]"
                      style={{ color: DARK_GOLD }}
                    >
                      Terms &amp; Conditions
                    </p>
                    <GoldDiamond size={5} />
                    <p
                      lang="ar"
                      dir="rtl"
                      className="text-[8.5pt] font-bold leading-none"
                      style={{ color: DARK_GOLD }}
                    >
                      الشروط والأحكام
                    </p>
                  </div>
                  <div className="px-[3mm] py-[1.2mm]">
                    {terms.length === 0 ? (
                      <p className="py-[1mm] text-center text-[7.5pt]" style={{ color: INK_SOFT }}>
                        As mutually agreed between the parties.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-x-[6mm]">
                        {[terms.slice(0, Math.ceil(terms.length / 2)), terms.slice(Math.ceil(terms.length / 2))].map(
                          (col, ci) => (
                            <ol key={ci} className="space-y-[0.4mm]">
                              {col.map((t, ti) => {
                                const n = ci === 0 ? ti + 1 : Math.ceil(terms.length / 2) + ti + 1
                                return (
                                  <li
                                    key={`${n}-${t.text.slice(0, 12)}`}
                                    className="flex gap-[1.5mm] text-[7.5pt] leading-[3.2mm] text-[#1D2433]"
                                  >
                                    <span className="shrink-0 font-bold" style={{ color: DARK_GOLD }}>
                                      {n}.
                                    </span>
                                    <span className="break-words">
                                      {t.title ? (
                                        <>
                                          <b>{t.title}: </b>
                                          {t.text}
                                        </>
                                      ) : (
                                        t.text
                                      )}
                                    </span>
                                  </li>
                                )
                              })}
                            </ol>
                          )
                        )}
                      </div>
                    )}
                    {q.notes ? (
                      <p
                        className="mt-[1.2mm] whitespace-pre-line border-t pt-[1.2mm] text-[7.5pt] italic leading-[3.4mm]"
                        style={{ borderColor: BORDER, color: INK_SOFT }}
                      >
                        {q.notes}
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* SIGNATURES — APPROVED BY | ACCEPTED BY, pinned to the foot
                  of the page; the note line follows with ≥3mm clear above
                  and below. Name + designation come from Settings ›
                  Signatories — empty line when none is set. */}
              {plan.blocks.includes('signatures') ? (
                <div className="mt-auto" style={{ paddingTop: '2mm' }}>
                  <section className="grid grid-cols-2 gap-[5mm]">
                    {/* APPROVED BY — the company */}
                    <div
                      className="rounded-lg border"
                      style={{ borderColor: BORDER, background: 'white' }}
                    >
                      <div
                        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-[0.3mm] rounded-t-[7px] border-b px-[3mm] py-[2px]"
                        style={{ borderColor: BORDER, background: CREAM }}
                      >
                        <p
                          className="whitespace-nowrap text-[8.5pt] font-extrabold uppercase tracking-[0.3pt]"
                          style={{ color: DARK_GOLD }}
                        >
                          Approved By · {approverLabel}
                        </p>
                        <GoldDiamond size={4} />
                        <p
                          lang="ar"
                          dir="rtl"
                          className="whitespace-nowrap text-[8.5pt] font-bold leading-none"
                          style={{ color: DARK_GOLD }}
                        >
                          اعتماد الشركة
                        </p>
                      </div>
                      <div className="flex items-end justify-between gap-[3mm] px-[3mm] py-[1.5mm]">
                        <div className="min-w-0 flex-1 space-y-[0.8mm]">
                          {/* Signature line — uploaded signature sits EXACTLY on
                              it (bottom-anchored, just above the border). */}
                          <div className="relative border-b border-neutral-500" style={{ height: '4mm' }}>
                            {signatureAsset ? (
                              <img
                                src={signatureAsset.dataUrl}
                                alt="Authorized signature"
                                className="absolute bottom-[0.7mm] left-0 h-[calc(100%-1.4mm)] max-w-full object-contain object-left-bottom"
                              />
                            ) : null}
                          </div>
                          <p className="break-words text-[8.5pt] leading-[4mm] text-[#1D2433]">
                            <span className="text-[7.5pt] font-semibold" style={{ color: INK_SOFT }}>
                              Name:{' '}
                            </span>
                            {approvedBy?.name
                              ? `${approvedBy.name}${approvedBy.designation ? ` · ${approvedBy.designation}` : ''}`
                              : '______________'}
                            <span className="mx-[2mm]" />
                            <span className="text-[7.5pt] font-semibold" style={{ color: INK_SOFT }}>
                              Date:{' '}
                            </span>
                            <span className="tabular-nums">___ / ___ / ______</span>
                          </p>
                        </div>
                        {/* uploaded company stamp — frameless, beside the name */}
                        {stampAsset ? (
                          <img
                            src={stampAsset.dataUrl}
                            alt="Company stamp"
                            className="h-[13mm] w-auto max-w-[24mm] shrink-0 object-contain"
                          />
                        ) : null}
                      </div>
                    </div>

                    {/* ACCEPTED BY — the client (physical signature on paper) */}
                    <div
                      className="rounded-lg border"
                      style={{ borderColor: BORDER, background: 'white' }}
                    >
                      <div
                        className="flex flex-wrap items-center justify-center gap-x-2 gap-y-[0.3mm] rounded-t-[7px] border-b px-[3mm] py-[2px]"
                        style={{ borderColor: BORDER, background: CREAM }}
                      >
                        <p
                          className="whitespace-nowrap text-[8.5pt] font-extrabold uppercase tracking-[0.3pt]"
                          style={{ color: DARK_GOLD }}
                        >
                          Accepted By · Client
                        </p>
                        <GoldDiamond size={4} />
                        <p
                          lang="ar"
                          dir="rtl"
                          className="whitespace-nowrap text-[8.5pt] font-bold leading-none"
                          style={{ color: DARK_GOLD }}
                        >
                          موافقة العميل
                        </p>
                      </div>
                      <div className="flex items-end justify-between gap-[3mm] px-[3mm] py-[1.5mm]">
                        <div className="min-w-0 flex-1 space-y-[0.8mm]">
                          <div className="border-b border-neutral-500" style={{ height: '4mm' }} />
                          <p className="break-words text-[8.5pt] leading-[4mm] text-[#1D2433]">
                            <span className="text-[7.5pt] font-semibold" style={{ color: INK_SOFT }}>
                              Name:{' '}
                            </span>
                            ______________
                            <span className="mx-[2mm]" />
                            <span className="text-[7.5pt] font-semibold" style={{ color: INK_SOFT }}>
                              Date:{' '}
                            </span>
                            <span className="tabular-nums">___ / ___ / ______</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  </section>

                  {noteLine(pageIdx, plan)}
                </div>
              ) : (
                /* continuation pages — the note line alone at the foot */
                noteLine(pageIdx, plan)
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

