// Pay slip PRINT templates — shared registry (client + server).
//
// The Payroll module ships 3 pay slip layouts that all render the SAME
// payroll data (staff name, Iqama, category, hours, rates, every earning and
// deduction line, gross/deductions/net totals, payment method, project and
// client — never affected by the choice, only the look):
//
//   classic  the original approved layout (the DEFAULT — a flowing document
//            with the brand header, info grid, side-by-side Earnings /
//            Deductions tables, net bar and the Approval & Acknowledgment
//            block). Its rendering code is UNTOUCHED and stays byte-identical.
//   sidebar  reference Payslip_Template_1_Sidebar — cream sidebar with a gold
//            gradient edge (SALARY PAY SLIP / PAY SLIP stack, period + status
//            chip, EMPLOYEE / ASSIGNMENT / PAYMENT sections, navy NET box
//            pinned to the bottom), main column with the Earnings /
//            Deductions tables, the Gross − Deductions = Net equation bar,
//            the regular/overtime hours bar and the acknowledgment panel.
//   folder   reference Payslip_Template_3_Folder — folder-tab sections
//            01 · EMPLOYEE (4-cell grid), 02 · EARNINGS & DEDUCTIONS
//            (side-by-side tables), 03 · NET PAY (gold tab, navy amount box),
//            04 · ACKNOWLEDGMENT.
//
// STORAGE — deliberately different from the other modules: there is NO
// Payroll.template column (the boss's rule). The template is a PRINT OPTION
// ONLY: the print dialogs (single + bulk) default to the
// `payrollPayslipDefaultTemplate` Setting key and let the user switch per
// print. Changing the template never changes any amount, hours, status,
// employee data, formula or stored field — only the look of the printout.
//
// Acknowledgment text: the 2 NEW templates print the configurable
// `payrollAcknowledgmentText` Setting (placeholders {netPay} {period}
// {method} {project} {client}); Classic keeps its hard-coded text unchanged.

export const PAYSLIP_TEMPLATE_IDS = ['classic', 'sidebar', 'folder'] as const

export type PayslipTemplateId = (typeof PAYSLIP_TEMPLATE_IDS)[number]

export type PayslipTemplateMeta = {
  id: PayslipTemplateId
  label: string
  description: string
}

export const PAYSLIP_TEMPLATES: PayslipTemplateMeta[] = [
  {
    id: 'classic',
    label: 'Classic',
    description:
      'The original approved layout — brand header, info grid, side-by-side Earnings and Deductions tables, net pay bar, approval and acknowledgment block.',
  },
  {
    id: 'sidebar',
    label: 'Sidebar',
    description:
      'Cream sidebar with a gold gradient edge — period and status chip, employee / assignment / payment sections, navy NET box at the bottom; equation bar and hours bar in the main column.',
  },
  {
    id: 'folder',
    label: 'Folder',
    description:
      'Folder-tab sections — 01 · EMPLOYEE grid, 02 · EARNINGS & DEDUCTIONS tables, 03 · NET PAY with the gold tab and navy amount box, 04 · ACKNOWLEDGMENT.',
  },
]

/** Coerce any stored value into a valid template id (null → not set). */
export function normalizePayslipTemplate(
  value: string | null | undefined
): PayslipTemplateId | null {
  if (!value) return null
  return (PAYSLIP_TEMPLATE_IDS as readonly string[]).includes(value)
    ? (value as PayslipTemplateId)
    : null
}

/**
 * Effective pay slip template: the module default from Settings, else
 * 'classic'. (No per-row saved choice — the template is a print option only.)
 */
export function resolvePayslipTemplate(
  moduleDefault: string | null | undefined
): PayslipTemplateId {
  return normalizePayslipTemplate(moduleDefault) ?? 'classic'
}

// ── Slip number — display-only, deterministic per payroll row ───────────────
// PS-{year}-{month 2-digit}-{last 4 characters of the row id}. The SAME row
// always yields the SAME number (derived from its immutable id); nothing is
// stored and no sequence is consumed.
export function payslipNo(row: { id: string; month: number; year: number }): string {
  return `PS-${row.year}-${String(row.month).padStart(2, '0')}-${row.id.slice(-4)}`
}

// ── Acknowledgment text ─────────────────────────────────────────────────────
/** Placeholders: {netPay} (bare amount, e.g. "15,295.00" — pair it with your
 *  own "SAR" wording), {period}, {method}, {project}, {client} */
export const PAYSLIP_ACK_PLACEHOLDERS = ['{netPay}', '{period}', '{method}', '{project}', '{client}'] as const

export const DEFAULT_PAYSLIP_ACK_TEXT =
  'I acknowledge that I have received my net salary of SAR {netPay} for {period} by {method} for my work on {project} at {client}. I confirm that the earnings and deductions stated on this slip are correct.'

/** Max stored length for the configurable acknowledgment text. */
export const PAYSLIP_ACK_MAX_LENGTH = 2000

/**
 * Substitute the placeholders in the acknowledgment text. Missing optional
 * values (project / client) are handled gracefully: their connecting word is
 * dropped so the sentence stays grammatical (e.g. "on {project} at {client}"
 * → "at {client}" when no project, no dangling "on at" / "at ." fragments).
 */
export function interpolatePayslipAck(
  text: string,
  values: { netPay: string; period: string; method: string; project: string; client: string }
): string {
  let out = text
    .replaceAll('{netPay}', values.netPay)
    .replaceAll('{period}', values.period)
    .replaceAll('{method}', values.method)
    .replaceAll('{project}', values.project)
    .replaceAll('{client}', values.client)
  // graceful cleanup when project / client are missing
  out = out
    .replace(/\bon\s+at\b/g, 'at') // no project, client present → "work at X"
    .replace(/\s*at\s*\./g, '.') // no client (at sentence end) → drop " at"
    .replace(/\s*on\s*\./g, '.') // no project and no client → drop " on"
    .replace(/\s{2,}/g, ' ')
    .trim()
  return out
}
