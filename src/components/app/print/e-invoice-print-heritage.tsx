'use client'

// E-Invoice print template "HERITAGE" — reference design
// E-Invoice_Template_D_Heritage (HTML + PNG attached by the boss).
//
//   • navy title band with the geometric star pattern and cut corners
//   • gold hexagon capsule carrying the invoice number
//   • serif EN/AR display titles, gold ornament lines
//   • dates row with ✦ separators, supplier/customer panels with dotted
//     EN·value·AR rows, references bar
//   • items table: cream thead with a gold rule + double gold underline,
//     ✦ item markers, mono numbers
//   • closing: ornamented AMOUNT IN WORDS + bank box (left) | totals list +
//     patterned TOTAL DUE box (right)
//   • signature row: ZATCA QR 30×30mm in a gold frame | Received by |
//     Authorized Signature | Company Stamp — pinned to the BOTTOM of the
//     LAST page, directly above the footer line
//
// DATA GUARANTEE: reads the SAME DocModel as Classic (shared module) — the
// invoice number, every amount, the VAT (incl. the BR-CO-17 rounding row),
// the totals, the amount in words, the customer and bank data and the ZATCA
// QR are IDENTICAL across all templates. Optional values that are missing
// hide their line (never a placeholder). Letterhead artwork + geometry come
// from the shared resolveLetterhead (Settings), not from the reference file.
//
// Pagination: measured (same rig pattern as Classic) with the shared
// planLayout — 1 page when it fits (rows may squeeze 2mm→1.5mm padding
// first); with many items the table continues on page 2+ behind a small
// title band (TAX INVOICE + invoice no. + "continued · تابع"), the thead
// repeats, a row is never split, and totals + bank + QR + signatures stay
// together on the last page.
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
  DARK_GOLD,
  DOC_FONT,
  DOC_MONO,
  DOC_SERIF,
  GOLD,
  HERITAGE_CREAM,
  HERITAGE_INK,
  HERITAGE_INK_SOFT,
  HERITAGE_PAPER,
  HERITAGE_RULE,
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

// ── Heritage palette (from the reference) ───────────────────────────────────
// navy #132A4A · gold #C0934C · light gold #E1B169 · dark gold #8E6420
// ink #1D2433 · ink-soft #4A5468 · cream #FAF7F1 · paper rule #EFE8D8 ·
// dotted rule #E2D6B5  (shared constants in e-invoice-print-shared)

/** The reference's geometric star pattern — two overlapping squares rotated
 *  45°, thin light-gold strokes at 35% opacity. Used ONLY as a light
 *  background on the title band and the TOTAL DUE box (never near the QR or
 *  behind table numbers). */
const STAR_PATTERN =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='18' height='18'><g fill='none' stroke='%23E1B169' stroke-width='.6' opacity='.35'><rect x='4' y='4' width='10' height='10'/><rect x='4' y='4' width='10' height='10' transform='rotate(45 9 9)'/></g></svg>\")"

/** cut-corner clip path (reference: 3mm chamfers). */
const CLIP_CORNERS =
  'polygon(3mm 0, calc(100% - 3mm) 0, 100% 3mm, 100% calc(100% - 3mm), calc(100% - 3mm) 100%, 3mm 100%, 0 calc(100% - 3mm), 0 3mm)'

/** gold hexagon clip path (reference .med). */
const CLIP_HEXAGON =
  'polygon(4mm 0, calc(100% - 4mm) 0, 100% 50%, calc(100% - 4mm) 100%, 4mm 100%, 0 50%)'

/** Serif stack for Arabic display text (Latin serifs carry no Arabic
 *  glyphs, so Arabic falls through to the Cairo webfont — correct shaping). */
const AR_SERIF = `'DejaVu Serif', Georgia, var(--font-cairo), 'Cairo', 'Noto Sans Arabic', serif`

/** gold gradient rule (reference .gl). */
function GoldRule() {
  return (
    <div
      style={{
        height: '1.4mm',
        marginTop: '1mm',
        background:
          'linear-gradient(90deg, transparent, #C0934C 15%, #E1B169 50%, #C0934C 85%, transparent)',
      }}
    />
  )
}

/** ornament line — label between two fading gold lines (reference .orn). */
function Orn({ en, ar }: { en: string; ar: string }) {
  return (
    <div
      className="flex items-center gap-[2.5mm] text-[7.2pt] font-bold"
      style={{ color: DARK_GOLD, letterSpacing: '.8pt', marginBottom: '1.6mm' }}
    >
      <span
        className="flex-1"
        style={{ height: '1px', background: 'linear-gradient(90deg, transparent, #C0934C)' }}
      />
      {en}
      <span lang="ar" dir="rtl" style={{ letterSpacing: 0, fontSize: '8pt', fontFamily: DOC_FONT }}>
        {ar}
      </span>
      <span
        className="flex-1"
        style={{ height: '1px', background: 'linear-gradient(90deg, #C0934C, transparent)' }}
      />
    </div>
  )
}

/** dotted EN · value · AR row (reference .kv) — hidden entirely when the
 *  value is missing (missing optional values never print a placeholder). */
function KvRow({ en, ar, value }: { en: string; ar: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div
      className="grid items-baseline text-[7.6pt]"
      style={{ gridTemplateColumns: 'auto 1fr auto', gap: '2mm', padding: '.6mm 0', borderBottom: `1px dotted ${HERITAGE_RULE}` }}
    >
      <span style={{ color: HERITAGE_INK_SOFT }}>{en}</span>
      <b className="text-center font-bold" style={{ fontFamily: DOC_MONO, color: HERITAGE_INK }}>
        {value}
      </b>
      <span lang="ar" dir="rtl" className="text-right" style={{ color: HERITAGE_INK_SOFT }}>
        {ar}
      </span>
    </div>
  )
}

// ── The title band (reference .band) ────────────────────────────────────────
function TitleBand({ m }: { m: DocModel }) {
  return (
    <div
      className="relative grid text-white"
      style={{
        background: `${NAVY} ${STAR_PATTERN}`,
        backgroundRepeat: 'repeat',
        height: '21mm',
        gridTemplateColumns: '1fr 46mm 1fr',
        alignItems: 'center',
        padding: '0 5mm',
        clipPath: CLIP_CORNERS,
      }}
    >
      <div
        className="break-words"
        style={{ fontFamily: DOC_SERIF, fontSize: '15pt', letterSpacing: '2.5pt', lineHeight: 1.15 }}
      >
        {m.title.en}
      </div>
      <div
        className="flex flex-col items-center justify-center"
        style={{
          justifySelf: 'center',
          background: LIGHT_GOLD,
          color: NAVY,
          width: '44mm',
          height: '15mm',
          clipPath: CLIP_HEXAGON,
        }}
      >
        <small className="text-[6.2pt] font-bold" style={{ letterSpacing: '.6pt' }}>
          {m.title.en.includes('TAX') ? 'INVOICE NO.' : 'DOCUMENT NO.'} ·{' '}
          <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
            رقم الفاتورة
          </span>
        </small>
        <b className="mt-[.4mm] font-bold" style={{ fontFamily: DOC_MONO, fontSize: '10pt' }}>
          {m.inv.invoiceNumber}
        </b>
      </div>
      <div
        lang="ar"
        dir="rtl"
        className="break-words text-right"
        style={{ fontFamily: AR_SERIF, fontSize: '15pt', color: LIGHT_GOLD, lineHeight: 1.3 }}
      >
        {m.title.ar}
      </div>
    </div>
  )
}

/** Small continuation band (page 2+): TAX INVOICE + invoice no. + continued. */
function MiniBand({ m }: { m: DocModel }) {
  return (
    <div
      className="relative flex items-center justify-between text-white"
      style={{
        background: `${NAVY} ${STAR_PATTERN}`,
        backgroundRepeat: 'repeat',
        height: '11mm',
        padding: '0 5mm',
        clipPath: CLIP_CORNERS,
      }}
    >
      <span style={{ fontFamily: DOC_SERIF, fontSize: '10pt', letterSpacing: '1.5pt' }}>
        {m.title.en}
      </span>
      <span className="text-[7.6pt] font-bold" style={{ fontFamily: DOC_MONO, color: LIGHT_GOLD }}>
        {m.inv.invoiceNumber}
        <span className="mx-1.5 font-sans font-semibold" style={{ color: '#fff' }}>
          · continued ·{' '}
        </span>
        <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT, letterSpacing: 0 }}>
          تابع
        </span>
      </span>
      <span lang="ar" dir="rtl" style={{ fontFamily: AR_SERIF, fontSize: '10pt', color: LIGHT_GOLD }}>
        {m.title.ar}
      </span>
    </div>
  )
}

// ── Dates row (reference .dates) — ✦ separators, mono values ───────────────
// Cells with no value hide entirely (boss rule: hide if empty — no '—'
// placeholders, no reformatting; present dates print DD / MM / YYYY exactly
// like Classic).
function DatesRow({ m }: { m: DocModel }) {
  const cells: Array<[string, string, string | null]> = [
    ['Issue Date', 'تاريخ الإصدار', fmtDate(m.inv.issueDate)],
    ['Supply', 'التوريد', m.inv.supplyDate ? fmtDate(m.inv.supplyDate) : null],
    ['Due Date', 'الاستحقاق', m.inv.dueDate ? fmtDate(m.inv.dueDate) : null],
    ['Currency', 'العملة', m.currency],
  ]
  const visible = cells.filter((c) => c[2] !== null)
  return (
    <div
      className="grid text-center"
      style={{ gridTemplateColumns: `repeat(${Math.max(visible.length, 1)}, 1fr)`, marginTop: '2mm' }}
    >
      {visible.map(([en, ar, value], i) => (
        <div key={en} className="relative">
          {i > 0 ? (
            <span
              aria-hidden
              className="absolute"
              style={{ left: '-1.5mm', top: '2.2mm', color: GOLD, fontSize: '7pt' }}
            >
              ✦
            </span>
          ) : null}
          <small
            className="block text-[6.6pt] font-semibold"
            style={{ color: HERITAGE_INK_SOFT }}
          >
            {en} ·{' '}
            <span lang="ar" dir="rtl">
              {ar}
            </span>
          </small>
          <b
            className="mt-[.6mm] block font-bold"
            style={{ fontSize: '8.6pt', color: NAVY, fontFamily: DOC_MONO }}
          >
            {value}
          </b>
        </div>
      ))}
    </div>
  )
}

// ── Supplier / Customer panels (reference .parties) ─────────────────────────
function PartyPanel({
  who,
  whoAr,
  nameEn,
  nameAr,
  vat,
  cr,
  addressEn,
  addressAr,
}: {
  who: string
  whoAr: string
  nameEn: string
  nameAr: string
  vat: string | null | undefined
  cr: string | null | undefined
  addressEn?: string | null
  addressAr?: string | null
}) {
  return (
    <div>
      <Orn en={who} ar={whoAr} />
      <p
        className="break-words text-center font-bold"
        style={{ fontFamily: DOC_SERIF, fontSize: '10pt', color: NAVY, lineHeight: 1.25 }}
      >
        {nameEn}
      </p>
      {nameAr ? (
        <p
          lang="ar"
          dir="rtl"
          className="break-words text-center font-bold"
          style={{ fontFamily: DOC_FONT, fontSize: '9pt', color: NAVY, marginTop: '.4mm', lineHeight: 1.4 }}
        >
          {nameAr}
        </p>
      ) : null}
      <div style={{ marginTop: '.8mm' }}>
        <KvRow en="VAT No." ar="الرقم الضريبي" value={vat} />
        <KvRow en="C.R. No." ar="السجل التجاري" value={cr} />
      </div>
      {addressEn ? (
        <p
          className="break-words text-center"
          style={{ fontSize: '7.5pt', marginTop: '.6mm', lineHeight: 1.45, color: HERITAGE_INK }}
        >
          {addressEn}
        </p>
      ) : null}
      {addressAr ? (
        <p
          lang="ar"
          dir="rtl"
          className="break-words text-center"
          style={{ fontFamily: DOC_FONT, fontSize: '7.5pt', marginTop: '.3mm', lineHeight: 1.45, color: HERITAGE_INK }}
        >
          {addressAr}
        </p>
      ) : null}
    </div>
  )
}

// ── References bar (reference .refs) ────────────────────────────────────────
function RefsBar({ m }: { m: DocModel }) {
  const { inv } = m
  const cells: Array<{ label: string; labelAr: string; value: string | null; ar?: string | null }> = [
    { label: 'P.O. / Contract', labelAr: 'أمر الشراء', value: inv.poRef || inv.contractRef },
    { label: 'Project', labelAr: 'المشروع', value: inv.projectEn, ar: inv.projectAr },
    { label: 'Payment Terms', labelAr: 'شروط الدفع', value: inv.paymentTermsEn, ar: inv.paymentTermsAr },
    { label: 'Method', labelAr: 'طريقة الدفع', value: inv.paymentMethodEn, ar: inv.paymentMethodAr },
  ]
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: '1fr 1.5fr 1.1fr .8fr',
        marginTop: '2mm',
        borderTop: `1px solid ${HERITAGE_RULE}`,
        borderBottom: `1px solid ${HERITAGE_RULE}`,
      }}
    >
      {cells.map((c, i) => (
        <div
          key={c.label}
          className="px-[2.5mm] py-[1.8mm] text-center"
          style={i > 0 ? { borderLeft: `1px solid ${HERITAGE_RULE}` } : undefined}
        >
          <small className="block text-[6.5pt] font-semibold" style={{ color: HERITAGE_INK_SOFT }}>
            {c.label} ·{' '}
            <span lang="ar" dir="rtl">
              {c.labelAr}
            </span>
          </small>
          <b className="mt-[.4mm] block break-words font-semibold" style={{ fontSize: '8pt', color: NAVY, lineHeight: 1.3 }}>
            {c.value || '—'}
          </b>
          {c.ar ? (
            <span lang="ar" dir="rtl" className="block break-words" style={{ fontFamily: DOC_FONT, fontSize: '7.2pt', color: HERITAGE_INK_SOFT, lineHeight: 1.4 }}>
              {c.ar}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

// ── Items table (reference table) ───────────────────────────────────────────
// cream thead with a gold top rule + double gold underline; ✦ item markers;
// mono right-aligned numbers; AR description/unit as a second line.
function ItemsTable({
  m,
  items,
  pad,
  empty,
  rowRefs,
}: {
  m: DocModel
  items: EInvoiceItemRow[]
  /** normal 2mm row padding; 1.5mm when the planner squeezes onto one page */
  pad: number
  empty: boolean
  rowRefs?: (i: number, el: HTMLTableRowElement | null) => void
}) {
  const { currency } = m
  const thBase: React.CSSProperties = {
    background: HERITAGE_CREAM,
    color: NAVY,
    fontSize: '7pt',
    fontWeight: 700,
    padding: '1.8mm 1.6mm',
    borderTop: `1px solid ${GOLD}`,
    borderBottom: `3px double ${GOLD}`,
    lineHeight: 1.3,
    textAlign: 'right',
    verticalAlign: 'bottom',
  }
  const td: React.CSSProperties = {
    padding: `${pad}mm 1.6mm`,
    borderBottom: `1px solid ${HERITAGE_PAPER}`,
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
    <table
      className="w-full"
      style={{ borderCollapse: 'collapse', tableLayout: 'auto' }}
    >
      <thead style={{ display: 'table-header-group' }}>
        <tr>
          <th style={{ ...thBase, width: '10mm', textAlign: 'center' }}>#</th>
          <th style={{ ...thBase, textAlign: 'left' }}>
            Description
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: DARK_GOLD, textAlign: 'left' }}>
              الوصف
            </span>
          </th>
          <th style={{ ...thBase, textAlign: 'center' }}>
            Qty
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: DARK_GOLD }}>
              الكمية
            </span>
          </th>
          <th style={thBase}>
            Unit Price
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: DARK_GOLD }}>
              سعر الوحدة
            </span>
          </th>
          <th style={thBase}>
            Taxable
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: DARK_GOLD }}>
              الخاضع
            </span>
          </th>
          <th style={{ ...thBase, textAlign: 'center' }}>
            VAT
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: DARK_GOLD }}>
              النسبة
            </span>
          </th>
          <th style={thBase}>
            VAT Amt
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: DARK_GOLD }}>
              الضريبة
            </span>
          </th>
          <th style={thBase}>
            {`Total ${currency}`}
            <span lang="ar" dir="rtl" className="block font-normal" style={{ fontFamily: DOC_FONT, color: DARK_GOLD }}>
              الإجمالي
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        {empty && items.length === 0 ? (
          <tr>
            <td
              colSpan={8}
              className="text-center"
              style={{ ...td, textAlign: 'center', color: HERITAGE_INK_SOFT, padding: '3mm' }}
            >
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
              <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                <span style={{ color: GOLD, fontSize: '9pt' }}>✦</span> {it.sr}
              </td>
              <td style={td}>
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
              <td style={{ ...td, textAlign: 'center', whiteSpace: 'nowrap' }}>
                {fmtQty(it.quantity)}
                {it.unitEn ? ` ${it.unitEn}` : ''}
                {it.unitAr ? arLine(it.unitAr, true) : null}
              </td>
              <td style={tdR}>{m.money(it.unitPrice)}</td>
              <td style={tdR}>{m.money(it.taxableAmount)}</td>
              <td style={{ ...td, textAlign: 'center' }}>{`${Math.round(it.vatPercent)}%`}</td>
              <td style={tdR}>{m.money(it.vatAmount)}</td>
              <td style={{ ...tdR, fontWeight: 700 }}>{m.money(it.lineTotal)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

// ── Closing group (reference .low): words + bank box | totals + TOTAL DUE ──
function ClosingGroup({ m }: { m: DocModel }) {
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
    <div className="grid" style={{ gridTemplateColumns: '1fr 74mm', gap: '5mm' }}>
      {/* left — ornamented box: amount in words + bank details */}
      <div className="relative" style={{ border: `1px solid ${HERITAGE_RULE}`, padding: '2.6mm 3.5mm' }}>
        <span
          aria-hidden
          className="absolute"
          style={{ top: '-2.2mm', left: '2mm', color: GOLD, fontSize: '7pt', background: '#fff', padding: '0 .8mm' }}
        >
          ✦
        </span>
        <span
          aria-hidden
          className="absolute"
          style={{ bottom: '-2.2mm', right: '2mm', color: GOLD, fontSize: '7pt', background: '#fff', padding: '0 .8mm' }}
        >
          ✦
        </span>
        <div style={{ fontSize: '7.6pt', lineHeight: 1.5, color: HERITAGE_INK }}>
          <b style={{ color: DARK_GOLD }}>AMOUNT IN WORDS ·{' '}
            <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
              المبلغ كتابةً
            </span>
          </b>
          <br />
          {m.words.en}
          <span lang="ar" dir="rtl" className="block text-right" style={{ fontFamily: DOC_FONT }}>
            {m.words.ar}
          </span>
        </div>
        {anyBank ? (
          <div
            className="grid"
            style={{
              gridTemplateColumns: '1.3fr 1fr',
              gap: '1.2mm 4mm',
              fontSize: '7.5pt',
              marginTop: '2.4mm',
              paddingTop: '2.2mm',
              borderTop: `1px dotted ${HERITAGE_RULE}`,
              color: HERITAGE_INK,
            }}
          >
            <div>
              <small className="block text-[6.4pt] font-semibold" style={{ color: HERITAGE_INK_SOFT }}>
                Account Name ·{' '}
                <span lang="ar" dir="rtl">
                  اسم الحساب
                </span>
              </small>
              <b className="font-semibold">{settings.bankAccountName || '—'}</b>
            </div>
            <div>
              <small className="block text-[6.4pt] font-semibold" style={{ color: HERITAGE_INK_SOFT }}>
                Bank ·{' '}
                <span lang="ar" dir="rtl">
                  البنك
                </span>
              </small>
              <b className="font-semibold">{settings.bankName || '—'}</b>
            </div>
            <div>
              <small className="block text-[6.4pt] font-semibold" style={{ color: HERITAGE_INK_SOFT }}>
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
              <small className="block text-[6.4pt] font-semibold" style={{ color: HERITAGE_INK_SOFT }}>
                Account No. · SWIFT
              </small>
              <b className="break-all font-semibold" style={{ fontFamily: DOC_MONO }}>
                {[settings.bankAccountNumber, settings.bankSwiftCode].filter(Boolean).join(' · ') || '—'}
              </b>
            </div>
          </div>
        ) : null}
      </div>

      {/* right — totals list + patterned TOTAL DUE box */}
      <div>
        <div>
          {rows.map(([en, ar, value]) => (
            <div
              key={en}
              className="flex items-baseline justify-between"
              style={{ fontSize: '8pt', padding: '1.15mm 0', borderBottom: `1px dotted ${HERITAGE_RULE}` }}
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
        </div>
        <div
          className="flex items-center justify-between text-white"
          style={{
            marginTop: '2mm',
            background: `${NAVY} ${STAR_PATTERN}`,
            backgroundRepeat: 'repeat',
            padding: '3mm 4mm',
            clipPath: CLIP_CORNERS,
          }}
        >
          <span style={{ fontFamily: DOC_SERIF, fontSize: '9pt', letterSpacing: '.8pt', lineHeight: 1.4 }}>
            {`TOTAL DUE · ${m.currency}`}
            <span lang="ar" dir="rtl" className="block" style={{ fontFamily: DOC_FONT, color: LIGHT_GOLD, letterSpacing: 0 }}>
              الإجمالي المستحق
            </span>
          </span>
          <b style={{ fontFamily: DOC_MONO, fontSize: '14pt', color: LIGHT_GOLD }}>
            {m.money(inv.totalDue)}
          </b>
        </div>
      </div>
    </div>
  )
}

// ── Signature row (reference .fin) — QR | Received | Authorized | Stamp ─────
function SignatureRow({ m }: { m: DocModel }) {
  const { inv, config } = m
  const receiver = inv.showReceiverSignature
  const sigLabel = (en: string, ar: string) => (
    <b className="block font-bold" style={{ fontFamily: DOC_SERIF, fontSize: '7.6pt', color: NAVY, marginTop: '1.2mm' }}>
      {en}
      <span lang="ar" dir="rtl" className="float-right" style={{ fontFamily: DOC_FONT, color: DARK_GOLD, fontSize: '7.2pt' }}>
        {ar}
      </span>
    </b>
  )
  return (
    <div
      className="grid items-end"
      style={{
        gridTemplateColumns: receiver ? '36mm minmax(0,1fr) minmax(0,1fr) 28mm' : '36mm minmax(0,1fr) minmax(0,1fr)',
        gap: '5mm',
      }}
    >
      {/* ZATCA QR — exactly 30×30mm, black on white, in the gold frame */}
      <div
        className="text-center"
        style={{ border: `1px solid ${GOLD}`, borderRadius: '1.5mm', padding: '1.5mm', fontSize: '6.2pt', color: HERITAGE_INK_SOFT }}
      >
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

      {receiver ? (
        <div>
          <div style={{ height: '12mm', borderBottom: `1px solid ${NAVY}` }} />
          {sigLabel('Received by', 'توقيع المستلم')}
          <small className="block" style={{ fontSize: '6.6pt', color: HERITAGE_INK_SOFT, marginTop: '.4mm' }}>
            Name &amp; Date ·{' '}
            <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
              الاسم والتاريخ
            </span>
          </small>
        </div>
      ) : null}

      <div>
        <div className="flex items-end justify-center" style={{ height: '12mm', borderBottom: `1px solid ${NAVY}` }}>
          {config.signature ? (
            <img
              src={config.signature}
              alt="Authorized signature"
              className="block max-h-[11mm] object-contain"
            />
          ) : null}
        </div>
        {sigLabel('Authorized Signature', 'التوقيع المعتمد')}
        <small className="block" style={{ fontSize: '6.6pt', color: HERITAGE_INK_SOFT, marginTop: '.4mm' }}>
          Name &amp; Date ·{' '}
          <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
            الاسم والتاريخ
          </span>
        </small>
      </div>

      <div className="flex flex-col items-center justify-center text-center" style={{ width: '26mm', height: '26mm', border: `1.4px dashed ${GOLD}`, borderRadius: '50%', fontSize: '6.4pt', color: DARK_GOLD, marginInline: 'auto' }}>
        {config.stamp ? (
          <img
            src={config.stamp}
            alt="Company stamp"
            className="block max-h-[15mm] max-w-[15mm] object-contain"
          />
        ) : (
          <>
            <span>Company Stamp</span>
            <span lang="ar" dir="rtl" style={{ fontFamily: DOC_FONT }}>
              ختم الشركة
            </span>
          </>
        )}
      </div>
    </div>
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
      style={{ fontSize: '6.4pt', color: HERITAGE_INK_SOFT, paddingTop: '1.5mm' }}
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

// ── Measure rig (same pattern as Classic — real DOM heights in mm) ─────────
function HeritageMeasureRig({
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
        contMm: mm(contRef.current),
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
        <HeritageHead m={m} />
        {/* spacing between the refs bar and the items table (real box so the
            measured head height includes it) */}
        <div style={{ height: '2.5mm' }} />
      </div>
      <div ref={contRef}>
        <MiniBand m={m} />
        <div style={{ height: '2.5mm' }} />
      </div>
      {/* fixed table overhead: thead only (the Heritage table has no box) */}
      <div ref={tableRef}>
        <ItemsTable m={m} items={[]} pad={2} empty={false} />
      </div>
      {/* every row, measured individually */}
      <div>
        <ItemsTable
          m={m}
          items={m.items}
          pad={2}
          empty={m.items.length === 0}
          rowRefs={(i, el) => {
            rowRefs.current[i] = el
          }}
        />
      </div>
      <div ref={closingRef}>
        <div style={{ height: '2.5mm' }} />
        <ClosingGroup m={m} />
      </div>
      <div ref={sigRef}>
        <SignatureRow m={m} />
        <div style={{ height: '1.5mm' }} />
      </div>
      <div ref={noteRef}>
        <FootLine m={m} page={1} of={1} dedicatedPageNo={lh.dedicatedPageNo} />
      </div>
    </div>
  )
}

// ── Head blocks (band → notices → dates → parties → refs) ───────────────────
function HeritageHead({ m }: { m: DocModel }) {
  const { inv, supplier } = m
  return (
    <>
      <TitleBand m={m} />
      <GoldRule />
      {inv.relatedInvoiceNumber ? (
        <p
          className="text-center"
          style={{ marginTop: '1.2mm', fontSize: '8pt', color: HERITAGE_INK_SOFT }}
        >
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
      <DatesRow m={m} />
      <div className="grid grid-cols-2" style={{ gap: '6mm', marginTop: '2.5mm' }}>
        <PartyPanel
          who="SUPPLIER"
          whoAr="المورد"
          nameEn={supplier.nameEn}
          nameAr={supplier.nameAr}
          vat={supplier.vat}
          cr={supplier.cr}
        />
        <PartyPanel
          who="CUSTOMER"
          whoAr="العميل"
          nameEn={inv.clientNameEn}
          nameAr={inv.clientNameAr}
          vat={inv.clientVatNumber}
          cr={inv.clientCrNumber}
          addressEn={m.buyerAddr}
          addressAr={inv.clientAddressAr}
        />
      </div>
      <RefsBar m={m} />
    </>
  )
}

// ── The document ────────────────────────────────────────────────────────────
export function HeritageEInvoiceDocument({
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
                      <HeritageHead m={m} />
                    ) : (
                      <>
                        <MiniBand m={m} />
                        <div style={{ height: '2.5mm' }} />
                      </>
                    )}

                    <div style={{ height: pageIdx === 0 ? '2.5mm' : 0 }} />
                    <ItemsTable
                      m={m}
                      items={chunk}
                      pad={plan.compact ? 1.5 : 2}
                      empty={m.items.length === 0 && pageIdx === 0}
                    />

                    {isLast ? (
                      <>
                        <div style={{ height: '2.5mm' }} />
                        <ClosingGroup m={m} />
                      </>
                    ) : null}

                    {/* flexible spacer — empty space goes BETWEEN the closing
                        group and the signature row, never below it */}
                    <div className="min-h-0 w-full" style={{ flex: '1 1 0' }} />

                    {isLast ? (
                      <>
                        <SignatureRow m={m} />
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
      {!plan ? <HeritageMeasureRig m={m} lh={lh} onMeasured={handleMeasured} /> : null}
    </>
  )
}
