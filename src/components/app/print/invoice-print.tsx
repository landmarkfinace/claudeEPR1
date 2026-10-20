'use client'

// TAX INVOICE print document — A4 portrait, bilingual English/Arabic,
// ZATCA Phase 1 + Phase 2 compliant:
//   • company letterhead (logo + EN/AR name + EN/AR address from Settings)
//   • title block: TAX INVOICE / فاتورة ضريبية (standard B2B) or
//     SIMPLIFIED TAX INVOICE / فاتورة ضريبية مبسطة (simplified B2C)
//   • "Bill To" block with client EN/AR name, address, CR + VAT numbers
//   • line-items table + Subtotal / VAT / TOTAL bar (+ Amount Paid / Balance)
//   • ZATCA QR from /api/invoices/[id]/zatca — all 8 TLV tags:
//     Phase 1 (seller, VAT no, timestamp, total, VAT) + Phase 2 (invoice
//     hash, ECDSA signature, public key)
//   • compliance block: UUID, invoice hash, previous invoice hash (PIH)
//   • payment instructions (company bank details) + signature block
// Print via the browser (Ctrl+P → "Save as PDF" for the PDF export).
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Printer, QrCode, ShieldCheck, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { api } from '@/lib/api-client'
import { formatDate, formatMoney, round2 } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import type { AppSettings, DocItemRow, InvoiceRow, ZatcaStamp } from '@/lib/types'

/** Linked client info returned by GET /api/invoices/[id] (null = free-text client). */
export type InvoiceClientInfo = {
  id: string
  name: string
  nameAr: string | null
  address: string | null
  addressAr: string | null
  city: string | null
  phone: string | null
  email: string | null
  crNumber: string | null
  vatNumber: string | null
  bankName: string | null
  iban: string | null
  accountNumber: string | null
  swiftCode: string | null
} | null

/** Full invoice payload with items + linked client — the print source of truth. */
export type InvoicePrintData = InvoiceRow & {
  client: InvoiceClientInfo
  items: DocItemRow[]
}

export function InvoicePrintDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: InvoicePrintData | null
}) {
  const settings = useAppStore((s) => s.settings)
  const user = useAppStore((s) => s.user)
  usePageRule(open, 'size: A4 portrait; margin: 12mm;')

  // ZATCA Phase 1+2 stamp — fetched from the API whenever the dialog opens
  const [stamp, setStamp] = useState<ZatcaStamp | null>(null)
  const [stampLoading, setStampLoading] = useState(false)
  const [stampError, setStampError] = useState<string | null>(null)
  const stampReqId = useRef(0)

  const loadStamp = useCallback(async (invoiceId: string) => {
    const reqId = ++stampReqId.current
    setStamp(null)
    setStampError(null)
    setStampLoading(true)
    try {
      const s = await api.get<ZatcaStamp>(`/api/invoices/${invoiceId}/zatca`)
      if (reqId !== stampReqId.current) return
      setStamp(s)
    } catch (e) {
      if (reqId !== stampReqId.current) return
      setStampError(e instanceof Error ? e.message : 'ZATCA stamp failed')
    } finally {
      if (reqId === stampReqId.current) setStampLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !invoice) return
    void loadStamp(invoice.id)
  }, [open, invoice, loadStamp])

  if (!open) return null

  const currency = settings.currency || 'SAR'
  const money = (n: number) => formatMoney(n, currency)
  const i = invoice
  const vatPercent = Math.round((i?.vatRate ?? 0.15) * 100)
  const balanceDue = i ? round2(i.total - i.paidAmount) : 0
  const isSimplified = i?.invoiceType === 'simplified'
  const sellerVat = settings.vatNumber || stamp?.sellerVatNumber || ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Tax invoice print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable bilingual ZATCA-compliant tax invoice with line items, VAT breakdown,
          cryptographic stamp and verification QR code.
        </DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              {i ? `Tax Invoice — ${i.invoiceNumber}` : 'Tax Invoice'}
            </h2>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <QrCode className="h-3.5 w-3.5" />
              A4 portrait · ZATCA Phase 1 + 2 QR · {vatPercent}% VAT · English / العربية
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button onClick={() => window.print()} disabled={!i}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Scrollable preview / printable page */}
        <div className="nice-scrollbar print-area flex-1 overflow-y-auto bg-neutral-100 p-4 print:overflow-visible print:bg-white print:p-0">
          {i ? (
            <div
              dir="ltr"
              className="mx-auto w-full max-w-[820px] bg-white p-8 text-neutral-900 shadow-sm [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:max-w-none print:p-0 print:shadow-none"
              style={{ fontFamily: "'Segoe UI', 'Noto Naskh Arabic', Tahoma, Arial, sans-serif" }}
            >
              {/* ---- Letterhead (bilingual) ---- */}
              <header className="flex items-start justify-between gap-4 border-b-2 border-[#0F1F3D] pb-4">
                <div className="flex min-w-0 items-start gap-4">
                  <img
                    src={settings.logo ?? '/logo-mark.png'}
                    alt={`${settings.companyName} logo`}
                    className="h-16 w-16 shrink-0 object-contain"
                  />
                  <div className="min-w-0">
                    <p className="text-lg font-bold uppercase tracking-wide text-[#0F1F3D]">
                      {settings.companyName}
                    </p>
                    <p lang="ar" dir="rtl" className="text-sm font-bold text-[#0F1F3D]">
                      {settings.companyNameAr}
                    </p>
                    {settings.address ? (
                      <p className="mt-1 max-w-[380px] text-[10px] leading-relaxed text-neutral-600">
                        {settings.address}
                      </p>
                    ) : null}
                    {settings.addressAr ? (
                      <p
                        lang="ar"
                        dir="rtl"
                        className="max-w-[380px] text-[10px] leading-relaxed text-neutral-600"
                      >
                        {settings.addressAr}
                      </p>
                    ) : null}
                    <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-neutral-600">
                      {settings.phone ? <span>Tel: {settings.phone}</span> : null}
                      {settings.email ? <span>Email: {settings.email}</span> : null}
                    </div>
                    {sellerVat ? (
                      <p className="mt-1 text-[10px] font-semibold text-neutral-800">
                        VAT No. / الرقم الضريبي:{' '}
                        <span className="font-mono tabular-nums">{sellerVat}</span>
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="rounded-md border-l-4 border-[#D4AF37] bg-[#0F1F3D] px-3 py-1.5 text-sm font-bold tracking-widest text-white">
                    TAX INVOICE
                  </p>
                  <p lang="ar" dir="rtl" className="mt-1 text-sm font-bold text-[#0F1F3D]">
                    {isSimplified ? 'فاتورة ضريبية مبسطة' : 'فاتورة ضريبية'}
                  </p>
                  <p className="mt-2 text-[11px] text-neutral-700">
                    Invoice No. / رقم الفاتورة:{' '}
                    <span className="font-mono font-bold text-neutral-900">{i.invoiceNumber}</span>
                  </p>
                  <p className="text-[11px] text-neutral-600">
                    Issue Date / تاريخ الإصدار: {formatDate(i.issueDate)}
                  </p>
                  <p className="text-[11px] text-neutral-600">
                    Due Date / تاريخ الاستحقاق: {i.dueDate ? formatDate(i.dueDate) : '—'}
                  </p>
                  {/* status stamp */}
                  {i.status === 'paid' ? (
                    <p className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-emerald-600 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-emerald-700">
                      Paid
                    </p>
                  ) : i.status === 'issued' ? (
                    <p className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-amber-500 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-amber-600">
                      Issued
                    </p>
                  ) : i.status === 'cancelled' ? (
                    <p className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-rose-500 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-rose-600">
                      Cancelled
                    </p>
                  ) : (
                    <p className="mt-2 inline-block -rotate-6 rounded-md border-[3px] border-neutral-400 px-2.5 py-0.5 text-xs font-black uppercase tracking-[0.2em] text-neutral-500">
                      Draft
                    </p>
                  )}
                </div>
              </header>
              {/* gold accent segment under the navy header rule */}
              <div className="mt-[3px] h-[3px] w-24 bg-[#D4AF37]" aria-hidden />

              {/* ---- Bill To (bilingual) + Invoice Details ---- */}
              <section className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Bill To / الفاتورة إلى
                  </p>
                  <p className="mt-1 text-sm font-bold text-neutral-900">{i.clientName}</p>
                  {i.client?.nameAr ? (
                    <p lang="ar" dir="rtl" className="text-sm font-bold text-neutral-900">
                      {i.client.nameAr}
                    </p>
                  ) : null}
                  {i.client ? (
                    <div className="mt-1 space-y-0.5 text-[11px] leading-relaxed text-neutral-600">
                      {i.client.address ? <p>{i.client.address}</p> : null}
                      {i.client.addressAr ? (
                        <p lang="ar" dir="rtl">
                          {i.client.addressAr}
                        </p>
                      ) : null}
                      {i.client.city ? <p>{i.client.city}</p> : null}
                      {i.client.phone ? (
                        <p>
                          Tel: <span className="tabular-nums">{i.client.phone}</span>
                        </p>
                      ) : null}
                      {i.client.email ? <p>{i.client.email}</p> : null}
                      {i.client.crNumber ? (
                        <p>
                          CR No. / السجل التجاري:{' '}
                          <span className="tabular-nums">{i.client.crNumber}</span>
                        </p>
                      ) : null}
                      {i.client.vatNumber ? (
                        <p>
                          VAT No. / الرقم الضريبي:{' '}
                          <span className="font-mono tabular-nums">{i.client.vatNumber}</span>
                        </p>
                      ) : !isSimplified ? (
                        <p className="italic text-amber-700">
                          (unregistered buyer / عميل غير مسجل)
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] italic text-neutral-400">
                      (unregistered customer / عميل غير مسجل)
                    </p>
                  )}
                </div>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Invoice Details / تفاصيل الفاتورة
                  </p>
                  <div className="mt-1 space-y-0.5 text-[11px] text-neutral-600">
                    <p>
                      Subject / الموضوع:{' '}
                      <span className="font-medium text-neutral-900">{i.subject ?? '—'}</span>
                    </p>
                    <p>
                      Type / النوع:{' '}
                      <span className="font-medium text-neutral-900">
                        {isSimplified ? 'Simplified / مبسطة' : 'Standard / قياسية'}
                      </span>
                    </p>
                    <p>
                      Currency / العملة:{' '}
                      <span className="font-medium text-neutral-900">{currency}</span>
                    </p>
                    <p>
                      VAT Rate / نسبة الضريبة:{' '}
                      <span className="font-medium tabular-nums text-neutral-900">
                        {vatPercent}%
                      </span>
                    </p>
                    <p>
                      Prepared By / أعدت بواسطة:{' '}
                      <span className="font-medium text-neutral-900">
                        {i.createdByName ?? user?.name ?? 'Accounts'}
                      </span>
                    </p>
                  </div>
                </div>
              </section>

              {/* ---- Items table (bilingual headers) ---- */}
              <table className="mt-4 w-full border-collapse text-[11px]">
                <thead>
                  <tr>
                    <th className="w-[34px] border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800">
                      Sr
                    </th>
                    <th className="border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800">
                      Description / الوصف
                    </th>
                    <th className="w-[80px] border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-left font-semibold text-neutral-800">
                      Unit / الوحدة
                    </th>
                    <th className="w-[60px] border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-right font-semibold text-neutral-800">
                      Qty / الكمية
                    </th>
                    <th className="w-[90px] border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-right font-semibold text-neutral-800">
                      Unit Price / السعر
                    </th>
                    <th className="w-[100px] border border-neutral-300 bg-neutral-100 px-1.5 py-1.5 text-right font-semibold text-neutral-800">
                      Total / المجموع
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {i.items.map((it) => (
                    <tr key={it.id ?? it.sr} className="break-inside-avoid">
                      <td className="border border-neutral-300 px-1.5 py-1.5 text-center tabular-nums text-neutral-600">
                        {it.sr}
                      </td>
                      <td className="border border-neutral-300 px-1.5 py-1.5 align-top text-neutral-900">
                        {it.description}
                      </td>
                      <td className="border border-neutral-300 px-1.5 py-1.5 align-top text-neutral-600">
                        {it.unit ?? '—'}
                      </td>
                      <td className="border border-neutral-300 px-1.5 py-1.5 text-right tabular-nums text-neutral-900">
                        {it.quantity}
                      </td>
                      <td className="border border-neutral-300 px-1.5 py-1.5 text-right tabular-nums text-neutral-900">
                        {it.unitPrice.toFixed(2)}
                      </td>
                      <td className="border border-neutral-300 px-1.5 py-1.5 text-right font-semibold tabular-nums text-neutral-900">
                        {it.lineTotal.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ---- Totals bar (bilingual) ---- */}
              <div className="mt-3 flex justify-end">
                <table className="w-full max-w-[340px] border-collapse text-[11px] sm:w-[340px]">
                  <tbody>
                    <tr>
                      <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                        Subtotal / المجموع قبل الضريبة
                      </td>
                      <td className="w-[120px] border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums">
                        {i.subtotal.toFixed(2)}
                      </td>
                    </tr>
                    <tr>
                      <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                        VAT {vatPercent}% / ضريبة القيمة المضافة
                      </td>
                      <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums">
                        {i.vatAmount.toFixed(2)}
                      </td>
                    </tr>
                    <tr className="bg-[#0F1F3D] font-bold text-white">
                      <td className="border border-[#0F1F3D] px-2.5 py-2">
                        TOTAL / الإجمالي
                      </td>
                      <td className="border border-[#0F1F3D] px-2.5 py-2 text-right text-sm tabular-nums">
                        {money(i.total)}
                      </td>
                    </tr>
                    {i.paidAmount > 0 ? (
                      <>
                        <tr>
                          <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5 font-medium">
                            Amount Paid / المبلغ المدفوع
                          </td>
                          <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums text-emerald-700">
                            {money(i.paidAmount)}
                          </td>
                        </tr>
                        <tr className="font-bold">
                          <td className="border border-neutral-300 bg-neutral-50 px-2.5 py-1.5">
                            Balance Due / الرصيد المستحق
                          </td>
                          <td className="border border-neutral-300 px-2.5 py-1.5 text-right tabular-nums text-[#0F1F3D]">
                            {money(balanceDue)}
                          </td>
                        </tr>
                      </>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {/* ---- Payment instructions (company bank) ---- */}
              {settings.bankIban || settings.bankName || settings.bankAccountNumber ? (
                <section className="mt-4 break-inside-avoid rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Payment Details / تفاصيل الدفع
                  </p>
                  <div className="mt-1 flex flex-wrap gap-x-6 gap-y-0.5 text-[11px] text-neutral-700">
                    {settings.bankName ? (
                      <p>
                        <span className="text-neutral-500">Bank / البنك:</span>{' '}
                        <span className="font-medium">{settings.bankName}</span>
                      </p>
                    ) : null}
                    {settings.bankIban ? (
                      <p>
                        <span className="text-neutral-500">IBAN:</span>{' '}
                        <span className="font-mono">{settings.bankIban}</span>
                      </p>
                    ) : null}
                    {settings.bankAccountNumber ? (
                      <p>
                        <span className="text-neutral-500">Account / الحساب:</span>{' '}
                        <span className="font-mono">{settings.bankAccountNumber}</span>
                      </p>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {/* ---- Notes ---- */}
              {i.notes ? (
                <section className="mt-4 break-inside-avoid rounded-lg border border-neutral-200 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Notes / ملاحظات
                  </p>
                  <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-neutral-700">
                    {i.notes}
                  </p>
                </section>
              ) : null}

              {/* ---- ZATCA QR + compliance block + signatures ---- */}
              <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
                {/* ZATCA Phase 1 + 2 verification QR */}
                <div className="shrink-0 text-center">
                  {stampLoading ? (
                    <div className="flex h-[130px] w-[130px] items-center justify-center border border-dashed border-neutral-300">
                      <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
                    </div>
                  ) : stamp?.qrDataUrl ? (
                    <img
                      src={stamp.qrDataUrl}
                      alt="ZATCA invoice verification QR code"
                      className="h-[130px] w-[130px]"
                    />
                  ) : (
                    <div className="flex h-[130px] w-[130px] items-center justify-center border border-dashed border-rose-300 text-[9px] text-rose-400">
                      QR unavailable
                    </div>
                  )}
                  <p className="mt-1 max-w-[140px] text-[9px] leading-tight text-neutral-500">
                    Scan to verify · امسح للتحقق
                    <br />
                    ZATCA Phase 1 + 2
                  </p>
                </div>

                {/* Phase 2 cryptographic stamp details */}
                <div className="min-w-0 flex-1">
                  {stamp ? (
                    <div className="break-inside-avoid rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-600">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                        e-Invoice Cryptographic Stamp / الختم الإلكتروني
                      </p>
                      <div className="mt-1.5 space-y-1 text-[9px] leading-relaxed text-neutral-600">
                        <p className="truncate">
                          UUID:{' '}
                          <span className="font-mono text-neutral-800">{stamp.uuid}</span>
                        </p>
                        <p className="truncate">
                          Invoice Hash / بصمة الفاتورة:{' '}
                          <span className="font-mono text-neutral-800">{stamp.invoiceHash}</span>
                        </p>
                        <p className="truncate">
                          Previous Hash / بصمة الفاتورة السابقة:{' '}
                          <span className="font-mono text-neutral-800">{stamp.previousHash}</span>
                        </p>
                        <p className="truncate">
                          ECDSA Signature / التوقيع الإلكتروني:{' '}
                          <span className="font-mono text-neutral-800">{stamp.signature}</span>
                        </p>
                      </div>
                    </div>
                  ) : stampError ? (
                    <p className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2 text-[9px] text-amber-700">
                      ZATCA stamp unavailable: {stampError}
                    </p>
                  ) : null}
                  {stamp?.warnings?.length ? (
                    <p className="mt-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2 text-[9px] text-amber-700">
                      {stamp.warnings[0]}
                    </p>
                  ) : null}
                </div>

                <div className="flex min-w-[180px] justify-end">
                  <div className="min-w-[180px]">
                    <div className="flex h-12 items-end">
                      <div className="w-full border-t border-neutral-800" />
                    </div>
                    <p className="mt-1.5 text-[10px] font-bold uppercase tracking-widest text-neutral-900">
                      Authorized By / المفوض بالتوقيع
                    </p>
                    <p className="text-[10px] text-neutral-600">
                      {settings.authorizedSignatory || settings.companyName}
                    </p>
                    <p className="text-[10px] text-neutral-600">
                      {settings.signatoryTitle || 'Authorized Signatory'}
                    </p>
                  </div>
                </div>
              </div>

              <p className="mt-4 border-t border-neutral-200 pt-2 text-center text-[9px] text-neutral-400">
                This is a computer-generated tax invoice issued by {settings.companyName}. ·
                فاتورة ضريبية صادرة إلكترونياً من {settings.companyNameAr}
              </p>
            </div>
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-neutral-400">
              No invoice selected.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
