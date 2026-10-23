// Name List print templates — shared registry (client + server).
//
// The Name List module ships 4 print layouts that all render the SAME
// list data (list number, client, project, dates, every worker's name,
// Iqama, mobile, results, the trade summary and the total — never affected
// by the choice, only the look):
//
//   classic   the original approved layout (the default; legacy rows with a
//             NULL NameList.template resolve to this unless a module default
//             is configured in Settings → Name List → Templates)
//   heritage  navy star-pattern title band with cut corners, gold hexagon
//             list-number capsule, serif titles, ✦ cell separators,
//             patterned TOTAL box
//             (reference: Name_List_Template_1_Heritage)
//   folder    tabbed sections — 01 Details, 02 Workers, 03 Summary (gold),
//             04 Sign-off — with the status badge beside the title
//             (reference: Name_List_Template_2_Folder)
//   sidebar   full-height cream sidebar (gold gradient edge) carrying the
//             title stack, list number, info sections and the navy
//             TOTAL WORKERS box; the workers table fills the main column
//             (reference: Name_List_Template_3_Sidebar)
//
// Storage: NameList.template (nullable string column, purely cosmetic) +
// the `nameListDefaultTemplate` Setting key for the module default.
// Changing the template of ANY list (any status) is allowed — it changes
// only the layout, never list data, workers, results, statuses or numbering.

export const NAME_LIST_TEMPLATE_IDS = ['classic', 'heritage', 'folder', 'sidebar'] as const

export type NameListTemplateId = (typeof NAME_LIST_TEMPLATE_IDS)[number]

export type NameListTemplateMeta = {
  id: NameListTemplateId
  label: string
  description: string
}

export const NAME_LIST_TEMPLATES: NameListTemplateMeta[] = [
  {
    id: 'classic',
    label: 'Classic',
    description:
      'The original approved layout — mirror header, cream info bar, navy table with gold-ring numbers, trade chips and signature cards.',
  },
  {
    id: 'heritage',
    label: 'Heritage',
    description:
      'Navy star-pattern title band with cut corners, gold hexagon list number, serif titles, ✦ cell separators and a patterned TOTAL box.',
  },
  {
    id: 'folder',
    label: 'Folder',
    description:
      'Tabbed sections — 01 Details, 02 Workers, 03 Summary in gold, 04 Sign-off — with the status badge beside the title.',
  },
  {
    id: 'sidebar',
    label: 'Sidebar',
    description:
      'Full-height cream sidebar with a gold edge carrying the title stack, info sections and the navy TOTAL WORKERS box.',
  },
]

/** Coerce any stored value into a valid template id (null → not set). */
export function normalizeNameListTemplate(
  value: string | null | undefined
): NameListTemplateId | null {
  if (!value) return null
  return (NAME_LIST_TEMPLATE_IDS as readonly string[]).includes(value)
    ? (value as NameListTemplateId)
    : null
}

/**
 * Effective template for a name list:
 *   1. the value saved on the list row,
 *   2. else the module default from Settings,
 *   3. else 'classic'.
 */
export function resolveNameListTemplate(
  saved: string | null | undefined,
  moduleDefault: string | null | undefined
): NameListTemplateId {
  return (
    normalizeNameListTemplate(saved) ?? normalizeNameListTemplate(moduleDefault) ?? 'classic'
  )
}

/** Display label for a template id (unknown → 'Classic'). */
export function nameListTemplateLabel(id: string | null | undefined): string {
  return (
    NAME_LIST_TEMPLATES.find((t) => t.id === normalizeNameListTemplate(id))?.label ?? 'Classic'
  )
}
