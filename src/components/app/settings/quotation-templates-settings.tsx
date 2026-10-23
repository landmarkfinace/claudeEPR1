'use client'

// Settings › Quotation › Templates — choose the module's default print
// template and preview each layout. The default only decides which template
// NEW quotations (and legacy rows with no saved choice) print in; every
// quotation can override it individually. Changing the default never
// touches quotation data.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eye, LayoutTemplate, Star } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useAppStore } from '@/lib/store'
import {
  QUOTATION_TEMPLATES,
  resolveQuotationTemplate,
  type QuotationTemplateId,
} from '@/lib/quotation-templates'
import { DEFAULT_QUOTATION_TERMS, serializeTerms } from '@/lib/quotation-terms'
import type { AppSettings, LetterheadConfig } from '@/lib/types'
import { SectionCard } from '@/components/app/shared/page-header'
import {
  QuotationDocument,
  DEFAULT_LETTERHEAD,
  type ApprovedBy,
  type QuotationDetail,
} from '@/components/app/print/quotation-print'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

/** Demo quotation used ONLY for template previews in this settings section —
 *  never saved, never sent to the API. */
const SAMPLE_QUOTATION: QuotationDetail = {
  id: 'sample',
  quoteNumber: 'QTN-PREVIEW',
  clientId: null,
  clientName: 'Eastern Province Industrial Services',
  subject: 'Manpower Supply',
  referenceNo: 'PO-2026-118',
  issueDate: new Date().toISOString(),
  validityDate: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  status: 'sent',
  subtotal: 0,
  discount: 0,
  vatRate: 0.15,
  vatAmount: 0,
  total: 0,
  notes: null,
  terms: serializeTerms(DEFAULT_QUOTATION_TERMS),
  projectName: 'Jafurah Gas Project',
  projectLocation: 'Jafurah, Al-Ahsa',
  contractPeriod: null,
  contractMonths: null,
  mobilization: null,
  inclusions: null,
  exclusions: null,
  template: null,
  createdByName: null,
  createdAt: new Date().toISOString(),
  items: [
    {
      sr: 1,
      description: 'HELPER',
      unit: null,
      quantity: 10,
      unitPrice: 35,
      discount: 0,
      lineTotal: 350,
      subText: null,
    },
    {
      sr: 2,
      description: 'CARPENTER',
      unit: null,
      quantity: 10,
      unitPrice: 17,
      discount: 0,
      lineTotal: 170,
      subText: null,
    },
  ],
  assets: [],
  client: {
    id: 'sample',
    name: 'Eastern Province Industrial Services',
    nameAr: 'خدمات المنطقة الشرقية الصناعية',
    contactPerson: 'Nasser Al-Dosari',
    phone: '+966 13 812 4460',
    email: 'nasser.dosari@example.com',
    address: '1st Industrial Street, 2nd Industrial City',
    city: 'Dammam',
    crNumber: '2050188364',
    vatNumber: '320501883640003',
  },
}

export function QuotationTemplatesSettingsSection({ canEdit }: { canEdit: boolean }) {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)

  const [current, setCurrent] = useState<QuotationTemplateId>(() =>
    resolveQuotationTemplate(null, settings.quotationDefaultTemplate)
  )
  const [saving, setSaving] = useState(false)

  // preview dialog state
  const [preview, setPreview] = useState<QuotationTemplateId | null>(null)
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)
  const [approvedBy, setApprovedBy] = useState<ApprovedBy>(null)

  // fresh settings on mount (another tab may have changed the default)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get<{ settings: AppSettings }>('/api/settings')
        if (cancelled) return
        setCurrent(resolveQuotationTemplate(null, res.settings.quotationDefaultTemplate))
      } catch {
        /* keep the store value */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // letterhead + default signatory for the previews (same sources as the real print)
  useEffect(() => {
    if (!preview) return
    let cancelled = false
    ;(async () => {
      try {
        const [lh, sig] = await Promise.all([
          api.get<LetterheadConfig>('/api/letterhead'),
          api.get<{ signatories: { name: string; designation: string; isDefault: boolean }[] }>(
            '/api/signatories'
          ),
        ])
        if (cancelled) return
        setLetterhead(lh)
        const def = sig.signatories.find((s) => s.isDefault) ?? null
        setApprovedBy(def ? { name: def.name, designation: def.designation ?? '' } : null)
      } catch {
        if (!cancelled) setLetterhead(DEFAULT_LETTERHEAD)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [preview])

  async function setDefault(id: QuotationTemplateId) {
    if (saving || !canEdit) return
    if (id === current) return
    setSaving(true)
    try {
      await api.put('/api/settings', { quotationDefaultTemplate: id })
      setCurrent(id)
      // keep the whole app in sync (new quotations read this default)
      setSettings({ ...settings, quotationDefaultTemplate: id })
      toast.success(`Default quotation template: ${QUOTATION_TEMPLATES.find((t) => t.id === id)?.label}`)
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
            Quotation Templates
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The default print layout for quotations — new quotations start with it and legacy
            quotations follow it until they get their own choice. Changing the template never
            changes quotation data, numbers, rates, status or terms.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {QUOTATION_TEMPLATES.map((t) => {
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

      {/* template preview — demo data, real letterhead + signatory */}
      <Dialog open={preview !== null} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]"
        >
          <DialogTitle className="sr-only">Template preview</DialogTitle>
          <DialogDescription className="sr-only">
            Preview of the quotation print template with demo data.
          </DialogDescription>
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-semibold">
              {QUOTATION_TEMPLATES.find((t) => t.id === preview)?.label} — preview
            </p>
            <p className="text-xs text-muted-foreground">Demo data — your quotations print real data</p>
            <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
              Close
            </Button>
          </div>
          <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900">
            {preview ? (
              <QuotationDocument
                quotation={SAMPLE_QUOTATION}
                letterhead={letterhead ?? DEFAULT_LETTERHEAD}
                settings={settings}
                approvedBy={approvedBy}
                template={preview}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
