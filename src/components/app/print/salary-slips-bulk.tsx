'use client'

// BULK pay slip print — one PDF, one employee per A4 page, in the selected
// template (Classic / Sidebar / Folder — all 3 supported). The rows are
// gathered by the Payroll view from the CURRENTLY FILTERED list (month /
// year / status / project / client filters respected) and sorted by staff
// name before opening this dialog.
//
// DATA GUARANTEE: bulk printing never writes anything — it only renders the
// SAME stored payroll rows page by page. Classic pages render the ORIGINAL
// SalarySlipDocument markup inside fixed A4 sheets (one page each); the new
// templates render their own sheets. Every page carries the letterhead
// artwork from Settings (empty bands without artwork — never placeholder
// text). The signature row on the new templates is pinned to the bottom of
// each page directly above the footer.
import { useEffect, useState } from 'react'
import { Printer, FileDown, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { downloadPrintAreaAsPdf, printPrintArea } from '@/lib/print-to-pdf'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api-client'
import {
  PAYSLIP_TEMPLATES,
  resolvePayslipTemplate,
  type PayslipTemplateId,
} from '@/lib/payslip-print-templates'
import type { LetterheadConfig } from '@/lib/types'
import {
  SalarySlipDocument,
  PayslipTemplateDocument,
  type SlipPayroll,
} from '@/components/app/print/salary-slip'
import { DEFAULT_LETTERHEAD, PAGE_H_MM, PAGE_W_MM } from '@/components/app/print/payslip-print-shared'

export function SalarySlipsBulkDialog({
  rows,
  periodLabel,
  open,
  onOpenChange,
}: {
  rows: SlipPayroll[]
  periodLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const user = useAppStore((s) => s.user)
  const [tpl, setTpl] = useState<PayslipTemplateId>('classic')
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)
  const isClassic = tpl === 'classic'

  // the new templates are fixed A4 sheets with a 0 margin (Classic pages are
  // fixed sheets too — one per slip — so the same rule applies to all)
  usePageRule(open, 'size: A4; margin: 0;')

  // working template: the module default from Settings, re-read on open
  const [wasOpen, setWasOpen] = useState(false)
  if (open && !wasOpen) {
    setWasOpen(true)
    setTpl(resolvePayslipTemplate(settings.payrollPayslipDefaultTemplate))
  }
  if (!open && wasOpen) setWasOpen(false)

  // letterhead artwork (all templates; Classic keeps its own brand header in
  // the layout itself, the sheet bands stay empty for it)
  useEffect(() => {
    if (!open || letterhead || isClassic) return
    let alive = true
    api
      .get<LetterheadConfig>('/api/letterhead')
      .then((lh) => {
        if (alive) setLetterhead(lh)
      })
      .catch(() => {
        /* without letterhead config the reserved bands stay empty */
      })
    return () => {
      alive = false
    }
  }, [open, isClassic, letterhead])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Bulk pay slips print preview</DialogTitle>
        <DialogDescription className="sr-only">
          One pay slip per A4 page — {rows.length} slips for {periodLabel}, in the selected
          template.
        </DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              Pay Slips — {periodLabel} ({rows.length}{' '}
              {rows.length === 1 ? 'slip' : 'slips'})
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              One slip per page, sorted by staff name · {rows[0]?.staff.fullName ?? ''}
              {rows.length > 1 ? ` … ${rows[rows.length - 1]?.staff.fullName}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={tpl} onValueChange={(v) => setTpl(v as PayslipTemplateId)}>
              <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Pay slip template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYSLIP_TEMPLATES.map((t) => (
                  <SelectItem key={t.id} value={t.id} className="text-xs">
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button
              variant="outline"
              onClick={(e) =>
                void downloadPrintAreaAsPdf(`Pay-Slips-${periodLabel.replace(/\s+/g, '-')}`, e.currentTarget)
              }
              disabled={rows.length === 0}
            >
              <FileDown className="h-4 w-4" />
              Download PDF
            </Button>
            <Button onClick={(e) => printPrintArea(e.currentTarget)} disabled={rows.length === 0}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Printable page — one A4 sheet per slip */}
        <div className="nice-scrollbar print-area flex-1 overflow-y-auto bg-neutral-100 p-4 print:overflow-visible print:bg-white print:p-0">
          {rows.length > 0 ? (
            <div className="mx-auto flex w-fit flex-col items-center gap-6 print:gap-0">
              {rows.map((row, i) =>
                isClassic ? (
                  // Classic: the ORIGINAL document markup, one fixed A4 sheet
                  // per slip (layout untouched — just paginated for bulk)
                  <div
                    key={row.id}
                    className="doc-page relative shrink-0 overflow-hidden bg-white shadow-sm print:shadow-none"
                    style={{
                      width: `${PAGE_W_MM}mm`,
                      height: `${PAGE_H_MM}mm`,
                      breakAfter: i === rows.length - 1 ? 'auto' : 'page',
                      breakInside: 'avoid',
                    }}
                  >
                    <SalarySlipDocument payroll={row} settings={settings} />
                  </div>
                ) : (
                  <PayslipTemplateDocument
                    key={row.id}
                    template={tpl}
                    payroll={row}
                    settings={settings}
                    preparedBy={user?.name ?? ''}
                    letterhead={letterhead ?? DEFAULT_LETTERHEAD}
                  />
                )
              )}
            </div>
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-[#6B7488]">
              No pay slips match the current filters.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
