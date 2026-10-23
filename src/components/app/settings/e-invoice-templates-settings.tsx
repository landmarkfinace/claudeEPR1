'use client'

// Settings › E-Invoice › Templates — choose the module's default print
// template and preview each layout. The default only decides which template
// NEW e-invoices (and legacy rows with no saved choice) print in; every
// invoice can override it individually (print-preview dropdown + the
// invoice form). Changing the default — or any template choice — never
// touches invoice data, totals, numbering, status or the ZATCA QR.
//
// The preview renders an IN-MEMORY demo invoice (never saved, no invoice
// number consumed, nothing written to the database) with a 2-item / 8-item
// toggle: 2 items shows the single-page layout, 8 items shows the
// multi-page behaviour (items continue on page 2, QR + signatures pinned to
// the bottom of the last page) without creating any real document.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eye, LayoutTemplate, Star } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import {
  EINVOICE_TEMPLATES,
  resolveEInvoiceTemplate,
  type EInvoiceTemplateId,
} from '@/lib/e-invoice-templates'
import type {
  AppSettings,
  EInvoiceConfig,
  EInvoiceItemRow,
  EInvoiceLetterheadConfig,
  EInvoiceRow,
  LetterheadConfig,
} from '@/lib/types'
import { SectionCard } from '@/components/app/shared/page-header'
import { EInvoiceDocument } from '@/components/app/print/e-invoice-print'
import { DEFAULT_EI_CONFIG } from '@/components/app/print/e-invoice-print-shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

/** Demo items — the reference design's two lines plus six more manpower
 *  lines, so the toggle can show both the 1-page and the multi-page layout. */
function demoItems(): EInvoiceItemRow[] {
  const mk = (
    sr: number,
    descriptionEn: string,
    descriptionAr: string,
    unitEn: string,
    unitAr: string,
    unitPrice: number
  ): EInvoiceItemRow => {
    const taxable = unitPrice
    const vat = Math.round(taxable * 0.15 * 100) / 100
    return {
      id: `demo-${sr}`,
      sr,
      descriptionEn,
      descriptionAr,
      descArManual: true,
      unitEn,
      unitAr,
      unitArManual: true,
      quantity: 1,
      unitPrice,
      discount: 0,
      vatPercent: 15,
      taxCategory: 'S',
      exemptionCode: null,
      exemptionReason: null,
      taxableAmount: taxable,
      vatAmount: vat,
      lineTotal: Math.round((taxable + vat) * 100) / 100,
    }
  }
  return [
    mk(
      1,
      'Supply of Helper — Monthly Manpower (October 2026)',
      'توريد عامل مساعد — عمالة شهرية (أكتوبر 2026)',
      'Month',
      'شهر',
      9100
    ),
    mk(
      2,
      'Supply of Carpenter — Monthly Manpower (October 2026)',
      'توريد نجار — عمالة شهرية (أكتوبر 2026)',
      'Month',
      'شهر',
      4420
    ),
    mk(
      3,
      'Supply of Pipe Fitter — Monthly Manpower (October 2026)',
      'توريد سباك أنابيب — عمالة شهرية (أكتوبر 2026)',
      'Month',
      'شهر',
      6300
    ),
    mk(
      4,
      'Supply of Welder — Monthly Manpower (October 2026)',
      'توريد لحام — عمالة شهرية (أكتوبر 2026)',
      'Month',
      'شهر',
      7200
    ),
    mk(
      5,
      'Supply of Rigger — Monthly Manpower (October 2026)',
      'توريد ريغر — عمالة شهرية (أكتوبر 2026)',
      'Month',
      'شهر',
      5400
    ),
    mk(
      6,
      'Supply of Coating QCI — Monthly Manpower (October 2026)',
      'توريد فاحص طلاء — عمالة شهرية (أكتوبر 2026)',
      'Month',
      'شهر',
      8100
    ),
    mk(
      7,
      'Supply of Line Checker — Monthly Manpower (October 2026)',
      'توريد فاحص خطوط — عمالة شهرية (أكتوبر 2026)',
      'Month',
      'شهر',
      4900
    ),
    mk(
      8,
      'Supply of Office Coordinator — Monthly Manpower (October 2026)',
      'توريد منسق مكتب — عمالة شهرية (أكتوبر 2026)',
      'Month',
      'شهر',
      5600
    ),
  ]
}

/** Demo e-invoice used ONLY for template previews in this settings section —
 *  never saved, never sent to the API, no invoice number consumed. */
function buildDemoInvoice(itemCount: 2 | 8): EInvoiceRow {
  const items = demoItems().slice(0, itemCount)
  const subtotal = Math.round(items.reduce((s, it) => s + it.taxableAmount, 0) * 100) / 100
  const vatAmount = Math.round(items.reduce((s, it) => s + it.vatAmount, 0) * 100) / 100
  return {
    id: 'preview',
    invoiceNumber: 'INV-PREVIEW',
    docType: 'invoice',
    clientId: null,
    clientNameEn: 'Eastern Province Industrial Services',
    clientNameAr: 'خدمات المنطقة الشرقية الصناعية',
    clientVatNumber: '320501883640003',
    clientCrNumber: '2050188364',
    clientAddressEn: '2841 1st Industrial Street, 2nd Industrial City, Dammam 34326',
    clientAddressAr: 'الشارع الصناعي الأول، المدينة الصناعية الثانية، الدمام 34326',
    poRef: 'EPIS-PO-2026-118',
    contractRef: null,
    projectEn: 'Jafurah Gas Project — Manpower Supply',
    projectAr: 'مشروع غاز الجافورة — توريد عمالة',
    paymentTermsEn: '30 days from invoice date',
    paymentTermsAr: 'خلال 30 يوماً من تاريخ الفاتورة',
    paymentMethodEn: 'Bank Transfer',
    paymentMethodAr: 'تحويل بنكي',
    issueDate: '2026-10-23T00:00:00.000Z',
    supplyDate: '2026-10-23T00:00:00.000Z',
    dueDate: '2026-11-22T00:00:00.000Z',
    status: 'issued',
    subtotal,
    totalDiscount: 0,
    taxableAmount: subtotal,
    vatAmount,
    totalDue: Math.round((subtotal + vatAmount) * 100) / 100,
    paidAmount: 0,
    notesEn: null,
    notesAr: null,
    arManualFlags: [],
    showReceiverSignature: true,
    zatcaPhase: 1,
    zatcaStatus: null,
    zatcaSubmittedAt: null,
    zatcaSubmissionMode: null,
    invoiceKind: 'standard',
    noteReason: null,
    paymentMeansCode: '30',
    buyerStreet: '2841 1st Industrial Street',
    buyerBuildingNo: '2841',
    buyerDistrict: '2nd Industrial City',
    buyerCity: 'Dammam',
    buyerPostalCode: '34326',
    buyerCountry: 'SA',
    hasSignedXml: false,
    hasClearedXml: false,
    relatedInvoiceId: null,
    uuid: null,
    icv: null,
    invoiceHash: null,
    previousHash: null,
    issuedAt: null,
    issuedByName: null,
    signedCopyImage: null,
    template: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    overdue: false,
    itemCount: items.length,
    items,
    payments: [],
    relatedInvoiceNumber: null,
  }
}

export function EInvoiceTemplatesSettingsSection({ canEdit }: { canEdit: boolean }) {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)

  const [current, setCurrent] = useState<EInvoiceTemplateId>(() =>
    resolveEInvoiceTemplate(null, settings.eInvoiceDefaultTemplate)
  )
  const [saving, setSaving] = useState(false)

  // preview dialog state
  const [preview, setPreview] = useState<EInvoiceTemplateId | null>(null)
  const [demoItems, setDemoItems] = useState<2 | 8>(2)
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)
  const [eiLetterhead, setEiLetterhead] = useState<EInvoiceLetterheadConfig | null>(null)
  const [config, setConfig] = useState<EInvoiceConfig | null>(null)

  // fresh settings on mount (another tab may have changed the default)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get<{ settings: AppSettings }>('/api/settings')
        if (cancelled) return
        setCurrent(resolveEInvoiceTemplate(null, res.settings.eInvoiceDefaultTemplate))
      } catch {
        /* keep the store value */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // letterhead + print config for the previews (same sources as the real print)
  useEffect(() => {
    if (!preview) return
    let cancelled = false
    ;(async () => {
      try {
        const [lh, eiLh, cfg] = await Promise.all([
          api.get<LetterheadConfig>('/api/letterhead'),
          api.get<EInvoiceLetterheadConfig>('/api/e-invoice-letterhead'),
          api.get<EInvoiceConfig>('/api/e-invoice-config'),
        ])
        if (cancelled) return
        setLetterhead(lh)
        setEiLetterhead(eiLh)
        setConfig(cfg)
      } catch {
        /* preview without artwork */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [preview])

  async function setDefault(id: EInvoiceTemplateId) {
    if (saving || !canEdit) return
    if (id === current) return
    setSaving(true)
    try {
      await api.put('/api/settings', { eInvoiceDefaultTemplate: id })
      setCurrent(id)
      // keep the whole app in sync (new invoices read this default)
      setSettings({ ...settings, eInvoiceDefaultTemplate: id })
      toast.success(`Default e-invoice template: ${EINVOICE_TEMPLATES.find((t) => t.id === id)?.label}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the default template')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
            E-Invoice Templates
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The default print layout for e-invoices — new invoices start with it and legacy
            invoices follow it until they get their own choice. Changing the template never
            changes invoice data, amounts, VAT, totals, numbering, status or the ZATCA QR —
            it is allowed even on issued (locked) invoices because it changes only the look.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {EINVOICE_TEMPLATES.map((t) => {
          const isDefault = t.id === current
          return (
            <div
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {t.label}
                  {isDefault ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                      <Star className="h-3 w-3" />
                      Default
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreview(t.id)}>
                  <Eye className="h-4 w-4" />
                  Preview
                </Button>
                <Button
                  variant={isDefault ? 'secondary' : 'default'}
                  size="sm"
                  disabled={!canEdit || saving || isDefault}
                  onClick={() => void setDefault(t.id)}
                >
                  {isDefault ? 'Current default' : 'Set as default'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {/* template preview — in-memory demo data (never saved), real
          letterhead/signature/stamp artwork from Settings */}
      <Dialog open={preview !== null} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]"
        >
          <DialogTitle className="sr-only">E-Invoice template preview</DialogTitle>
          <DialogDescription className="sr-only">
            Preview of the e-invoice print template with in-memory demo data.
          </DialogDescription>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <p className="text-sm font-semibold">
              {EINVOICE_TEMPLATES.find((t) => t.id === preview)?.label} — preview
            </p>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-md border p-0.5">
                {([2, 8] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDemoItems(n)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      demoItems === n
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {n} items
                  </button>
                ))}
              </div>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Demo data — your invoices print real data
              </p>
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                Close
              </Button>
            </div>
          </div>
          <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900">
            {preview ? (
              <EInvoiceDocument
                invoice={buildDemoInvoice(demoItems)}
                config={config ?? DEFAULT_EI_CONFIG}
                settings={settings}
                qrDataUrl={null}
                letterhead={letterhead}
                eiLetterhead={eiLetterhead}
                template={preview}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
