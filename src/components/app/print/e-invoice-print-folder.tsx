'use client'

// E-Invoice print template "FOLDER" — reference design
// E-Invoice_Template_F_Folder (HTML + PNG attached by the boss).
//
//   • title row: TAX INVOICE + فاتورة ضريبية | INVOICE NO. + status badge
//   • five folder-tabbed sections:
//       01 · DETAILS  التفاصيل   — dates, P.O./contract, project, terms,
//                                  method, currency
//       02 · PARTIES  الأطراف    — supplier | customer panels
//       03 · ITEMS    البنود     — items table (navy thead, numbered gold
//                                  badges) — CONTINUES on page 2+ behind a
//                                  "03 · ITEMS (continued · تابع)" tab
//       04 · PAYMENT  الدفع      — GOLD tab: amount in words + bank |
//                                  totals + TOTAL DUE (last page only)
//       05 · SIGN-OFF الاعتماد   — QR | Received by | Authorized Signature |
//                                  Company Stamp (last page only, pinned to
//                                  the bottom directly above the footer)
//
// DATA GUARANTEE: reads the SAME DocModel as Classic (shared module) — the
// invoice number, every amount, the VAT (incl. the BR-CO-17 rounding row),
// the totals, the amount in words, the customer and bank data and the ZATCA
// QR are IDENTICAL across all templates. Optional values that are missing
// hide their line (never a placeholder; dates hide their whole cell).
// Letterhead artwork + geometry come from the shared resolveLetterhead
// (Settings), not from the reference file.
//
// Pagination: measured (same rig pattern as Classic) with the shared
// planLayout. The items folder box repeats its tab + thead on every page, a
// row is never split, and 04 Payment + 05 Sign-off stay together on the last
// page (they never open a page alone).
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type {
  AppSettings,
  EInvoiceConfig,
  EInvoiceItemRow,
  EInvoiceRow,
  EInvoiceLetterheadConfig,
  LetterheadConfig,
} from '@/lib/types'
import {
  BORDER,
  DARK_GOLD,
  DOC_FONT,
  DOC_MONO,
  HERITAGE_CREAM,
  GOLD,
  HERITAGE_INK,
  HERITAGE_INK_SOFT,
  LIGHT_GOLD,
  NAVY,
  PAGE_H_MM,
  buildModel,
  fmtDate,
  fmtQty,
  planLayout,
  resolveLetterhead,
  vatRoundingDelta,
  DocPageShell,
  type DocModel,
  type Measured,
  type ResolvedLetterhead,
} from './e-invoice-print-shared'

// ── Folder palette (from the reference) ─────────────────────────────────────
// navy #132A4A · gold #C0934C · light gold #E1B169 · dark gold #8E6420 ·
// dashed rule #DDE3EC · cream badge #FAF7F1 · ink #1D2433 · soft #4A5468

/** Status badge labels (same wording as Classic's stamp). */
const STATUS_LABELS: Record<string, string> = {
  draft: 'DRAFT',
  issued: 'ISSUED',
  partially_paid: 'PARTIALLY PAID',
  paid: 'PAID',
}

/** One folder tab (reference .tab) — absolute, sticking 5mm above its box. */
function Tab({
  n,
  en,
  ar,
  gold,
  continued,
}: {
  n: string
  en: string
  ar: string
  gold?: boolean
  continued?: boolean
}) {
  const bg = gold ? GOLD : NAVY
  const fg = gold ? '#fff' : LIGHT_GOLD
  return (
    <div
      className="absolute flex items-center font-bold"
      style={{
        top: '-5mm',
        left: '-1px',
        height: '5mm',
        background: bg,
        color: fg,
        fontSize: '6.6pt',
        letterSpacing: '.8pt',
        padding: '0 4mm 0 3mm',
        gap: '2mm',
        borderRadius: '2mm 2mm 0 0',
      }}
    >
      {`${n} · ${en}`}
      {continued ? (
        <span className="font-semibold" style={{ letterSpacing: 0, fontSize: '6.2pt' }}>
          (continued ·{' '}
          <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
            تابع
          </span>
          )
        </span>
      ) : null}
      <span lang="ar" dir="rtl" style={{ letterSpacing: 0, fontFamily: DOC_FONT, fontSize: '7pt', color: gold ? '#fff' : '#fff', fontWeight: 400 }}>
        {ar}
      </span>
      {/* angled tab edge (reference .tab:after) */}
      <span
        aria-hidden
        className="absolute"
        style={{
          right: '-3mm',
          bottom: 0,
          width: '3mm',
          height: '5mm',
          background: bg,
          clipPath: 'polygon(0 0, 0 100%, 100% 100%)',
        }}
      />
    </div>
  )
}

/** A folder section box (reference .fd) — content + optional tab. */
function Folder({
  tab,
  gold,
  children,
  style,
}: {
  tab?: React.ReactNode
  gold?: boolean
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <div
      className="relative"
      style={{
        border: `1px solid ${gold ? GOLD : NAVY}`,
        borderRadius: '0 2.5mm 2.5mm 2.5mm',
        padding: '2mm 3.5mm',
        ...style,
      }}
    >
      {tab}
      {children}
    </div>
  )
}

/** g4 cell: label row (EN left · AR right) + mono value (+ optional AR line). */
function Cell({
  label,
  labelAr,
  value,
  ar,
  sans,
}: {
  label: string
  labelAr: string
  value: string | null
  ar?: string | null
  /** project/terms/method print in the sans face (reference .tx) */
  sans?: boolean
}) {
  if (value === null || value === '') return null
  return (
    <div className="min-w-0">
      <small
        className="flex items-baseline justify-between text-[6.5pt] font-semibold"
        style={{ color: HERITAGE_INK_SOFT }}
      >
        <span>{label}</span>
        <span lang="ar" dir="rtl">
          {labelAr}
        </span>
      </small>
      <b
        className="mt-[.4mm] block break-words font-semibold"
        style={{ fontSize: '8.2pt', color: HERITAGE_INK, fontFamily: sans ? DOC_FONT : DOC_MONO, lineHeight: 1.3 }}
      >
        {value}
      </b>
      {ar ? (
        <span
          lang="ar"
          dir="rtl"
          className="block break-words"
          style={{ fontFamily: DOC_FONT, fontSize: '7.2pt', color: HERITAGE_INK_SOFT, lineHeight: 1.4 }}
        >
          {ar}
        </span>
      ) : null}
    </div>
  )
}

// ── Title row (reference .top) — TAX INVOICE | invoice no. + status badge ──
function TopRow({ m }: { m: DocModel }) {
  const { inv } = m
  const label = inv.overdue ? 'OVERDUE' : (STATUS_LABELS[inv.status] ?? 'DRAFT')
  return (
    <div className="flex items-end justify-between gap-3">
      <div
        className="break-words font-bold"
        style={{ fontSize: '15pt', color: NAVY, lineHeight: 1.2 }}
      >
        {m.title.en}
        <span
          lang="ar"
          dir="rtl"
          className="ml-[3mm] inline-block"
          style={{ fontFamily: DOC_FONT, fontSize: '13pt', color: DARK_GOLD }}
        >
          {m.title.ar}
        </span>
      </div>
      <div className="shrink-0 text-right">
        <small className="block text-[6.6pt] font-semibold" style={{ color: HERITAGE_INK_SOFT }}>
          {m.title.en.includes('TAX') ? 'INVOICE NO.' : 'DOCUMENT NO.'} ·{' '}
          <span lang="ar" dir="rtl">
            رقم الفاتورة
          </span>
        </small>
        <b className="block font-bold" style={{ fontFamily: DOC_MONO, fontSize: '11pt', color: NAVY }}>
          {inv.invoiceNumber}
          <span
            className="ml-[2mm] inline-block rounded-[1mm] px-[2mm] py-[.5mm] align-middle font-bold"
            style={{ fontSize: '6.4pt', color: NAVY, background: LIGHT_GOLD, letterSpacing: '.5pt' }}
          >
            {label}
          </span>
        </b>
      </div>
    </div>
  )
}

// ── 01 · DETAILS ────────────────────────────────────────────────────────────
function DetailsSection({ m }: { m: DocModel }) {
  const { inv } = m
  // dates row — cells with no value hide entirely (boss rule: hide if empty)
  const dates: Array<{ label: string; labelAr: string; value: string | null }> = [
    { label: 'Issue Date', labelAr: 'الإصدار', value: fmtDate(inv.issueDate) },
    { label: 'Supply', labelAr: 'التوريد', value: inv.supplyDate ? fmtDate(inv.supplyDate) : null },
    { label: 'Due Date', labelAr: 'الاستحقاق', value: inv.dueDate ? fmtDate(inv.dueDate) : null },
    {
      label: 'P.O. / Contract',
      labelAr: 'أمر الشراء',
      value: inv.poRef || inv.contractRef || null,
    },
  ]
  const visibleDates = dates.filter((d) => d.value !== null)
  const refs: Array<{ label: string; labelAr: string; value: string | null; ar?: string | null }> = [
    { label: 'Project', labelAr: 'المشروع', value: inv.projectEn, ar: inv.projectAr },
    { label: 'Payment Terms', labelAr: 'شروط الدفع', value: inv.paymentTermsEn, ar: inv.paymentTermsAr },
    { label: 'Method', labelAr: 'طريقة الدفع', value: inv.paymentMethodEn, ar: inv.paymentMethodAr },
    { label: 'Currency', labelAr: 'العملة', value: m.currency },
  ]
  const visibleRefs = refs.filter((r) => r.value !== null)
  return (
    <Folder
      tab={
        <Tab n="01" en="DETAILS" ar="التفاصيل" />
      }
    >
      <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(visibleDates.length, 1)}, 1fr)`, gap: '3mm' }}>
        {visibleDates.map((d) => (
          <Cell key={d.label} label={d.label} labelAr={d.labelAr} value={d.value} />
        ))}
      </div>
      <div style={{ height: '1px', background: BORDER, margin: '1.5mm 0' }} />
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${Math.max(visibleRefs.length, 1)}, 1fr)`,
          gap: '3mm',
        }}
      >
        {visibleRefs.map((r) => (
          <Cell key={r.label} label={r.label} labelAr={r.labelAr} value={r.value} ar={r.ar} sans />
        ))}
      </div>
    </Folder>
  )
}

// ── 02 · PARTIES ────────────────────────────────────────────────────────────
function PartyColumn({
  who,
  whoAr,
  nameEn,
  nameAr,
  vat,
  cr,
  addressEn,
  addressAr,
  divided,
}: {
  who: string
  whoAr: string
  nameEn: string
  nameAr: string
  vat: string | null | undefined
  cr: string | null | undefined
  addressEn?: string | null
  addressAr?: string | null
  divided?: boolean
}) {
  return (
    <div
      className="min-w-0"
      style={divided ? { borderLeft: `1px dashed ${BORDER}`, paddingLeft: '6mm' } : undefined}
    >
      <div
        className="flex items-baseline justify-between text-[6.6pt] font-bold"
        style={{ color: DARK_GOLD, letterSpacing: '.6pt', marginBottom: '.8mm' }}
      >
        <span>{who}</span>
        <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT, letterSpacing: 0 }}>
          {whoAr}
        </span>
      </div>
      <p className="break-words font-bold" style={{ fontSize: '9.4pt', color: NAVY, lineHeight: 1.25 }}>
        {nameEn}
      </p>
      {nameAr ? (
        <p
          lang="ar"
          dir="rtl"
          className="break-words text-right font-bold"
          style={{ fontFamily: DOC_FONT, fontSize: '8.6pt', color: NAVY, marginTop: '.3mm', lineHeight: 1.4 }}
        >
          {nameAr}
        </p>
      ) : null}
      <div className="text-[7.5pt]" style={{ color: HERITAGE_INK_SOFT, lineHeight: 1.45, marginTop: '1mm' }}>
        {vat ? (
          <p className="break-words">
            VAT No. ·{' '}
            <span lang="ar" dir="rtl">
              الرقم الضريبي
            </span>{' '}
            <b style={{ color: HERITAGE_INK, fontFamily: DOC_MONO }}>{vat}</b>
          </p>
        ) : null}
        {cr ? (
          <p className="break-words">
            C.R. No. ·{' '}
            <span lang="ar" dir="rtl">
              السجل التجاري
            </span>{' '}
            <b style={{ color: HERITAGE_INK, fontFamily: DOC_MONO }}>{cr}</b>
          </p>
        ) : null}
        {addressEn ? <p className="break-words">{addressEn}</p> : null}
        {addressAr ? (
          <p lang="ar" dir="rtl" className="break-words text-right" style={{ fontFamily: DOC_FONT }}>
            {addressAr}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function PartiesSection({ m }: { m: DocModel }) {
  const { inv, supplier } = m
  return (
    <Folder tab={<Tab n="02" en="PARTIES" ar="الأطراف" />}>
      <div className="grid grid-cols-2" style={{ gap: '6mm' }}>
        <PartyColumn
          who="SUPPLIER"
          whoAr="المورد"
          nameEn={supplier.nameEn}
          nameAr={supplier.nameAr}
          vat={supplier.vat}
          cr={supplier.cr}
        />
        <PartyColumn
          who="CUSTOMER"
          whoAr="العميل"
          nameEn={inv.clientNameEn}
          nameAr={inv.clientNameAr}
          vat={inv.clientVatNumber}
          cr={inv.clientCrNumber}
          addressEn={m.buyerAddr}
          addressAr={inv.clientAddressAr}
          divided
        />
      </div>
    </Folder>
  )
}

// ── 03 · ITEMS ──────────────────────────────────────────────────────────────
function ItemsTable({
  m,
  items,
  pad,
  empty,
  rowRefs,
}: {
  m: DocModel
  items: EInvoiceItemRow[]
  /** normal 1.5mm row padding (reference); 1mm when squeezed onto one page */
  pad: number
  empty: boolean
  rowRefs?: (i: number, el: HTMLTableRowElement | null) => void
}) {
  const { currency } = m
  const th: React.CSSProperties = {
    fontSize: '6.8pt',
    color: NAVY,
    fontWeight: 700,
    padding: '0 1.6mm 1.4mm',
    textAlign: 'right',
    borderBottom: `1.4px solid ${NAVY}`,
    lineHeight: 1.3,
    verticalAlign: 'bottom',
  }
  const td: React.CSSProperties = {
    padding: `${pad}mm 1.6mm`,
    borderBottom: `1px solid ${BORDER}`,
    verticalAlign: 'top',
    fontSize: '8pt',
    lineHeight: 1.35,
    color: HERITAGE_INK,
  }
  const tdR: React.CSSProperties = { ...td, textAlign: 'right', fontFamily: DOC_MONO, whiteSpace: 'nowrap' }
  const arLine = (text: string, center?: boolean) => (
    <span
      lang="ar"
      dir="rtl"
      className="block break-words"
      style={{
        fontFamily: DOC_FONT,
        color: HERITAGE_INK_SOFT,
        fontSize: '7.2pt',
        marginTop: '.4mm',
        lineHeight: 1.4,
        ...(center ? { textAlign: 'center' } : { textAlign: 'right' }),
      }}
    >
      {text}
    </span>
  )
  return (
    <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'auto' }}>
      <thead style={{ display: 'table-header-group' }}>
        <tr>
          <th style={{ ...th, width: '8mm', textAlign: 'left' }}>#</th>
          <th style={{ ...th, textAlign: 'left' }}>
            Description
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: HERITAGE_INK_SOFT, textAlign: 'left' }}>
              الوصف
            </span>
          </th>
          <th style={th}>
            Qty
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: HERITAGE_INK_SOFT }}>
              الكمية
            </span>
          </th>
          <th style={th}>
            Unit Price
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: HERITAGE_INK_SOFT }}>
              سعر الوحدة
            </span>
          </th>
          <th style={th}>
            Taxable
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: HERITAGE_INK_SOFT }}>
              الخاضع
            </span>
          </th>
          <th style={th}>
            VAT
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: HERITAGE_INK_SOFT }}>
              النسبة
            </span>
          </th>
          <th style={th}>
            VAT Amt
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: HERITAGE_INK_SOFT }}>
              الضريبة
            </span>
          </th>
          <th style={th}>
            {`Total ${currency}`}
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: HERITAGE_INK_SOFT }}>
              الإجمالي
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {empty && items.length === 0 ? (
          <tr>
            <td colSpan={8} style={{ ...td, textAlign: 'center', color: HERITAGE_INK_SOFT, padding: '3mm', borderBottom: 'none' }}>
              No line items yet
            </td>
          </tr>
        ) : (
          items.map((it, i) => (
            <tr
              key={it.id ?? `${it.sr}-${i}`}
              ref={rowRefs ? (el) => rowRefs(i, el) : undefined}
              style={{ breakInside: 'avoid' }}
            >
              <td style={{ ...td, borderBottom: i === items.length - 1 ? 'none' : td.borderBottom, width: '8mm' }}>
                <span
                  className="inline-flex items-center justify-center font-bold"
                  style={{
                    width: '5mm',
                    height: '5mm',
                    borderRadius: '1.2mm',
                    background: HERITAGE_CREAM,
                    border: `1px solid ${GOLD}`,
                    color: DARK_GOLD,
                    fontSize: '6.4pt',
                  }}
                >
                  {it.sr}
                </span>
              </td>
              <td style={{ ...td, borderBottom: i === items.length - 1 ? 'none' : td.borderBottom }}>
                <b className="break-words font-semibold">{it.descriptionEn}</b>
                {it.descriptionAr ? arLine(it.descriptionAr) : null}
                {it.taxCategory && it.taxCategory !== 'S' ? (
                  <span className="block" style={{ fontSize: '7.2pt', color: HERITAGE_INK_SOFT, fontStyle: 'italic' }}>
                    {it.taxCategory === 'Z'
                      ? 'Zero-rated'
                      : it.taxCategory === 'E'
                        ? 'VAT exempt'
                        : 'Not subject to VAT'}
                    {it.exemptionReason ? ` — ${it.exemptionReason}` : ''}
                  </span>
                ) : null}
              </td>
              <td style={{ ...tdR, borderBottom: i === items.length - 1 ? 'none' : td.borderBottom }}>
                {fmtQty(it.quantity)}
                {it.unitEn ? ` ${it.unitEn}` : ''}
                {it.unitAr ? arLine(it.unitAr) : null}
              </td>
              <td style={{ ...tdR, borderBottom: i === items.length - 1 ? 'none' : td.borderBottom }}>
                {m.money(it.unitPrice)}
              </td>
              <td style={{ ...tdR, borderBottom: i === items.length - 1 ? 'none' : td.borderBottom }}>
                {m.money(it.taxableAmount)}
              </td>
              <td style={{ ...tdR, borderBottom: i === items.length - 1 ? 'none' : td.borderBottom }}>
                {`${Math.round(it.vatPercent)}%`}
              </td>
              <td style={{ ...tdR, borderBottom: i === items.length - 1 ? 'none' : td.borderBottom }}>
                {m.money(it.vatAmount)}
              </td>
              <td style={{ ...tdR, borderBottom: i === items.length - 1 ? 'none' : td.borderBottom, fontWeight: 700 }}>
                {m.money(it.lineTotal)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

/** The complete 03 · ITEMS folder box (tab + table) — one per items page. */
function ItemsSection({
  m,
  items,
  pad,
  empty,
  continued,
  rowRefs,
}: {
  m: DocModel
  items: EInvoiceItemRow[]
  pad: number
  empty: boolean
  continued?: boolean
  rowRefs?: (i: number, el: HTMLTableRowElement | null) => void
}) {
  return (
    <Folder
      tab={
        <Tab n="03" en="ITEMS" ar="البنود" continued={continued} />
      }
    >
      <ItemsTable m={m} items={items} pad={pad} empty={empty} rowRefs={rowRefs} />
    </Folder>
  )
}

// ── 04 · PAYMENT (gold tab — reference .fd.g) ───────────────────────────────
function PaymentSection({ m }: { m: DocModel }) {
  const { inv, settings } = m
  const anyBank = Boolean(
    settings.bankName ||
      settings.bankIban ||
      settings.bankAccountNumber ||
      settings.bankAccountName ||
      settings.bankSwiftCode
  )
  const delta = vatRoundingDelta(inv)
  const rows: Array<[string, string, string]> = [
    ['Subtotal', 'المجموع', m.money(inv.subtotal)],
    ['Discount', 'الخصم', inv.totalDiscount > 0 ? `-${m.money(inv.totalDiscount)}` : m.money(0)],
    ['Taxable Amount', 'الخاضع للضريبة', m.money(inv.taxableAmount)],
    [`VAT ${m.vatLabel}`.trim(), 'ضريبة القيمة المضافة', m.money(inv.vatAmount)],
    ...(Math.abs(delta) > 0.005
      ? ([[ 'Rounding', 'تقريب', `${delta > 0 ? '+' : ''}${m.money(delta)}`]] as Array<[string, string, string]>)
      : []),
  ]
  return (
    <Folder gold tab={<Tab n="04" en="PAYMENT" ar="الدفع" gold />}>
      <div className="grid" style={{ gridTemplateColumns: '1fr 70mm', gap: '5mm' }}>
        {/* left — amount in words + bank details */}
        <div>
          <div style={{ fontSize: '7.6pt', lineHeight: 1.5, color: HERITAGE_INK }}>
            <b style={{ color: DARK_GOLD }}>
              AMOUNT IN WORDS ·{' '}
              <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
                المبلغ كتابةً
              </span>
            </b>
            <br />
            {m.words.en}
            <span lang="ar" dir="rtl" className="block break-words text-right" style={{ fontFamily: DOC_FONT }}>
              {m.words.ar}
            </span>
          </div>
          {anyBank ? (
            <div
              className="grid"
              style={{
                gridTemplateColumns: '1.3fr 1fr',
                gap: '1mm 4mm',
                fontSize: '7.5pt',
                marginTop: '2mm',
                paddingTop: '2mm',
                borderTop: `1px dashed ${BORDER}`,
                color: HERITAGE_INK,
              }}
            >
              <div>
                <small className="block text-[6.3pt] font-semibold" style={{ color: HERITAGE_INK_SOFT }}>
                  Account Name ·{' '}
                  <span lang="ar" dir="rtl">
                    اسم الحساب
                  </span>
                </small>
                <b className="font-semibold">{settings.bankAccountName || '—'}</b>
              </div>
              <div>
                <small className="block text-[6.3pt] font-semibold" style={{ color: HERITAGE_INK_SOFT }}>
                  Bank ·{' '}
                  <span lang="ar" dir="rtl">
                    البنك
                  </span>
                </small>
                <b className="font-semibold">{settings.bankName || '—'}</b>
              </div>
              <div>
                <small className="block text-[6.3pt] font-semibold" style={{ color: HERITAGE_INK_SOFT }}>
                  IBAN ·{' '}
                  <span lang="ar" dir="rtl">
                    الآيبان
                  </span>
                </small>
                <b className="break-all font-semibold" style={{ fontFamily: DOC_MONO }}>
                  {settings.bankIban || '—'}
                </b>
              </div>
              <div>
                <small className="block text-[6.3pt] font-semibold" style={{ color: HERITAGE_INK_SOFT }}>
                  Account No. · SWIFT
                </small>
                <b className="break-all font-semibold" style={{ fontFamily: DOC_MONO }}>
                  {[settings.bankAccountNumber, settings.bankSwiftCode].filter(Boolean).join(' · ') || '—'}
                </b>
              </div>
            </div>
          ) : null}
        </div>

        {/* right — totals + TOTAL DUE */}
        <div>
          {rows.map(([en, ar, value]) => (
            <div
              key={en}
              className="flex items-baseline justify-between"
              style={{ fontSize: '8pt', padding: '.8mm 0', borderBottom: `1px dotted ${BORDER}` }}
            >
              <span style={{ color: HERITAGE_INK }}>
                {en}
                <small lang="ar" dir="rtl" className="ml-[1.5mm]" style={{ fontFamily: DOC_FONT, color: HERITAGE_INK_SOFT, fontSize: '7pt' }}>
                  {ar}
                </small>
              </span>
              <b style={{ fontFamily: DOC_MONO, color: HERITAGE_INK }}>{value}</b>
            </div>
          ))}
          <div
            className="flex items-center justify-between text-white"
            style={{ marginTop: '2mm', background: NAVY, borderRadius: '2mm', padding: '2.6mm 3.5mm' }}
          >
            <span className="font-bold" style={{ fontSize: '7.6pt', letterSpacing: '.5pt', lineHeight: 1.35 }}>
              {`TOTAL DUE · ${m.currency}`}
              <span lang="ar" dir="rtl" className="block" style={{ fontFamily: DOC_FONT, color: LIGHT_GOLD, letterSpacing: 0 }}>
                الإجمالي المستحق
              </span>
            </span>
            <b style={{ fontFamily: DOC_MONO, fontSize: '13.5pt', color: LIGHT_GOLD }}>
              {m.money(inv.totalDue)}
            </b>
          </div>
        </div>
      </div>
    </Folder>
  )
}

// ── 05 · SIGN-OFF ───────────────────────────────────────────────────────────
function SignOffSection({ m }: { m: DocModel }) {
  const { inv, config } = m
  const receiver = inv.showReceiverSignature
  const sigBlock = (en: string, ar: string, signatureImg?: string) => (
    <div className="min-w-0">
      <div
        className="flex items-end justify-center"
        style={{ height: '10mm', borderBottom: `1px solid ${NAVY}` }}
      >
        {signatureImg ? (
          <img src={signatureImg} alt="Authorized signature" className="block max-h-[9mm] object-contain" />
        ) : null}
      </div>
      <b className="block font-bold" style={{ fontSize: '7.5pt', color: NAVY, marginTop: '1.2mm' }}>
        {en}
        <span lang="ar" dir="rtl" className="float-right" style={{ fontFamily: DOC_FONT, color: DARK_GOLD, fontSize: '7.2pt' }}>
          {ar}
        </span>
      </b>
      <small className="block" style={{ fontSize: '6.6pt', color: HERITAGE_INK_SOFT, marginTop: '.3mm' }}>
        Name &amp; Date
      </small>
    </div>
  )
  return (
    <Folder tab={<Tab n="05" en="SIGN-OFF" ar="الاعتماد" />}>
      <div
        className="grid items-end"
        style={{
          gridTemplateColumns: receiver
            ? '34mm minmax(0,1fr) minmax(0,1fr) 26mm'
            : '34mm minmax(0,1fr) 26mm',
          gap: '5mm',
        }}
      >
        {/* ZATCA QR — exactly 30×30mm, black on white, fully visible */}
        <div className="text-center" style={{ fontSize: '6.2pt', color: HERITAGE_INK_SOFT }}>
          {m.qrDataUrl ? (
            <img
              src={m.qrDataUrl}
              alt="ZATCA QR code"
              className="mx-auto block bg-white"
              style={{ width: '30mm', height: '30mm' }}
            />
          ) : (
            <div
              className="mx-auto flex flex-col items-center justify-center text-center"
              style={{ width: '30mm', height: '30mm', border: '1px dashed #C7CFDC', color: HERITAGE_INK_SOFT }}
            >
              <span className="text-[7pt] font-semibold">QR appears</span>
              <span className="text-[7pt] font-semibold">after issuing</span>
              <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }} className="text-[7pt]">
                يظهر الرمز بعد الإصدار
              </span>
            </div>
          )}
          {m.zatcaNotice ? (
            <p className="mx-auto mt-[.5mm] max-w-[34mm] text-center text-[6.4pt] font-bold leading-tight text-red-700">
              {m.zatcaNotice}
            </p>
          ) : null}
          <p className="mt-[.5mm]" style={{ fontFamily: DOC_FONT }}>
            Scan to verify · <span lang="ar" dir="rtl">امسح للتحقق</span>
          </p>
        </div>

        {receiver ? sigBlock('Received by', 'توقيع المستلم') : null}
        {sigBlock('Authorized Signature', 'التوقيع المعتمد', config.signature || undefined)}

        <div
          className="mx-auto flex flex-col items-center justify-center text-center"
          style={{
            width: '21mm',
            height: '21mm',
            border: `1.2px dashed ${GOLD}`,
            borderRadius: '50%',
            fontSize: '6.2pt',
            color: DARK_GOLD,
          }}
        >
          {config.stamp ? (
            <img
              src={config.stamp}
              alt="Company stamp"
              className="block max-h-[13mm] max-w-[13mm] object-contain"
            />
          ) : (
            <>
              <span>Company</span>
              <span>Stamp</span>
              <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
                ختم الشركة
              </span>
            </>
          )}
        </div>
      </div>
    </Folder>
  )
}

// ── Footer line (reference .foot) — every page ──────────────────────────────
function FootLine({
  m,
  page,
  of,
  dedicatedPageNo,
}: {
  m: DocModel
  page: number
  of: number
  dedicatedPageNo?: boolean
}) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{ fontSize: '6.4pt', color: HERITAGE_INK_SOFT, paddingTop: '2mm' }}
    >
      <span className="break-words">
        {m.noteCompany} · <span style={{ fontFamily: DOC_MONO }}>{m.inv.invoiceNumber}</span>
      </span>
      {dedicatedPageNo ? <span /> : (
        <span>
          Page {page} of {of}
          <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
            {' '}
            · صفحة {page} من {of}
          </span>
        </span>
      )}
      <span>Printed {fmtDate(m.printedAt.toISOString())}</span>
    </div>
  )
}

// ── Head blocks: top row + notices + 01 + 02 ────────────────────────────────
function FolderHead({ m }: { m: DocModel }) {
  const { inv } = m
  return (
    <>
      <TopRow m={m} />
      {inv.relatedInvoiceNumber ? (
        <p className="text-center" style={{ marginTop: '1.2mm', fontSize: '8pt', color: HERITAGE_INK_SOFT }}>
          Original Invoice:{' '}
          <b style={{ fontFamily: DOC_MONO, color: NAVY }}>{inv.relatedInvoiceNumber}</b>
          <span className="mx-1.5">|</span>
          <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
            الفاتورة الأصلية:{' '}
          </span>
          <b lang="ar" dir="rtl" style={{ fontFamily: DOC_MONO, color: NAVY }}>
            {inv.relatedInvoiceNumber}
          </b>
        </p>
      ) : null}
      {inv.docType !== 'invoice' && inv.noteReason ? (
        <p className="text-center" style={{ marginTop: '.4mm', fontSize: '8pt', color: HERITAGE_INK_SOFT }}>
          Reason <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>(السبب)</span>:{' '}
          <b style={{ color: NAVY }}>{inv.noteReason}</b>
        </p>
      ) : null}
      {/* section clearance — the folder tabs stick 5mm above their boxes */}
      <div style={{ height: '5.6mm' }} />
      <DetailsSection m={m} />
      <div style={{ height: '5.6mm' }} />
      <PartiesSection m={m} />
    </>
  )
}

// ── Measure rig (same pattern as Classic — real DOM heights in mm) ─────────
// Mapping into the shared planner:
//   headMm  = top row + notices + 01 + 02 (incl. the 5.6mm tab clearances)
//   contMm  = 0 (the continuation box geometry is identical to page 1's)
//   tableMm = 5.6mm clearance + the full items folder box chrome + thead
//             (every items page carries one complete box)
//   closingMm = 5.6mm clearance + the 04 PAYMENT box
//   sigMm   = 6mm clearance + the 05 SIGN-OFF box
//   noteMm  = the footer line
function FolderMeasureRig({
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
  const tableRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef<HTMLDivElement>(null)
  const sigRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([])

  useLayoutEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        await document.fonts.ready
      } catch {}
      const root = rootRef.current
      if (!root || cancelled) return
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
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      if (cancelled || !rootRef.current) return
      const pxPerMm = (calRef.current?.getBoundingClientRect().height || 378) / 100
      const mm = (el: HTMLElement | null) =>
        el ? el.getBoundingClientRect().height / pxPerMm : 0
      const value = {
        headMm: mm(headRef.current),
        // the continuation box is geometrically identical to page 1's box
        contMm: 0,
        tableMm: mm(tableRef.current),
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
        fontSize: '8.5pt',
        color: HERITAGE_INK,
      }}
    >
      <div ref={calRef} style={{ height: '100mm' }} />
      <div ref={headRef}>
        <FolderHead m={m} />
      </div>
      {/* fixed items-page overhead: clearance + full box chrome + thead */}
      <div ref={tableRef}>
        <div style={{ height: '5.6mm' }} />
        <ItemsSection m={m} items={[]} pad={1.5} empty={false} />
      </div>
      {/* every row, measured individually */}
      <div>
        <ItemsSection
          m={m}
          items={m.items}
          pad={1.5}
          empty={m.items.length === 0}
          rowRefs={(i, el) => {
            rowRefs.current[i] = el
          }}
        />
      </div>
      <div ref={closingRef}>
        <div style={{ height: '5.6mm' }} />
        <PaymentSection m={m} />
      </div>
      <div ref={sigRef}>
        <div style={{ height: '6mm' }} />
        <SignOffSection m={m} />
        <div style={{ height: '1.5mm' }} />
      </div>
      <div ref={noteRef}>
        <FootLine m={m} page={1} of={1} dedicatedPageNo={lh.dedicatedPageNo} />
      </div>
    </div>
  )
}

// ── The document ────────────────────────────────────────────────────────────
export function FolderEInvoiceDocument({
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
  letterhead?: LetterheadConfig | null
  eiLetterhead?: EInvoiceLetterheadConfig | null
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
          fontSize: '8.5pt',
          color: HERITAGE_INK,
          minHeight: plan ? undefined : `${PAGE_H_MM}mm`,
        }}
      >
        {plan
          ? plan.pages.map((idxs, pageIdx) => {
              const isLast = pageIdx === plan.pages.length - 1
              const chunk = idxs.map((i) => m.items[i])
              return (
                <DocPageShell
                  key={pageIdx}
                  lh={lh}
                  isLast={isLast}
                  draft={m.inv.status === 'draft'}
                  pageIdx={pageIdx}
                  totalPages={plan.pages.length}
                >
                  <div
                    className="absolute inset-0 z-10 flex flex-col [&>*]:shrink-0"
                    style={columnStyle}
                  >
                    {pageIdx === 0 ? (
                      <FolderHead m={m} />
                    ) : null}

                    <ItemsSection
                      m={m}
                      items={chunk}
                      pad={plan.compact ? 1 : 1.5}
                      empty={m.items.length === 0 && pageIdx === 0}
                      continued={pageIdx > 0}
                    />

                    {/* 04 Payment + 05 Sign-off live ONLY on the last page,
                        never split, never opening a page alone */}
                    {isLast ? (
                      <>
                        <div style={{ height: '5.6mm' }} />
                        <PaymentSection m={m} />
                        {/* flexible spacer — empty space goes BETWEEN 04 and
                            05, so 05 (+ the footer) pins to the bottom */}
                        <div className="min-h-0 w-full" style={{ flex: '1 1 0' }} />
                        <div style={{ height: '6mm' }} />
                        <SignOffSection m={m} />
                        <div style={{ height: '1.5mm' }} />
                      </>
                    ) : null}

                    <FootLine
                      m={m}
                      page={pageIdx + 1}
                      of={plan.pages.length}
                      dedicatedPageNo={lh.dedicatedPageNo}
                    />
                  </div>
                </DocPageShell>
              )
            })
          : null}
      </div>
      {!plan ? <FolderMeasureRig m={m} lh={lh} onMeasured={handleMeasured} /> : null}
    </>
  )
}
