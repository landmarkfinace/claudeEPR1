'use client'

// Quotation print preview — multi-page A4 portrait business document.
// Opened from the Quotations table (Print / Preview) and from the editor
// (live draft preview — same component, so the preview always matches the
// final PDF).
//
// Pagination model: the document is split into EXPLICIT A4 pages
// (210mm × 296.5mm — the 0.5mm slack prevents blank interleaved pages from
// sub-pixel rounding in Chrome's print pipeline). Items are chunked across
// pages with a conservative row-height estimator; every page repeats the
// table header, carries the letterhead artwork and a "Page X of Y" footer.
// Signature/stamp assets are absolutely positioned on the LAST page using
// percent-of-page coordinates saved per quotation — exactly reproducing the
// AssetPlacer canvas.
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
import { formatDate, formatMoney, round2 } from '@/lib/format'
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

// ── A4 pagination geometry ──────────────────────────────────────────────────
const PAGE_W_MM = 210
const PAGE_H_MM = 296.5 // 0.5mm print-pipeline slack (see header comment)
const SIDE_PAD_MM = 12

type PageGeometry = {
  padTop: number
  padBottom: number
  page1Fixed: number
}

function geometryFor(letterhead: LetterheadConfig): PageGeometry {
  switch (letterhead.mode) {
    case 'full':
      return {
        padTop: letterhead.headerHeightMm + 4,
        padBottom: Math.max(letterhead.footerHeightMm + 4, 12),
        page1Fixed: 52,
      }
    case 'header':
      return {
        padTop: letterhead.headerHeightMm + 3,
        padBottom: 12,
        page1Fixed: 52,
      }
    case 'header_footer':
      return {
        padTop: letterhead.headerHeightMm + 3,
        padBottom: letterhead.footerHeightMm + 3,
        page1Fixed: 52,
      }
    default:
      return { padTop: 10, padBottom: 13, page1Fixed: 66 }
  }
}

/** Conservative table-row height estimate in mm (over-estimate = safe page breaks). */
function rowHeightMm(it: DocItemRow): number {
  const CHARS_PER_LINE = 56
  const lines = Math.max(1, Math.ceil(it.description.length / CHARS_PER_LINE))
  return 7 + 4 * (lines - 1)
}

function textBlockMm(text: string | null | undefined, baseOverheadMm: number): number {
  if (!text) return 0
  const CHARS_PER_LINE = 96
  const lines = text
    .split('\n')
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / CHARS_PER_LINE)), 0)
  return baseOverheadMm + 4.4 * lines
}

/**
 * Greedy pagination: chunk items into explicit pages, then verify the tail
 * (totals + notes + terms + signature) fits on the final page — if not, the
 * tail moves to its own page.
 */
function paginate(
  items: DocItemRow[],
  geo: PageGeometry,
  tailMm: number
): DocItemRow[][] {
  const availFirst = PAGE_H_MM - geo.padTop - geo.padBottom - geo.page1Fixed
  const availRest = PAGE_H_MM - geo.padTop - geo.padBottom
  const pages: DocItemRow[][] = []
  let cur: DocItemRow[] = []
  let used = 0
  let limit = availFirst

  for (const it of items) {
    const h = rowHeightMm(it)
    if (used + h > limit && cur.length > 0) {
      pages.push(cur)
      cur = []
      used = 0
      limit = availRest
    }
    cur.push(it)
    used += h
  }
  pages.push(cur)

  // Tail must fit on the last page — otherwise it moves to a fresh page
  const lastAvail = pages.length === 1 ? availFirst : availRest
  if (used + tailMm > lastAvail) {
    pages.push([]) // empty items chunk = tail-only page
  }
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
      className={`mt-2 inline-block -rotate-6 rounded-md border-[3px] px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] ${styles[status] ?? styles.draft}`}
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
          Printable A4 quotation with letterhead, line items, totals, terms, signature and stamp.
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
  const money = (n: number) => formatMoney(n, currency)
  const geo = geometryFor(letterhead)

  // Tail = everything after the items table on the last page
  const tailMm =
    58 + // totals table + amount in words
    textBlockMm(q.notes, 12) +
    textBlockMm(q.terms, 12) +
    48 + // validity line + signature blocks
    8
  const pages = paginate(items, geo, tailMm)
  const showDiscountCol = items.some((it) => (it.discount ?? 0) > 0) || q.discount > 0

  const th =
    'border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800'
  const thR = `${th} text-right`
  const td = 'border border-neutral-300 px-1.5 py-1.5 align-top text-neutral-900'
  const tdR = `${td} text-right tabular-nums`

  const metaRows: Array<[string, string]> = [
    ['Quote No', q.quoteNumber],
    ['Issue Date', formatDate(q.issueDate)],
    ['Valid Until', q.validityDate ? formatDate(q.validityDate) : '—'],
  ]
  if (q.referenceNo) metaRows.push(['Ref No', q.referenceNo])

  return (
    <div className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:gap-0">
      {pages.map((chunk, pageIdx) => {
        const isLast = pageIdx === pages.length - 1
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
                    <header className="flex flex-col gap-3 border-b-2 border-[#0F1F3D] pb-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-start gap-3">
                        <img
                          src={settings.logo ?? '/logo-mark.png'}
                          alt={`${companyName} logo`}
                          className="h-16 w-16 shrink-0 object-contain"
                        />
                        <div className="min-w-0">
                          <h2 className="text-lg font-bold uppercase tracking-wide text-[#0F1F3D]">
                            {companyName}
                          </h2>
                          {letterhead.showCompanyDetails && settings.address ? (
                            <p className="mt-0.5 max-w-[330px] text-[10px] leading-relaxed text-neutral-500">
                              {settings.address}
                            </p>
                          ) : null}
                          {letterhead.showCompanyDetails ? (
                            <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-neutral-500">
                              {settings.phone ? <span>Tel: {settings.phone}</span> : null}
                              {settings.email ? <span>Email: {settings.email}</span> : null}
                              {settings.vatNumber ? <span>VAT: {settings.vatNumber}</span> : null}
                              {settings.crNumber ? <span>CR: {settings.crNumber}</span> : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
                        <span className="rounded-md border-l-4 border-[#D4AF37] bg-[#0F1F3D] px-3 py-1.5 text-xs font-bold tracking-widest text-white">
                          QUOTATION
                        </span>
                        <StatusStamp status={q.status} />
                      </div>
                    </header>
                  ) : (
                    /* compact title strip for artwork modes */
                    <div className="flex items-end justify-between gap-3">
                      <span
                        className={`rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-[0.25em] ${
                          letterhead.mode === 'full'
                            ? 'bg-white/85 text-[#0F1F3D] ring-1 ring-neutral-300'
                            : 'bg-[#0F1F3D] text-white'
                        }`}
                      >
                        Quotation
                      </span>
                      <StatusStamp status={q.status} />
                    </div>
                  )}

                  {/* quote meta row (artwork modes — the typed header already
                      carries these for 'none' mode further down) */}
                  {letterhead.mode !== 'none' ? (
                    <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-0.5 text-[10px] text-neutral-600">
                      {metaRows.map(([k, v]) => (
                        <span key={k}>
                          <span className="font-semibold text-neutral-500">{k}:</span>{' '}
                          <span className="font-mono font-semibold">{v}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {/* client + subject block */}
                  <section className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">
                        Quotation For
                      </p>
                      <p className="mt-0.5 text-sm font-bold text-[#0F1F3D]">{q.clientName}</p>
                      {client?.contactPerson ? (
                        <p className="text-[10px] text-neutral-600">Attn: {client.contactPerson}</p>
                      ) : null}
                      {client?.phone ? (
                        <p className="text-[10px] text-neutral-600">Tel: {client.phone}</p>
                      ) : null}
                      {client?.email ? (
                        <p className="text-[10px] text-neutral-600">Email: {client.email}</p>
                      ) : null}
                      {client?.address || client?.city ? (
                        <p className="mt-0.5 text-[10px] leading-relaxed text-neutral-600">
                          {[client?.address, client?.city].filter(Boolean).join(', ')}
                        </p>
                      ) : null}
                      {client?.crNumber || client?.vatNumber ? (
                        <p className="text-[10px] text-neutral-600">
                          {client.crNumber ? `CR No: ${client.crNumber}` : ''}
                          {client.crNumber && client.vatNumber ? ' · ' : ''}
                          {client.vatNumber ? `VAT No: ${client.vatNumber}` : ''}
                        </p>
                      ) : null}
                    </div>
                    <div>
                      {letterhead.mode === 'none' ? (
                        <div className="flex flex-col gap-0.5 text-[10px] text-neutral-600">
                          {metaRows.map(([k, v]) => (
                            <span key={k}>
                              <span className="font-semibold text-neutral-500">{k}:</span>{' '}
                              <span className="font-mono font-semibold">{v}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                      <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">
                        Subject
                      </p>
                      <p className="mt-0.5 text-[11px] font-medium leading-snug text-neutral-800">
                        {q.subject || '—'}
                      </p>
                    </div>
                  </section>

                  {/* items table heading */}
                  <h3 className="mb-1.5 mt-3 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Description of Goods / Services
                  </h3>
                </>
              ) : (
                /* continuation header on later item pages (tail-only pages skip it) */
                chunk.length > 0 ? (
                  <div className="flex items-baseline justify-between border-b border-neutral-200 pb-1">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-[#0F1F3D]">
                      {companyName} — Quotation{' '}
                      <span className="font-mono">{q.quoteNumber}</span>
                    </p>
                    <p className="text-[10px] italic text-neutral-500">continued</p>
                  </div>
                ) : null
              )}

              {/* items chunk — thead repeats on every page (tail-only pages skip the table) */}
              {chunk.length > 0 || pageIdx === 0 ? (
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr>
                      <th className={`${th} w-[30px]`}>Sr</th>
                      <th className={th}>Description</th>
                      <th className={`${th} w-[58px]`}>Unit</th>
                      <th className={`${thR} w-[46px]`}>Qty</th>
                      <th className={`${thR} w-[72px]`}>Unit Price</th>
                      {showDiscountCol ? <th className={`${thR} w-[62px]`}>Disc.</th> : null}
                      <th className={`${thR} w-[80px]`}>Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chunk.length === 0 ? (
                      <tr>
                        <td className={`${td} text-center text-neutral-400`} colSpan={showDiscountCol ? 7 : 6}>
                          No line items yet
                        </td>
                      </tr>
                    ) : (
                      chunk.map((it) => (
                        <tr key={it.id ?? `${it.sr}-${it.description.slice(0, 12)}`} className="break-inside-avoid">
                          <td className={`${td} text-center tabular-nums`}>{it.sr}</td>
                          <td className={td}>{it.description}</td>
                          <td className={td}>{it.unit ?? '—'}</td>
                          <td className={tdR}>{it.quantity.toLocaleString('en-US')}</td>
                          <td className={tdR}>{money(it.unitPrice)}</td>
                          {showDiscountCol ? (
                            <td className={tdR}>
                              {(it.discount ?? 0) > 0 ? `-${money(it.discount ?? 0)}` : '—'}
                            </td>
                          ) : null}
                          <td className={`${tdR} font-semibold`}>{money(it.lineTotal)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              ) : null}

              {/* ── tail (totals / notes / terms / signatures) — last page only ── */}
              {isLast ? (
                <div className="mt-auto flex flex-col">
                  {/* TOTALS */}
                  <section className="mt-4 break-inside-avoid">
                    <div className="ml-auto w-full sm:w-[340px]">
                      <table className="w-full border-collapse text-[11px]">
                        <tbody>
                          <tr>
                            <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                              Subtotal
                            </td>
                            <td className={`${tdR} border border-neutral-300 px-2.5 py-1.5`}>
                              {money(q.subtotal)}
                            </td>
                          </tr>
                          {q.discount > 0 ? (
                            <tr>
                              <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                                Discount
                              </td>
                              <td className={`${tdR} border border-neutral-300 px-2.5 py-1.5 text-rose-700`}>
                                -{money(q.discount)}
                              </td>
                            </tr>
                          ) : null}
                          <tr>
                            <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                              Net Amount
                            </td>
                            <td className={`${tdR} border border-neutral-300 px-2.5 py-1.5`}>
                              {money(netTotal)}
                            </td>
                          </tr>
                          <tr>
                            <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                              VAT ({vatPercent}%)
                            </td>
                            <td className={`${tdR} border border-neutral-300 px-2.5 py-1.5`}>
                              {money(q.vatAmount)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <div className="mt-1.5 flex items-center justify-between bg-[#0F1F3D] px-3 py-2.5 text-white">
                        <span className="text-sm font-bold tracking-wide">TOTAL</span>
                        <span className="text-lg font-bold tabular-nums">{money(q.total)}</span>
                      </div>
                      <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-600">
                        <span className="font-semibold uppercase tracking-wide">Amount in words:</span>{' '}
                        {amountInWords(q.total, currency)}
                      </p>
                    </div>
                  </section>

                  {/* NOTES + TERMS */}
                  {q.notes || q.terms ? (
                    <section className="mt-3 space-y-2.5">
                      {q.notes ? (
                        <div className="break-inside-avoid rounded-lg border border-neutral-300 p-3">
                          <h3 className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">
                            Notes
                          </h3>
                          <p className="mt-1 whitespace-pre-line text-[10px] leading-relaxed text-neutral-700">
                            {q.notes}
                          </p>
                        </div>
                      ) : null}
                      {q.terms ? (
                        <div className="break-inside-avoid rounded-lg border border-neutral-300 p-3">
                          <h3 className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">
                            Terms &amp; Conditions
                          </h3>
                          <p className="mt-1 whitespace-pre-line text-[10px] leading-relaxed text-neutral-700">
                            {q.terms}
                          </p>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {/* VALIDITY + SIGNATURES */}
                  <p className="mt-3 text-[10px] text-neutral-600">
                    {q.validityDate
                      ? `This quotation is valid until ${formatDate(q.validityDate)}. Prices are subject to change after the validity date.`
                      : 'Prices quoted are valid for acceptance as mutually agreed.'}
                  </p>

                  <div className="relative mt-4 grid grid-cols-2 gap-x-10">
                    {/* client acceptance */}
                    <div>
                      <div className="flex h-12 items-end">
                        <div className="w-full border-t border-neutral-800" />
                      </div>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-neutral-900">
                        Accepted By
                      </p>
                      <p className="text-[10px] italic text-neutral-400">
                        For the client — name, signature &amp; company stamp
                      </p>
                      <p className="mt-0.5 text-[10px] text-neutral-500">Date: ______________</p>
                    </div>
                    {/* authorized signatory */}
                    <div>
                      <div className="flex h-12 items-end">
                        <div className="w-full border-t border-neutral-800" />
                      </div>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-neutral-900">
                        Authorized Signatory
                      </p>
                      <p className="truncate text-[11px] font-semibold text-neutral-900">
                        {settings.authorizedSignatory || q.createdByName || preparedBy || '—'}
                      </p>
                      <p className="truncate text-[10px] text-neutral-500">
                        {settings.signatoryTitle || 'Authorized Signatory'} · {companyName}
                      </p>
                    </div>
                  </div>

                  <p className="mt-2 text-center text-[9px] text-neutral-400">
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
            <div className="pointer-events-none absolute inset-x-[12mm] bottom-[3.5mm] flex items-center justify-between border-t border-neutral-200 pt-[1mm] text-[8px] text-neutral-400">
              <span className="truncate">
                {companyName} · {q.quoteNumber}
                {q.referenceNo ? ` · Ref ${q.referenceNo}` : ''}
              </span>
              <span className="shrink-0 tabular-nums">
                Page {pageIdx + 1} of {pages.length}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
