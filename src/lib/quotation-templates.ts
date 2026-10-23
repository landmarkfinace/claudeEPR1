// Quotation print templates — shared registry (client + server).
//
// The Quotations module ships 3 print layouts that all render the SAME
// quotation data (numbers, rates, status and terms are never affected by
// the choice — only the look):
//
//   classic        the original approved layout (the default; legacy rows
//                  with a NULL Quotation.template resolve to this unless a
//                  module default is configured in Settings)
//   sidebar-cream  cream sidebar layout (reference: Quotation_Template_
//                  Sidebar_1_Cream)
//   sidebar-navy   dark navy sidebar layout (reference: Quotation_Template_
//                  Sidebar_2_Navy)
//
// Storage: Quotation.template (nullable string column, purely cosmetic) +
// the `quotationDefaultTemplate` Setting key for the module default.

export const QUOTATION_TEMPLATE_IDS = ['classic', 'sidebar-cream', 'sidebar-navy'] as const

export type QuotationTemplateId = (typeof QUOTATION_TEMPLATE_IDS)[number]

export type QuotationTemplateMeta = {
  id: QuotationTemplateId
  label: string
  description: string
}

export const QUOTATION_TEMPLATES: QuotationTemplateMeta[] = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'The original approved layout — centred header, info bar, TO box and full-width table.',
  },
  {
    id: 'sidebar-cream',
    label: 'Sidebar Cream',
    description: 'Warm cream sidebar with a gold edge — quotation number, details, client and project on the left.',
  },
  {
    id: 'sidebar-navy',
    label: 'Sidebar Navy',
    description: 'Deep navy sidebar with gold accents — item cards and a compact project box in the main column.',
  },
]

/** Coerce any stored value into a valid template id (null → not set). */
export function normalizeQuotationTemplate(
  value: string | null | undefined
): QuotationTemplateId | null {
  if (!value) return null
  return (QUOTATION_TEMPLATE_IDS as readonly string[]).includes(value)
    ? (value as QuotationTemplateId)
    : null
}

/**
 * Effective template for a quotation:
 *   1. the value saved on the quotation row,
 *   2. else the module default from Settings,
 *   3. else 'classic'.
 */
export function resolveQuotationTemplate(
  saved: string | null | undefined,
  moduleDefault: string | null | undefined
): QuotationTemplateId {
  return normalizeQuotationTemplate(saved) ?? normalizeQuotationTemplate(moduleDefault) ?? 'classic'
}

/** Display label for a template id (unknown → 'Classic'). */
export function quotationTemplateLabel(id: string | null | undefined): string {
  return QUOTATION_TEMPLATES.find((t) => t.id === normalizeQuotationTemplate(id))?.label ?? 'Classic'
}
