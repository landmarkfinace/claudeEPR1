'use client'

// Quotation print template — "Sidebar Navy".
// Reference: upload/Quotation_Template_Sidebar_2_Navy(_Reference.html) —
// layout, spacing, colors and typography copied from the reference; ALL
// data comes from the same QuotationDetail the Classic template renders
// (numbers, rates, status and terms are identical across templates).
//
//   • Deep navy gradient sidebar (62mm) with a gold edge ring decoration,
//     running the full height of every page between the letterhead bands:
//     subject label, QUOTATION / عرض سعر, boxed quotation number + status
//     pill, DETAILS, PREPARED FOR (client EN + AR, attn, phone, email,
//     address, VAT, C.R.) and the company brand block at the sidebar's foot.
//   • Main column: title + compact PROJECT / SITE box, intro line, item
//     CARDS (# | Trade / Category | Hours | Hourly Rate (SAR)), the rates
//     note, TERMS & CONDITIONS (circled numbers) and the signature boxes.
//   • Continuation pages: mini sidebar (quotation number + client name +
//     "continued · تابع") and the card header repeats.
//   • Signature boxes pin to the BOTTOM of the LAST page, directly above
//     the letterhead footer band; T&C + signatures always move together.
//   • Letterhead artwork comes from Settings (shared /api/letterhead),
//     never from the reference file.
import type { AppSettings, LetterheadConfig } from '@/lib/types'
import { parseTerms, type TermItem } from '@/lib/quotation-terms'

import {
  BORDER,
  DOC_FONT,
  GOLD,
  INK,
  INK_SOFT,
  NAVY,
  PAGE_H_MM,
  PAGE_W_MM,
  SIDE_CREAM,
  SIDE_CREAM_BORDER,
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

// ── palette (reference: Sidebar Navy) ──────────────────────────────────────
const SIDE_GRADIENT = 'linear-gradient(180deg, #132A4A 0%, #0C1D33 100%)'
const RING = 'rgba(225,177,105,.07)'
const LABEL_GOLD = '#E1B169'
const VALUE_SOFT = '#C9D3E3'
const SMALL_SOFT = '#93A6C2'
const LINE_SOFT = 'rgba(255,255,255,.18)'
const CREAM_INK_SOFT = '#4A5468'
const TITLE_GOLD = '#8E6420'

/** Status pill — gold pill with navy text (reference design). */
function StatusPill({ status }: { status: string }) {
  return (
    <span
      className="mt-[1.4mm] inline-block rounded-[10mm] px-[2.2mm] py-[0.4mm] text-[6.2pt] font-bold uppercase"
      style={{ background: LABEL_GOLD, color: NAVY }}
    >
      {status}
    </span>
  )
}

// ── conservative height estimators (calibrated against the reference CSS) ──

/** Item card: 2.4mm padding × 2 + trade EN + AR lines (+ wrap allowance). */
function rowHeightMm(desc: string): number {
  const lines = Math.max(1, Math.ceil(desc.length / 22))
  return 16 + (lines - 1) * 4.8
}

/** TERMS & CONDITIONS single-column list height (circled numbers). */
function termsListMm(items: TermItem[]): number {
  return (
    items.reduce(
      (s, t) => s + estLines(`${t.title ? `${t.title}: ` : ''}${t.text}`, 80) * 3.2 + 1.3,
      0
    ) + 2.2
  )
}

// fixed blocks (mm) — title row + intro + card header on page 1, repeated after
const PAGE1_FIXED_MM = 36
const REST_FIXED_MM = 8
const SIG_MM = 25
const FOOT_MM = 5.6

/**
 * The "Sidebar Navy" A4 quotation document — a stack of explicit A4 pages.
 * Purely presentational: renders exactly the data it is given.
 */
export function SidebarNavyQuotationDocument({
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
    4.8 + 9.6 + termsListMm(terms) + notesMm + SIG_MM + FOOT_MM + 2 // note + tch + list + notes + sig + foot + safety
  const plans = planSidebarPages({
    items,
    rowMm: (it) => rowHeightMm(it.description),
    page1FixedMm: PAGE1_FIXED_MM,
    restFixedMm: REST_FIXED_MM,
    tailMm,
    topMm: geo.topMm,
    bottomMm: geo.bottomMm,
  })

  /** One DETAILS row (EN label + small AR, mono value). */
  const detailRow = (en: string, ar: string, value: string) => (
    <div
      className="flex items-center justify-between py-[1.1mm] text-[7.6pt]"
      style={{ borderBottom: `1px solid ${LINE_SOFT}` }}
    >
      <span style={{ color: VALUE_SOFT, lineHeight: 1.25 }}>
        {en}
        <small className="block text-[6.6pt]" lang="ar" dir="rtl" style={{ color: SMALL_SOFT }}>
          {ar}
        </small>
      </span>
      <b className="whitespace-nowrap font-mono text-white">{value}</b>
    </div>
  )

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

  return (
    <div
      className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:gap-0"
      style={{ fontFamily: DOC_FONT }}
    >
      {plans.map((plan, pageIdx) => {
        const isLast = pageIdx === plans.length - 1
        // the LAST page that carries item rows — the rates note follows the cards there
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
                gridTemplateColumns: '62mm 1fr',
                paddingTop: `${geo.topMm}mm`,
                paddingBottom: `${geo.bottomMm}mm`,
              }}
            >
              {/* ── sidebar ── */}
              {pageIdx === 0 ? (
                <aside
                  className="relative flex flex-col overflow-hidden"
                  style={{ background: SIDE_GRADIENT, padding: '5mm 5mm 5mm 14mm' }}
                >
                  {/* decorative gold ring */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute"
                    style={{
                      right: '-18mm',
                      bottom: '28mm',
                      width: '52mm',
                      height: '52mm',
                      borderRadius: '50%',
                      border: `9mm solid ${RING}`,
                    }}
                  />
                  <div className="relative z-[1] flex flex-col">
                    <p className="text-[6.6pt] font-bold" style={{ color: LABEL_GOLD, letterSpacing: '1pt' }}>
                      {subjectLabel}
                      <span className="block" lang="ar" dir="rtl" style={{ letterSpacing: 0 }}>
                        توريد عمالة
                      </span>
                    </p>
                    <p
                      className="mt-[2mm] text-[19pt] font-bold leading-none text-white"
                      style={{ letterSpacing: '1pt' }}
                    >
                      QUOTATION
                    </p>
                    <p className="mt-[1.2mm] text-[11pt] font-bold leading-none" lang="ar" dir="rtl" style={{ color: LABEL_GOLD }}>
                      عرض سعر
                    </p>

                    {/* boxed quotation number + status */}
                    <div
                      className="mt-[4mm] rounded-[2mm] p-[2mm] pl-[3mm]"
                      style={{ border: '1.2px solid #C0934C' }}
                    >
                      <small className="block text-[6.4pt]" style={{ color: SMALL_SOFT }}>
                        QUOTATION NO. · <span lang="ar" dir="rtl">رقم العرض</span>
                      </small>
                      <b className="mt-[0.4mm] block font-mono text-[11pt]" style={{ color: LABEL_GOLD }}>
                        {q.quoteNumber}
                      </b>
                    </div>
                    <StatusPill status={q.status} />

                    {/* DETAILS */}
                    <section className="mt-[4.5mm]">
                      <div
                        className="mb-[1.2mm] flex items-center justify-between border-b pb-[1.2mm] text-[6.6pt] font-bold"
                        style={{ borderColor: LINE_SOFT, color: LABEL_GOLD, letterSpacing: '0.6pt' }}
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
                    <section className="mt-[4.5mm]">
                      <div
                        className="mb-[1.2mm] flex items-center justify-between border-b pb-[1.2mm] text-[6.6pt] font-bold"
                        style={{ borderColor: LINE_SOFT, color: LABEL_GOLD, letterSpacing: '0.6pt' }}
                      >
                        <span>PREPARED FOR</span>
                        <span lang="ar" dir="rtl" style={{ letterSpacing: 0, fontSize: '7.2pt' }}>
                          أعد لصالح
                        </span>
                      </div>
                      <p className="text-[9pt] font-bold leading-[1.3] text-white">{q.clientName}</p>
                      {client?.nameAr ? (
                        <p
                          className="mt-[0.5mm] text-right text-[8.4pt] font-bold"
                          lang="ar"
                          dir="rtl"
                          style={{ color: LABEL_GOLD }}
                        >
                          {client.nameAr}
                        </p>
                      ) : null}
                      <div className="mt-[1.2mm] text-[7.3pt] leading-[1.5]" style={{ color: VALUE_SOFT }}>
                        {client?.contactPerson ? (
                          <p>
                            Attn: <b className="font-semibold text-white">{client.contactPerson}</b>
                          </p>
                        ) : null}
                        {client?.phone ? <p className="font-semibold text-white">{client.phone}</p> : null}
                        {client?.email ? <p>{client.email}</p> : null}
                        {address ? <p>{address}</p> : null}
                        {client?.vatNumber ? (
                          <p>
                            VAT <b className="font-mono text-white">{client.vatNumber}</b>
                          </p>
                        ) : null}
                        {client?.crNumber ? (
                          <p>
                            C.R. <b className="font-mono text-white">{client.crNumber}</b>
                          </p>
                        ) : null}
                      </div>
                    </section>

                    {/* company brand block — pinned to the sidebar's foot */}
                    <div
                      className="mt-auto border-t pt-[2mm] text-[6.4pt] leading-[1.5]"
                      style={{ borderColor: LINE_SOFT, color: SMALL_SOFT }}
                    >
                      <b style={{ color: LABEL_GOLD }}>{companyName}</b>
                      <br />
                      Manpower Supply · General Contracting
                    </div>
                  </div>
                </aside>
              ) : (
                /* ── mini sidebar (continuation pages): number · client · continued ── */
                <aside
                  className="relative flex flex-col overflow-hidden"
                  style={{ background: SIDE_GRADIENT, padding: '5mm 5mm 5mm 14mm' }}
                >
                  <div
                    aria-hidden
                    className="pointer-events-none absolute"
                    style={{
                      right: '-18mm',
                      bottom: '28mm',
                      width: '52mm',
                      height: '52mm',
                      borderRadius: '50%',
                      border: `9mm solid ${RING}`,
                    }}
                  />
                  <div className="relative z-[1] flex flex-col">
                    <p className="font-mono text-[10.5pt] font-bold" style={{ color: LABEL_GOLD }}>
                      {q.quoteNumber}
                    </p>
                    <div className="mt-[1.5mm] h-[1.2px] w-full" style={{ background: '#C0934C' }} />
                    <p className="mt-[2mm] break-words text-[8.5pt] font-bold leading-snug text-white">
                      {q.clientName}
                    </p>
                    <p className="mt-auto text-[7.5pt] font-bold italic" style={{ color: LABEL_GOLD }}>
                      continued · <span lang="ar" dir="rtl">تابع</span>
                    </p>
                  </div>
                </aside>
              )}

              {/* ── main column ── */}
              <div className="flex min-w-0 flex-col" style={{ padding: '5mm 14mm 0 7mm' }}>
                {pageIdx === 0 ? (
                  <>
                    {/* title row: title left · compact project box right */}
                    <div
                      className="grid items-start gap-[5mm] border-b pb-[3mm]"
                      style={{ gridTemplateColumns: '1fr auto', borderColor: BORDER }}
                    >
                      <div className="min-w-0">
                        <p className="text-[11.5pt] font-bold leading-[1.3]" style={{ color: NAVY }}>
                          Supply of Skilled &amp; Unskilled Manpower
                        </p>
                        <p
                          className="mt-[0.8mm] text-[9pt] font-bold"
                          lang="ar"
                          dir="rtl"
                          style={{ color: TITLE_GOLD }}
                        >
                          توريد العمالة الماهرة وغير الماهرة
                        </p>
                      </div>
                      <div
                        className="shrink-0 rounded-[2mm] p-[2mm] pl-[3mm]"
                        style={{ background: SIDE_CREAM, border: `1px solid ${SIDE_CREAM_BORDER}` }}
                      >
                        <small className="block text-[6.4pt] font-bold" style={{ color: TITLE_GOLD }}>
                          PROJECT / SITE · <span lang="ar" dir="rtl">المشروع</span>
                        </small>
                        <b className="mt-[0.4mm] block text-[8.6pt] leading-tight" style={{ color: NAVY }}>
                          {q.projectName || '—'}
                        </b>
                        {q.projectLocation ? (
                          <i className="block text-[7pt] not-italic" style={{ color: CREAM_INK_SOFT }}>
                            {q.projectLocation}
                          </i>
                        ) : null}
                      </div>
                    </div>
                    <p className="mt-[2.6mm] text-[7.6pt] leading-[1.5]" style={{ color: CREAM_INK_SOFT }}>
                      Dear Sir, we are pleased to submit our most competitive rates. All workers are
                      experienced, medically fit and hold valid Iqama.
                    </p>
                  </>
                ) : null}

                {/* item cards — the header row repeats on every page that carries rows */}
                <div className="mt-[3mm] flex flex-col gap-[2mm]">
                  <div
                    className="grid px-[3mm] text-[6.6pt] font-bold"
                    style={{
                      gridTemplateColumns: '10mm 1fr 38mm 34mm',
                      color: CREAM_INK_SOFT,
                      letterSpacing: '0.3pt',
                    }}
                  >
                    <span>#</span>
                    <span>
                      TRADE / CATEGORY
                      <br />
                      <i className="not-italic font-normal" lang="ar" dir="rtl">
                        المهنة / الفئة
                      </i>
                    </span>
                    <span className="text-center">
                      HOURS
                      <br />
                      <i className="not-italic font-normal" lang="ar" dir="rtl">
                        الساعات
                      </i>
                    </span>
                    <span className="text-right">
                      HOURLY RATE (SAR)
                      <br />
                      <i className="not-italic font-normal" lang="ar" dir="rtl">
                        السعر بالساعة (ريال)
                      </i>
                    </span>
                  </div>
                  {plan.items.length === 0 && pageIdx === 0 ? (
                    <p
                      className="rounded-[2.5mm] border px-[3mm] py-[2.4mm] text-center text-[8pt]"
                      style={{ borderColor: BORDER, color: CREAM_INK_SOFT }}
                    >
                      No line items yet
                    </p>
                  ) : (
                    plan.items.map((it, i) => {
                      const tradeAr = TRADE_AR[it.description.trim().toUpperCase()] ?? null
                      return (
                        <div
                          key={it.id ?? `${it.sr}-${i}`}
                          className="grid items-center rounded-[2.5mm] border bg-white px-[3mm] py-[2.4mm]"
                          style={{ gridTemplateColumns: '10mm 1fr 38mm 34mm', borderColor: BORDER }}
                        >
                          <span className="font-mono text-[9pt] font-bold" style={{ color: GOLD }}>
                            {String(it.sr).padStart(2, '0')}
                          </span>
                          <div className="min-w-0">
                            <b className="block break-words text-[9.5pt] leading-tight" style={{ color: NAVY }}>
                              {it.description}
                            </b>
                            {tradeAr ? (
                              <span
                                className="block text-[7.8pt] leading-tight"
                                lang="ar"
                                dir="rtl"
                                style={{ color: CREAM_INK_SOFT }}
                              >
                                {tradeAr}
                              </span>
                            ) : null}
                            {it.subText ? (
                              <span className="block break-words text-[7pt] italic leading-tight" style={{ color: CREAM_INK_SOFT }}>
                                {it.subText}
                              </span>
                            ) : null}
                          </div>
                          <div className="text-center text-[8pt] tabular-nums" style={{ color: INK }}>
                            {it.quantity.toLocaleString('en-US')}
                          </div>
                          <div className="justify-self-end">
                            <span
                              className="inline-block whitespace-nowrap rounded-[10mm] px-[3.6mm] py-[1.4mm] font-mono text-[10pt] font-bold"
                              style={{ background: NAVY, color: LABEL_GOLD }}
                            >
                              SAR {fmtRate(it.unitPrice)}
                            </span>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* rates note — under the cards on the last items page */}
                {lastItemsPage ? (
                  <p
                    className="mt-[1.6mm] text-right text-[7pt] italic leading-snug"
                    style={{ color: CREAM_INK_SOFT }}
                  >
                    * Rates are per hour per worker, in Saudi Riyals, excluding VAT.
                  </p>
                ) : null}

                {/* ── tail: TERMS & CONDITIONS + signatures (always together) ── */}
                {plan.tail ? (
                  <>
                    <div
                      className="mt-[5mm] flex items-center gap-[3mm] text-[7.6pt] font-bold"
                      style={{ color: NAVY, letterSpacing: '0.6pt' }}
                    >
                      <span>
                        TERMS &amp; CONDITIONS ·{' '}
                        <span lang="ar" dir="rtl" style={{ color: TITLE_GOLD, letterSpacing: 0 }}>
                          الشروط والأحكام
                        </span>
                      </span>
                      <span className="h-[1px] flex-1" style={{ background: BORDER }} />
                    </div>
                    {terms.length === 0 ? (
                      <p className="mt-[2.2mm] text-[7.5pt]" style={{ color: INK_SOFT }}>
                        As mutually agreed between the parties.
                      </p>
                    ) : (
                      <div
                        className="mt-[2.2mm] grid text-[7.5pt] leading-[1.42]"
                        style={{ gridTemplateColumns: '7mm 1fr', rowGap: '1.3mm' }}
                      >
                        {terms.flatMap((t, i) => [
                          <span
                            key={`n-${i}`}
                            className="mt-[0.2mm] flex h-[5mm] w-[5mm] items-center justify-center rounded-full text-[6.2pt] font-bold"
                            style={{
                              background: SIDE_CREAM,
                              border: '1px solid #C0934C',
                              color: TITLE_GOLD,
                            }}
                          >
                            {i + 1}
                          </span>,
                          <div key={`t-${i}`} className="break-words" style={{ color: INK }}>
                            {t.title ? (
                              <>
                                <b style={{ color: NAVY }}>{t.title}: </b>
                                {t.text}
                              </>
                            ) : (
                              t.text
                            )}
                          </div>,
                        ])}
                      </div>
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
                      <div style={{ borderTop: `2px solid ${NAVY}`, paddingTop: '1.6mm' }}>
                        <div
                          className="flex items-center justify-between text-[7pt] font-bold"
                          style={{ color: NAVY, letterSpacing: '0.4pt' }}
                        >
                          <span className="uppercase">Approved By · {approverLabel}</span>
                          <span lang="ar" dir="rtl" style={{ color: TITLE_GOLD, letterSpacing: 0 }}>
                            اعتماد الشركة
                          </span>
                        </div>
                        <div
                          className="relative mt-[1mm]"
                          style={{ height: '12mm', borderBottom: '1px dashed #9AA3B5' }}
                        >
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
                      <div style={{ borderTop: `2px solid ${NAVY}`, paddingTop: '1.6mm' }}>
                        <div
                          className="flex items-center justify-between text-[7pt] font-bold"
                          style={{ color: NAVY, letterSpacing: '0.4pt' }}
                        >
                          <span className="uppercase">Accepted By · Client</span>
                          <span lang="ar" dir="rtl" style={{ color: TITLE_GOLD, letterSpacing: 0 }}>
                            موافقة العميل
                          </span>
                        </div>
                        <div className="mt-[1mm]" style={{ height: '12mm', borderBottom: '1px dashed #9AA3B5' }} />
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
