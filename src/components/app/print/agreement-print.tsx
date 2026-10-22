'use client'

// Agreement print — the EXACT uploaded bilingual template
// (agreement-template.html): English left column | Arabic right column, one
// table row per section, contract price words EN+AR, signature/stamp blocks.
//   • AgreementSheet — <style> (embedded Noto Naskh Arabic + Noto Sans + the
//     template's stylesheet) + the .sheet element with the template's render
//     output. Mounted by the print dialog (.print-area) and by the editor's
//     live preview pane.
//   • AgreementPrintDialog — View dialog with Download PDF (server vector
//     pipeline over the live sheet) and Print. The @page rule matches the
//     template's own print CSS exactly (A4, margin 12mm 12mm 14mm).
import { Printer, FileDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { usePageRule } from '@/components/app/print/print-page-rule'
import { downloadPrintAreaAsPdf, printPrintArea } from '@/lib/print-to-pdf'
import {
  renderSheetHtml,
  sheetStyleCss,
  toTemplateAgreement,
  type TemplateAgreement,
} from '@/lib/agreement-template'
import type { AgreementRow } from '@/lib/types'
import { cn } from '@/lib/utils'

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
  usePageRule(open, 'size: A4; margin: 12mm 12mm 14mm;')

  const tpl = agreement ? toTemplateAgreement(agreement) : null
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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
              Close
            </Button>
            <Button
              variant="outline"
              onClick={(e) => void downloadPrintAreaAsPdf(downloadName, e.currentTarget)}
              disabled={!tpl}
            >
              <FileDown className="h-4 w-4" />
              Download PDF
            </Button>
            <Button onClick={(e) => printPrintArea(e.currentTarget)} disabled={!tpl}>
              <Printer className="h-4 w-4" />
              Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Printable page — the sheet at natural size, centered */}
        <div className="nice-scrollbar print-area flex-1 overflow-y-auto bg-neutral-100 p-4 print:overflow-visible print:bg-white print:p-0">
          {tpl ? (
            <div className="mx-auto w-fit">
              <AgreementSheet agreement={tpl} />
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
