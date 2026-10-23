'use client'

// Settings › Payroll › Pay Slip Templates — choose the module's default pay
// slip print layout, preview each template, and edit the acknowledgment text
// printed by the Sidebar / Folder templates (Classic keeps its own
// hard-coded text). The default only decides which template the print
// dialogs START from — the choice is a PRINT OPTION ONLY (no database
// column, nothing saved per payroll): switching never changes any amount,
// hours, status or employee data, only the look of the printout.
//
// The preview renders an IN-MEMORY demo payroll (never saved, nothing
// written to the database) with the real letterhead artwork from Settings.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eye, LayoutTemplate, RotateCcw, Star } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useAppStore, can } from '@/lib/store'
import {
  PAYSLIP_TEMPLATES,
  PAYSLIP_ACK_PLACEHOLDERS,
  DEFAULT_PAYSLIP_ACK_TEXT,
  PAYSLIP_ACK_MAX_LENGTH,
  interpolatePayslipAck,
  resolvePayslipTemplate,
  type PayslipTemplateId,
} from '@/lib/payslip-print-templates'
import type { LetterheadConfig } from '@/lib/types'
import { SectionCard } from '@/components/app/shared/page-header'
import { PayslipTemplateDocument, type SlipPayroll } from '@/components/app/print/salary-slip'
import { DEFAULT_LETTERHEAD } from '@/components/app/print/payslip-print-shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'

/** Demo payroll used ONLY for template previews in this settings section —
 *  never saved, never sent to the API. Mirrors the reference sample data. */
const DEMO_PAYROLL: SlipPayroll = {
  id: 'settingspreview0001',
  month: 9,
  year: 2026,
  totalHours: 212,
  hourlyRateSnapshot: 70,
  overtimeHours: 11,
  overtimeRateSnapshot: 105,
  otherEarnings: 0,
  advance: 500,
  absentPenalty: 0,
  ptAmount: 0,
  unionFees: 0,
  otherDeductionValue: 200,
  otherDeductionType: 'fixed',
  clientRate: 0,
  clientOtRate: 0,
  grossPay: 15995,
  totalDeductions: 700,
  netPay: 15295,
  status: 'pending',
  payDate: null,
  payType: 'bank_transfer',
  taxCode: 'N/A',
  staff: {
    id: 'demo-staff',
    fullName: 'Abdul Kareem',
    iqamaId: '2471889915',
    staffCategory: { id: 'demo-cat', name: 'PIPING QCI' },
  },
  project: {
    id: 'demo-project',
    name: 'SABIC Gas Plant Piping Works',
    clientId: null,
    clientName: 'Al Waha Engineering Group',
  },
}

export function PayslipTemplatesSettingsSection() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const user = useAppStore((s) => s.user)
  const canEdit = can(user, 'settings.edit')

  const [current, setCurrent] = useState<PayslipTemplateId>(() =>
    resolvePayslipTemplate(settings.payrollPayslipDefaultTemplate)
  )
  const [saving, setSaving] = useState(false)

  // acknowledgment text editor (printed by the Sidebar / Folder templates)
  const [ack, setAck] = useState(settings.payrollAcknowledgmentText || DEFAULT_PAYSLIP_ACK_TEXT)
  const [ackPristine, setAckPristine] = useState(true)
  const [ackSaving, setAckSaving] = useState(false)

  // preview dialog state
  const [preview, setPreview] = useState<PayslipTemplateId | null>(null)
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)

  // fresh settings on mount (another tab may have changed them)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get<{
          settings: { payrollPayslipDefaultTemplate: string; payrollAcknowledgmentText: string }
        }>('/api/settings')
        if (cancelled) return
        setCurrent(resolvePayslipTemplate(res.settings.payrollPayslipDefaultTemplate))
        if (ackPristine) {
          setAck(res.settings.payrollAcknowledgmentText || DEFAULT_PAYSLIP_ACK_TEXT)
        }
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

  async function setDefault(id: PayslipTemplateId) {
    if (saving || !canEdit) return
    if (id === current) return
    setSaving(true)
    try {
      await api.put('/api/settings', { payrollPayslipDefaultTemplate: id })
      setCurrent(id)
      // keep the whole app in sync (the print dialogs read this default)
      setSettings({ ...settings, payrollPayslipDefaultTemplate: id })
      toast.success(`Default pay slip template: ${PAYSLIP_TEMPLATES.find((t) => t.id === id)?.label}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the default template')
    } finally {
      setSaving(false)
    }
  }

  async function saveAck() {
    if (ackSaving || !canEdit) return
    setAckSaving(true)
    try {
      const res = await api.put<{ settings: { payrollAcknowledgmentText: string } }>(
        '/api/settings',
        { payrollAcknowledgmentText: ack }
      )
      setAckPristine(true)
      setAck(res.settings.payrollAcknowledgmentText)
      setSettings({ ...settings, payrollAcknowledgmentText: res.settings.payrollAcknowledgmentText })
      toast.success('Pay slip acknowledgment text saved.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the acknowledgment text')
    } finally {
      setAckSaving(false)
    }
  }

  const ackPreview = interpolatePayslipAck(ack, {
    netPay: '15,295.00',
    period: 'September 2026',
    method: 'Bank Transfer',
    project: 'SABIC Gas Plant Piping Works',
    client: 'Al Waha Engineering Group',
  })

  return (
    <SectionCard className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
            Payroll — Pay Slip Templates
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The default print layout for salary pay slips — the single-slip and bulk print dialogs
            start from it. The template is a print option only: changing it never changes any
            amount, hours, status or employee data, only the look of the printout.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {PAYSLIP_TEMPLATES.map((t) => {
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

      {/* Acknowledgment text — printed by the Sidebar / Folder templates */}
      <div className="mt-6 rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold">Pay slip acknowledgment text</h4>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Printed by the Sidebar and Folder templates (Classic keeps its own text). Available
              placeholders:{' '}
              {PAYSLIP_ACK_PLACEHOLDERS.map((ph) => (
                <code key={ph} className="mx-0.5 rounded bg-muted px-1 py-0.5 text-[10px]">
                  {ph}
                </code>
              ))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!canEdit || ackSaving || (ack === DEFAULT_PAYSLIP_ACK_TEXT && ackPristine)}
              onClick={() => {
                setAck(DEFAULT_PAYSLIP_ACK_TEXT)
                setAckPristine(false)
              }}
            >
              <RotateCcw className="h-4 w-4" />
              Reset to default
            </Button>
            <Button
              size="sm"
              disabled={!canEdit || ackSaving || (ackPristine && ack === settings.payrollAcknowledgmentText)}
              onClick={() => void saveAck()}
            >
              {ackSaving ? 'Saving…' : 'Save text'}
            </Button>
          </div>
        </div>
        <Textarea
          value={ack}
          onChange={(e) => {
            setAck(e.target.value.slice(0, PAYSLIP_ACK_MAX_LENGTH))
            setAckPristine(false)
          }}
          disabled={!canEdit}
          rows={3}
          className="mt-3 text-sm"
          aria-label="Pay slip acknowledgment text"
        />
        <p className="mt-1 text-right text-[10px] text-muted-foreground">
          {ack.length} / {PAYSLIP_ACK_MAX_LENGTH}
        </p>
        <div className="mt-2 rounded-md bg-muted/50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Preview (demo values)
          </p>
          <p className="mt-1 text-xs leading-relaxed">{ackPreview}</p>
        </div>
      </div>

      {/* template preview — in-memory demo data (never saved), real
          letterhead artwork from Settings */}
      <Dialog open={preview !== null} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]"
        >
          <DialogTitle className="sr-only">Pay slip template preview</DialogTitle>
          <DialogDescription className="sr-only">
            Preview of the pay slip print template with in-memory demo data.
          </DialogDescription>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <p className="text-sm font-semibold">
              {PAYSLIP_TEMPLATES.find((t) => t.id === preview)?.label} — preview
            </p>
            <div className="flex items-center gap-2">
              <p className="hidden text-xs text-muted-foreground sm:block">
                Demo data — your pay slips print real data
              </p>
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                Close
              </Button>
            </div>
          </div>
          <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900">
            {preview ? (
              <div className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
                <PayslipTemplateDocument
                  template={preview}
                  payroll={DEMO_PAYROLL}
                  settings={settings}
                  preparedBy={user?.name ?? ''}
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
