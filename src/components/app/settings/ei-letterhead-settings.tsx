'use client'

// E-Invoice letterhead settings section (rendered inside the Settings view,
// right after Company Profile). The E-Invoice module's own letterhead:
//   • Letterhead Header  — PNG designed for A4 width (210 mm), 45 mm tall —
//     printed at the very top of EVERY page, full width, no margin above it.
//   • Letterhead Footer  — PNG designed for A4 width (210 mm), 25 mm tall —
//     printed at the very bottom of EVERY page, full width, no margin below it.
//   • Watermark — PNG with a transparent / light background, centered behind
//     the invoice body on every page (≈120 mm wide, aspect ratio kept, opacity
//     10–100 %, on/off toggle).
// Each slot has a preview, a Replace button and a Remove button; a live mini
// A4 preview shows the exact arrangement. Everything saves with the single
// Save button via PUT /api/e-invoice-letterhead (PNG-only, ≤ 2 MB per image).
// While any slot is uploaded the E-Invoice uses THIS layout (45/25 mm bands,
// 5 mm gaps, 12 mm side margins, bilingual page number above the footer);
// with all slots empty it falls back to exactly the previous behaviour.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImageUp, Layers, Loader2, Save, Trash2 } from 'lucide-react'

import { api } from '@/lib/api-client'
import { fileToDataUrl, formatImageSize } from '@/lib/image-data-url'
import type { EInvoiceLetterheadConfig } from '@/lib/types'
import { cn } from '@/lib/utils'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { SectionCard } from '@/components/app/shared/page-header'

const DEFAULT_CONFIG: EInvoiceLetterheadConfig = {
  header: '',
  footer: '',
  watermark: '',
  watermarkOpacity: 100,
  watermarkEnabled: true,
}

type Slot = 'header' | 'footer' | 'watermark'

const SLOT_META: Record<Slot, { label: string; hint: string; empty: string }> = {
  header: {
    label: 'Letterhead Header',
    hint: 'PNG designed for A4 width (210 mm) and 45 mm tall — the very top of every page, full width, no margin above it.',
    empty: 'No header artwork',
  },
  footer: {
    label: 'Letterhead Footer',
    hint: 'PNG designed for A4 width (210 mm) and 25 mm tall — the very bottom of every page, full width, no margin below it.',
    empty: 'No footer artwork',
  },
  watermark: {
    label: 'Watermark',
    hint: 'PNG with a transparent / light background — centered BEHIND the invoice body on every page (about 120 mm wide, aspect ratio kept).',
    empty: 'No watermark',
  },
}

export function EILetterheadSettingsSection({ canEdit }: { canEdit: boolean }) {
  const [cfg, setCfg] = useState<EInvoiceLetterheadConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get<EInvoiceLetterheadConfig>('/api/e-invoice-letterhead')
      setCfg({ ...DEFAULT_CONFIG, ...res })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the E-Invoice letterhead')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function pickImage(slot: Slot) {
    return (file: File | undefined) => {
      if (!file) return
      if (file.type !== 'image/png') {
        toast.error('Only PNG images are allowed (the watermark and bands are designed as PNG artwork)')
        return
      }
      fileToDataUrl(file)
        .then((dataUrl) => setCfg((c) => ({ ...c, [slot]: dataUrl })))
        .catch((e: unknown) =>
          toast.error(e instanceof Error ? e.message : 'Could not read the image')
        )
    }
  }

  async function handleSave() {
    if (!canEdit || saving) return
    setSaving(true)
    try {
      const saved = await api.put<EInvoiceLetterheadConfig>('/api/e-invoice-letterhead', {
        header: cfg.header,
        footer: cfg.footer,
        watermark: cfg.watermark,
        watermarkOpacity: cfg.watermarkOpacity,
        watermarkEnabled: cfg.watermarkEnabled,
      })
      setCfg({ ...DEFAULT_CONFIG, ...saved })
      toast.success('E-Invoice letterhead saved — previews and prints use it immediately')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the E-Invoice letterhead')
    } finally {
      setSaving(false)
    }
  }

  const mmPct = (mm: number) => (mm / 297) * 100
  const wmActive = Boolean(cfg.watermark && cfg.watermarkEnabled)

  return (
    <SectionCard className="p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Layers className="h-4 w-4 text-[#8E6420]" />
        Company Letterhead — E-Invoice
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The E-Invoice&apos;s own letterhead: a 45 mm header band and a 25 mm footer band (full A4
        width, every page) plus an optional watermark behind the invoice body. While any slot is
        uploaded, tax invoices use this layout (45/25 mm bands, 5 mm gaps, 12 mm side margins and a
        bilingual page number just above the footer). With all slots empty the invoice falls back
        to the shared company letterhead — exactly as before.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        PNG only, up to 2 MB per image. Printing on pre-printed paper? The print dialog has a
        &quot;Print with letterhead&quot; checkbox that hides the artwork but keeps the same
        margins.
      </p>

      {loading ? (
        <div className="mt-6 flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading letterhead settings…
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_240px]">
          {/* ── settings column ── */}
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(SLOT_META) as Slot[]).map((slot) => (
                <ImageSlot
                  key={slot}
                  label={SLOT_META[slot].label}
                  hint={SLOT_META[slot].hint}
                  dataUrl={cfg[slot] || null}
                  disabled={!canEdit || saving}
                  onClear={() => setCfg((c) => ({ ...c, [slot]: '' }))}
                  onFile={(f) => pickImage(slot)(f)}
                />
              ))}
            </div>

            {/* watermark controls */}
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="ei-lh-wm-on" className="text-sm">
                    Watermark on printed invoices
                  </Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Master on/off toggle — when off (or no watermark is uploaded) the layer is
                    skipped entirely.
                  </p>
                </div>
                <Switch
                  id="ei-lh-wm-on"
                  checked={cfg.watermarkEnabled}
                  onCheckedChange={(v) => setCfg((c) => ({ ...c, watermarkEnabled: v }))}
                  disabled={!canEdit || saving}
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="ei-lh-wm-opacity" className="text-sm">
                    Watermark opacity
                  </Label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {cfg.watermarkOpacity}%{' '}
                    {cfg.watermarkOpacity === 100 ? '(artwork as uploaded — already faded)' : ''}
                  </span>
                </div>
                <Slider
                  id="ei-lh-wm-opacity"
                  value={[cfg.watermarkOpacity]}
                  min={10}
                  max={100}
                  step={5}
                  onValueChange={(v) => setCfg((c) => ({ ...c, watermarkOpacity: v[0] }))}
                  disabled={!canEdit || saving}
                />
                <p className="text-[11px] text-muted-foreground">
                  10 % – 100 %. Default 100 % prints the image exactly as faded as you uploaded it.
                </p>
              </div>
            </div>

            <Button onClick={() => void handleSave()} disabled={!canEdit || saving || loading}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Letterhead
            </Button>
          </div>

          {/* ── mini A4 preview (exact mm proportions) ── */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold">A4 preview</Label>
            <div
              className="relative w-full overflow-hidden rounded border bg-white text-[7px] shadow"
              style={{ aspectRatio: '210 / 297' }}
            >
              {/* header band 45 mm */}
              {cfg.header ? (
                <img
                  src={cfg.header}
                  alt="Header band preview"
                  className="absolute left-0 top-0 w-full object-fill"
                  style={{ height: `${mmPct(45)}%` }}
                />
              ) : (
                <div
                  className="absolute left-0 top-0 w-full border-b border-dashed border-neutral-300 bg-neutral-50"
                  style={{ height: `${mmPct(45)}%` }}
                />
              )}
              {/* footer band 25 mm */}
              {cfg.footer ? (
                <img
                  src={cfg.footer}
                  alt="Footer band preview"
                  className="absolute bottom-0 left-0 w-full object-fill"
                  style={{ height: `${mmPct(25)}%` }}
                />
              ) : (
                <div
                  className="absolute bottom-0 left-0 w-full border-t border-dashed border-neutral-300 bg-neutral-50"
                  style={{ height: `${mmPct(25)}%` }}
                />
              )}
              {/* watermark centered in the body area */}
              {wmActive ? (
                <div
                  className="absolute flex items-center justify-center"
                  style={{
                    top: `${mmPct(50)}%`,
                    bottom: `${mmPct(30)}%`,
                    left: 0,
                    right: 0,
                  }}
                >
                  <img
                    src={cfg.watermark}
                    alt="Watermark preview"
                    className="object-contain"
                    style={{
                      width: '57%',
                      maxHeight: '100%',
                      opacity: cfg.watermarkOpacity / 100,
                    }}
                  />
                </div>
              ) : null}
              {/* content-safe zone 50–267 mm */}
              <div
                className="absolute border border-dashed border-emerald-400/70 bg-emerald-50/30"
                style={{
                  top: `${mmPct(50)}%`,
                  bottom: `${mmPct(30)}%`,
                  left: `${mmPct(12)}%`,
                  right: `${mmPct(12)}%`,
                }}
              >
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[7px] font-medium text-emerald-600">
                  invoice body
                </span>
              </div>
              {/* page number marker just above the footer */}
              <div
                className="absolute left-0 right-0 text-center text-[6px] font-medium text-neutral-500"
                style={{ bottom: `${mmPct(26.5)}%` }}
              >
                Page 1 of 2 / صفحة 1 من 2
              </div>
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Header 45 mm · footer 25 mm · body 50–267 mm with 12 mm side margins · watermark
              ≈120 mm wide behind the body · page number just above the footer — on every page.
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

function ImageSlot({
  label,
  hint,
  dataUrl,
  disabled,
  onClear,
  onFile,
}: {
  label: string
  hint: string
  dataUrl: string | null
  disabled: boolean
  onClear: () => void
  onFile: (file: File | undefined) => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-2.5">
      <div>
        <p className="text-[11px] font-semibold">{label}</p>
      </div>
      <div className="flex h-16 items-center justify-center overflow-hidden rounded border border-dashed bg-muted/30">
        {dataUrl ? (
          <img src={dataUrl} alt={`${label} preview`} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[10px] text-muted-foreground">No image</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 flex-1 px-2 text-[11px]"
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
        >
          <ImageUp className="mr-1 h-3 w-3" />
          {dataUrl ? 'Replace' : 'Upload'}
        </Button>
        {dataUrl ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950"
              onClick={onClear}
              disabled={disabled}
              aria-label={`Remove ${label}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
            <span className={cn('text-[9px] tabular-nums text-muted-foreground')}>
              {formatImageSize(Math.round((dataUrl.length * 3) / 4))}
            </span>
          </>
        ) : null}
      </div>
      <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/png"
        className="sr-only"
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
        aria-label={`Upload ${label}`}
        disabled={disabled}
      />
    </div>
  )
}
