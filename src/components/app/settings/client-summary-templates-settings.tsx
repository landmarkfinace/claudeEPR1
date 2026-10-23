'use client'

// Settings › Client Salary Summary › Print Templates — choose the module's
// default summary print layout and preview each template. The default only
// decides which template the print dialog STARTS from — the choice is a
// PRINT OPTION ONLY (no database column, nothing saved per summary):
// switching never changes any hours, rate, OT rate, amount, subtotal, VAT or
// grand total, only the look of the printout.
//
// The previews render IN-MEMORY demo groups (never saved, nothing written to
// the database) with the real letterhead artwork from Settings:
//   • Demo "no distinct OT rates" — every worker's OT rate equals their
//     normal rate → no OT columns; every row Total Hours × Rate = Amount
//   • Demo "2 projects · 30 workers" — grouped by project then category,
//     spans 2+ pages with the summaries and approval on the last page, and
//     includes workers whose OT rates differ → the OT columns appear
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eye, FileDown, LayoutTemplate, Printer, Star } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useAppStore, can } from '@/lib/store'
import { round2 } from '@/lib/format'
import {
  CLIENT_SUMMARY_TEMPLATES,
  resolveClientSummaryTemplate,
  type ClientSummaryTemplateId,
} from '@/lib/client-summary-print-templates'
import type { ClientBillingLine, ClientSalaryGroup, LetterheadConfig } from '@/lib/types'
import { SectionCard } from '@/components/app/shared/page-header'
import {
  ClientSummaryTemplateDocument,
} from '@/components/app/print/client-summary-print'
import { DEFAULT_LETTERHEAD, hasDistinctOtRates } from '@/components/app/print/client-summary-print-shared'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { downloadPrintAreaAsPdf, printPrintArea } from '@/lib/print-to-pdf'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// ── In-memory demo data (never saved, never sent to the API) ─────────────────

type DemoSpec = {
  name: string
  iqama: string
  position: string
  projectId: string
  projectName: string
  reg: number
  ot: number
  rate: number
  otRate: number
}

/** Build one billing line — the demo's own "server": amount is computed HERE
 *  (exactly like the real API does) and the templates print it as stored. */
function demoLine(spec: DemoSpec, i: number): ClientBillingLine {
  return {
    payrollId: `demo-${i}`,
    source: 'payroll',
    projectId: spec.projectId,
    projectName: spec.projectName,
    staffId: `demo-staff-${i}`,
    fullName: spec.name,
    iqamaId: spec.iqama,
    position: spec.position,
    categoryName: null,
    hours: spec.reg,
    otHours: spec.ot,
    clientRate: spec.rate,
    clientOtRate: spec.otRate,
    manualRate: spec.rate,
    manualOtRate: spec.otRate > spec.rate ? spec.otRate : 0,
    projectRate: 0,
    rateSource: 'manual',
    amount: round2(spec.reg * spec.rate + spec.ot * spec.otRate),
    workerRate: 0,
    workerCost: 0,
    monthlySalary: 0,
    status: 'active',
  }
}

function buildDemoGroup(
  client: {
    id: string
    name: string
    city: string
    contactPerson: string
    phone: string
    email: string
    crNumber: string
    address: string
  },
  specs: DemoSpec[],
  projectCount: number
): ClientSalaryGroup {
  const rows = specs.map(demoLine)
  const hours = round2(rows.reduce((s, r) => s + r.hours, 0))
  const otHours = round2(rows.reduce((s, r) => s + r.otHours, 0))
  const billedAmount = round2(rows.reduce((s, r) => s + r.amount, 0))
  const vatAmount = round2(billedAmount * 0.15)
  return {
    clientId: client.id,
    clientName: client.name,
    city: client.city,
    contactPerson: client.contactPerson,
    phone: client.phone,
    email: client.email,
    crNumber: client.crNumber,
    address: client.address,
    clientStatus: 'active',
    projectCount,
    workerCount: new Set(rows.map((r) => r.staffId)).size,
    workersWithHours: new Set(rows.filter((r) => r.hours > 0 || r.otHours > 0).map((r) => r.staffId)).size,
    rows,
    hours,
    otHours,
    billedAmount,
    vatAmount,
    grandTotal: round2(billedAmount + vatAmount),
    workerCost: 0,
    margin: billedAmount,
    totalMonthlySalary: 0,
    avgMonthlySalary: 0,
    share: 100,
  }
}

/** Demo A — a client where every OT rate equals the normal rate: no OT
 *  columns appear and every row satisfies Total Hours × Rate = Amount. */
const DEMO_NO_OT = buildDemoGroup(
  {
    id: 'demo-client-jts',
    name: 'Jubail Technical Services Co.',
    city: 'Al Jubail',
    contactPerson: 'Faisal Al-Otaibi',
    phone: '+966 13 341 8890',
    email: 'faisal@jubailtech.com.sa',
    crNumber: '2050177743',
    address: 'King Saud Street, Al Jubail Industrial City',
  },
  [
    { name: 'Ahmed Saleh', iqama: '2471889971', position: 'Helper', projectId: 'p1', projectName: 'Jubail Refinery Maintenance Contract', reg: 200, ot: 12, rate: 25, otRate: 25 },
    { name: 'Imran Sheikh', iqama: '2471889972', position: 'Pipe Fitter', projectId: 'p1', projectName: 'Jubail Refinery Maintenance Contract', reg: 195, ot: 0, rate: 40, otRate: 40 },
    { name: 'Suresh Kumar', iqama: '2471889973', position: 'Welder 6G', projectId: 'p1', projectName: 'Jubail Refinery Maintenance Contract', reg: 210, ot: 8, rate: 60, otRate: 60 },
    { name: 'Karim Bux', iqama: '2471889974', position: 'Rigger', projectId: 'p1', projectName: 'Jubail Refinery Maintenance Contract', reg: 188, ot: 0, rate: 28, otRate: 28 },
    { name: 'Anil Verma', iqama: '2471889975', position: 'Foreman', projectId: 'p1', projectName: 'Jubail Refinery Maintenance Contract', reg: 205, ot: 10, rate: 55, otRate: 55 },
  ],
  1
)

/** Demo B — 2 projects · 30 workers: grouped by project then category,
 *  continues to page 2+, summaries + approval on the last page; 5 workers
 *  bill OT at 1.5× their normal rate → the OT columns appear. */
const DEMO_TWO_PROJECTS = buildDemoGroup(
  {
    id: 'demo-client-epis',
    name: 'Eastern Province Industrial Services',
    city: 'Dammam',
    contactPerson: 'Nasser Al-Dosari',
    phone: '+966 13 812 4460',
    email: 'nasser.dosari@epis.com.sa',
    crNumber: '2050188364',
    address: '1st Industrial Street, 2nd Industrial City',
  },
  [
    // ── Project 1 · Aramco Rig Upgrade — Phase 3 (18 workers) ──
    { name: 'Mohsin Raza', iqama: '2471889933', position: 'Helper', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 179, ot: 3, rate: 30, otRate: 45 },
    { name: 'Tapas Roy', iqama: '2471889937', position: 'Helper', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 185, ot: 28, rate: 18, otRate: 18 },
    { name: 'Rafiq Islam', iqama: '2471889951', position: 'Helper', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 190, ot: 0, rate: 25, otRate: 25 },
    { name: 'Mohammed Ashraf', iqama: '2471889919', position: 'Pipe Fitter', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 195, ot: 1, rate: 30, otRate: 45 },
    { name: 'Ravi Prasad', iqama: '2471889922', position: 'Pipe Fitter', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 198, ot: 4, rate: 49, otRate: 49 },
    { name: 'Deepak Yadav', iqama: '2471889952', position: 'Pipe Fitter', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 192, ot: 6, rate: 42, otRate: 42 },
    { name: 'Nasir Mehmood', iqama: '2471889924', position: 'Welder 6G', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 196, ot: 27, rate: 62, otRate: 62 },
    { name: 'Ramesh Chandra', iqama: '2471889927', position: 'Welder 6G', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 209, ot: 21, rate: 62, otRate: 62 },
    { name: 'Zahir Abbas', iqama: '2471889953', position: 'Welder 6G', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 200, ot: 10, rate: 65, otRate: 97.5 },
    { name: 'Iqbal Hussain', iqama: '2471889954', position: 'Welder 6G', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 188, ot: 0, rate: 60, otRate: 60 },
    { name: 'Babar Hussain', iqama: '2471889930', position: 'Rigger', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 186, ot: 8, rate: 30, otRate: 45 },
    { name: 'Salim Khan', iqama: '2471889955', position: 'Rigger', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 195, ot: 5, rate: 32, otRate: 32 },
    { name: 'Rajesh Nair', iqama: '2471889917', position: 'QC Supervisor', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 223, ot: 8, rate: 85, otRate: 85 },
    { name: 'Rustam Ali', iqama: '2471889928', position: 'QC Supervisor', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 176, ot: 24, rate: 92, otRate: 92 },
    { name: 'Hassan Rizvi', iqama: '2471889943', position: 'Site Coordinator', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 184, ot: 21, rate: 30, otRate: 45 },
    { name: 'Ghulam Nabi', iqama: '2471889956', position: 'Foreman', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 205, ot: 0, rate: 55, otRate: 55 },
    { name: 'Aslam Pervez', iqama: '2471889957', position: 'Electrician', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 198, ot: 12, rate: 45, otRate: 45 },
    { name: 'Munir Ahmed', iqama: '2471889958', position: 'Electrician', projectId: 'p1', projectName: 'Aramco Rig Upgrade — Phase 3', reg: 210, ot: 0, rate: 45, otRate: 45 },
    // ── Project 2 · Aramco Rig Upgrade — Phase 4 (12 workers) ──
    { name: 'Nadeem Akhtar', iqama: '2471889959', position: 'Helper', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 190, ot: 0, rate: 26, otRate: 26 },
    { name: 'Faisal Mahmood', iqama: '2471889960', position: 'Helper', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 185, ot: 9, rate: 26, otRate: 26 },
    { name: 'Rubel Mia', iqama: '2471889961', position: 'Helper', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 192, ot: 0, rate: 28, otRate: 28 },
    { name: 'Jahangir Alam', iqama: '2471889962', position: 'Helper', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 188, ot: 4, rate: 30, otRate: 45 },
    { name: 'Sanjay Patel', iqama: '2471889963', position: 'Pipe Fitter', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 200, ot: 8, rate: 44, otRate: 44 },
    { name: 'Vikram Singh', iqama: '2471889964', position: 'Pipe Fitter', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 195, ot: 0, rate: 48, otRate: 48 },
    { name: 'Mahesh Chandra', iqama: '2471889965', position: 'Pipe Fitter', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 205, ot: 12, rate: 46, otRate: 46 },
    { name: 'Arif Chowdhury', iqama: '2471889966', position: 'Welder 6G', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 198, ot: 15, rate: 62, otRate: 93 },
    { name: 'Shahid Malik', iqama: '2471889967', position: 'Welder 6G', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 210, ot: 0, rate: 62, otRate: 62 },
    { name: 'Tanveer Baig', iqama: '2471889968', position: 'Welder 6G', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 190, ot: 6, rate: 63, otRate: 63 },
    { name: 'Muhammad Rafiq', iqama: '2471889914', position: 'Sr. QC Inspector', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 200, ot: 0, rate: 75, otRate: 75 },
    { name: 'Noor Alam', iqama: '2471889969', position: 'Safety Officer', projectId: 'p2', projectName: 'Aramco Rig Upgrade — Phase 4', reg: 195, ot: 5, rate: 42, otRate: 42 },
  ],
  2
)

type DemoId = 'no-ot' | 'two-projects'
const DEMOS: { id: DemoId; label: string; group: ClientSalaryGroup; month: number; year: number }[] = [
  { id: 'no-ot', label: 'No distinct OT rates · 5 workers', group: DEMO_NO_OT, month: 9, year: 2026 },
  { id: 'two-projects', label: '2 projects · 30 workers · OT', group: DEMO_TWO_PROJECTS, month: 9, year: 2026 },
]

export function ClientSummaryTemplatesSettingsSection() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const user = useAppStore((s) => s.user)
  const canEdit = can(user, 'settings.edit')

  const [current, setCurrent] = useState<ClientSummaryTemplateId>(() =>
    resolveClientSummaryTemplate(settings.clientSummaryDefaultTemplate)
  )
  const [saving, setSaving] = useState(false)

  // preview dialog state
  const [preview, setPreview] = useState<ClientSummaryTemplateId | null>(null)
  const [demo, setDemo] = useState<DemoId>('no-ot')
  const [showOt, setShowOt] = useState(true)
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)

  // fresh settings on mount (another tab may have changed them)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get<{
          settings: { clientSummaryDefaultTemplate: string }
        }>('/api/settings')
        if (cancelled) return
        setCurrent(resolveClientSummaryTemplate(res.settings.clientSummaryDefaultTemplate))
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

  // page rule for the open preview (Classic = flow margins, By Category = sheets)
  const previewDemo = DEMOS.find((d) => d.id === demo) ?? DEMOS[0]
  usePageRule(
    preview !== null,
    preview === 'bycategory' ? 'size: A4; margin: 0;' : 'size: A4 portrait; margin: 10mm;'
  )

  // OT columns auto-detect per demo when the preview opens / demo switches
  useEffect(() => {
    setShowOt(hasDistinctOtRates(previewDemo.group.rows))
  }, [previewDemo])

  async function setDefault(id: ClientSummaryTemplateId) {
    if (saving || !canEdit) return
    if (id === current) return
    setSaving(true)
    try {
      await api.put('/api/settings', { clientSummaryDefaultTemplate: id })
      setCurrent(id)
      // keep the whole app in sync (the print dialog reads this default)
      setSettings({ ...settings, clientSummaryDefaultTemplate: id })
      toast.success(
        `Default client summary template: ${CLIENT_SUMMARY_TEMPLATES.find((t) => t.id === id)?.label}`
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the default template')
    } finally {
      setSaving(false)
    }
  }

  const otAuto = hasDistinctOtRates(previewDemo.group.rows)

  return (
    <SectionCard className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <LayoutTemplate className="h-4 w-4 text-muted-foreground" />
            Client Salary Summary — Print Templates
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The default print layout for client salary summaries — the print dialog starts from it.
            The template is a print option only: changing it never changes any hours, rate, OT rate,
            amount, subtotal, VAT or grand total, only the look of the printout.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {CLIENT_SUMMARY_TEMPLATES.map((t) => {
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPreview(t.id)
                    setShowOt(hasDistinctOtRates((DEMOS.find((d) => d.id === demo) ?? DEMOS[0]).group.rows))
                  }}
                >
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
          className="flex max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[900px]"
        >
          <DialogTitle className="sr-only">Client summary template preview</DialogTitle>
          <DialogDescription className="sr-only">
            Preview of the client salary summary print template with in-memory demo data.
          </DialogDescription>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <p className="text-sm font-semibold">
              {CLIENT_SUMMARY_TEMPLATES.find((t) => t.id === preview)?.label} — preview
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <p className="hidden text-xs text-muted-foreground sm:block">
                Demo data — your summaries print real data
              </p>
              {preview === 'bycategory' ? (
                <Select value={demo} onValueChange={(v) => setDemo(v as DemoId)}>
                  <SelectTrigger className="h-8 w-[240px] text-xs" aria-label="Demo dataset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEMOS.map((d) => (
                      <SelectItem key={d.id} value={d.id} className="text-xs">
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={(e) =>
                  void downloadPrintAreaAsPdf(
                    `Client-Summary-Preview-${CLIENT_SUMMARY_TEMPLATES.find((t) => t.id === preview)?.label ?? ''}-${previewDemo.id}`,
                    e.currentTarget
                  )
                }
              >
                <FileDown className="h-4 w-4" />
                Download PDF
              </Button>
              <Button variant="outline" size="sm" onClick={(e) => printPrintArea(e.currentTarget)}>
                <Printer className="h-4 w-4" />
                Print
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                Close
              </Button>
            </div>
          </div>
          {preview === 'bycategory' ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/30 px-4 py-2">
              <label
                className="inline-flex cursor-pointer select-none items-center gap-2 text-xs font-medium"
                title="Force the OT columns on or off for this print"
              >
                <Checkbox
                  checked={showOt}
                  onCheckedChange={(v) => setShowOt(v === true)}
                  aria-label="Show OT columns"
                />
                Show OT columns
              </label>
              {otAuto ? (
                <span className="text-xs italic text-muted-foreground">
                  OT columns shown because some OT rates differ from normal rates
                </span>
              ) : (
                <span className="text-xs italic text-muted-foreground">
                  No OT columns — every OT rate equals the normal rate
                </span>
              )}
            </div>
          ) : null}
          <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900 print:overflow-visible print:bg-white print:p-0">
            {preview ? (
              <ClientSummaryTemplateDocument
                template={preview}
                group={previewDemo.group}
                month={previewDemo.month}
                year={previewDemo.year}
                vatRate={0.15}
                settings={settings}
                letterhead={letterhead ?? DEFAULT_LETTERHEAD}
                showOt={showOt}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
