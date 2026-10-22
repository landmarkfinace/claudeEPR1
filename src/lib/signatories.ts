// Signatories — shared parsing/model for the Setting row "signatories".
// The quotation print's APPROVED BY box reads the default signatory
// (name + designation) from here; when no signatory is set the name line
// stays empty.

export type Signatory = {
  id: string
  name: string
  designation: string
  isDefault: boolean
}

export const SIGNATORIES_KEY = 'signatories'
export const MAX_SIGNATORIES = 12

/** Parse a stored signatories JSON value into rows (never throws). */
export function parseSignatories(raw: string | null | undefined): Signatory[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const out: Signatory[] = []
    for (const el of arr) {
      if (!el || typeof el !== 'object') continue
      const name = typeof (el as { name?: unknown }).name === 'string' ? (el as { name: string }).name.trim() : ''
      if (!name) continue
      const designation =
        typeof (el as { designation?: unknown }).designation === 'string'
          ? (el as { designation: string }).designation.trim().slice(0, 120)
          : ''
      const id =
        typeof (el as { id?: unknown }).id === 'string' && (el as { id: string }).id
          ? (el as { id: string }).id
          : `sig-${out.length + 1}`
      out.push({
        id,
        name: name.slice(0, 120),
        designation,
        isDefault: (el as { isDefault?: unknown }).isDefault === true,
      })
    }
    return out.slice(0, MAX_SIGNATORIES)
  } catch {
    return []
  }
}

/** Exactly one default (the first isDefault flag wins; else the first row). */
export function normalizeDefaultSignatory(rows: Signatory[]): Signatory[] {
  if (rows.length === 0) return rows
  const idx = rows.findIndex((r) => r.isDefault)
  const def = idx >= 0 ? idx : 0
  return rows.map((r, i) => ({ ...r, isDefault: i === def }))
}

/** The signatory printed on the quotation (default row), or null. */
export function defaultSignatory(rows: Signatory[]): Signatory | null {
  if (rows.length === 0) return null
  return normalizeDefaultSignatory(rows).find((r) => r.isDefault) ?? null
}
