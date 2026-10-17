'use client'

import { useRef, useState } from 'react'
import { Building2, DatabaseBackup, ImagePlus, Loader2, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { useAppStore, can } from '@/lib/store'
import { PAY_TYPE_LABELS, type AppSettings, type PayType } from '@/lib/types'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

/**
 * Read an image file, downscale it (keeping aspect ratio) so its longest edge
 * is at most `maxSize` px, and return the result as a data URL.
 * PNG files stay PNG; everything else is re-encoded as JPEG (quality 0.85).
 */
export function fileToDataUrl(file: File, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please select an image file'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the selected file'))
    reader.onload = () => {
      const img = new window.Image()
      img.onerror = () => reject(new Error('Could not load the selected image'))
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas is not supported in this browser'))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        const isPng = file.type === 'image/png'
        resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

export function SettingsView() {
  const { user, settings, setSettings } = useAppStore()
  const canEdit = can(user, 'settings.edit')

  const [form, setForm] = useState<AppSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  /** Download the full-system JSON backup (admin-only endpoint). */
  async function handleBackup() {
    if (backingUp) return
    setBackingUp(true)
    try {
      const res = await fetch('/api/backup', { credentials: 'same-origin' })
      if (!res.ok) {
        let message = 'Backup failed'
        try {
          const body = (await res.json()) as { error?: string }
          if (body.error) message = body.error
        } catch {
          // keep default
        }
        throw new Error(message)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `lig-backup-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Backup downloaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Backup failed')
    } finally {
      setBackingUp(false)
    }
  }

  function setField<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (key === 'companyName') setNameError(null)
  }

  async function handleLogoSelected(file: File | undefined) {
    if (!file) return
    try {
      setUploading(true)
      const dataUrl = await fileToDataUrl(file, 256)
      setField('logo', dataUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not process the image')
    } finally {
      setUploading(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  async function handleSave() {
    const companyName = form.companyName.trim()
    if (!companyName) {
      setNameError('Company name is required')
      return
    }
    try {
      setSaving(true)
      const res = await api.put<{ settings: AppSettings }>('/api/settings', {
        companyName,
        address: form.address,
        phone: form.phone,
        email: form.email,
        logo: form.logo,
        currency: form.currency.trim() || 'SAR',
        defaultPayType: form.defaultPayType,
        authorizedSignatory: form.authorizedSignatory.trim(),
        signatoryTitle: form.signatoryTitle.trim(),
        vatRate: Number.isFinite(Number(form.vatRate)) ? Number(form.vatRate) : 15,
      })
      setSettings(res.settings)
      setForm(res.settings)
      toast.success('Settings saved')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Company profile, branding and system defaults."
      />

      <div className="max-w-2xl space-y-6">
        <SectionCard className="p-6">
          <h2 className="text-base font-semibold">Company Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These details appear across the system, on printed salary sheets and on the login screen.
          </p>

          <div className="mt-6 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="company-name">Company Name</Label>
              <Input
                id="company-name"
                value={form.companyName}
                onChange={(e) => setField('companyName', e.target.value)}
                placeholder="Landmark Inter Gulf"
                aria-invalid={!!nameError}
                disabled={!canEdit}
              />
              {nameError ? (
                <p className="text-xs text-destructive">{nameError}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="company-address">Address</Label>
              <Textarea
                id="company-address"
                value={form.address}
                onChange={(e) => setField('address', e.target.value)}
                placeholder="Riyadh, Kingdom of Saudi Arabia"
                rows={2}
                disabled={!canEdit}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company-phone">Phone</Label>
                <Input
                  id="company-phone"
                  value={form.phone}
                  onChange={(e) => setField('phone', e.target.value)}
                  placeholder="+966 11 000 0000"
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-email">Email</Label>
                <Input
                  id="company-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setField('email', e.target.value)}
                  placeholder="info@company.com"
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company-currency">Currency</Label>
                <Input
                  id="company-currency"
                  value={form.currency}
                  onChange={(e) => setField('currency', e.target.value)}
                  placeholder="SAR"
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Display currency for money formatting
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="default-pay-type">Default Pay Type</Label>
                <Select
                  value={form.defaultPayType}
                  onValueChange={(v) => setField('defaultPayType', v as PayType)}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="default-pay-type" className="w-full">
                    <SelectValue placeholder="Select pay type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAY_TYPE_LABELS) as PayType[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {PAY_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Pre-selected for new payroll entries
                </p>
              </div>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="signatory-name">Authorized Signatory — Name</Label>
                <Input
                  id="signatory-name"
                  value={form.authorizedSignatory}
                  onChange={(e) => setField('authorizedSignatory', e.target.value)}
                  placeholder="e.g. Faisal Al-Otaibi"
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signatory-title">Authorized Signatory — Title</Label>
                <Input
                  id="signatory-title"
                  value={form.signatoryTitle}
                  onChange={(e) => setField('signatoryTitle', e.target.value)}
                  placeholder="e.g. Finance Manager"
                  disabled={!canEdit}
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              Printed on every salary slip in the “Approved By” signature block.
            </p>

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vat-rate">VAT Rate (%)</Label>
                <Input
                  id="vat-rate"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.5"
                  value={form.vatRate}
                  onChange={(e) => setField('vatRate', Number(e.target.value) as AppSettings['vatRate'])}
                  placeholder="15"
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Applied in VAT Return Expense — bills are split as Without VAT = With VAT ÷ (1 + rate).
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Company Logo</Label>
              <div className="flex flex-wrap items-center gap-4">
                <div className="relative">
                  <img
                    src={form.logo ?? '/logo-mark.png'}
                    alt="Company logo"
                    className="h-16 w-16 rounded-lg border bg-white object-contain p-1"
                  />
                  {(!form.logo || form.logo === '/logo-mark.png') ? (
                    <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border bg-gold-soft px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-accent-foreground">
                      Default
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => void handleLogoSelected(e.target.files?.[0])}
                    aria-label="Upload company logo"
                    disabled={!canEdit || uploading}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={!canEdit || uploading}
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ImagePlus className="h-4 w-4" />
                    )}
                    Upload Logo
                  </Button>
                  {form.logo && form.logo !== '/logo-mark.png' ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setField('logo', null)}
                      disabled={!canEdit}
                    >
                      <RotateCcw className="h-4 w-4" />
                      Reset to Default
                    </Button>
                  ) : null}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Shown in the sidebar and on printed documents. Images are resized to 256 px.
                Removing a custom logo restores the Landmark Inter Gulf brand mark.
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end border-t pt-4">
            {canEdit ? (
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Changes
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* span wrapper so the tooltip works on the disabled button */}
                  <span tabIndex={0} aria-disabled="true">
                    <Button disabled tabIndex={-1}>
                      <Save className="h-4 w-4" />
                      Save Changes
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>You do not have permission to edit settings</TooltipContent>
              </Tooltip>
            )}
          </div>
        </SectionCard>

        <SectionCard className="p-6">
          <h2 className="text-base font-semibold">Data &amp; Backup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Export every module — staff, projects, attendance, payroll, transactions and the audit
            trail — as a single JSON file. Passwords and sessions are never included.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {canEdit ? (
              <Button variant="outline" onClick={() => void handleBackup()} disabled={backingUp}>
                {backingUp ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <DatabaseBackup className="h-4 w-4" />
                )}
                Download Backup
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} aria-disabled="true">
                    <Button variant="outline" disabled tabIndex={-1}>
                      <DatabaseBackup className="h-4 w-4" />
                      Download Backup
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>You do not have permission to export data</TooltipContent>
              </Tooltip>
            )}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Runs locally — nothing leaves this server
            </span>
          </div>
        </SectionCard>

        <SectionCard className="p-6">
          <h2 className="text-base font-semibold">About</h2>
          <div className="mt-3 space-y-1.5 text-sm">
            <p className="font-medium">{settings.companyName} — Workforce, Payroll &amp; Accounts</p>
            <p className="text-muted-foreground">Version 1.0.0</p>
            <p className="text-muted-foreground">
              Built with Next.js 16, TypeScript, Prisma ORM, Tailwind CSS and shadcn/ui.
            </p>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
