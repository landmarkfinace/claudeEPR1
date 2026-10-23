'use client'

// Settings › Agreement › Templates — choose the module's default print
// template and preview each layout. The default only decides which template
// NEW agreements (and legacy rows with no saved choice) print in; every
// agreement can override it individually (print-preview dropdown + the
// agreement form). Changing the default — or any template choice — never
// changes agreement text, parties, dates, numbers, signatories or statuses.
//
// The preview renders an IN-MEMORY demo agreement (never saved, no agreement
// number consumed, nothing written to the database) with an articles toggle:
//   • 5 articles — the single-page layout (matches the live demo data)
//   • 15 articles — the multi-page behaviour (articles continue on page 2+
//     behind the continuation header; Initials + Page X of Y on every page;
//     the signature block pinned to the bottom of the last page together
//     with at least the last article) without creating any real agreement.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eye, LayoutTemplate, Star } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useAppStore, can } from '@/lib/store'
import {
  AGREEMENT_PRINT_TEMPLATES,
  resolveAgreementPrintTemplate,
  type AgreementPrintTemplateId,
} from '@/lib/agreement-print-templates'
import type { LetterheadConfig } from '@/lib/types'
import type { TemplateAgreement } from '@/lib/agreement-template'
import { SectionCard } from '@/components/app/shared/page-header'
import { AgreementTemplateDocument } from '@/components/app/print/agreement-print'
import { DEFAULT_LETTERHEAD } from '@/components/app/print/agreement-print-shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

// ── In-memory demo articles (never saved, no agreement number consumed) ────
const DEMO_ARTICLES: { en: string; ar: string }[] = [
  {
    en: 'Second Party shall provide industrial service and supply of equipment to the First Party.',
    ar: 'يلتزم الطرف الثاني بتوفير الخدمات الصناعية وتوريد المعدات للطرف الأول.',
  },
  {
    en: 'First Party shall be responsible for the ID cards, vehicle stickers and gate passes for the Second Party. The Second Party shall provide all documents required for issuing the permits.',
    ar: 'يكون الطرف الأول مسؤولاً عن إصدار البطاقات والملصقات وتصاريح دخول البوابة للسيارات، وعلى الطرف الثاني توفير كافة المستندات المطلوبة لإصدار التصاريح.',
  },
  {
    en: 'Contract Price: {PRICE}',
    ar: 'قيمة العقد: {PRICE}',
  },
  {
    en: 'Contract Period: {PERIOD}',
    ar: 'مدة العقد: {PERIOD}',
  },
  {
    en: 'First Party and Second Party hereby agree that all other terms and conditions shall be followed as per the purchase order.',
    ar: 'وافق الطرف الأول والطرف الثاني على أن تبقى جميع البنود والشروط الأخرى حسب أمر الشراء.',
  },
  {
    en: 'The Second Party shall maintain all equipment in good working condition and replace any defective unit within seventy-two (72) hours of notification.',
    ar: 'يلتزم الطرف الثاني بصيانة جميع المعدات بحالة تشغيل جيدة واستبدال أي وحدة معيبة خلال اثنتين وسبعين (72) ساعة من الإخطار.',
  },
  {
    en: 'The Second Party shall comply with all safety regulations of the site, including the wearing of personal protective equipment at all times while inside the work area.',
    ar: 'يلتزم الطرف الثاني باتباع جميع لوائح السلامة في الموقع، بما في ذلك ارتداء معدات الوقاية الشخصية طوال التواجد داخل منطقة العمل.',
  },
  {
    en: 'Payment Terms: The First Party shall pay the Second Party within forty-five (45) days from the date of each approved invoice.',
    ar: 'شروط الدفع: يدفع الطرف الأول للطرف الثاني خلال خمسة وأربعين (45) يوماً من تاريخ كل فاتورة معتمدة.',
  },
  {
    en: 'The Second Party shall not assign or sub-let this agreement, in whole or in part, without the prior written consent of the First Party.',
    ar: 'لا يجوز للطرف الثاني التنازل عن هذا العقد أو إعادة تأجيره، كلياً أو جزئياً، دون موافقة كتابية مسبقة من الطرف الأول.',
  },
  {
    en: 'Insurance: The Second Party shall maintain valid insurance coverage for all its personnel and equipment for the entire duration of this agreement.',
    ar: 'التأمين: يلتزم الطرف الثاني بالحفاظ على تغطية تأمينية سارية لجميع موظفيه ومعداته طوال مدة هذا العقد.',
  },
  {
    en: 'Either party may terminate this agreement by giving sixty (60) days written notice to the other party, without prejudice to any accrued rights.',
    ar: 'يجوز لأي من الطرفين إنهاء هذا العقد بإشعار كتابي مدته ستون (60) يوماً للطرف الآخر، دون المساس بأي حقوق مستحقة.',
  },
  {
    en: 'The Second Party shall indemnify the First Party against any claims, losses or damages arising from the negligence of the Second Party or its personnel.',
    ar: 'يتعهد الطرف الثاني بتعويض الطرف الأول عن أي مطالبات أو خسائر أو أضرار تنشأ عن إهمال الطرف الثاني أو موظفيه.',
  },
  {
    en: 'Confidentiality: Both parties shall keep confidential all technical and commercial information exchanged under this agreement for a period of five (5) years.',
    ar: 'السرية: يلتزم الطرفان بالحفاظ على سرية جميع المعلومات الفنية والتجارية المتبادلة بموجب هذا العقد لمدة خمس (5) سنوات.',
  },
  {
    en: 'Force Majeure: Neither party shall be liable for any failure to perform caused by events beyond its reasonable control, including natural disasters and government restrictions.',
    ar: 'القوة القاهرة: لا يتحمل أي من الطرفين المسؤولية عن أي إخلال بالأداء ناتج عن أحداث خارجة عن سيطرته المعقولة، بما في ذلك الكوارث الطبيعية والقيود الحكومية.',
  },
  {
    en: 'This agreement shall be governed by the laws of the Kingdom of Saudi Arabia, and any dispute shall be referred to the competent courts in the Eastern Province.',
    ar: 'يخضع هذا العقد لأنظمة المملكة العربية السعودية، وتُحال أي منازعة إلى المحاكم المختصة في المنطقة الشرقية.',
  },
]

/** Demo agreement used ONLY for template previews in this settings section —
 *  never saved, never sent to the API, no agreement number consumed. */
function buildDemoAgreement(articleCount: 5 | 15): TemplateAgreement {
  return {
    agreementNo: 'AGR-PREVIEW',
    date: '2026-01-04',
    showLetterheadSpace: false,
    title: { en: 'Sub-Contract Agreement', ar: 'عقد مقاولة من الباطن' },
    firstParty: {
      name: { en: 'Gusan Construction Arabia Co., Ltd', ar: 'شركة كوسان كونستركشن العربية المحدودة' },
      crNo: '2051041222',
      address: {
        en: 'P.O. Box 4679, Al Khobar 31952, KSA',
        ar: 'ص.ب 4679، الخبر 31952، المملكة العربية السعودية',
      },
      tel: '013 833 5923',
      fax: '013 833 5828',
      signatory: { name: { en: '', ar: '' }, title: { en: '', ar: '' } },
      signatureImg: '',
      stampImg: '',
    },
    secondParty: {
      name: { en: 'Green Forest Company Limited.', ar: 'شركة الغابة الخضراء المحدودة' },
      crNo: '2055141340',
      address: { en: '', ar: '' },
      tel: '',
      fax: '',
      signatory: {
        name: { en: 'Kazi Nazmul Kazi Kamal', ar: 'قاضي نظمول قاضي كمال' },
        title: { en: 'Chief Executive Officer (CEO)', ar: 'الرئيس التنفيذي' },
      },
      signatureImg: '',
      stampImg: '',
    },
    intro: {
      en: 'The First Party and the Second Party have agreed that the Second Party shall provide the First Party with industrial service and supply of equipment at Amiral Project Package # 4 – onshore project at Saudi Aramco, according to the following terms and conditions:',
      ar: 'وافق الطرف الأول والطرف الثاني على تزويد الطرف الأول بالخدمة الصناعية وتوريد المعدات في حزمة مشروع أميرال رقم 4 – المشروع البري في أرامكو السعودية، وفقاً للشروط والأحكام التالية:',
    },
    periodFrom: '2026-01-04',
    periodTo: '2028-01-03',
    contractPrice: { en: 'As per the PO', ar: 'حسب أمر الشراء' },
    clauses: DEMO_ARTICLES.slice(0, articleCount),
  }
}

export function AgreementTemplatesSettingsSection() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const user = useAppStore((s) => s.user)
  const canEdit = can(user, 'settings.edit')

  const [current, setCurrent] = useState<AgreementPrintTemplateId>(() =>
    resolveAgreementPrintTemplate(null, settings.agreementDefaultTemplate)
  )
  const [saving, setSaving] = useState(false)

  // preview dialog state
  const [preview, setPreview] = useState<AgreementPrintTemplateId | null>(null)
  const [demoArticles, setDemoArticles] = useState<5 | 15>(5)
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)

  // fresh settings on mount (another tab may have changed the default)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get<{ settings: { agreementDefaultTemplate: string } }>(
          '/api/settings'
        )
        if (cancelled) return
        setCurrent(resolveAgreementPrintTemplate(null, res.settings.agreementDefaultTemplate))
      } catch {
        /* keep the store value */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // letterhead for the previews (same source as the real print)
  useEffect(() => {
    if (!preview) return
    let cancelled = false
    ;(async () => {
      try {
        const lh = await api.get<LetterheadConfig>('/api/letterhead')
        if (cancelled) return
        setLetterhead(lh)
      } catch {
        /* preview without artwork */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [preview])

  async function setDefault(id: AgreementPrintTemplateId) {
    if (saving || !canEdit) return
    if (id === current) return
    setSaving(true)
    try {
      await api.put('/api/settings', { agreementDefaultTemplate: id })
      setCurrent(id)
      // keep the whole app in sync (new agreements read this default)
      setSettings({ ...settings, agreementDefaultTemplate: id })
      toast.success(
        `Default agreement template: ${AGREEMENT_PRINT_TEMPLATES.find((t) => t.id === id)?.label}`
      )
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
            Agreement Templates
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The default print layout for agreements — new agreements start with it and legacy
            agreements follow it until they get their own choice. Changing the template never
            changes agreement text, parties, dates, numbers or signatories — it is allowed on
            every agreement (signed included) because it changes only the look.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {AGREEMENT_PRINT_TEMPLATES.map((t) => {
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
          letterhead artwork from Settings */}
      <Dialog open={preview !== null} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]"
        >
          <DialogTitle className="sr-only">Agreement template preview</DialogTitle>
          <DialogDescription className="sr-only">
            Preview of the agreement print template with in-memory demo data.
          </DialogDescription>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <p className="text-sm font-semibold">
              {AGREEMENT_PRINT_TEMPLATES.find((t) => t.id === preview)?.label} — preview
            </p>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-md border p-0.5">
                {([5, 15] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDemoArticles(n)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      demoArticles === n
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {n} articles
                  </button>
                ))}
              </div>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Demo data — your agreements print real data
              </p>
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                Close
              </Button>
            </div>
          </div>
          <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900">
            {preview ? (
              <div className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
                <AgreementTemplateDocument
                  template={preview}
                  agreement={buildDemoAgreement(demoArticles)}
                  letterhead={letterhead ?? DEFAULT_LETTERHEAD}
                />
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
