// Client Salary Summary PRINT templates — shared registry (client + server).
//
// The module ships 2 print layouts that render the SAME billing data
// (client details, period, every worker's stored hours / OT hours / client
// rate / OT rate / server-calculated amount, the group's subtotal / VAT /
// grand total, amount in words, note and signature labels — never affected
// by the choice, only the look):
//
//   classic    the original approved layout (the DEFAULT — brand logo
//              header, flat worker table grouped by project, tfoot totals,
//              words, note, 3 signature blocks). Its rendering code is
//              UNTOUCHED and stays byte-identical.
//   bycategory reference Client_Summary_By_Category — folder-tab sections
//              01 · BILL TO & PERIOD / 02 · WORKERS BY CATEGORY (grouped by
//              project → category with category header + total rows) /
//              03 · CATEGORY SUMMARY / 04 · BILLING SUMMARY (gold) /
//              05 · APPROVAL, Settings letterhead on every page, Page X of
//              Y, and an automatic OT variant of the worker table.
//
// STORAGE — deliberately like the pay slips: there is NO database column.
// The template is a PRINT OPTION ONLY: the print dialog defaults to the
// `clientSummaryDefaultTemplate` Setting key and lets the user switch per
// print. Changing the template never changes any hours, rate, OT rate,
// amount, subtotal, VAT or grand total — only the look of the printout.
//
// The "Show OT columns" flag is likewise a PER-PRINT checkbox in the dialog
// (auto-ON when any worker has OT hours billed at a rate different from the
// normal rate); it is never stored.

export const CLIENT_SUMMARY_TEMPLATE_IDS = ['classic', 'bycategory'] as const

export type ClientSummaryTemplateId = (typeof CLIENT_SUMMARY_TEMPLATE_IDS)[number]

export type ClientSummaryTemplateMeta = {
  id: ClientSummaryTemplateId
  label: string
  description: string
}

export const CLIENT_SUMMARY_TEMPLATES: ClientSummaryTemplateMeta[] = [
  {
    id: 'classic',
    label: 'Classic',
    description:
      'The original approved layout — brand header, bill-to block, flat worker table grouped by project with hours, OT, rates and amounts, subtotal / VAT / grand total tfoot, amount in words and the 3 signature blocks.',
  },
  {
    id: 'bycategory',
    label: 'By Category',
    description:
      'Folder-tab sections — 01 · Bill To & Period, 02 · Workers By Category (project → category groups with category header and total rows), 03 · Category Summary, 04 · Billing Summary (gold), 05 · Approval pinned above the footer. Letterhead on every page, Page X of Y, and an automatic OT-column variant when OT rates differ from normal rates.',
  },
]

/** Coerce any stored value into a valid template id (null → not set). */
export function normalizeClientSummaryTemplate(
  value: string | null | undefined
): ClientSummaryTemplateId | null {
  if (!value) return null
  return (CLIENT_SUMMARY_TEMPLATE_IDS as readonly string[]).includes(value)
    ? (value as ClientSummaryTemplateId)
    : null
}

/**
 * Effective client summary template: the module default from Settings, else
 * 'classic'. (No per-summary saved choice — the template is a print option
 * only.)
 */
export function resolveClientSummaryTemplate(
  moduleDefault: string | null | undefined
): ClientSummaryTemplateId {
  return normalizeClientSummaryTemplate(moduleDefault) ?? 'classic'
}
