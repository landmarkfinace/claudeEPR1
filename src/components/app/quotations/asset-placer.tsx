'use client'

// AssetPlacer — upload editor for the quotation's signature & company stamp
// artwork. The artwork is anchored INTO the "Approved By" box of the letter's
// closing section: the signature sits exactly on its line, the stamp inside
// the dashed circle — identical to the printed PDF, and always BELOW the
// letter body. No manual positioning: the preview below is exactly what
// prints. The legacy posX/posY/width/rotation fields are still stored (API
// compatibility) but no longer drive placement.
import { useCallback, useRef, useState } from 'react'
import {
  BadgeCheck,
  ImagePlus,
  PenLine,
  ScanEye,
  Stamp,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { fileToDataUrl } from '@/lib/image-data-url'
import { useAppStore } from '@/lib/store'
import type { QuotationAssetRow } from '@/lib/types'

export type AssetType = 'signature' | 'stamp'

/**
 * Legacy placement values — kept so existing API validation and stored rows
 * stay compatible. Rendering ignores them: the artwork is auto-anchored to
 * the Approved By box (signature on the line, stamp in the circle).
 */
export function defaultAssetPlacement(type: AssetType, dataUrl: string): QuotationAssetRow {
  return type === 'signature'
    ? { type, dataUrl, posX: 68, posY: 83, width: 20, rotation: 0, visible: true }
    : { type, dataUrl, posX: 44, posY: 78, width: 17, rotation: -12, visible: true }
}

export function AssetPlacer({
  assets,
  onChange,
  disabled = false,
  onError,
}: {
  assets: QuotationAssetRow[]
  /** controlled — the parent quotation form owns the list */
  onChange: (next: QuotationAssetRow[]) => void
  disabled?: boolean
  onError?: (message: string) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const companyName = settings.companyName || 'Landmark Inter Gulf'
  const signatoryName = settings.authorizedSignatory || ''
  const [uploading, setUploading] = useState<AssetType | null>(null)
  const sigFileRef = useRef<HTMLInputElement>(null)
  const stampFileRef = useRef<HTMLInputElement>(null)

  const signature = assets.find((a) => a.type === 'signature') ?? null
  const stamp = assets.find((a) => a.type === 'stamp') ?? null

  const patch = useCallback(
    (type: AssetType, changes: Partial<QuotationAssetRow>) => {
      onChange(assets.map((a) => (a.type === type ? { ...a, ...changes } : a)))
    },
    [assets, onChange]
  )

  // ── upload handling ──────────────────────────────────────────────────────
  // Re-uploading keeps the visible flag; errors surface via onError.
  function safeUpload(type: AssetType, file: File | undefined) {
    if (!file) return
    setUploading(type)
    fileToDataUrl(file)
      .then((dataUrl) => {
        const existing = assets.find((a) => a.type === type)
        if (existing) {
          patch(type, { dataUrl, visible: true })
        } else {
          onChange([...assets, defaultAssetPlacement(type, dataUrl)])
        }
      })
      .catch((e: unknown) => {
        onError?.(e instanceof Error ? e.message : 'Upload failed')
      })
      .finally(() => setUploading(null))
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      {/* ── A4 preview — exactly what the printed closing section looks like ── */}
      <div
        className="relative mx-auto w-full max-w-[420px] select-none overflow-hidden rounded-lg border-2 border-dashed border-neutral-300 bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px)] shadow-inner dark:border-neutral-700"
        style={{ aspectRatio: '210 / 297' }}
      >
        {/* letter body mock — the signature always sits BELOW this */}
        <div className="absolute inset-x-[7%] top-[16%] space-y-[10px]">
          <div className="h-1.5 w-[70%] rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-1.5 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-1.5 w-[94%] rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-1.5 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-1.5 w-[60%] rounded bg-neutral-200 dark:bg-neutral-700" />
          <p className="pt-1 text-center text-[9px] font-semibold uppercase tracking-widest text-neutral-400">
            Letter body
          </p>
        </div>

        {/* closing signature boxes — pinned to the foot of the page */}
        <div className="absolute inset-x-[6%] bottom-[7%]">
          <div className="grid grid-cols-2 gap-2">
            {/* APPROVED BY — the company; artwork anchors here */}
            <div className="overflow-hidden rounded-md border border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-900">
              <div className="flex items-center justify-center gap-1 border-b border-neutral-300 bg-neutral-100 px-1.5 py-[3px] dark:border-neutral-600 dark:bg-neutral-800">
                <p className="truncate text-[7px] font-extrabold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-500">
                  Approved By · {companyName}
                </p>
              </div>
              <div className="flex items-end justify-between gap-2 px-2 py-[5px]">
                <div className="min-w-0 flex-1 space-y-[3px]">
                  {/* signature line — the uploaded signature sits exactly on it */}
                  <div className="relative h-[26px] border-b border-neutral-400 dark:border-neutral-500">
                    {signature ? (
                      <img
                        src={signature.dataUrl}
                        alt="Signature preview"
                        className={cn(
                          'absolute bottom-[3px] left-0 h-[calc(100%-6px)] max-w-full object-contain object-left-bottom',
                          !signature.visible && 'opacity-30 saturate-0'
                        )}
                      />
                    ) : null}
                  </div>
                  <p className="text-[7px] leading-tight text-neutral-600 dark:text-neutral-400">
                    <span className="font-semibold">Name: </span>
                    {signatoryName || '_____________________'}
                  </p>
                  <p className="text-[7px] leading-tight text-neutral-600 dark:text-neutral-400">
                    <span className="font-semibold">Date: </span>____ / ____ / ____
                  </p>
                </div>
                {/* stamp circle — the uploaded stamp fills it exactly */}
                <div className="relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-dashed border-amber-500 text-center text-[6px] font-bold uppercase leading-tight text-amber-700 dark:text-amber-500">
                  {stamp ? (
                    <img
                      src={stamp.dataUrl}
                      alt="Stamp preview"
                      className={cn(
                        'absolute inset-[6px] h-[calc(100%-12px)] w-[calc(100%-12px)] rounded-full object-contain',
                        !stamp.visible && 'opacity-30 saturate-0'
                      )}
                    />
                  ) : (
                    <>
                      Company<br />Stamp
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* ACCEPTED BY — the client signs on paper */}
            <div className="overflow-hidden rounded-md border border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-900">
              <div className="flex items-center justify-center gap-1 border-b border-neutral-300 bg-neutral-100 px-1.5 py-[3px] dark:border-neutral-600 dark:bg-neutral-800">
                <p className="truncate text-[7px] font-extrabold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-500">
                  Accepted By · Client
                </p>
              </div>
              <div className="flex items-end justify-between gap-2 px-2 py-[5px]">
                <div className="min-w-0 flex-1 space-y-[3px]">
                  <div className="h-[26px] border-b border-neutral-400 dark:border-neutral-500" />
                  <p className="text-[7px] leading-tight text-neutral-600 dark:text-neutral-400">
                    <span className="font-semibold">Name: </span>_____
                  </p>
                  <p className="text-[7px] leading-tight text-neutral-600 dark:text-neutral-400">
                    <span className="font-semibold">Date: </span>____ / ____ / ____
                  </p>
                </div>
                <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-dashed border-amber-500 text-center text-[6px] font-bold uppercase leading-tight text-amber-700 dark:text-amber-500">
                  Client<br />Stamp
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* empty state hint */}
        {!signature && !stamp && !disabled ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center text-neutral-400">
            <ImagePlus className="h-8 w-8 opacity-60" />
            <p className="text-xs font-medium">
              Upload a signature and a company stamp — they snap into the Approved
              By box automatically
            </p>
            <p className="text-[10px]">PNG with transparent background works best</p>
          </div>
        ) : null}
      </div>

      {/* ── controls ── */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <AssetSlot
            label="Signature"
            icon={<PenLine className="h-3.5 w-3.5" />}
            asset={signature}
            uploading={uploading === 'signature'}
            disabled={disabled}
            onPick={() => sigFileRef.current?.click()}
            onToggle={(v) => signature && patch('signature', { visible: v })}
            onRemove={() => onChange(assets.filter((a) => a.type !== 'signature'))}
          />
          <AssetSlot
            label="Stamp"
            icon={<Stamp className="h-3.5 w-3.5" />}
            asset={stamp}
            uploading={uploading === 'stamp'}
            disabled={disabled}
            onPick={() => stampFileRef.current?.click()}
            onToggle={(v) => stamp && patch('stamp', { visible: v })}
            onRemove={() => onChange(assets.filter((a) => a.type !== 'stamp'))}
          />
        </div>

        <input
          ref={sigFileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            safeUpload('signature', f)
          }}
        />
        <input
          ref={stampFileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            safeUpload('stamp', f)
          }}
        />

        <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-[11px] leading-relaxed text-muted-foreground">
          <BadgeCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          <span>
            <span className="font-medium text-foreground">No manual positioning needed.</span>{' '}
            The signature snaps onto its line and the stamp into the circle of the{' '}
            <span className="font-medium">Approved By</span> box — both boxes are pinned to
            the very bottom of the letter, exactly as previewed. The preview is exactly
            what prints.
          </span>
        </div>

        {disabled ? (
          <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
            <ScanEye className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Read-only — placement follows the saved artwork.
          </p>
        ) : null}
      </div>
    </div>
  )
}

function AssetSlot({
  label,
  icon,
  asset,
  uploading,
  disabled,
  onPick,
  onToggle,
  onRemove,
}: {
  label: string
  icon: React.ReactNode
  asset: QuotationAssetRow | null
  uploading: boolean
  disabled: boolean
  onPick: () => void
  onToggle: (v: boolean) => void
  onRemove: () => void
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-card p-2.5 transition-colors',
        asset && 'border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/20'
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px] font-semibold">
          {icon}
          {label}
        </span>
        {asset ? (
          <Switch
            checked={asset.visible}
            disabled={disabled}
            onCheckedChange={onToggle}
            aria-label={`Show ${label}`}
            className="scale-90"
          />
        ) : null}
      </div>
      <div className="flex h-14 items-center justify-center overflow-hidden rounded border border-dashed bg-background">
        {asset ? (
          <img
            src={asset.dataUrl}
            alt={`${label} thumbnail`}
            className={cn('max-h-full max-w-full object-contain', !asset.visible && 'opacity-30 saturate-0')}
          />
        ) : (
          <span className="text-[10px] text-muted-foreground">Not uploaded</span>
        )}
      </div>
      <div className="flex gap-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 flex-1 px-2 text-[11px]"
          disabled={disabled || uploading}
          onClick={(e) => {
            e.stopPropagation()
            onPick()
          }}
        >
          <ImagePlus className="mr-1 h-3 w-3" />
          {uploading ? 'Reading…' : asset ? 'Replace' : 'Upload'}
        </Button>
        {asset ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 w-7 shrink-0 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950"
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            aria-label={`Remove ${label}`}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}
