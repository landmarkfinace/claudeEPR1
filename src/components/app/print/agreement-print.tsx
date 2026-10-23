'use client'

// Agreement print — the EXACT uploaded bilingual template ("Classic")
// plus the 3 newer print layouts (Bilingual Cards / Official Form /
// Key Terms) chosen from the Template dropdown.
//   • AgreementSheet — <style> (embedded Noto Naskh Arabic + Noto Sans + the
//     template's stylesheet) + the .sheet element with the template's render
//     output. Mounted by the print dialog (.print-area) and by the editor's
//     live preview pane. UNCHANGED — Classic output stays byte-identical.
//   • AgreementPrintDialog — View dialog with Download PDF (server vector
//     pipeline over the live sheet) and Print, plus the print-template
//     dropdown. Switching the template re-renders instantly and PATCHes the
//     choice onto the saved agreement (works on signed/expired too — it is
//     layout only, never touching text, parties, dates, numbers, signatories
//     or statuses).
import { useEffect, useState } from 'react'
import { Printer, FileDown, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { downloadPrintAreaAsPdf, printPrintArea } from '@/lib/print-to-pdf'
import {
  renderSheetHtml,
  sheetStyleCss,
  toTemplateAgreement,
  type TemplateAgreement,
} from '@/lib/agreement-template'
import {
  AGREEMENT_PRINT_TEMPLATES,
  normalizeAgreementPrintTemplate,
  resolveAgreementPrintTemplate,
  type AgreementPrintTemplateId,
} from '@/lib/agreement-print-templates'
import { useAppStore } from '@/lib/store'
import { api } from '@/lib/api-client'
import type { AgreementRow, LetterheadConfig } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DEFAULT_LETTERHEAD } from './agreement-print-shared'
import { AgreementBilingualCardsDocument } from './agreement-print-bilingual-cards'
import { AgreementOfficialFormDocument } from './agreement-print-official-form'
import { AgreementKeyTermsDocument } from './agreement-print-key-terms'

/**
 * The template sheet, exactly as the standalone file renders it. Any wrapper
 * class is applied to the .sheet element itself (the template styles it).
 */
export function AgreementSheet({
  agreement,
  className,
}: {
  agreement: TemplateAgreement
  className?: string
}) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: sheetStyleCss() }} />
      <div
        className={cn('sheet', className)}
        dangerouslySetInnerHTML={{ __html: renderSheetHtml(agreement) }}
      />
    </>
  )
}

/**
 * Renders one agreement in the selected print template. The SAME data (every
 * word of the preamble and articles, both parties, dates, price, period,
 * signatories) flows to whichever template is chosen; only the layout
 * changes. Used by the print dialog, the editor's live preview and the
 * Settings template previews.
 */
export function AgreementTemplateDocument({
  template,
  agreement,
  letterhead,
}: {
  template?: string | null
  agreement: TemplateAgreement
  letterhead?: LetterheadConfig | null
}) {
  const tpl = normalizeAgreementPrintTemplate(template) ?? 'classic'
  const lh = letterhead ?? DEFAULT_LETTERHEAD
  if (tpl === 'bilingual-cards') {
    return <AgreementBilingualCardsDocument agreement={agreement} letterhead={lh} />
  }
  if (tpl === 'official-form') {
    return <AgreementOfficialFormDocument agreement={agreement} letterhead={lh} />
  }
  if (tpl === 'key-terms') {
    return <AgreementKeyTermsDocument agreement={agreement} letterhead={lh} />
  }
  return <AgreementSheet agreement={agreement} />
}

/**
 * Full-screen preview dialog for a single agreement. `agreement` must be the
 * FULL row (clauses included — GET /api/agreements/[id]). The document is
 * wrapped in `.print-area`; the print buttons render the server PDF.
 */
export function AgreementPrintDialog({
  agreement,
  open,
  onOpenChange,
}: {
  agreement: AgreementRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const settings = useAppStore((s) => s.settings)
  const [tpl, setTpl] = useState<AgreementPrintTemplateId>('classic')
  const [letterhead, setLetterhead] = useState<LetterheadConfig | null>(null)

  // Classic keeps its own @page margins (the uploaded template's print CSS);
  // the 3 new templates are fixed A4 sheets with a 0 margin.
  const isClassic = tpl === 'classic'
  usePageRule(open, isClassic ? 'size: A4; margin: 12mm 12mm 14mm;' : 'size: A4; margin: 0;')

  // reset the working template when a DIFFERENT agreement is opened (the
  // render-time "adjust state when props change" pattern — saved choice,
  // else the module default from Settings; Classic until changed). The
  // marker clears on close so re-opening the same row re-initializes too
  // (the editor's Print-draft path always uses the sentinel id 'draft').
  const [openAgreementId, setOpenAgreementId] = useState<string | null>(null)
  if (!open && openAgreementId !== null) {
    setOpenAgreementId(null)
  }
  if (open && agreement && agreement.id !== openAgreementId) {
    setOpenAgreementId(agreement.id)
    setTpl(resolveAgreementPrintTemplate(agreement.template ?? null, settings.agreementDefaultTemplate))
  }

  // letterhead artwork for the 3 new templates (Classic keeps its own
  // dashed letterhead-space behaviour — untouched)
  useEffect(() => {
    if (!open || isClassic || letterhead) return
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

  /** Switch the print template — re-renders instantly; the choice is PATCHed
   *  onto the saved agreement (any status — layout only, touches NOTHING
   *  else: no text, parties, dates, numbers, signatories, clauses, status). */
  async function chooseTemplate(v: string) {
    const t = normalizeAgreementPrintTemplate(v) ?? 'classic'
    setTpl(t)
    // PATCH only SAVED agreements — the editor's Print-draft preview uses the
    // sentinel id 'draft' (nothing to persist; the form saves the choice)
    if (!agreement || agreement.id === 'draft') return
    try {
      await api.patch(`/api/agreements/${agreement.id}`, { template: t })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the template choice')
    }
  }

  const tplData = agreement ? toTemplateAgreement(agreement) : null
  const partyName =
    agreement?.otherPartyNameEn || agreement?.otherPartyNameAr || 'Agreement'
  const downloadName = agreement ? `${agreement.agreementNo}_${partyName}` : 'Agreement'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[92vh] max-h-[92vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1000px] print:static print:h-auto print:max-h-none print:w-full print:translate-x-0 print:translate-y-0 print:overflow-visible print:rounded-none print:border-0 print:p-0 print:shadow-none"
      >
        <DialogTitle className="sr-only">Agreement print preview</DialogTitle>
        <DialogDescription className="sr-only">
          Printable bilingual agreement — the exact attached template: parties, intro,
          numbered clauses with contract price and period tokens, signature and stamp blocks.
        </DialogDescription>

        {/* Toolbar (hidden when printing) */}
        <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">
              {agreement ? `Agreement ${agreement.agreementNo}` : 'Agreement'}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {agreement
                ? `${agreement.titleEn || agreement.titleAr} · ${partyName} · ${
                    agreement.status === 'expired' ? 'Expired' : agreement.status === 'signed' ? 'Signed' : 'Draft'
                  }`
                : 'Bilingual A4 agreement document'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={tpl} onValueChange={(v) => void chooseTemplate(v)}>
              <SelectTrigger className="h-8 w-[150px] text-xs" aria-label="Print template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGREEMENT_PRINT_TEMPLATES.map((t) => (
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
              onClick={(e) => void downloadPrintAreaAsPdf(downloadName, e.currentTarget)}
              disabled={!tplData}
            >
              <FileDown className="h-4 w-4" />
              Download PDF
            </Button>
            <Button onClick={(e) => printPrintArea(e.currentTarget)} disabled={!tplData}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Printable page — the document at natural size, centered */}
        <div className="nice-scrollbar print-area flex-1 overflow-y-auto bg-neutral-100 p-4 print:overflow-visible print:bg-white print:p-0">
          {tplData ? (
            <div className="mx-auto w-fit">
              {isClassic ? (
                <AgreementSheet agreement={tplData} />
              ) : (
                <AgreementTemplateDocument template={tpl} agreement={tplData} letterhead={letterhead} />
              )}
            </div>
          ) : (
            <div className="flex min-h-[300px] items-center justify-center bg-white p-16 text-sm text-[#6B7488]">
              No agreement selected.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
