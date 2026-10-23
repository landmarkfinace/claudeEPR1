'use client'

// Agreements view — bilingual, template-driven contracts (Business Documents).
// The printed document is the EXACT uploaded agreement-template.html:
//   • list: Agreement No / Date / Title / Other Party / Period / Status —
//     'expired' is DERIVED (signed + Period To passed). Search + status +
//     date-range filters; row actions View / Edit / Duplicate / Download PDF /
//     Delete (confirm). + New Agreement → template chooser (or start blank).
//   • editor: split screen — LEFT the form, RIGHT a live preview of the exact
//     template updating as you type. Auto-translate EN→AR per field (Arabic
//     stays editable; Re-translate button per field). Contract price "As per
//     PO" or an amount in SAR auto-written in both languages; {PRICE} and
//     {PERIOD} tokens work inside clauses. Signature/stamp images per party.
//   • PDF: server-rendered vector from the same template (Noto Naskh Arabic
//     embedded), file name AgreementNo_OtherPartyName.pdf.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Copy,
  Eye,
  FileDown,
  FileSignature,
  Languages,
  Loader2,
  Pencil,
  Plus,
  Printer,
  ScrollText,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDelete } from '@/components/app/shared/confirm-delete'
import { DataTablePagination } from '@/components/app/shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '@/components/app/shared/empty-state'
import { ErrorState } from '@/components/app/shared/error-state'
import { FilterBar, FilterSelect, SearchInput } from '@/components/app/shared/filter-select'
import { PageHeader, SectionCard, MobileFab } from '@/components/app/shared/page-header'
import { StatCard } from '@/components/app/shared/stat-card'
import {
  AgreementPrintDialog,
  AgreementSheet,
  AgreementTemplateDocument,
} from '@/components/app/print/agreement-print'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent } from '@/hooks/use-view-intent'
import { api, getAuthToken, qs, ApiError } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { fileToDataUrl } from '@/components/app/views/settings'
import { formatDate, formatMoney, formatNumber, toDateInputValue } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import {
  type AgreementPartyRow,
  type AgreementRow,
  type AgreementTemplateRow,
  type LetterheadConfig,
  type Paginated,
} from '@/lib/types'
import {
  AGREEMENT_PRINT_TEMPLATES,
  resolveAgreementPrintTemplate,
} from '@/lib/agreement-print-templates'
import { cn } from '@/lib/utils'
import {
  DEFAULT_PRICE,
  emptyParty,
  ourPartyFromSettings,
  priceTextFor,
  toTemplateAgreement,
  type CompanySettingsLike,
  type TemplateAgreement,
  type TemplateParty,
} from '@/lib/agreement-template'

// ---------------------------------------------------------------------------
// Constants + small shared pieces
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  signed: 'Signed',
  expired: 'Expired',
}

type ListTotals = {
  count: number
  totalAmount: number
  signedCount: number
  active: number
}

const NEW_PARTY_VALUE = '__new__'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'border-neutral-300 bg-neutral-100 text-neutral-700',
    signed: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    expired: 'border-amber-300 bg-amber-50 text-amber-700',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold',
        map[status] ?? map.draft
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

/** One optional image slot (signature / stamp) for a party. */
function ImageSlotField({
  label,
  value,
  onChange,
  emptyHint,
  disabled,
}: {
  label: string
  value: string
  onChange: (dataUrl: string) => void
  emptyHint: string
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-2.5">
      {value ? (
        <img
          src={value}
          alt={label}
          className="h-12 w-24 shrink-0 rounded border bg-white object-contain p-0.5"
        />
      ) : (
        <div className="flex h-12 w-24 shrink-0 items-center justify-center rounded border border-dashed text-center text-[10px] leading-tight text-muted-foreground">
          {emptyHint}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium">{label}</p>
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            aria-label={`Upload ${label}`}
            disabled={disabled || busy}
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (inputRef.current) inputRef.current.value = ''
              if (!file) return
              try {
                setBusy(true)
                onChange(await fileToDataUrl(file, 512))
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not process the image')
              } finally {
                setBusy(false)
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2.5"
            disabled={disabled || busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Upload
          </Button>
          {value ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2.5"
              disabled={disabled}
              onClick={() => onChange('')}
            >
              <X className="h-3.5 w-3.5" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * An EN → AR pair field. Arabic auto-fills (debounced) while the user types
 * English — but ONLY while the Arabic side is empty or was auto-filled; once
 * the user types Arabic it stays theirs. The Re-translate button re-fills
 * Arabic from the current English on demand.
 */
function TranslatableField({
  id,
  label,
  en,
  ar,
  arManual,
  onEn,
  onAr,
  context,
  multiline,
  rows = 3,
  enPlaceholder,
  arPlaceholder,
  disabled,
}: {
  id: string
  label?: ReactNode
  en: string
  ar: string
  arManual: boolean
  onEn: (v: string) => void
  onAr: (v: string, manual: boolean) => void
  context: string
  multiline?: boolean
  rows?: number
  enPlaceholder?: string
  arPlaceholder?: string
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const lastAutoEn = useRef('')
  const warnedRef = useRef(false)

  const translate = useCallback(
    async (text: string, force: boolean): Promise<string | null> => {
      const t = text.trim()
      if (!t) return null
      try {
        setBusy(true)
        const res = await api.post<{
          results: { key: string; translated: string; source: string }[]
          providerError?: string
        }>('/api/agreements/translate', {
          entries: [{ key: id, text: t, context }],
        })
        if (res.providerError && !warnedRef.current) {
          warnedRef.current = true
          toast.error(res.providerError, {
            description: 'You can keep typing Arabic manually and retry later.',
          })
        }
        const hit = res.results.find((r) => r.key === id)
        if (hit && hit.translated) return hit.translated
        if (!force) return null
        toast.error('Translation failed — type the Arabic manually or retry.')
        return null
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Translation failed')
        return null
      } finally {
        setBusy(false)
      }
    },
    [id, context]
  )

  // Auto-translate while typing English (Arabic empty or still auto-filled)
  const debouncedEn = useDebounce(en, 900)
  useEffect(() => {
    const t = debouncedEn.trim()
    if (!t || disabled) return
    if (ar.trim() && arManual) return // user owns the Arabic now
    if (t === lastAutoEn.current) return
    let cancelled = false
    void (async () => {
      const out = await translate(t, false)
      if (cancelled || out == null) return
      lastAutoEn.current = t
      onAr(out, false)
    })()
    return () => {
      cancelled = true
    }
  }, [debouncedEn, ar, arManual, disabled])

  const retranslate = async () => {
    const out = await translate(en, true)
    if (out != null) {
      lastAutoEn.current = en.trim()
      onAr(out, false)
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        {label ? (
          <Label htmlFor={`${id}-en`} className="text-xs font-medium">
            {label}
          </Label>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
          onClick={() => void retranslate()}
          disabled={disabled || busy || !en.trim()}
          title="Re-translate Arabic from the current English"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
          Re-translate
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {multiline ? (
          <>
            <Textarea
              id={`${id}-en`}
              value={en}
              rows={rows}
              onChange={(e) => onEn(e.target.value)}
              placeholder={enPlaceholder}
              disabled={disabled}
              className={cn(id === 'intro' || id.startsWith('clause') ? 'text-[13px]' : '')}
            />
            <Textarea
              id={`${id}-ar`}
              lang="ar"
              dir="rtl"
              value={ar}
              rows={rows}
              onChange={(e) => onAr(e.target.value, true)}
              placeholder={arPlaceholder}
              disabled={disabled}
              className="text-[14px] leading-7"
            />
          </>
        ) : (
          <>
            <Input
              id={`${id}-en`}
              value={en}
              onChange={(e) => onEn(e.target.value)}
              placeholder={enPlaceholder}
              disabled={disabled}
            />
            <Input
              id={`${id}-ar`}
              lang="ar"
              dir="rtl"
              value={ar}
              onChange={(e) => onAr(e.target.value, true)}
              placeholder={arPlaceholder}
              disabled={disabled}
              className="text-[14px]"
            />
          </>
        )}
      </div>
    </div>
  )
}

/** Right pane of the editor: the exact template, auto-scaled to fit. */
function ScaledSheetPreview({
  tpl,
  template,
  letterhead,
}: {
  tpl: TemplateAgreement
  template: string | null
  letterhead: LetterheadConfig | null
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.45)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => {
      const w = el.clientWidth
      if (w > 0) setScale(Math.min(1, Math.max(0.22, (w - 24) / 794)))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={wrapRef} className="nice-scrollbar h-full overflow-auto bg-neutral-100 p-3">
      <div
        style={{ transform: `scale(${scale})`, transformOrigin: 'top center', width: 794 }}
        className="mx-auto"
      >
        {template && template !== 'classic' ? (
          <div className="flex flex-col items-center gap-4">
            <AgreementTemplateDocument template={template} agreement={tpl} letterhead={letterhead} />
          </div>
        ) : (
          <div className="agr-desk">
            <AgreementSheet agreement={tpl} />
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Template chooser ("New Agreement first asks: choose a template or start blank")
// ---------------------------------------------------------------------------

function TemplateChooserDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onPick: (t: AgreementTemplateRow | null) => void
}) {
  const [rows, setRows] = useState<AgreementTemplateRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api
      .get<AgreementTemplateRow[]>('/api/agreements/templates')
      .then((r) => {
        if (!cancelled) {
          setRows(r)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load templates')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New Agreement</DialogTitle>
          <DialogDescription>
            Start from a saved template, or begin from a blank page.
          </DialogDescription>
        </DialogHeader>
        <div className="nice-scrollbar max-h-[60vh] space-y-3 overflow-y-auto">
          <button
            type="button"
            onClick={() => onPick(null)}
            className="w-full rounded-xl border-2 border-dashed p-4 text-left transition-colors hover:border-primary hover:bg-muted/30"
          >
            <p className="text-sm font-semibold">Start blank</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Empty agreement — build the title, intro and clauses from scratch.
            </p>
          </button>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading templates…
            </div>
          ) : error ? (
            <ErrorState
              title="Couldn't load templates"
              description={error}
              onRetry={() => {
                void api
                  .get<AgreementTemplateRow[]>('/api/agreements/templates')
                  .then(setRows)
                  .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load templates'))
              }}
            />
          ) : rows.length === 0 ? (
            <p className="rounded-lg border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
              No templates saved yet. Build an agreement and use{' '}
              <span className="font-medium">Save as Template</span> to add one.
            </p>
          ) : (
            rows.map((t) => (
              <div key={t.id} className="rounded-xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{t.name}</p>
                    {t.titleEn ? (
                      <p lang="ar" className="mt-0.5 text-xs text-muted-foreground">
                        {t.titleEn}
                        {t.titleAr ? ` · ${t.titleAr}` : ''}
                      </p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t.clauses.length} clause{t.clauses.length === 1 ? '' : 's'}
                      {t.introEn ? ' · intro included' : ''}
                    </p>
                  </div>
                  <Button size="sm" className="h-8 shrink-0" onClick={() => onPick(t)}>
                    Use Template
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// "Save as Template" — name only; title/intro/clauses come from the current form
// ---------------------------------------------------------------------------

function SaveTemplateDialog({
  open,
  onOpenChange,
  snapshot,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  snapshot: {
    titleEn: string
    titleAr: string
    introEn: string
    introAr: string
    clauses: { textEn: string; textAr: string }[]
  } | null
}) {
  const [name, setName] = useState(() => (snapshot?.titleEn ?? '').trim().slice(0, 80))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!snapshot) return
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Give the template a name')
      return
    }
    const clauses = snapshot.clauses
      .filter((c) => c.textEn.trim() || c.textAr.trim())
      .map((c) => ({ textEn: c.textEn.trim(), textAr: c.textAr.trim() }))
    try {
      setBusy(true)
      await api.post('/api/agreements/templates', {
        name: trimmed,
        titleEn: snapshot.titleEn.trim() || trimmed,
        titleAr: snapshot.titleAr.trim(),
        introEn: snapshot.introEn.trim(),
        introAr: snapshot.introAr.trim(),
        clauses,
      })
      toast.success(`Template "${trimmed}" saved`)
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the template')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Save as Template</DialogTitle>
          <DialogDescription>
            Saves the current title, intro and clauses under this name. Saving with an
            existing name replaces that template.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Template name</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sub-Contract, Manpower Supply, Equipment Rental"
              maxLength={80}
            />
          </div>
          {snapshot ? (
            <p className="text-xs text-muted-foreground">
              Will save: title “{snapshot.titleEn.trim() || '—'}”
              {snapshot.titleAr.trim() ? ` · ${snapshot.titleAr.trim()}` : ''} · intro{' '}
              {snapshot.introEn.trim() ? 'included' : 'empty'} · {snapshot.clauses.length} clause
              {snapshot.clauses.length === 1 ? '' : 's'}.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !snapshot}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// One party block: bilingual identity fields + CR/tel/fax + images
// ---------------------------------------------------------------------------

type ArManualMap = { name: boolean; address: boolean; sigName: boolean; sigTitle: boolean }

const ALL_MANUAL: ArManualMap = { name: true, address: true, sigName: true, sigTitle: true }

function PartyBlockFields({
  idPrefix,
  party,
  arManual,
  onParty,
  onArManual,
  disabled,
}: {
  idPrefix: 'our' | 'other'
  party: TemplateParty
  arManual: ArManualMap
  onParty: (next: TemplateParty) => void
  onArManual: (next: ArManualMap) => void
  disabled?: boolean
}) {
  const set = (patch: Partial<TemplateParty>) => onParty({ ...party, ...patch })
  const setAr = (key: keyof ArManualMap, v: string, manual: boolean) => {
    onArManual({ ...arManual, [key]: manual })
    // value is written by the caller of onAr inside TranslatableField — noop here
    void v
  }
  return (
    <div className="space-y-4">
      <TranslatableField
        id={`${idPrefix}-name`}
        label={<>Party Name — <span lang="ar" dir="rtl">اسم الطرف</span></>}
        en={party.name.en}
        ar={party.name.ar}
        arManual={arManual.name}
        onEn={(v) => set({ name: { ...party.name, en: v } })}
        onAr={(v, manual) => {
          set({ name: { ...party.name, ar: v } })
          setAr('name', v, manual)
        }}
        context="party-name"
        enPlaceholder="Company legal name"
        arPlaceholder="الاسم القانوني للشركة"
        disabled={disabled}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-cr`} className="text-xs font-medium">
            CR No
          </Label>
          <Input
            id={`${idPrefix}-cr`}
            value={party.crNo}
            onChange={(e) => set({ crNo: e.target.value })}
            placeholder="1010357489"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-tel`} className="text-xs font-medium">
            Tel
          </Label>
          <Input
            id={`${idPrefix}-tel`}
            value={party.tel}
            onChange={(e) => set({ tel: e.target.value })}
            placeholder="013 833 5923"
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-fax`} className="text-xs font-medium">
            Fax
          </Label>
          <Input
            id={`${idPrefix}-fax`}
            value={party.fax}
            onChange={(e) => set({ fax: e.target.value })}
            placeholder="013 833 5828"
            disabled={disabled}
          />
        </div>
      </div>
      <TranslatableField
        id={`${idPrefix}-address`}
        label={<>Address — <span lang="ar" dir="rtl">العنوان</span></>}
        en={party.address.en}
        ar={party.address.ar}
        arManual={arManual.address}
        onEn={(v) => set({ address: { ...party.address, en: v } })}
        onAr={(v, manual) => {
          set({ address: { ...party.address, ar: v } })
          setAr('address', v, manual)
        }}
        context="party-address"
        multiline
        rows={2}
        enPlaceholder="P.O. Box 4679, Al Khobar 31952, KSA"
        arPlaceholder="ص.ب 4679، الخبر 31952، المملكة العربية السعودية"
        disabled={disabled}
      />
      <div className="rounded-lg border bg-muted/20 p-3">
        <p className="text-xs font-semibold">Signatory</p>
        <div className="mt-2.5 space-y-3">
          <TranslatableField
            id={`${idPrefix}-sig-name`}
            label={<>Name — <span lang="ar" dir="rtl">الاسم</span></>}
            en={party.signatory.name.en}
            ar={party.signatory.name.ar}
            arManual={arManual.sigName}
            onEn={(v) => set({ signatory: { ...party.signatory, name: { ...party.signatory.name, en: v } } })}
            onAr={(v, manual) => {
              set({ signatory: { ...party.signatory, name: { ...party.signatory.name, ar: v } } })
              setAr('sigName', v, manual)
            }}
            context="signatory-name"
            enPlaceholder="Kazi Nazmul Kazi Kamal"
            arPlaceholder="قاضي نظمول قاضي كمال"
            disabled={disabled}
          />
          <TranslatableField
            id={`${idPrefix}-sig-title`}
            label={<>Title — <span lang="ar" dir="rtl">المنصب</span></>}
            en={party.signatory.title.en}
            ar={party.signatory.title.ar}
            arManual={arManual.sigTitle}
            onEn={(v) => set({ signatory: { ...party.signatory, title: { ...party.signatory.title, en: v } } })}
            onAr={(v, manual) => {
              set({ signatory: { ...party.signatory, title: { ...party.signatory.title, ar: v } } })
              setAr('sigTitle', v, manual)
            }}
            context="signatory-title"
            enPlaceholder="Chief Executive Officer (CEO)"
            arPlaceholder="الرئيس التنفيذي"
            disabled={disabled}
          />
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <ImageSlotField
          label="Signature image"
          value={party.signatureImg}
          onChange={(v) => set({ signatureImg: v })}
          emptyHint="No signature — blank line printed"
          disabled={disabled}
        />
        <ImageSlotField
          label="Company stamp"
          value={party.stampImg}
          onChange={(v) => set({ stampImg: v })}
          emptyHint="No stamp — dashed box printed"
          disabled={disabled}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The split-screen editor: LEFT the form, RIGHT a live preview of the EXACT
// template updating as you type.
// ---------------------------------------------------------------------------

type ClauseDraft = { key: string; textEn: string; textAr: string; arManual: boolean }

type FormState = {
  agreementNo: string
  noManual: boolean
  date: string
  titleEn: string
  titleAr: string
  titleArManual: boolean
  ourCompanyIs: 'first' | 'second'
  our: TemplateParty
  ourArManual: ArManualMap
  other: TemplateParty
  otherArManual: ArManualMap
  otherPartyId: string | null
  saveOtherParty: boolean
  introEn: string
  introAr: string
  introArManual: boolean
  clauses: ClauseDraft[]
  periodFrom: string
  periodTo: string
  priceMode: 'po' | 'amount'
  priceAmount: string
  priceEn: string
  priceAr: string
  priceManual: boolean
  showLetterheadSpace: boolean
  /** Print-layout template (null = inherit the module default) — cosmetic only */
  template: string | null
}

let clauseKeySeq = 0
const nextClauseKey = () => `c${++clauseKeySeq}`

/** Edit mode: the saved row → form state (stored party JSONs as-is). */
function formFromRow(editing: AgreementRow): FormState {
  const our = editing.ourCompanyIs === 'first' ? editing.firstParty : editing.secondParty
  const other = editing.ourCompanyIs === 'first' ? editing.secondParty : editing.firstParty
  return {
    agreementNo: editing.agreementNo,
    noManual: true,
    date: editing.date,
    titleEn: editing.titleEn,
    titleAr: editing.titleAr,
    titleArManual: Boolean(editing.titleAr.trim()),
    ourCompanyIs: editing.ourCompanyIs,
    our,
    ourArManual: { ...ALL_MANUAL },
    other,
    otherArManual: { ...ALL_MANUAL },
    otherPartyId: editing.otherPartyId,
    saveOtherParty: Boolean(editing.otherPartyId),
    introEn: editing.introEn,
    introAr: editing.introAr,
    introArManual: Boolean(editing.introAr.trim()),
    clauses: (editing.clauses ?? []).map((c) => ({
      key: nextClauseKey(),
      textEn: c.textEn,
      textAr: c.textAr,
      arManual: Boolean(c.textAr.trim()),
    })),
    periodFrom: editing.periodFrom,
    periodTo: editing.periodTo,
    priceMode: editing.priceMode,
    priceAmount: editing.priceAmount != null ? String(editing.priceAmount) : '',
    priceEn: editing.priceEn,
    priceAr: editing.priceAr,
    priceManual: false,
    showLetterheadSpace: editing.showLetterheadSpace,
    template: editing.template ?? null,
  }
}

/** Create mode: blank or from a template; our party auto-filled from Settings. */
function freshForm(
  t: AgreementTemplateRow | null,
  settings: CompanySettingsLike,
  today: string
): FormState {
  return {
    agreementNo: '',
    noManual: false,
    date: today,
    titleEn: t?.titleEn ?? '',
    titleAr: t?.titleAr ?? '',
    titleArManual: Boolean((t?.titleAr ?? '').trim()),
    ourCompanyIs: 'first',
    our: ourPartyFromSettings(settings),
    ourArManual: { ...ALL_MANUAL },
    other: emptyParty(),
    otherArManual: { name: false, address: false, sigName: false, sigTitle: false },
    otherPartyId: null,
    saveOtherParty: false,
    introEn: t?.introEn ?? '',
    introAr: t?.introAr ?? '',
    introArManual: Boolean((t?.introAr ?? '').trim()),
    clauses: (t?.clauses ?? []).map((c) => ({
      key: nextClauseKey(),
      textEn: c.textEn,
      textAr: c.textAr,
      arManual: Boolean(c.textAr.trim()),
    })),
    periodFrom: '',
    periodTo: '',
    priceMode: 'po',
    priceAmount: '',
    priceEn: DEFAULT_PRICE.en,
    priceAr: DEFAULT_PRICE.ar,
    priceManual: false,
    showLetterheadSpace: true,
    template: null,
  }
}

function AgreementEditorDialog({
  open,
  onOpenChange,
  editing,
  initialTemplate,
  onSaved,
  onPrintDraft,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editing: AgreementRow | null
  initialTemplate: AgreementTemplateRow | null
  onSaved: (row: AgreementRow) => void
  onPrintDraft: (row: AgreementRow) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const [form, setForm] = useState<FormState>(() =>
    editing
      ? formFromRow(editing)
      : freshForm(initialTemplate, settings, toDateInputValue(new Date()))
  )
  // letterhead artwork for the live preview when a non-Classic print
  // template is selected (Classic keeps its own dashed letterhead space)
  const [previewLetterhead, setPreviewLetterhead] = useState<LetterheadConfig | null>(null)
  useEffect(() => {
    if (!open || !form.template || form.template === 'classic' || previewLetterhead) return
    let alive = true
    api
      .get<LetterheadConfig>('/api/letterhead')
      .then((lh) => {
        if (alive) setPreviewLetterhead(lh)
      })
      .catch(() => {
        /* preview without artwork */
      })
    return () => {
      alive = false
    }
  }, [open, form.template, previewLetterhead])
  const [parties, setParties] = useState<AgreementPartyRow[]>([])
  const [busy, setBusy] = useState<'draft' | 'save' | 'download' | null>(null)
  const [tplSaveOpen, setTplSaveOpen] = useState(false)

  const patchForm = useCallback((patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }))
  }, [])

  // saved parties for the dropdown (this dialog mounts on open)
  useEffect(() => {
    let cancelled = false
    api
      .get<AgreementPartyRow[]>('/api/agreements/parties')
      .then((r) => {
        if (!cancelled) setParties(r)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // ---- auto AGR number follows the DATE year (until manually edited) -----
  const dateYear = !editing && !form.noManual ? form.date.slice(0, 4) : ''
  useEffect(() => {
    if (!dateYear || !/^\d{4}$/.test(dateYear)) return
    let cancelled = false
    api
      .get<{ agreementNo: string }>(`/api/agreements/next-number?year=${dateYear}`)
      .then((r) => {
        if (!cancelled) patchForm({ agreementNo: r.agreementNo })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [dateYear, patchForm])

  // ---- contract price words: set on input, never via effect ---------------
  const setAmountInput = (v: string) => {
    if (form.priceManual) {
      patchForm({ priceAmount: v })
      return
    }
    const n = parseFloat(v)
    const next = priceTextFor('amount', isNaN(n) ? null : n)
    patchForm({ priceAmount: v, priceEn: next.en, priceAr: next.ar })
  }
  const setPriceMode = (mode: 'po' | 'amount') => {
    if (mode === 'po') {
      patchForm({ priceMode: mode, priceManual: false, priceEn: DEFAULT_PRICE.en, priceAr: DEFAULT_PRICE.ar })
      return
    }
    const n = parseFloat(form.priceAmount)
    const next = priceTextFor('amount', isNaN(n) ? null : n)
    patchForm({ priceMode: mode, priceManual: false, priceEn: next.en, priceAr: next.ar })
  }

  // ---- derived preview object ---------------------------------------------
  const tpl: TemplateAgreement | null = useMemo(() => {
    const our = form.ourCompanyIs === 'first' ? form.our : form.other
    const other = form.ourCompanyIs === 'first' ? form.other : form.our
    return {
      agreementNo: form.agreementNo || 'AGR-____-____',
      date: form.date || '____-__-__',
      showLetterheadSpace: form.showLetterheadSpace,
      title: { en: form.titleEn || '—', ar: form.titleAr },
      firstParty: our,
      secondParty: other,
      intro: { en: form.introEn, ar: form.introAr },
      periodFrom: form.periodFrom || '____-__-__',
      periodTo: form.periodTo || '____-__-__',
      contractPrice: { en: form.priceEn, ar: form.priceAr },
      clauses: form.clauses
        .filter((c) => c.textEn.trim() || c.textAr.trim())
        .map((c) => ({ en: c.textEn, ar: c.textAr })),
    }
  }, [form])

  // ---- validation + body + save -------------------------------------------
  function validate(f: FormState): string | null {
    if (!/^AGR-\d{4}-\d{1,4}$/.test(f.agreementNo.trim())) {
      return 'Agreement No must look like AGR-2026-0001 (editable).'
    }
    if (!f.date) return 'Pick the agreement date.'
    if (!f.titleEn.trim()) return 'Enter the agreement title (English).'
    if (!f.our.name.en.trim()) {
      return 'Our company name is empty — fill it in, or set it once in Settings.'
    }
    if (!f.other.name.en.trim()) return 'Enter the other party name (English).'
    if (!f.periodFrom || !f.periodTo) return 'Pick the Period From and To dates.'
    if (new Date(f.periodTo) < new Date(f.periodFrom)) {
      return 'Period To cannot be before Period From.'
    }
    if (f.priceMode === 'amount') {
      const n = parseFloat(f.priceAmount)
      if (isNaN(n) || n < 0) return 'Enter the contract price amount, or switch to "As per PO".'
    }
    if (!f.priceEn.trim() || !f.priceAr.trim()) return 'Contract price text is missing.'
    return null
  }

  function buildBody(f: FormState, status: 'draft' | 'signed') {
    const our = f.ourCompanyIs === 'first' ? f.our : f.other
    const other = f.ourCompanyIs === 'first' ? f.other : f.our
    const clauses = f.clauses
      .filter((c) => c.textEn.trim() || c.textAr.trim())
      .map((c) => ({ textEn: c.textEn.trim(), textAr: c.textAr.trim() }))
    return {
      agreementNo: f.agreementNo.trim(),
      date: f.date,
      titleEn: f.titleEn.trim(),
      titleAr: f.titleAr.trim(),
      ourCompanyIs: f.ourCompanyIs,
      firstParty: our,
      secondParty: other,
      otherPartyId: f.otherPartyId,
      saveOtherParty: f.saveOtherParty,
      introEn: f.introEn,
      introAr: f.introAr,
      periodFrom: f.periodFrom,
      periodTo: f.periodTo,
      priceMode: f.priceMode,
      priceAmount: f.priceMode === 'amount' ? parseFloat(f.priceAmount) || 0 : null,
      priceEn: f.priceEn.trim(),
      priceAr: f.priceAr.trim(),
      showLetterheadSpace: f.showLetterheadSpace,
      template: f.template,
      status,
      clauses,
    }
  }

  async function saveAgreement(f: FormState, status: 'draft' | 'signed'): Promise<AgreementRow> {
    const body = buildBody(f, status)
    return editing
      ? api.put<AgreementRow>(`/api/agreements/${editing.id}`, body)
      : api.post<AgreementRow>('/api/agreements', body)
  }

  const runSave = async (kind: 'draft' | 'save') => {
    if (busy) return
    const problem = validate(form)
    if (problem) {
      toast.error(problem)
      return
    }
    try {
      setBusy(kind === 'draft' ? 'draft' : 'save')
      const row = await saveAgreement(form, kind === 'draft' ? 'draft' : 'signed')
      toast.success(`Agreement ${row.agreementNo} saved${kind === 'draft' ? ' as draft' : ''}`)
      onSaved(row)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the agreement')
    } finally {
      setBusy(null)
    }
  }

  const runDownload = async () => {
    if (busy) return
    const problem = validate(form)
    if (problem) {
      toast.error(problem)
      return
    }
    try {
      setBusy('download')
      const keepStatus: 'draft' | 'signed' =
        editing && (editing.status === 'signed' || editing.status === 'expired') ? 'signed' : 'draft'
      const row = await saveAgreement(form, keepStatus)
      await downloadServerPdf(row.id, `${row.agreementNo}_${row.otherPartyNameEn || row.otherPartyNameAr}`)
      toast.success(`Agreement ${row.agreementNo} saved — PDF downloaded`)
      onSaved(row)
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not prepare the PDF')
    } finally {
      setBusy(null)
    }
  }

  const runPrint = () => {
    const problem = validate(form)
    if (problem) {
      toast.error(problem)
      return
    }
    const our = form.ourCompanyIs === 'first' ? form.our : form.other
    const other = form.ourCompanyIs === 'first' ? form.other : form.our
    const clauses = form.clauses
      .filter((c) => c.textEn.trim() || c.textAr.trim())
      .map((c, i) => ({ order: i + 1, textEn: c.textEn, textAr: c.textAr }))
    onPrintDraft({
      id: 'draft',
      agreementNo: form.agreementNo,
      date: form.date,
      titleEn: form.titleEn,
      titleAr: form.titleAr,
      ourCompanyIs: form.ourCompanyIs,
      firstParty: our,
      secondParty: other,
      otherPartyId: form.otherPartyId,
      otherPartyNameEn: other.name.en,
      otherPartyNameAr: other.name.ar,
      introEn: form.introEn,
      introAr: form.introAr,
      periodFrom: form.periodFrom,
      periodTo: form.periodTo,
      priceMode: form.priceMode,
      priceAmount: form.priceMode === 'amount' ? parseFloat(form.priceAmount) || null : null,
      priceEn: form.priceEn,
      priceAr: form.priceAr,
      showLetterheadSpace: form.showLetterheadSpace,
      template: form.template,
      status: 'draft',
      lastEditedBy: null,
      lastEditedAt: null,
      createdByName: null,
      createdAt: new Date().toISOString(),
      clauses,
    })
  }

  // ---- clause helpers ------------------------------------------------------
  const addClause = () =>
    patchForm({
      clauses: [...form.clauses, { key: nextClauseKey(), textEn: '', textAr: '', arManual: false }],
    })
  const removeClause = (idx: number) =>
    patchForm({ clauses: form.clauses.filter((_, i) => i !== idx) })
  const moveClause = (idx: number, dir: -1 | 1) => {
    const next = [...form.clauses]
    const j = idx + dir
    if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    patchForm({ clauses: next })
  }
  const patchClause = (idx: number, patch: Partial<ClauseDraft>) => {
    patchForm({ clauses: form.clauses.map((c, i) => (i === idx ? { ...c, ...patch } : c)) })
  }

  const f = form
  const subtitle = editing
    ? `Edit · last edited by ${editing.lastEditedBy ?? editing.createdByName ?? '—'}${
        editing.lastEditedAt ? ` · ${formatDate(editing.lastEditedAt)}` : ''
      }`
    : initialTemplate
      ? `From template “${initialTemplate.name}” — live preview on the right`
      : 'Start blank — live preview on the right'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1440px]"
      >
        <DialogTitle className="sr-only">Agreement editor</DialogTitle>
        <DialogDescription className="sr-only">
          Split-screen agreement editor — form on the left, live preview of the bilingual
          template on the right.
        </DialogDescription>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              {editing ? `Edit ${editing.agreementNo}` : 'New Agreement'}
            </h2>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setTplSaveOpen(true)}
              disabled={!f.titleEn.trim() && f.clauses.length === 0}
            >
              <ScrollText className="mr-2 h-4 w-4" />
              Save as Template
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenChange(false)}>
              <X className="mr-2 h-4 w-4" />
              Close
            </Button>
          </div>
        </div>

        {/* Split: form | live preview */}
        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,46%)]">
          <div className="nice-scrollbar min-h-0 space-y-7 overflow-y-auto p-4 sm:p-5">
            {/* ---- Basics ---- */}
            <section className="space-y-4">
              <header>
                <h3 className="text-sm font-semibold">Basics</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The number follows the agreement date year until you edit it.
                </p>
              </header>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="agr-no" className="text-xs font-medium">
                    Agreement No
                  </Label>
                  <Input
                    id="agr-no"
                    className="font-mono"
                    value={f.agreementNo}
                    onChange={(e) => patchForm({ agreementNo: e.target.value, noManual: true })}
                    placeholder="AGR-2026-0001"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agr-date" className="text-xs font-medium">
                    Date
                  </Label>
                  <Input
                    id="agr-date"
                    type="date"
                    value={f.date}
                    onChange={(e) => patchForm({ date: e.target.value })}
                  />
                </div>
              </div>
              <TranslatableField
                id="agr-title"
                label={<>Title — <span lang="ar" dir="rtl">العنوان</span></>}
                en={f.titleEn}
                ar={f.titleAr}
                arManual={f.titleArManual}
                onEn={(v) => patchForm({ titleEn: v })}
                onAr={(v, manual) => patchForm({ titleAr: v, titleArManual: manual })}
                context="title"
                enPlaceholder="Sub-Contract Agreement"
                arPlaceholder="عقد مقاولة من الباطن"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="agr-role" className="text-xs font-medium">
                    Our company is
                  </Label>
                  <Select
                    value={f.ourCompanyIs}
                    onValueChange={(v) => patchForm({ ourCompanyIs: v as 'first' | 'second' })}
                  >
                    <SelectTrigger id="agr-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="first">First Party — الطرف الأول</SelectItem>
                      <SelectItem value="second">Second Party — الطرف الثاني</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <Checkbox
                      checked={f.showLetterheadSpace}
                      onCheckedChange={(v) => patchForm({ showLetterheadSpace: v === true })}
                    />
                    <span className="space-y-0.5">
                      <span className="block text-xs font-medium leading-none">
                        Leave space for letterhead
                      </span>
                      <span className="block text-[11px] leading-snug text-muted-foreground">
                        Prints a 30 mm dashed area at the top for pre-printed letterhead paper.
                      </span>
                    </span>
                  </label>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agr-print-template" className="text-xs font-medium">
                  Print template
                </Label>
                <Select
                  value={resolveAgreementPrintTemplate(f.template, settings.agreementDefaultTemplate)}
                  onValueChange={(v) => patchForm({ template: v })}
                >
                  <SelectTrigger id="agr-print-template" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGREEMENT_PRINT_TEMPLATES.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Layout only — never changes the agreement text, parties, dates or signatories.
                  Saved with this agreement; the default comes from Settings.
                </p>
              </div>
            </section>

            {/* ---- Our company ---- */}
            <section className="space-y-4">
              <header>
                <h3 className="text-sm font-semibold">Our Company</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Auto-filled from Settings — changes here affect only this agreement.
                </p>
              </header>
              <PartyBlockFields
                idPrefix="our"
                party={f.our}
                arManual={f.ourArManual}
                onParty={(next) => patchForm({ our: next })}
                onArManual={(next) => patchForm({ ourArManual: next })}
              />
            </section>

            {/* ---- Other party ---- */}
            <section className="space-y-4">
              <header>
                <h3 className="text-sm font-semibold">Other Party</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Pick a saved party or type a new one — you can save it for future agreements.
                </p>
              </header>
              <div className="space-y-2.5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Saved party</Label>
                  <Select
                    value={f.otherPartyId ?? NEW_PARTY_VALUE}
                    onValueChange={(v) => {
                      if (v === NEW_PARTY_VALUE) {
                        patchForm({
                          otherPartyId: null,
                          other: emptyParty(),
                          otherArManual: { name: false, address: false, sigName: false, sigTitle: false },
                          saveOtherParty: false,
                        })
                        return
                      }
                      const p = parties.find((x) => x.id === v)
                      if (!p) return
                      patchForm({
                        otherPartyId: p.id,
                        saveOtherParty: true,
                        other: {
                          name: { en: p.nameEn, ar: p.nameAr },
                          crNo: p.crNo ?? '',
                          address: { en: p.addressEn ?? '', ar: p.addressAr ?? '' },
                          tel: p.tel ?? '',
                          fax: p.fax ?? '',
                          signatory: {
                            name: { en: p.signatoryNameEn ?? '', ar: p.signatoryNameAr ?? '' },
                            title: { en: p.signatoryTitleEn ?? '', ar: p.signatoryTitleAr ?? '' },
                          },
                          signatureImg: '',
                          stampImg: '',
                        },
                        otherArManual: { ...ALL_MANUAL },
                      })
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select saved party" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NEW_PARTY_VALUE}>Enter a new party…</SelectItem>
                      {parties.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nameEn}
                          {p.nameAr ? ` — ${p.nameAr}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {f.other.name.en.trim() ? (
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border bg-muted/20 px-3 py-2.5">
                    <Checkbox
                      checked={f.saveOtherParty}
                      onCheckedChange={(v) => patchForm({ saveOtherParty: v === true })}
                    />
                    <span className="text-xs">
                      Save this party for future agreements
                      {f.otherPartyId ? ' (updates the saved record)' : ''}
                    </span>
                  </label>
                ) : null}
              </div>
              <PartyBlockFields
                idPrefix="other"
                party={f.other}
                arManual={f.otherArManual}
                onParty={(next) => patchForm({ other: next })}
                onArManual={(next) => patchForm({ otherArManual: next })}
              />
            </section>

            {/* ---- Intro ---- */}
            <section className="space-y-4">
              <header>
                <h3 className="text-sm font-semibold">Intro Paragraph</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Printed after the party blocks, before the numbered clauses.
                </p>
              </header>
              <TranslatableField
                id="intro"
                en={f.introEn}
                ar={f.introAr}
                arManual={f.introArManual}
                onEn={(v) => patchForm({ introEn: v })}
                onAr={(v, manual) => patchForm({ introAr: v, introArManual: manual })}
                context="intro"
                multiline
                rows={3}
                enPlaceholder="The First Party and the Second Party have agreed that…"
                arPlaceholder="وافق الطرف الأول والطرف الثاني على…"
              />
            </section>

            {/* ---- Clauses ---- */}
            <section className="space-y-4">
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold">Clauses</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Numbering is automatic on the document — order them here.
                  </p>
                </div>
                <Button variant="outline" size="sm" className="h-8" onClick={addClause}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Clause
                </Button>
              </header>
              {f.clauses.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  No clauses yet — “Add Clause” to start the terms list.
                </p>
              ) : (
                <div className="space-y-3">
                  {f.clauses.map((c, i) => (
                    <div key={c.key} className="space-y-2 rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">Clause {i + 1}</span>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => moveClause(i, -1)}
                            disabled={i === 0}
                            title="Move up"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                            <span className="sr-only">Move clause {i + 1} up</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => moveClause(i, 1)}
                            disabled={i === f.clauses.length - 1}
                            title="Move down"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                            <span className="sr-only">Move clause {i + 1} down</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => removeClause(i)}
                            title="Delete clause"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span className="sr-only">Delete clause {i + 1}</span>
                          </Button>
                        </div>
                      </div>
                      <TranslatableField
                        id={`clause-${c.key}`}
                        en={c.textEn}
                        ar={c.textAr}
                        arManual={c.arManual}
                        onEn={(v) => patchClause(i, { textEn: v })}
                        onAr={(v, manual) => patchClause(i, { textAr: v, arManual: manual })}
                        context="clause"
                        multiline
                        rows={3}
                        enPlaceholder="Second Party shall provide industrial service…"
                        arPlaceholder="يلتزم الطرف الثاني بتوفير الخدمات الصناعية…"
                      />
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Tokens: <code className="rounded bg-muted px-1">{`{PRICE}`}</code> → contract
                price · <code className="rounded bg-muted px-1">{`{PERIOD}`}</code> → period
                dates (both languages, replaced on the document).
              </p>
            </section>

            {/* ---- Price & period ---- */}
            <section className="space-y-4">
              <header>
                <h3 className="text-sm font-semibold">Contract Price &amp; Period</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  “As per PO”, or an amount in SAR auto-written in both languages.
                </p>
              </header>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Price</Label>
                  <Select
                    value={f.priceMode}
                    onValueChange={(v) => setPriceMode(v as 'po' | 'amount')}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="po">As per PO — حسب أمر الشراء</SelectItem>
                      <SelectItem value="amount">Amount in SAR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {f.priceMode === 'amount' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="agr-price-amount" className="text-xs font-medium">
                      Amount (SAR)
                    </Label>
                    <Input
                      id="agr-price-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={f.priceAmount}
                      onChange={(e) => setAmountInput(e.target.value)}
                      placeholder="224120"
                    />
                  </div>
                ) : null}
              </div>
              {f.priceMode === 'amount' ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium">
                    Price text (auto-written — editable):{' '}
                    <span className="font-normal text-muted-foreground">
                      replaces <code className="rounded bg-muted px-1">{`{PRICE}`}</code> in clauses
                    </span>
                  </p>
                  <Textarea
                    aria-label="Contract price text, English"
                    value={f.priceEn}
                    rows={2}
                    onChange={(e) => patchForm({ priceEn: e.target.value, priceManual: true })}
                    className="text-[13px]"
                  />
                  <Textarea
                    aria-label="Contract price text, Arabic"
                    lang="ar"
                    dir="rtl"
                    value={f.priceAr}
                    rows={2}
                    onChange={(e) => patchForm({ priceAr: e.target.value, priceManual: true })}
                    className="text-[14px] leading-7"
                  />
                </div>
              ) : (
                <p className="rounded-lg border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
                  Printed as:{' '}
                  <span className="font-medium text-foreground">{DEFAULT_PRICE.en}</span>
                  {' · '}
                  <span lang="ar" className="font-medium text-foreground">
                    {DEFAULT_PRICE.ar}
                  </span>
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="agr-from" className="text-xs font-medium">
                    Period From
                  </Label>
                  <Input
                    id="agr-from"
                    type="date"
                    value={f.periodFrom}
                    onChange={(e) => patchForm({ periodFrom: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="agr-to" className="text-xs font-medium">
                    Period To
                  </Label>
                  <Input
                    id="agr-to"
                    type="date"
                    value={f.periodTo}
                    onChange={(e) => patchForm({ periodTo: e.target.value })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The status flips to <span className="font-medium">Expired</span> automatically once
                the Period To date passes (for signed agreements).
              </p>
            </section>
          </div>

          {/* Live preview (≥ lg) */}
          <div className="hidden min-h-0 border-l lg:block">
            {tpl ? (
              <ScaledSheetPreview
                tpl={tpl}
                template={form.template}
                letterhead={previewLetterhead}
              />
            ) : null}
          </div>
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-card px-4 py-3">
          <Button
            variant="outline"
            onClick={() => void runSave('draft')}
            disabled={busy != null}
          >
            {busy === 'draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save as Draft
          </Button>
          <Button onClick={() => void runSave('save')} disabled={busy != null}>
            {busy === 'save' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save
          </Button>
          <Button variant="outline" onClick={() => void runDownload()} disabled={busy != null}>
            {busy === 'download' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
            Download PDF
          </Button>
          <Button variant="outline" onClick={runPrint}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>

        {/* Save as Template (mounted on open so its state resets) */}
        {tplSaveOpen ? (
          <SaveTemplateDialog
            open
            onOpenChange={setTplSaveOpen}
            snapshot={{
              titleEn: f.titleEn,
              titleAr: f.titleAr,
              introEn: f.introEn,
              introAr: f.introAr,
              clauses: f.clauses
                .filter((c) => c.textEn.trim() || c.textAr.trim())
                .map((c) => ({ textEn: c.textEn, textAr: c.textAr })),
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Server PDF download (list rows + the editor's Download PDF action)
// ---------------------------------------------------------------------------

async function downloadServerPdf(id: string, filename: string): Promise<void> {
  const token = getAuthToken()
  const res = await fetch(`/api/agreements/${id}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) throw new Error(`PDF failed (${res.status})`)
  const blob = await res.blob()
  if (blob.size === 0) throw new Error('empty pdf')
  const clean = filename
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${clean || 'agreement'}.pdf`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

// ---------------------------------------------------------------------------
// Agreements list view
// ---------------------------------------------------------------------------

export function AgreementsView() {
  const { user, settings } = useAppStore()
  const canCreate = can(user, 'agreements.create')
  const canEdit = can(user, 'agreements.edit')
  const canDelete = can(user, 'agreements.delete')
  const currency = settings.currency || 'SAR'

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 350)
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFromFilter, setDateFromFilter] = useState('')
  const [dateToFilter, setDateToFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [rows, setRows] = useState<AgreementRow[]>([])
  const [totals, setTotals] = useState<ListTotals>({
    count: 0,
    totalAmount: 0,
    signedCount: 0,
    active: 0,
  })
  const [meta, setMeta] = useState({ page: 1, pageSize: 10, total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [chooserOpen, setChooserOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AgreementRow | null>(null)
  const [editorTemplate, setEditorTemplate] = useState<AgreementTemplateRow | null>(null)
  const [printing, setPrinting] = useState<AgreementRow | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const loadList = useCallback(async () => {
    setLoadError(null)
    setLoading(true)
    try {
      const res = await api.get<Paginated<AgreementRow>>(
        `/api/agreements${qs({
          search: debouncedSearch,
          status: statusFilter === 'all' ? '' : statusFilter,
          dateFrom: dateFromFilter,
          dateTo: dateToFilter,
          page,
          pageSize,
        })}`
      )
      setRows(res.data)
      setTotals({
        count: res.totals?.count ?? 0,
        totalAmount: res.totals?.totalAmount ?? 0,
        signedCount: res.totals?.signedCount ?? 0,
        active: res.totals?.active ?? 0,
      })
      setMeta({ page: res.page, pageSize: res.pageSize, total: res.total, totalPages: res.totalPages })
      if (res.data.length === 0 && res.page > 1 && res.total > 0) setPage(res.totalPages)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Something went wrong')
      toast.error(e instanceof Error ? e.message : 'Failed to load agreements')
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, statusFilter, dateFromFilter, dateToFilter, page, pageSize])

  useEffect(() => {
    void loadList()
  }, [loadList])

  function changeFilter(setter: (v: string) => void) {
    return (v: string) => {
      setter(v)
      setPage(1)
    }
  }

  // Deep-open the chooser when arriving via the command palette
  const shouldOpenCreate = useViewIntent('agreements', 'create')
  useEffect(() => {
    if (shouldOpenCreate) setChooserOpen(true)
  }, [shouldOpenCreate])

  const fetchFull = useCallback(async (id: string): Promise<AgreementRow | null> => {
    try {
      return await api.get<AgreementRow>(`/api/agreements/${id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load agreement')
      return null
    }
  }, [])

  async function openEdit(row: AgreementRow) {
    if (busyId) return
    setBusyId(row.id)
    const full = await fetchFull(row.id)
    setBusyId(null)
    if (full) {
      setEditing(full)
      setEditorTemplate(null)
      setEditorOpen(true)
    }
  }

  async function openPrint(row: AgreementRow) {
    if (busyId) return
    setBusyId(row.id)
    const full = await fetchFull(row.id)
    setBusyId(null)
    if (full) setPrinting(full)
  }

  async function handleDelete(row: AgreementRow) {
    try {
      await api.del(`/api/agreements/${row.id}`)
      toast.success(`Agreement ${row.agreementNo} deleted`)
      void loadList()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete agreement')
    }
  }

  async function handleDuplicate(row: AgreementRow) {
    if (busyId) return
    setBusyId(row.id)
    try {
      const copy = await api.post<AgreementRow>(`/api/agreements/${row.id}/duplicate`, {})
      toast.success(`Duplicated as ${copy.agreementNo} (draft)`)
      void loadList()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to duplicate agreement')
    } finally {
      setBusyId(null)
    }
  }

  async function handleRowPdf(row: AgreementRow) {
    if (busyId) return
    setBusyId(row.id)
    try {
      await downloadServerPdf(
        row.id,
        `${row.agreementNo}_${row.otherPartyNameEn || row.otherPartyNameAr}`
      )
      toast.success('PDF downloaded')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate the PDF')
    } finally {
      setBusyId(null)
    }
  }

  function handleSaved(row: AgreementRow) {
    setEditorOpen(false)
    setEditing(null)
    setEditorTemplate(null)
    void loadList()
    void row
  }

  async function handleExportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const all: AgreementRow[] = []
      let p = 1
      for (;;) {
        const res = await api.get<Paginated<AgreementRow>>(
          `/api/agreements${qs({
            search: debouncedSearch,
            status: statusFilter === 'all' ? '' : statusFilter,
            dateFrom: dateFromFilter,
            dateTo: dateToFilter,
            page: p,
            pageSize: 100,
          })}`
        )
        all.push(...res.data)
        if (p >= res.totalPages || res.data.length === 0) break
        p += 1
      }
      if (all.length === 0) {
        toast.info('No agreements match the current filters')
        return
      }
      const csv = buildCsv(
        [
          'Agreement No',
          'Date',
          'Title (EN)',
          'Title (AR)',
          'Other Party',
          'Other Party (AR)',
          'Our Company Is',
          'Period From',
          'Period To',
          'Price Mode',
          `Amount (${currency})`,
          'Price Text (EN)',
          'Status',
          'Last Edited By',
          'Last Edited At',
        ],
        all.map((r) => [
          r.agreementNo,
          formatDate(r.date),
          r.titleEn,
          r.titleAr,
          r.otherPartyNameEn,
          r.otherPartyNameAr,
          r.ourCompanyIs === 'first' ? 'First Party' : 'Second Party',
          formatDate(r.periodFrom),
          formatDate(r.periodTo),
          r.priceMode === 'amount' ? 'Amount' : 'As per PO',
          r.priceAmount != null ? r.priceAmount.toFixed(2) : '',
          r.priceEn,
          STATUS_LABELS[r.status] ?? r.status,
          r.lastEditedBy ?? r.createdByName ?? '',
          r.lastEditedAt ? formatDate(r.lastEditedAt) : '',
        ])
      )
      downloadCsv(csvFilename('agreements', 'all'), csv)
      toast.success(`Exported ${all.length} agreement${all.length === 1 ? '' : 's'} to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const activeFilterCount =
    (statusFilter !== 'all' ? 1 : 0) +
    (dateFromFilter ? 1 : 0) +
    (dateToFilter ? 1 : 0)

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Agreements"
        description="Bilingual contracts — printed as the exact attached template"
      >
        <Button
          variant="outline"
          size="sm"
          className="h-9"
          onClick={handleExportCsv}
          disabled={exporting}
        >
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="mr-2 h-4 w-4" />
          )}
          Excel / CSV
        </Button>
        {canCreate ? (
          <Button size="sm" className="h-9" onClick={() => setChooserOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Agreement
          </Button>
        ) : null}
      </PageHeader>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Agreements"
          value={totals.count.toLocaleString()}
          sublabel="Matching the current filters"
          icon={FileSignature}
          tone="navy"
        />
        <StatCard
          title="Contract Amounts"
          value={formatNumber(totals.totalAmount)}
          valuePrefix={currency}
          sublabel="Amount-mode agreements only (as-per-PO excluded)"
          icon={ScrollText}
          tone="gold"
        />
        <StatCard
          title="Signed"
          value={totals.signedCount.toLocaleString()}
          sublabel="Signed, incl. already expired"
          icon={Pencil}
          tone="green"
        />
        <StatCard
          title="Active"
          value={totals.active.toLocaleString()}
          sublabel="Signed and not yet expired"
          icon={CalendarClock}
          tone="teal"
        />
      </div>

      {/* List */}
      <SectionCard className="p-4 sm:p-6">
        <FilterBar
          search={
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v)
                setPage(1)
              }}
              placeholder="Search number, title or party…"
            />
          }
          activeCount={activeFilterCount}
        >
          <FilterSelect
            value={statusFilter}
            onChange={changeFilter(setStatusFilter)}
            placeholder="Status"
            options={['draft', 'signed', 'expired'].map((s) => ({
              value: s,
              label: STATUS_LABELS[s],
            }))}
            emptyLabel="All statuses"
          />
          <div className="flex items-center gap-1.5">
            <label htmlFor="agr-filter-from" className="sr-only">
              Date from
            </label>
            <Input
              id="agr-filter-from"
              type="date"
              className="h-9 w-[150px]"
              value={dateFromFilter}
              onChange={(e) => {
                setDateFromFilter(e.target.value)
                setPage(1)
              }}
            />
            <span className="text-xs text-muted-foreground">→</span>
            <label htmlFor="agr-filter-to" className="sr-only">
              Date to
            </label>
            <Input
              id="agr-filter-to"
              type="date"
              className="h-9 w-[150px]"
              value={dateToFilter}
              onChange={(e) => {
                setDateToFilter(e.target.value)
                setPage(1)
              }}
            />
          </div>
        </FilterBar>

        <div className="mt-4">
          {loadError && !loading ? (
            <ErrorState
              title="Couldn't load agreements"
              description={loadError}
              onRetry={() => void loadList()}
              className="m-4"
            />
          ) : loading ? (
            <TableSkeleton rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={FileSignature}
              title="No agreements"
              description={
                activeFilterCount > 0 || search
                  ? 'No agreements match the current filters — try clearing them.'
                  : 'Bilingual contracts will appear here.'
              }
              action={
                canCreate ? (
                  <Button size="sm" onClick={() => setChooserOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Agreement
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="table-scroll nice-scrollbar hidden overflow-x-auto md:block">
                <Table className="min-w-[920px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9">Agreement No</TableHead>
                      <TableHead className="h-9 min-w-[200px]">Title</TableHead>
                      <TableHead className="h-9 min-w-[150px]">Other Party</TableHead>
                      <TableHead className="h-9">Period</TableHead>
                      <TableHead className="h-9">Status</TableHead>
                      <TableHead className="h-9 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="px-4 py-2.5">
                          <p className="font-mono text-xs font-medium">{r.agreementNo}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatDate(r.date)}
                            {r.lastEditedBy ? (
                              <>
                                {' · '}
                                <span title={`Last edited by ${r.lastEditedBy}`}>
                                  edited by {r.lastEditedBy}
                                  {r.lastEditedAt ? ` · ${formatDate(r.lastEditedAt)}` : ''}
                                </span>
                              </>
                            ) : null}
                          </p>
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <p className="max-w-[260px] truncate font-medium" title={r.titleEn}>
                            {r.titleEn}
                          </p>
                          {r.titleAr ? (
                            <p dir="rtl" lang="ar" className="max-w-[260px] truncate text-xs text-muted-foreground">
                              {r.titleAr}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <p className="max-w-[170px] truncate" title={r.otherPartyNameEn}>
                            {r.otherPartyNameEn}
                          </p>
                          {r.otherPartyNameAr ? (
                            <p dir="rtl" lang="ar" className="max-w-[170px] truncate text-xs text-muted-foreground">
                              {r.otherPartyNameAr}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <p className="text-sm">{formatDate(r.periodFrom)}</p>
                          <p className="text-xs text-muted-foreground">
                            to {formatDate(r.periodTo)}
                          </p>
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => void openPrint(r)}
                              disabled={busyId === r.id}
                              title="View / print"
                            >
                              {busyId === r.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                              <span className="sr-only">View {r.agreementNo}</span>
                            </Button>
                            {canEdit ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => void openEdit(r)}
                                disabled={busyId === r.id}
                                title="Edit agreement"
                              >
                                <Pencil className="h-4 w-4" />
                                <span className="sr-only">Edit {r.agreementNo}</span>
                              </Button>
                            ) : null}
                            {canCreate ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => void handleDuplicate(r)}
                                disabled={busyId === r.id}
                                title="Duplicate as draft"
                              >
                                <Copy className="h-4 w-4" />
                                <span className="sr-only">Duplicate {r.agreementNo}</span>
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => void handleRowPdf(r)}
                              disabled={busyId === r.id}
                              title="Download PDF"
                            >
                              <FileDown className="h-4 w-4" />
                              <span className="sr-only">Download {r.agreementNo} PDF</span>
                            </Button>
                            {canDelete ? (
                              <ConfirmDelete
                                onConfirm={() => handleDelete(r)}
                                title="Delete agreement?"
                                description={`${r.agreementNo} — ${r.titleEn} with ${r.otherPartyNameEn}. Clauses are removed too.`}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <ul className="space-y-3 md:hidden">
                {rows.map((r) => (
                  <li key={r.id} className="rounded-xl border bg-card p-3.5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] font-semibold text-muted-foreground">
                          {r.agreementNo} · {formatDate(r.date)}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-sm font-semibold">{r.titleEn}</p>
                      </div>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {r.otherPartyNameEn}
                      {r.otherPartyNameAr ? ` · ${r.otherPartyNameAr}` : ''}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      <div>
                        <p className="text-muted-foreground">Period</p>
                        <p className="font-medium">
                          {formatDate(r.periodFrom)} → {formatDate(r.periodTo)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Price</p>
                        <p className="font-medium">
                          {r.priceMode === 'amount'
                            ? formatMoney(r.priceAmount ?? 0, currency)
                            : 'As per PO'}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-end gap-1 border-t pt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 px-2.5"
                        onClick={() => void openPrint(r)}
                        disabled={busyId === r.id}
                      >
                        {busyId === r.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Eye className="h-3.5 w-3.5" />
                        )}
                        View
                      </Button>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-2.5"
                          onClick={() => void openEdit(r)}
                          disabled={busyId === r.id}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </Button>
                      ) : null}
                      {canCreate ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 px-2.5"
                          onClick={() => void handleDuplicate(r)}
                          disabled={busyId === r.id}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Duplicate
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 px-2.5"
                        onClick={() => void handleRowPdf(r)}
                        disabled={busyId === r.id}
                      >
                        <FileDown className="h-3.5 w-3.5" />
                        PDF
                      </Button>
                      {canDelete ? (
                        <ConfirmDelete
                          onConfirm={() => handleDelete(r)}
                          title="Delete agreement?"
                          description={`${r.agreementNo} — ${r.titleEn} with ${r.otherPartyNameEn}. Clauses are removed too.`}
                          label="Delete"
                          size="sm"
                          triggerClassName="h-8 px-2.5 gap-1.5 text-destructive hover:text-destructive"
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <DataTablePagination
                  page={meta.page}
                  pageSize={meta.pageSize}
                  total={meta.total}
                  totalPages={meta.totalPages}
                  onPageChange={setPage}
                  onPageSizeChange={(s) => {
                    setPageSize(s)
                    setPage(1)
                  }}
                />
              </div>
            </>
          )}
        </div>
      </SectionCard>

      {/* New Agreement → choose a template or start blank */}
      <TemplateChooserDialog
        open={chooserOpen}
        onOpenChange={setChooserOpen}
        onPick={(t) => {
          setChooserOpen(false)
          setEditing(null)
          setEditorTemplate(t)
          setEditorOpen(true)
        }}
      />

      {/* Split-screen editor (mounts on open so its form state initializes fresh) */}
      {editorOpen ? (
        <AgreementEditorDialog
          open
          onOpenChange={(o) => {
            setEditorOpen(o)
            if (!o) {
              setEditing(null)
              setEditorTemplate(null)
            }
          }}
          editing={editing}
          initialTemplate={editorTemplate}
          onSaved={handleSaved}
          onPrintDraft={(row) => setPrinting(row)}
        />
      ) : null}

      {/* A4 print preview (the exact template) */}
      <AgreementPrintDialog
        agreement={printing}
        open={Boolean(printing)}
        onOpenChange={(o) => !o && setPrinting(null)}
      />

      {/* Mobile FAB */}
      {canCreate ? (
        <MobileFab label="New Agreement" icon={Plus} onClick={() => setChooserOpen(true)} />
      ) : null}
    </div>
  )
}


