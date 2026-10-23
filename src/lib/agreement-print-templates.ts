// Agreement PRINT templates — shared registry (client + server).
//
// NOTE: this registry is about PRINT LAYOUTS only. It is deliberately kept
// separate from the existing "Agreement Templates" feature (the named
// title + intro + clause SETS a new agreement can start from —
// AgreementTemplate/AgreementTemplateClause models). Content templates are
// NOT touched by this registry in any way.
//
// The Agreement module ships 4 print layouts that all render the SAME
// agreement data (agreement no., dates, both parties, preamble, every
// article's English and Arabic text exactly as stored, contract price and
// period, signatories — never affected by the choice, only the look):
//
//   classic          the original approved layout (the default; rows with a
//                    NULL Agreement.template resolve to this unless a module
//                    default is configured in Settings → Agreement → Templates)
//   bilingual-cards  reference Agreement_Template_1_SubContract — centered
//                    serif title over a gold ◆ rule, cream meta strip, party
//                    cards with navy top borders, side-by-side articles with
//                    navy circle numbers (EN left, AR right), navy signature
//                    cards with gold stamp circles
//   official-form    reference Agreement_Template_2_OfficialForm — double-
//                    bordered title box, official form tables (meta row,
//                    party sections with navy headers, preamble, articles
//                    with a centred EN/AR number column), signature table
//   key-terms        reference Agreement_Template_3_KeyTerms — gold left
//                    spine, big header stack, navy KEY TERMS box (agreement
//                    no. / date / period / price from the STRUCTURED fields),
//                    party blocks, articles with big gold 01 02 03 numerals
//
// Storage: Agreement.template (nullable string column, purely cosmetic) +
// the `agreementDefaultTemplate` Setting key for the module default.
// Changing the template of ANY agreement (draft/signed/expired) is allowed —
// it changes only the layout, never text, parties, dates, numbers,
// signatories, statuses or numbering.

export const AGREEMENT_PRINT_TEMPLATE_IDS = [
  'classic',
  'bilingual-cards',
  'official-form',
  'key-terms',
] as const

export type AgreementPrintTemplateId = (typeof AGREEMENT_PRINT_TEMPLATE_IDS)[number]

export type AgreementPrintTemplateMeta = {
  id: AgreementPrintTemplateId
  label: string
  description: string
}

export const AGREEMENT_PRINT_TEMPLATES: AgreementPrintTemplateMeta[] = [
  {
    id: 'classic',
    label: 'Classic',
    description:
      'The original approved layout — bilingual table rows (English left, Arabic right), numbered clauses, signature and stamp blocks.',
  },
  {
    id: 'bilingual-cards',
    label: 'Bilingual Cards',
    description:
      'Centered serif title over a gold rule, cream meta strip, party cards with navy top borders, circle-numbered articles, navy signature cards.',
  },
  {
    id: 'official-form',
    label: 'Official Form',
    description:
      'Double-bordered title box and official form tables — meta row, party sections, preamble, articles with a centred EN/AR number column, signature table.',
  },
  {
    id: 'key-terms',
    label: 'Key Terms',
    description:
      'Gold spine with a big header stack, navy KEY TERMS box (number, date, period, price), party blocks and big gold article numerals.',
  },
]

/** Coerce any stored value into a valid template id (null → not set). */
export function normalizeAgreementPrintTemplate(
  value: string | null | undefined
): AgreementPrintTemplateId | null {
  if (!value) return null
  return (AGREEMENT_PRINT_TEMPLATE_IDS as readonly string[]).includes(value)
    ? (value as AgreementPrintTemplateId)
    : null
}

/**
 * Effective template for an agreement:
 *   1. the value saved on the agreement row,
 *   2. else the module default from Settings,
 *   3. else 'classic'.
 */
export function resolveAgreementPrintTemplate(
  saved: string | null | undefined,
  moduleDefault: string | null | undefined
): AgreementPrintTemplateId {
  return (
    normalizeAgreementPrintTemplate(saved) ??
    normalizeAgreementPrintTemplate(moduleDefault) ??
    'classic'
  )
}

/** Display label for a template id (unknown → 'Classic'). */
export function agreementPrintTemplateLabel(id: string | null | undefined): string {
  return (
    AGREEMENT_PRINT_TEMPLATES.find((t) => t.id === normalizeAgreementPrintTemplate(id))?.label ??
    'Classic'
  )
}
