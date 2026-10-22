// Quotation Terms & Conditions — shared structured model.
//
// Storage: Quotation.terms and DefaultTerms.content keep a SINGLE string
// column. New data is stored as a JSON array of { title?, text } items
// (title optional → rendered bold). Legacy plain-text values (newline list,
// possibly with "1." numbering) still parse: lines keep their number, and a
// short "Something:" prefix is recognised as a bold title, so old quotations
// upgrade gracefully the first time they are edited.

export type TermItem = {
  /** Optional bold heading rendered before the text ("Minimum Working Hours"). */
  title?: string
  /** The item text (required to print). */
  text: string
}

/** Pre-filled defaults for Settings › Quotation › Default Terms & Conditions. */
export const DEFAULT_QUOTATION_TERMS: TermItem[] = [
  {
    title: 'Minimum Working Hours',
    text: '10 hours per day, 6 days per week.',
  },
  {
    title: 'Purchase Order (P.O.)',
    text: 'A Purchase Order (P.O.) shall be issued upon acceptance of this quotation.',
  },
  {
    title: 'Overtime',
    text: 'Any work performed beyond the standard working hours will be charged at the agreed hourly rate or in accordance with the applicable Saudi Labor Law, unless otherwise agreed.',
  },
  {
    text: 'Food, accommodation, and transportation shall be provided by the Client.',
  },
  {
    title: 'Payment Terms',
    text: 'Payment shall be made within 30 days from the date of invoice submission.',
  },
  {
    title: 'Timesheet',
    text: 'Monthly timesheets shall be submitted during the first week of the following month and must be approved by the Client.',
  },
  {
    title: 'Demobilization',
    text: "A minimum of 15 days' prior written notice is required for the demobilization of manpower.",
  },
  {
    title: 'VAT',
    text: 'The quoted rates are exclusive of VAT. Applicable VAT will be charged separately in accordance with the laws and regulations of the Kingdom of Saudi Arabia.',
  },
  {
    title: 'Validity',
    text: 'This quotation shall remain valid for 30 days from the date of issue.',
  },
  {
    title: 'General',
    text: 'Any terms and conditions not specifically mentioned herein shall be governed by the applicable laws and regulations of the Kingdom of Saudi Arabia.',
  },
]

const MAX_TERMS = 60
const MAX_TEXT = 800

/** Is this string a JSON array of term items? */
function tryParseJson(raw: string): TermItem[] | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('[')) return null
  try {
    const arr = JSON.parse(trimmed) as unknown
    if (!Array.isArray(arr)) return null
    const items: TermItem[] = []
    for (const el of arr) {
      if (typeof el === 'string') {
        // Very first JSON draft: bare strings.
        const t = el.trim()
        if (t) items.push(splitLegacyTitle(t))
        continue
      }
      if (!el || typeof el !== 'object') continue
      const title = (el as { title?: unknown }).title
      const text = (el as { text?: unknown }).text
      if (typeof text === 'string' && text.trim()) {
        items.push({
          ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}),
          text: text.trim().slice(0, MAX_TEXT),
        })
      }
    }
    return items.slice(0, MAX_TERMS)
  } catch {
    return null
  }
}

/**
 * Legacy line → item: strip a leading "12." / "12)" number, then split a
 * SHORT pre-colon segment (≤ 45 chars) off as the bold title.
 */
function splitLegacyTitle(line: string): TermItem {
  const stripped = line.replace(/^\s*\d{1,3}[.)]\s*/, '').trim()
  const colon = stripped.indexOf(':')
  if (colon > 0 && colon <= 45) {
    const title = stripped.slice(0, colon).trim()
    const text = stripped.slice(colon + 1).trim()
    if (title && text) return { title, text }
  }
  return { text: stripped }
}

/**
 * Parse a stored terms value (JSON array or legacy plain text) into items.
 * Empty / null → []. Never throws.
 */
export function parseTerms(raw: string | null | undefined): TermItem[] {
  if (!raw) return []
  const trimmed = raw.trim()
  if (!trimmed) return []
  const json = tryParseJson(trimmed)
  if (json) return json
  // Legacy plain text: one item per non-empty line.
  const items: TermItem[] = []
  for (const line of trimmed.split('\n')) {
    const t = line.trim()
    if (t) items.push(splitLegacyTitle(t))
  }
  return items.slice(0, MAX_TERMS)
}

/** Items → JSON string for storage (Quotation.terms / DefaultTerms.content). */
export function serializeTerms(items: TermItem[]): string {
  const clean = items
    .map((it) => ({
      ...(it.title && it.title.trim() ? { title: it.title.trim().slice(0, 120) } : {}),
      text: (it.text ?? '').trim().slice(0, MAX_TEXT),
    }))
    .filter((it) => it.text)
  return JSON.stringify(clean)
}

/** Validate items for saving (used by the settings + quotation forms). */
export function validateTerms(items: TermItem[]): string | null {
  if (items.length === 0) return null
  if (items.length > MAX_TERMS) return `Too many terms (max ${MAX_TERMS})`
  for (let i = 0; i < items.length; i++) {
    if (!items[i].text.trim()) return `Term ${i + 1}: text is required`
    if (items[i].text.length > MAX_TEXT) return `Term ${i + 1}: text is too long (max ${MAX_TEXT} characters)`
  }
  return null
}
