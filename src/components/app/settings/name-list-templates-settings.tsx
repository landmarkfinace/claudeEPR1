'use client'

// Settings › Name List › Templates — choose the module's default print
// template and preview each layout. The default only decides which template
// NEW name lists (and legacy rows with no saved choice) print in; every list
// can override it individually (print-preview dropdown + the list form).
// Changing the default — or any template choice — never touches list data,
// workers, results, statuses or numbering.
//
// The preview renders an IN-MEMORY demo list (never saved, no list number
// consumed, nothing written to the database) with two toggles:
//   • subject kind — Interview or Mobilization (the two print layouts)
//   • 12 / 30 workers — 12 shows the single-page layout, 30 shows the
//     multi-page behaviour (workers continue on page 2 behind the template's
//     continuation header, trade summary + signatures pinned to the bottom of
//     the last page) without creating any real list.
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Eye, LayoutTemplate, Star } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useAppStore, can } from '@/lib/store'
import {
  NAME_LIST_TEMPLATES,
  resolveNameListTemplate,
  type NameListTemplateId,
} from '@/lib/name-list-templates'
import { defaultColumnsFor } from '@/lib/name-list-utils'
import type {
  LetterheadConfig,
  NameListDetail,
  NameListWorkerRow,
} from '@/lib/types'
import { SectionCard } from '@/components/app/shared/page-header'
import {
  NameListTemplateDocument,
} from '@/components/app/print/name-list-sheet-print'
import { DEFAULT_LETTERHEAD } from '@/components/app/print/name-list-print-shared'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'

// ── In-memory demo workers (never saved, no list number consumed) ───────────
const DEMO_NAMES = [
  'Mohammad Rafiqul Islam',
  'Abdul Karim Sheikh',
  'Ramesh Kumar Yadav',
  'Imran Hossain',
  'Suresh Babu Nair',
  'Arif Ahmed Khan',
  'Kamal Uddin',
  'Shahid Mehmood',
  'Rajib Hasan',
  'Bikash Tamang',
  'Anil Thapa',
  'Jahangir Alam',
  'Md. Salauddin',
  'Prakash Chandra Das',
  'Nasir Ali',
  'Tariq Mehmood',
  'Deepak Kumar',
  'Ashraf Hossain',
  'Vikram Singh',
  'Mizanur Rahman',
  'Sanjay Kumar Gupta',
  'Faisal Mahmood',
  'Bimal Shrestha',
  'Haroon Rashid',
  'Sabbir Ahmed',
  'Manoj Patel',
  'Zahid Hussain',
  'Dilip Kumar Yadav',
  'Rashidul Islam',
  'Gyanendra Rai',
  'Shah Alam',
  'Mohin Uddin',
  'Ravi Shankar',
  'Aftab Alam',
  'Sumon Mia',
  'Ramesh Chandra',
  'Nabin Thapa',
  'Ibrahim Khalil',
  'Sohel Rana',
  'Kamrul Hasan',
]
const DEMO_TRADES = ['Electrician', 'Plumber', 'Mason', 'Steel Fixer']
const DEMO_NATIONALITIES = ['Bangladesh', 'India', 'Pakistan', 'Nepal']
const DEMO_BLOOD = ['A+', 'O+', 'B+', 'AB+']

function demoWorkers(count: number, kind: 'interview' | 'mobilization'): NameListWorkerRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `demo-w-${i}`,
    staffId: `demo-s-${i}`,
    sortOrder: i,
    result: null,
    remarks: '',
    staff: {
      id: `demo-s-${i}`,
      fullName: DEMO_NAMES[i % DEMO_NAMES.length],
      phone: `050412${String(5821 + i * 13).padStart(4, '0')}`,
      position: null,
      iqamaId: String(2437157919 + i * 8819),
      iqamaExpiry: null,
      passportNo: kind === 'mobilization' ? `C5231${String(494 + i * 137).padStart(4, '0')}` : null,
      nationality: DEMO_NATIONALITIES[i % 4],
      bloodGroup: kind === 'mobilization' ? DEMO_BLOOD[i % 4] : null,
      experienceYears: (i % 7) + 3,
      deploymentStatus: 'available',
      status: 'active',
      categoryName: DEMO_TRADES[i % 4],
    },
  }))
}

/** Demo list used ONLY for template previews in this settings section —
 *  never saved, never sent to the API, no list number consumed. */
function buildDemoList(kind: 'interview' | 'mobilization', count: 12 | 30): NameListDetail {
  const isMob = kind === 'mobilization'
  return {
    id: 'preview',
    listNo: 'NL-PREVIEW',
    date: new Date().toISOString(),
    time: '09:00',
    clientId: 'demo-client',
    clientName: 'Eastern Province Industrial Services',
    location: 'Landmark Inter Gulf Training Yard — Jubail Industrial City',
    projectId: 'demo-project',
    projectName: 'SABIC Gas Plant Piping Works',
    subjectId: 'demo-subject',
    subjectName: isMob ? 'Site Mobilization' : 'Trade Test & Interview',
    subjectColor: isMob ? '#BE123C' : '#C98A1B',
    subjectKind: isMob ? 'mobilization' : 'interview',
    positions: isMob ? ['Rigger', 'General Worker'] : ['Pipe Fitter', 'Piping Welder', 'Rigger'],
    clientContact: 'Nasser Al-Dosari',
    clientPhone: '+966 13 812 4460',
    transport: 'Company bus — Jubail Bus Station 07:30',
    refInterviewListId: isMob ? 'demo-interview' : null,
    refInterviewListNo: isMob ? 'NL-2026-0001' : null,
    refPoNo: 'LIG-EPIS-2026-014',
    notes: null,
    status: 'sent',
    template: null,
    workerCount: count,
    resultCounts: { selected: 0, rejected: 0, absent: 0, onhold: 0, pending: count },
    signedCopyName: null,
    createdByName: null,
    createdAt: new Date().toISOString(),
    client: {
      id: 'demo-client',
      name: 'Eastern Province Industrial Services',
      contactPerson: 'Nasser Al-Dosari',
      phone: '+966 13 812 4460',
      city: null,
    },
    workers: demoWorkers(count, kind),
    columns: null,
  }
}

export function NameListTemplatesSettingsSection() {
  const settings = useAppStore((s) => s.settings)
  const setSettings = useAppStore((s) => s.setSettings)
  const user = useAppStore((s) => s.user)
  const canEdit = can(user, 'settings.edit')

  const [current, setCurrent] = useState<NameListTemplateId>(() =>
    resolveNameListTemplate(null, settings.nameListDefaultTemplate)
  )
  const [saving, setSaving] = useState(false)

  // preview dialog state
  const [preview, setPreview] = useState<NameListTemplateId | null>(null)
  const [demoKind, setDemoKind] = useState<'interview' | 'mobilization'>('interview')
  const [demoWorkers, setDemoWorkers] = useState<12 | 30>(12)
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)

  // fresh settings on mount (another tab may have changed the default)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get<{ settings: { nameListDefaultTemplate: string } }>(
          '/api/settings'
        )
        if (cancelled) return
        setCurrent(resolveNameListTemplate(null, res.settings.nameListDefaultTemplate))
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

  async function setDefault(id: NameListTemplateId) {
    if (saving || !canEdit) return
    if (id === current) return
    setSaving(true)
    try {
      await api.put('/api/settings', { nameListDefaultTemplate: id })
      setCurrent(id)
      // keep the whole app in sync (new lists read this default)
      setSettings({ ...settings, nameListDefaultTemplate: id })
      toast.success(
        `Default name list template: ${NAME_LIST_TEMPLATES.find((t) => t.id === id)?.label}`
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
            Name List Templates
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            The default print layout for name lists — new lists start with it and legacy lists
            follow it until they get their own choice. Changing the template never changes list
            data, workers, results or statuses — it is allowed on every list because it changes
            only the look.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        {NAME_LIST_TEMPLATES.map((t) => {
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
          <DialogTitle className="sr-only">Name List template preview</DialogTitle>
          <DialogDescription className="sr-only">
            Preview of the name list print template with in-memory demo data.
          </DialogDescription>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <p className="text-sm font-semibold">
              {NAME_LIST_TEMPLATES.find((t) => t.id === preview)?.label} — preview
            </p>
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-md border p-0.5">
                {(['interview', 'mobilization'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setDemoKind(k)}
                    className={`rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                      demoKind === k
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
              <div className="flex items-center rounded-md border p-0.5">
                {([12, 30] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setDemoWorkers(n)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      demoWorkers === n
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {n} workers
                  </button>
                ))}
              </div>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Demo data — your lists print real data
              </p>
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>
                Close
              </Button>
            </div>
          </div>
          <div className="nice-scrollbar min-h-0 flex-1 overflow-auto bg-neutral-100 p-4 dark:bg-neutral-900">
            {preview ? (
              <div className="print-area mx-auto flex w-full flex-col items-center gap-6 bg-transparent [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
                <NameListTemplateDocument
                  template={preview}
                  list={buildDemoList(demoKind, demoWorkers)}
                  columns={defaultColumnsFor(demoKind)}
                  letterhead={letterhead ?? DEFAULT_LETTERHEAD}
                  settings={settings}
                />
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}
