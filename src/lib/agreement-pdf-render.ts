// Server-side HTML rendering for the 3 new agreement print templates.
//
// Next.js forbids importing react-dom/server inside a route handler module
// (the route graph guard), so the render lives HERE behind dynamic imports —
// the route's static import graph stays clean. Pure server-side module.
import 'server-only'
import type { LetterheadConfig } from '@/lib/types'
import type { TemplateAgreement } from '@/lib/agreement-template'
import {
  normalizeAgreementPrintTemplate,
  type AgreementPrintTemplateId,
} from '@/lib/agreement-print-templates'

/**
 * Render one agreement in a NON-classic print template to a daemon-ready
 * fragment: `<div class="print-area">…doc-pages…</div>`. The same components
 * the dialog renders — same data, same layout.
 */
export async function renderAgreementPrintTemplate(
  template: string,
  agreement: TemplateAgreement,
  letterhead: LetterheadConfig
): Promise<string> {
  const tpl = normalizeAgreementPrintTemplate(template)
  if (!tpl || tpl === 'classic') {
    throw new Error('renderAgreementPrintTemplate: only the 3 new layouts (classic uses the flow fragment)')
  }
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { createElement } = await import('react')
  const doc =
    tpl === 'bilingual-cards'
      ? (await import('@/components/app/print/agreement-print-bilingual-cards'))
          .AgreementBilingualCardsDocument
      : tpl === 'official-form'
        ? (await import('@/components/app/print/agreement-print-official-form'))
            .AgreementOfficialFormDocument
        : (await import('@/components/app/print/agreement-print-key-terms'))
            .AgreementKeyTermsDocument
  const markup = renderToStaticMarkup(
    createElement(doc, { agreement, letterhead } as never)
  )
  return `<div class="print-area">${markup}</div>`
}

/** Type re-export for the route's dispatch switch. */
export type { AgreementPrintTemplateId }
