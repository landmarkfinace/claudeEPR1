'use client'

// Quotation print template — "Sidebar Cream".
// Reference: upload/Quotation_Template_Sidebar_1_Cream(_Reference.html) —
// layout, spacing, colors and typography copied from the reference; ALL
// data comes from the same QuotationDetail the Classic template renders
// (numbers, rates, status and terms are identical across templates).
//
//   • Cream sidebar (64mm) with a gold edge gradient, running the full
//     height of every page between the letterhead bands: subject label,
//     QUOTATION / عرض سعر, quotation number + status pill, DETAILS,
//     PREPARED FOR (client EN + AR, attn, phone, email, address, VAT, C.R.)
//     and the navy PROJECT / SITE box pinned to the sidebar's foot.
//   • Main column: title block, items table (# | Trade / Category | Hours |
//     Hourly Rate (SAR)), the rates note, TERMS & CONDITIONS and the
//     signature boxes (APPROVED BY · Landmark | ACCEPTED BY · Client).
//   • Continuation pages: mini sidebar (quotation number + client name +
//     "continued · تابع") and the table header repeats.
//   • Signature boxes pin to the BOTTOM of the LAST page, directly above
//     the letterhead footer band; T&C + signatures always move together.
//   • Letterhead artwork comes from Settings (shared /api/letterhead),
//     never from the reference file.
import type { AppSettings, LetterheadConfig } from '@/lib/types'
import { parseTerms, type TermItem } from '@/lib/quotation-terms'

import {
  BORDER,
  DARK_GOLD,
  DOC_FONT,
  GOLD,
  INK,
  INK_SOFT,
  LIGHT_GOLD,
  NAVY,
  PAGE_H_MM,
  PAGE_W_MM,
  ROW_SEP,
  SIDE_CREAM,
  SIDE_CREAM_BORDER,
  SIDE_CREAM_DOT,
  TRADE_AR,
  type ApprovedBy,
  type QuotationDetail,
  LetterheadLayers,
  estLines,
  fmtDate,
  fmtRate,
  geometryFor,
  planSidebarPages,
} from './quotation-print-shared'

// ── palette (reference: Sidebar Cream) ─────────────────────────────────────
const CREAM_SIDE = SIDE_CREAM
const CREAM_BORDER = SIDE_CREAM_BORDER
const CREAM_DOT = SIDE_CREAM_DOT
const CREAM_INK_SOFT = '#4A5468'
const PRJ_SUB = '#C9D3E3'

/** Status pill colors (same semantic mapping as Classic's stamp). */
const STATUS_COLORS: Record<string, string> = {
  draft: '#6B7280',
  sent: '#D9822B',
  accepted: '#059669',
  rejected: '#E11D48',
  expired: '#A16207',
}

// ── conservative height estimators (calibrated against the reference CSS) ──

/** Items-table row: 2.6mm padding × 2 + wrapped trade lines + sub-text. */
function rowHeightMm(desc: string, subText: string | null): number {
  const arChars = TRADE_AR[desc.trim().toUpperCase()]?.length ?? 0
  const lines = Math.max(1, Math.ceil((desc.length + arChars + 2) / 24))
  const subLines = subText ? Math.max(1, Math.ceil(subText.length / 30)) : 0
  return 5.2 + lines * 4.2 + subLines * 3.4
}

/** TERMS & CONDITIONS single-column list height. */
function termsListMm(items: TermItem[]): number {
  return (
    items.reduce(
      (s, t) => s + estLines(`${t.title ? `${t.title}: ` : ''}${t.text}`, 80) * 3.2 + 1,
      0
    ) + 2
  )
}

// fixed blocks (mm) — title block + table top on page 1, repeated thead after
const PAGE1_FIXED_MM = 31
const REST_FIXED_MM = 11
const SIG_MM = 25
const FOOT_MM = 5.6

/**
 * The "Sidebar Cream" A4 quotation document — a stack of explicit A4 pages.
 * Purely presentational: renders exactly the data it is given.
 */
export function SidebarCreamQuotationDocument({
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
  const q = quotation
  const client = q.client
  const items = q.items ?? []
  const currency = settings.currency || 'SAR'
  const companyName = settings.companyName || 'Landmark Inter Gulf'
  const approverLabel = companyName.split(/\s+/)[0] || companyName

  const assets = (q.assets ?? []).filter((a) => a.visible)
  const signatureAsset = assets.find((a) => a.type === 'signature') ?? null
  const stampAsset = assets.find((a) => a.type === 'stamp') ?? null

  const terms = parseTerms(q.terms)
  const subjectLabel = (q.subject || 'Manpower Supply').toUpperCase()
  const geo = geometryFor(letterhead)

  const address = [client?.address, client?.city].filter(Boolean).join(', ')

  // ── pagination ──
  const notesMm = q.notes ? 1.2 + estLines(q.notes, 88) * 3.4 : 0
  const tailMm =
    4.8 + 10.4 + termsListMm(terms) + notesMm + SIG_MM + FOOT_MM + 2 // note + tch + list + notes + sig + foot + safety
  const plans = planSidebarPages({
    items,
    rowMm: (it) => rowHeightMm(it.description, it.subText ?? null),
    page1FixedMm: PAGE1_FIXED_MM,
    restFixedMm: REST_FIXED_MM,
    tailMm,
    topMm: geo.topMm,
    bottomMm: geo.bottomMm,
  })

  const statusColor = STATUS_COLORS[q.status] ?? STATUS_COLORS.draft

  /** The bottom foot line — quote number · bilingual page numbers · printed date. */
  const footLine = (pageIdx: number, pinned: boolean) => (
    <div
      className={`flex items-center justify-between text-[6.4pt] ${pinned ? '' : 'mt-auto'}`}
      style={{ color: CREAM_INK_SOFT, marginTop: pinned ? '2.2mm' : undefined }}
    >
      <span className="font-mono">{q.quoteNumber}</span>
      <span>
        Page {pageIdx + 1} of {plans.length} ·{' '}
        <span lang="ar" dir="rtl">
          صفحة {pageIdx + 1} من {plans.length}
        </span>
      </span>
      <span>Printed {fmtDate(new Date().toISOString())}</span>
    </div>
  )

  /** One dotted DETAILS row (EN label + small AR, mono value). */
  const detailRow = (en: string, ar: string, value: string) => (
    <div
      className="flex items-center justify-between py-[1mm]"
      style={{ borderBottom: `1px dotted ${CREAM_DOT}`, fontSize: '7.6pt' }}
    >
      <span style={{ color: CREAM_INK_SOFT, lineHeight: 1.25 }}>
        {en}
        <small className="block text-[6.6pt]" lang="ar" dir="rtl">
          {ar}
        </small>
      </span>
      <b className="whitespace-nowrap font-mono" style={{ color: INK }}>
        {value}
      </b>
    </div>
  )

  return (
    <div
      className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:gap-0"
      style={{ fontFamily: DOC_FONT }}
    >
      {plans.map((plan, pageIdx) => {
        const isLast = pageIdx === plans.length - 1
        // the LAST page that carries item rows — the rates note follows the table there
        const lastItemsPage =
          plan.items.length > 0 && !plans.slice(pageIdx + 1).some((p) => p.items.length > 0)
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
            {/* letterhead artwork / placeholder zones (from Settings) */}
            <LetterheadLayers letterhead={letterhead} geo={geo} />

            {/* sidebar + main column — the sidebar runs the full page height
                between the letterhead bands on EVERY page */}
            <div
              className="absolute inset-0 z-10 grid"
              style={{
                gridTemplateColumns: '64mm 1fr',
                paddingTop: `${geo.topMm}mm`,
                paddingBottom: `${geo.bottomMm}mm`,
              }}
            >
              {/* ── sidebar ── */}
              {pageIdx === 0 ? (
                <aside
                  className="relative flex flex-col"
                  style={{
                    background: CREAM_SIDE,
                    borderRight: `1px solid ${CREAM_BORDER}`,
                    padding: '4mm 5mm 4mm 14mm',
                  }}
                >
                  {/* gold edge gradient strip */}
                  <div
                    aria-hidden
                    className="absolute bottom-0 left-0 top-0"
                    style={{ width: '3mm', background: `linear-gradient(${LIGHT_GOLD}, ${DARK_GOLD})` }}
                  />
                  {/* subject label */}
                  <p
                    className="text-[7pt] font-bold"
                    style={{ color: DARK_GOLD, letterSpacing: '1pt' }}
                  >
                    {subjectLabel}
                    <span className="block text-[7.6pt]" lang="ar" dir="rtl" style={{ letterSpacing: 0 }}>
                      توريد عمالة
                    </span>
                  </p>
                  <p
                    className="mt-[1.5mm] text-[18pt] font-bold leading-none"
                    style={{ color: NAVY, letterSpacing: '0.5pt' }}
                  >
                    QUOTATION
                  </p>
                  <p className="mt-[0.5mm] text-[11pt] font-bold leading-none" lang="ar" dir="rtl" style={{ color: NAVY }}>
                    عرض سعر
                  </p>

                  {/* quotation number + status */}
                  <div
                    className="mt-[2.5mm] flex items-center justify-between py-[1.6mm]"
                    style={{ borderTop: '1.2px solid #C0934C', borderBottom: '1.2px solid #C0934C' }}
                  >
                    <span className="font-mono text-[10.5pt] font-bold" style={{ color: NAVY }}>
                      {q.quoteNumber}
                    </span>
                    <span
                      className="rounded-[10mm] px-[2.2mm] py-[0.5mm] text-[6.4pt] font-bold uppercase"
                      style={{ background: statusColor, color: '#fff' }}
                    >
                      {q.status}
                    </span>
                  </div>

                  {/* DETAILS */}
                  <section className="mt-[3.6mm]">
                    <div
                      className="mb-[1.2mm] flex items-center justify-between text-[6.6pt] font-bold"
                      style={{ color: DARK_GOLD, letterSpacing: '0.5pt' }}
                    >
                      <span>DETAILS</span>
                      <span lang="ar" dir="rtl" style={{ letterSpacing: 0, fontSize: '7.2pt' }}>
                        التفاصيل
                      </span>
                    </div>
                    {detailRow('Date', 'التاريخ', fmtDate(q.issueDate))}
                    {detailRow('Valid Until', 'صالح حتى', fmtDate(q.validityDate))}
                    {detailRow('Your Reference', 'مرجعكم', q.referenceNo || '—')}
                    {detailRow('Currency', 'العملة', currency)}
                  </section>

                  {/* PREPARED FOR */}
                  <section className="mt-[3.6mm]">
                    <div
                      className="mb-[1.2mm] flex items-center justify-between text-[6.6pt] font-bold"
                      style={{ color: DARK_GOLD, letterSpacing: '0.5pt' }}
                    >
                      <span>PREPARED FOR</span>
                      <span lang="ar" dir="rtl" style={{ letterSpacing: 0, fontSize: '7.2pt' }}>
                        أعد لصالح
                      </span>
                    </div>
                    <p className="text-[9pt] font-bold leading-[1.3]" style={{ color: NAVY }}>
                      {q.clientName}
                    </p>
                    {client?.nameAr ? (
                      <p
                        className="mt-[0.4mm] text-right text-[8.4pt] font-bold"
                        lang="ar"
                        dir="rtl"
                        style={{ color: NAVY }}
                      >
                        {client.nameAr}
                      </p>
                    ) : null}
                    <div className="mt-[1.2mm] text-[7.3pt] leading-[1.5]" style={{ color: CREAM_INK_SOFT }}>
                      {client?.contactPerson ? (
                        <p>
                          Attn: <b style={{ color: INK }}>{client.contactPerson}</b>
                        </p>
                      ) : null}
                      {client?.phone ? (
                        <p className="font-bold" style={{ color: INK }}>
                          {client.phone}
                        </p>
                      ) : null}
                      {client?.email ? <p>{client.email}</p> : null}
                      {address ? <p>{address}</p> : null}
                      {client?.vatNumber ? (
                        <p>
                          VAT <b className="font-mono">{client.vatNumber}</b>
                        </p>
                      ) : null}
                      {client?.crNumber ? (
                        <p>
                          C.R. <b className="font-mono">{client.crNumber}</b>
                        </p>
                      ) : null}
                    </div>
                  </section>

                  {/* PROJECT / SITE — pinned to the sidebar's foot */}
                  <div
                    className="mt-auto rounded-[2.5mm] p-[3mm]"
                    style={{ background: NAVY, color: '#fff', paddingLeft: '3.5mm' }}
                  >
                    <p
                      className="flex items-center justify-between text-[6.6pt] font-bold"
                      style={{ color: LIGHT_GOLD, letterSpacing: '0.5pt' }}
                    >
                      <span>PROJECT / SITE</span>
                      <span lang="ar" dir="rtl" style={{ letterSpacing: 0 }}>
                        المشروع / الموقع
                      </span>
                    </p>
                    <b className="mt-[1.2mm] block text-[10pt] leading-tight">{q.projectName || '—'}</b>
                    {q.projectLocation ? (
                      <i className="mt-[0.5mm] block text-[7.4pt] not-italic" style={{ color: PRJ_SUB }}>
                        {q.projectLocation}
                      </i>
                    ) : null}
                  </div>
                </aside>
              ) : (
                /* ── mini sidebar (continuation pages): number · client · continued ── */
                <aside
                  className="relative flex flex-col"
                  style={{
                    background: CREAM_SIDE,
                    borderRight: `1px solid ${CREAM_BORDER}`,
                    padding: '4mm 5mm 4mm 14mm',
                  }}
                >
                  <div
                    aria-hidden
                    className="absolute bottom-0 left-0 top-0"
                    style={{ width: '3mm', background: `linear-gradient(${LIGHT_GOLD}, ${DARK_GOLD})` }}
                  />
                  <p className="font-mono text-[10.5pt] font-bold" style={{ color: NAVY }}>
                    {q.quoteNumber}
                  </p>
                  <div className="mt-[1.5mm] h-[1.2px] w-full" style={{ background: '#C0934C' }} />
                  <p className="mt-[2mm] break-words text-[8.5pt] font-bold leading-snug" style={{ color: NAVY }}>
                    {q.clientName}
                  </p>
                  <p className="mt-auto text-[7.5pt] font-bold italic" style={{ color: DARK_GOLD }}>
                    continued · <span lang="ar" dir="rtl">تابع</span>
                  </p>
                </aside>
              )}

              {/* ── main column ── */}
              <div className="flex min-w-0 flex-col" style={{ padding: '4mm 14mm 0 6mm' }}>
                {pageIdx === 0 ? (
                  <>
                    <p className="text-[11pt] font-bold leading-[1.35]" style={{ color: NAVY }}>
                      Quotation for Supply of Skilled &amp; Unskilled Manpower
                      <small className="mt-[0.8mm] block text-[7.6pt] font-normal leading-snug" style={{ color: CREAM_INK_SOFT }}>
                        Dear Sir, we are pleased to submit our most competitive rates. All workers are
                        experienced, medically fit and hold valid Iqama.
                      </small>
                    </p>
                    <p
                      className="mt-[0.6mm] text-right text-[9pt] font-bold"
                      lang="ar"
                      dir="rtl"
                      style={{ color: NAVY }}
                    >
                      عرض سعر لتوريد العمالة الماهرة وغير الماهرة
                    </p>
                  </>
                ) : null}

                {/* items table — thead repeats on every page that carries rows */}
                <table
                  className="mt-[3.5mm] w-full border-collapse text-[8.5pt]"
                  style={{ tableLayout: 'fixed' }}
                >
                  <colgroup>
                    <col style={{ width: '8mm' }} />
                    <col />
                    <col style={{ width: '34mm' }} />
                    <col style={{ width: '34mm' }} />
                  </colgroup>
                  <thead style={{ display: 'table-header-group' }}>
                    <tr>
                      {(
                        [
                          ['#', ''],
                          ['Trade / Category', 'المهنة / الفئة'],
                          ['Hours', 'الساعات'],
                          ['Hourly Rate (SAR)', 'السعر بالساعة (ريال)'],
                        ] as Array<[string, string]>
                      ).map(([en, ar], i) => (
                        <th
                          key={en}
                          className={`px-[2mm] pb-[1.6mm] text-left align-bottom text-[7pt] font-bold leading-[1.3] ${
                            i === 0 ? 'text-center' : i === 2 ? 'text-center' : i === 3 ? 'text-right' : ''
                          }`}
                          style={{ borderBottom: `1.6px solid ${NAVY}`, color: NAVY }}
                        >
                          {en}
                          {ar ? (
                            <span
                              className={`block font-normal ${i === 3 ? 'text-right' : ''}`}
                              style={{ color: CREAM_INK_SOFT }}
                              lang="ar"
                              dir="rtl"
                            >
                              {ar}
                            </span>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.items.length === 0 && pageIdx === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          className="py-[2mm] text-center text-[8pt]"
                          style={{ borderBottom: `1px solid ${BORDER}`, color: CREAM_INK_SOFT }}
                        >
                          No line items yet
                        </td>
                      </tr>
                    ) : (
                      plan.items.map((it, i) => {
                        const tradeAr = TRADE_AR[it.description.trim().toUpperCase()] ?? null
                        return (
                          <tr key={it.id ?? `${it.sr}-${i}`} style={{ borderBottom: `1px solid ${ROW_SEP}` }}>
                            <td
                              className="py-[2.6mm] text-center font-mono text-[8.5pt] font-bold"
                              style={{ color: GOLD }}
                            >
                              {String(it.sr).padStart(2, '0')}
                            </td>
                            <td className="px-[2mm] py-[2.6mm] align-top leading-[1.2]" style={{ color: INK }}>
                              <p className="break-words text-[8.5pt] font-bold">
                                {it.description}
                                {tradeAr ? (
                                  <>
                                    {' '}
                                    <span className="text-[7.8pt] font-semibold" lang="ar" dir="rtl" style={{ color: CREAM_INK_SOFT }}>
                                      {tradeAr}
                                    </span>
                                  </>
                                ) : null}
                              </p>
                              {it.subText ? (
                                <p className="break-words text-[7.5pt] italic leading-[1.2]" style={{ color: CREAM_INK_SOFT }}>
                                  {it.subText}
                                </p>
                              ) : null}
                            </td>
                            <td className="py-[2.6mm] text-center text-[8.5pt] tabular-nums" style={{ color: INK }}>
                              {it.quantity.toLocaleString('en-US')}
                            </td>
                            <td className="py-[2.6mm] text-right" style={{ color: INK }}>
                              <span className="font-mono text-[10pt] font-bold" style={{ color: NAVY }}>
                                {fmtRate(it.unitPrice)}
                              </span>
                              <small className="ml-[1mm] text-[6.6pt]" style={{ color: CREAM_INK_SOFT }}>
                                / hr
                              </small>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>

                {/* rates note — under the table on the last items page */}
                {lastItemsPage ? (
                  <p
                    className="mt-[1.4mm] text-right text-[7pt] italic leading-snug"
                    style={{ color: CREAM_INK_SOFT }}
                  >
                    * Rates are per hour per worker, in Saudi Riyals, excluding VAT.
                  </p>
                ) : null}

                {/* ── tail: TERMS & CONDITIONS + signatures (always together) ── */}
                {plan.tail ? (
                  <>
                    <div
                      className="mt-[5mm] flex items-center justify-between border-b pb-[1.4mm] text-[7.6pt] font-bold"
                      style={{ borderColor: '#C0934C', color: DARK_GOLD, letterSpacing: '0.6pt' }}
                    >
                      <span>TERMS &amp; CONDITIONS</span>
                      <span lang="ar" dir="rtl" style={{ letterSpacing: 0, fontSize: '8.2pt' }}>
                        الشروط والأحكام
                      </span>
                    </div>
                    {terms.length === 0 ? (
                      <p className="mt-[2mm] text-[7.5pt]" style={{ color: INK_SOFT }}>
                        As mutually agreed between the parties.
                      </p>
                    ) : (
                      <ol className="mt-[2mm] pl-[5mm] text-[7.5pt] leading-[1.42]" style={{ color: INK }}>
                        {terms.map((t, i) => (
                          <li key={i} className="mb-[1mm] break-words pl-[0.8mm]">
                            {t.title ? (
                              <>
                                <b style={{ color: NAVY }}>{t.title}: </b>
                                {t.text}
                              </>
                            ) : (
                              t.text
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                    {q.notes ? (
                      <p
                        className="mt-[1.2mm] whitespace-pre-line border-t pt-[1.2mm] text-[7.5pt] italic leading-[1.35]"
                        style={{ borderColor: BORDER, color: INK_SOFT }}
                      >
                        {q.notes}
                      </p>
                    ) : null}

                    <div className="sp flex-1" />

                    {/* signatures — pinned to the bottom of the LAST page */}
                    <div className="grid grid-cols-2 gap-[6mm]">
                      <div>
                        <div
                          className="flex items-center justify-between text-[7pt] font-bold"
                          style={{ color: DARK_GOLD, letterSpacing: '0.4pt' }}
                        >
                          <span className="uppercase">Approved By · {approverLabel}</span>
                          <span lang="ar" dir="rtl" style={{ letterSpacing: 0 }}>
                            اعتماد الشركة
                          </span>
                        </div>
                        <div className="relative mt-[1mm]" style={{ height: '12mm', borderBottom: `1px solid ${NAVY}` }}>
                          {signatureAsset ? (
                            <img
                              src={signatureAsset.dataUrl}
                              alt="Authorized signature"
                              className="absolute bottom-[0.7mm] left-0 h-[calc(100%-1.4mm)] max-w-full object-contain object-left-bottom"
                            />
                          ) : null}
                        </div>
                        <div className="mt-[1.4mm] flex items-end justify-between gap-[3mm]">
                          <p className="text-[7.2pt]" style={{ color: CREAM_INK_SOFT }}>
                            Name: {approvedBy?.name || '______________________________'}
                          </p>
                          {stampAsset ? (
                            <img
                              src={stampAsset.dataUrl}
                              alt="Company stamp"
                              className="h-[11mm] w-auto max-w-[20mm] shrink-0 object-contain"
                            />
                          ) : null}
                        </div>
                        <p className="mt-[0.8mm] text-[7.2pt] tabular-nums" style={{ color: CREAM_INK_SOFT }}>
                          Date: ____ / ____ / ________
                        </p>
                      </div>
                      <div>
                        <div
                          className="flex items-center justify-between text-[7pt] font-bold"
                          style={{ color: DARK_GOLD, letterSpacing: '0.4pt' }}
                        >
                          <span className="uppercase">Accepted By · Client</span>
                          <span lang="ar" dir="rtl" style={{ letterSpacing: 0 }}>
                            موافقة العميل
                          </span>
                        </div>
                        <div className="mt-[1mm]" style={{ height: '12mm', borderBottom: `1px solid ${NAVY}` }} />
                        <p className="mt-[1.4mm] text-[7.2pt]" style={{ color: CREAM_INK_SOFT }}>
                          Name: ______________________________
                        </p>
                        <p className="mt-[0.8mm] text-[7.2pt] tabular-nums" style={{ color: CREAM_INK_SOFT }}>
                          Date: ____ / ____ / ________
                        </p>
                      </div>
                    </div>

                    {footLine(pageIdx, true)}
                  </>
                ) : (
                  footLine(pageIdx, false)
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
