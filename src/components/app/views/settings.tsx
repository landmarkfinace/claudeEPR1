'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  Building2,
  DatabaseBackup,
  Globe2,
  ImagePlus,
  Loader2,
  RotateCcw,
  Save,
  ShieldCheck,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, getAuthToken } from '@/lib/api-client'
import { useAppStore, can } from '@/lib/store'
import { PAY_TYPE_LABELS, type AppSettings, type PayType } from '@/lib/types'
import { cn } from '@/lib/utils'
import { PageHeader, SectionCard } from '@/components/app/shared/page-header'
import {
  EInvoiceSettingsSection,
  GlossarySettingsSection,
} from '@/components/app/settings/e-invoice-settings'
import { EInvoiceTemplatesSettingsSection } from '@/components/app/settings/e-invoice-templates-settings'
import { AiSettingsSection } from '@/components/app/settings/ai-settings'
import { ZatcaSettingsPanel } from '@/components/app/settings/zatca-settings'
import { NameListSettingsSection } from '@/components/app/settings/namelist-settings'
import { AgreementTemplatesSettingsSection } from '@/components/app/settings/agreement-templates-settings'
import { SignatoriesSettingsSection } from '@/components/app/settings/signatories-settings'
import { QuotationTermsSettingsSection } from '@/components/app/settings/quotation-terms-settings'
import { QuotationTemplatesSettingsSection } from '@/components/app/settings/quotation-templates-settings'
import { PrayerTimesSettingsSection } from '@/components/app/settings/prayer-times-settings'
import { EILetterheadSettingsSection } from '@/components/app/settings/ei-letterhead-settings'
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
  const signatureInputRef = useRef<HTMLInputElement>(null)
  const stampInputRef = useRef<HTMLInputElement>(null)

  /** Download the full-system JSON backup (admin-only endpoint). */
  async function handleBackup() {
    if (backingUp) return
    setBackingUp(true)
    try {
      const res = await fetch('/api/backup', {
        credentials: 'same-origin',
        // Bearer fallback for iframe contexts where cookies are blocked
        headers: getAuthToken() ? { Authorization: `Bearer ${getAuthToken()}` } : undefined,
      })
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

  /** Shared handler for the agreement signature / stamp uploads (512 px). */
  async function handleAgreementImageSelected(
    file: File | undefined,
    key: 'companySignature' | 'companyStamp',
    inputRef: RefObject<HTMLInputElement | null>
  ) {
    if (!file) return
    try {
      setUploading(true)
      const dataUrl = await fileToDataUrl(file, 512)
      setField(key, dataUrl)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not process the image')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
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
        companyNameAr: form.companyNameAr.trim(),
        address: form.address,
        addressAr: form.addressAr.trim(),
        phone: form.phone,
        fax: form.fax,
        email: form.email,
        logo: form.logo,
        currency: form.currency.trim() || 'SAR',
        defaultPayType: form.defaultPayType,
        authorizedSignatory: form.authorizedSignatory.trim(),
        authorizedSignatoryAr: form.authorizedSignatoryAr.trim(),
        signatoryTitle: form.signatoryTitle.trim(),
        signatoryTitleAr: form.signatoryTitleAr.trim(),
        companySignature: form.companySignature,
        companyStamp: form.companyStamp,
        vatNumber: form.vatNumber.trim(),
        crNumber: form.crNumber.trim(),
        bankName: form.bankName.trim(),
        bankIban: form.bankIban.trim(),
        bankAccountNumber: form.bankAccountNumber.trim(),
        vatRate: Number.isFinite(Number(form.vatRate)) ? Number(form.vatRate) : 15,
        bankAccountName: form.bankAccountName.trim(),
        bankSwiftCode: form.bankSwiftCode.trim(),
        bankAddress: form.bankAddress.trim(),
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
              <Label htmlFor="company-name-ar">
                Company Name — <span lang="ar" dir="rtl">الاسم بالعربية</span>
              </Label>
              <Input
                id="company-name-ar"
                lang="ar"
                dir="rtl"
                value={form.companyNameAr}
                onChange={(e) => setField('companyNameAr', e.target.value)}
                placeholder="لاندمارك انتر جلف"
                disabled={!canEdit}
              />
              <p className="text-xs text-muted-foreground">
                Printed bilingually on ZATCA-style tax invoices and agreements.
              </p>
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

            <div className="space-y-2">
              <Label htmlFor="company-address-ar">
                Address — <span lang="ar" dir="rtl">العنوان بالعربية</span>
              </Label>
              <Textarea
                id="company-address-ar"
                lang="ar"
                dir="rtl"
                value={form.addressAr}
                onChange={(e) => setField('addressAr', e.target.value)}
                placeholder="الجبيل، المملكة العربية السعودية"
                rows={2}
                disabled={!canEdit}
              />
            </div>

            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
                <Label htmlFor="company-fax">Fax</Label>
                <Input
                  id="company-fax"
                  value={form.fax}
                  onChange={(e) => setField('fax', e.target.value)}
                  placeholder="+966 11 000 0001"
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Printed in the agreement party blocks (Tel / Fax line).
                </p>
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
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="signatory-name-ar">
                  Signatory Name — <span lang="ar" dir="rtl">الاسم بالعربية</span>
                </Label>
                <Input
                  id="signatory-name-ar"
                  lang="ar"
                  dir="rtl"
                  value={form.authorizedSignatoryAr}
                  onChange={(e) => setField('authorizedSignatoryAr', e.target.value)}
                  placeholder="قاضي نظمول قاضي كمال"
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signatory-title-ar">
                  Signatory Title — <span lang="ar" dir="rtl">المنصب بالعربية</span>
                </Label>
                <Input
                  id="signatory-title-ar"
                  lang="ar"
                  dir="rtl"
                  value={form.signatoryTitleAr}
                  onChange={(e) => setField('signatoryTitleAr', e.target.value)}
                  placeholder="الرئيس التنفيذي"
                  disabled={!canEdit}
                />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              Printed on every salary slip in the “Approved By” signature block and auto-fills our
              company party in the bilingual Agreements module.
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

            {/* ---- Agreement print assets: signature + stamp ---- */}
            <div className="space-y-2">
              <Label>Company Signature &amp; Stamp</Label>
              <p className="-mt-1 text-xs text-muted-foreground">
                Optional. Auto-fills OUR party in the bilingual Agreements module — printed in the
                signature block (max 45&nbsp;mm wide). Images are resized to 512 px.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    {
                      key: 'companySignature' as const,
                      label: 'Signature image',
                      alt: 'Company signature',
                      empty: 'No signature uploaded — a blank line is printed',
                      inputRef: signatureInputRef,
                    },
                    {
                      key: 'companyStamp' as const,
                      label: 'Company stamp',
                      alt: 'Company stamp',
                      empty: 'No stamp uploaded — a dashed stamp box is printed',
                      inputRef: stampInputRef,
                    },
                  ] as const
                ).map((slot) => (
                  <div
                    key={slot.key}
                    className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/20 p-3"
                  >
                    {form[slot.key] ? (
                      <img
                        src={form[slot.key]}
                        alt={slot.alt}
                        className="h-14 w-32 rounded border bg-white object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-14 w-32 items-center justify-center rounded border border-dashed text-center text-[10px] leading-tight text-muted-foreground">
                        {slot.empty}
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <input
                        ref={slot.inputRef}
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) =>
                          void handleAgreementImageSelected(e.target.files?.[0], slot.key, slot.inputRef)
                        }
                        aria-label={`Upload ${slot.label}`}
                        disabled={!canEdit || uploading}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => slot.inputRef.current?.click()}
                        disabled={!canEdit || uploading}
                      >
                        {uploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ImagePlus className="h-4 w-4" />
                        )}
                        Upload
                      </Button>
                      {form[slot.key] ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setField(slot.key, '')}
                          disabled={!canEdit}
                        >
                          <X className="h-4 w-4" />
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
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

        {/* ---- Company Letterhead — E-Invoice (header / footer / watermark) ---- */}
        <EILetterheadSettingsSection canEdit={canEdit} />

        {/* ---- ZATCA e-Invoicing & Connection ---- */}
        <SectionCard className="p-6">
          <h2 className="text-base font-semibold">ZATCA e-Invoicing &amp; Connection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Company identity printed on every tax invoice and in the ZATCA QR, the company ZATCA phase,
            and the Phase 2 connection to ZATCA (Fatoora). VAT and CR numbers are saved with the main
            Save button; the ZATCA panel below has its own Save button.
          </p>
          <div className="mt-6 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vat-number">VAT Registration Number</Label>
                <Input
                  id="vat-number"
                  inputMode="numeric"
                  value={form.vatNumber}
                  onChange={(e) => setField('vatNumber', e.target.value)}
                  placeholder="3XXXXXXXXXXXXX3"
                  className="font-mono"
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  15 digits — appears in QR tag 2 and on every tax invoice.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cr-number">Commercial Registration (CR) No.</Label>
                <Input
                  id="cr-number"
                  inputMode="numeric"
                  value={form.crNumber}
                  onChange={(e) => setField('crNumber', e.target.value)}
                  placeholder="e.g. 2050xxxxxxx"
                  className="font-mono"
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Included in the UBL XML seller identification.
                </p>
              </div>
            </div>
            <ZatcaSettingsPanel canEdit={canEdit} />
          </div>
        </SectionCard>

        {/* ---- Bank details ---- */}
        <SectionCard className="p-6">
          <h2 className="text-base font-semibold">Bank Details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Printed in the Bank Account Details box of every invoice. Individual
            invoices can override these per invoice.
          </p>
          <div className="mt-6 space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bank-name">Bank Name</Label>
                <Input
                  id="bank-name"
                  value={form.bankName}
                  onChange={(e) => setField('bankName', e.target.value)}
                  placeholder="e.g. Saudi National Bank"
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-account-name">Account Name</Label>
                <Input
                  id="bank-account-name"
                  value={form.bankAccountName}
                  onChange={(e) => setField('bankAccountName', e.target.value)}
                  placeholder="e.g. Landmark Inter Gulf Co."
                  disabled={!canEdit}
                />
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bank-iban">IBAN</Label>
                <Input
                  id="bank-iban"
                  value={form.bankIban}
                  onChange={(e) => setField('bankIban', e.target.value)}
                  placeholder="SA00 0000 0000 0000 0000 0000"
                  className="font-mono"
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-account">Account Number</Label>
                <Input
                  id="bank-account"
                  value={form.bankAccountNumber}
                  onChange={(e) => setField('bankAccountNumber', e.target.value)}
                  placeholder="00000000000000"
                  className="font-mono"
                  disabled={!canEdit}
                />
              </div>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bank-swift">Swift Code</Label>
                <Input
                  id="bank-swift"
                  value={form.bankSwiftCode}
                  onChange={(e) => setField('bankSwiftCode', e.target.value)}
                  placeholder="e.g. NCBKSAJE"
                  className="font-mono"
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bank-address">Bank Address</Label>
                <Input
                  id="bank-address"
                  value={form.bankAddress}
                  onChange={(e) => setField('bankAddress', e.target.value)}
                  placeholder="e.g. Jubail Industrial City, KSA"
                  disabled={!canEdit}
                />
              </div>
            </div>
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

        {/* ---- People who approve documents (quotation APPROVED BY box) ---- */}
        <SignatoriesSettingsSection canEdit={canEdit} />

        {/* ---- Quotation default Terms & Conditions ---- */}
        <QuotationTermsSettingsSection canEdit={canEdit} />

        {/* ---- Quotation print templates (default layout) ---- */}
        <QuotationTemplatesSettingsSection canEdit={canEdit} />

        {/* ---- E-Invoice print template + translation provider ---- */}
        <EInvoiceSettingsSection />

        {/* ---- E-Invoice print templates (default layout) ---- */}
        <EInvoiceTemplatesSettingsSection canEdit={canEdit} />

        {/* ---- AI Assistant provider + usage + logs ---- */}
        <AiSettingsSection />

        {/* ---- Name List subjects ---- */}
        <NameListSettingsSection />

        {/* ---- Agreement print templates (default layout) ---- */}
        <AgreementTemplatesSettingsSection />

        {/* ---- Prayer times (dashboard widget) ---- */}
        <PrayerTimesSettingsSection canEdit={canEdit} />

        {/* ---- EN→AR translation glossary ---- */}
        <GlossarySettingsSection />

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
