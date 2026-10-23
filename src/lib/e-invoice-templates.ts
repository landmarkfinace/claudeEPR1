// E-Invoice print templates — shared registry (client + server).
//
// The E-Invoice module ships 3 print layouts that all render the SAME
// invoice data (invoice number, every amount, VAT, totals, amount in words,
// customer and bank data, ZATCA QR — never affected by the choice, only the
// look):
//
//   classic   the original approved layout (the default; legacy rows with a
//             NULL EInvoice.template resolve to this unless a module default
//             is configured in Settings → E-Invoice → Templates)
//   heritage  navy title band with the geometric star pattern and cut
//             corners, gold hexagon invoice-number capsule, serif titles,
//             gold ornament lines, ✦ item markers, patterned TOTAL DUE box
//             (reference: E-Invoice_Template_D_Heritage)
//   folder    5 sections with folder tabs — 01 Details, 02 Parties,
//             03 Items, 04 Payment (gold), 05 Sign-off
//             (reference: E-Invoice_Template_F_Folder)
//
// Storage: EInvoice.template (nullable string column, purely cosmetic) +
// the `eInvoiceDefaultTemplate` Setting key for the module default.
// Changing the template of an ISSUED (locked) invoice is allowed — it
// changes only the layout, never data, totals, numbering, status or the QR.

export const EINVOICE_TEMPLATE_IDS = ['classic', 'heritage', 'folder'] as const

export type EInvoiceTemplateId = (typeof EINVOICE_TEMPLATE_IDS)[number]

export type EInvoiceTemplateMeta = {
  id: EInvoiceTemplateId
  label: string
  description: string
}

export const EINVOICE_TEMPLATES: EInvoiceTemplateMeta[] = [
  {
    id: 'classic',
    label: 'Classic',
    description:
      'The original approved layout — mirror EN/AR header, cream bars, navy items table, totals + bank + QR signature row.',
  },
  {
    id: 'heritage',
    label: 'Heritage',
    description:
      'Navy star-pattern title band with cut corners, gold hexagon invoice number, serif titles, ✦ item markers and a patterned TOTAL DUE box.',
  },
  {
    id: 'folder',
    label: 'Folder',
    description:
      'Five tabbed sections — 01 Details, 02 Parties, 03 Items, 04 Payment in gold, 05 Sign-off — with the status badge beside the invoice number.',
  },
]

/** Coerce any stored value into a valid template id (null → not set). */
export function normalizeEInvoiceTemplate(
  value: string | null | undefined
): EInvoiceTemplateId | null {
  if (!value) return null
  return (EINVOICE_TEMPLATE_IDS as readonly string[]).includes(value)
    ? (value as EInvoiceTemplateId)
    : null
}

/**
 * Effective template for an e-invoice:
 *   1. the value saved on the invoice row,
 *   2. else the module default from Settings,
 *   3. else 'classic'.
 */
export function resolveEInvoiceTemplate(
  saved: string | null | undefined,
  moduleDefault: string | null | undefined
): EInvoiceTemplateId {
  return (
    normalizeEInvoiceTemplate(saved) ?? normalizeEInvoiceTemplate(moduleDefault) ?? 'classic'
  )
}

/** Display label for a template id (unknown → 'Classic'). */
export function eInvoiceTemplateLabel(id: string | null | undefined): string {
  return (
    EINVOICE_TEMPLATES.find((t) => t.id === normalizeEInvoiceTemplate(id))?.label ?? 'Classic'
  )
}
