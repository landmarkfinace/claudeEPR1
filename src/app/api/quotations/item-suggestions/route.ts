// Saved quotation items — every distinct item category (description) ever
// used on any quotation, aggregated with usage stats. Powers the editor's
// item picker: an item added once is remembered and offered the next time a
// quotation is built; anything not on the list is simply typed in as new and
// becomes part of the list once the quotation is saved.
// GET /api/quotations/item-suggestions → { data: ItemSuggestion[] }
//   • one entry per distinct description (case-insensitive)
//   • subText = the detail line most often paired with that category
//   • sorted by usage count (desc), then name — capped at 200 entries
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ok, serverError, requirePermission, isResponse } from '@/lib/api-helpers'

export type ItemSuggestion = {
  description: string
  subText: string | null
  count: number
  lastUsedAt: string
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('quotations.view')
    if (isResponse(auth)) return auth

    // QuotationItem carries no timestamps — the parent's issueDate is the
    // "when was this item used" clock. No orderBy needed: we aggregate.
    const items = await db.quotationItem.findMany({
      select: {
        description: true,
        subText: true,
        quotation: { select: { issueDate: true } },
      },
      take: 5000,
    })

    type Agg = {
      display: string
      count: number
      subTexts: Map<string, number>
      lastUsedAt: Date
    }
    const byName = new Map<string, Agg>()

    for (const it of items) {
      const name = it.description.trim()
      if (!name) continue
      const key = name.toLowerCase()
      let agg = byName.get(key)
      if (!agg) {
        agg = { display: name, count: 0, subTexts: new Map(), lastUsedAt: it.quotation.issueDate }
        byName.set(key, agg)
      }
      agg.count += 1
      const st = (it.subText ?? '').trim()
      agg.subTexts.set(st, (agg.subTexts.get(st) ?? 0) + 1)
      if (it.quotation.issueDate > agg.lastUsedAt) agg.lastUsedAt = it.quotation.issueDate
    }

    const data: ItemSuggestion[] = Array.from(byName.values())
      .map((agg) => {
        // The detail line most often paired with this category (an empty
        // majority counts too — the pick then leaves the detail line blank)
        let best = ''
        let bestCount = -1
        for (const [st, c] of agg.subTexts) {
          if (c > bestCount) {
            best = st
            bestCount = c
          }
        }
        return {
          description: agg.display,
          subText: best || null,
          count: agg.count,
          lastUsedAt: agg.lastUsedAt.toISOString(),
        }
      })
      .sort((a, b) => b.count - a.count || a.description.localeCompare(b.description))
      .slice(0, 200)

    return ok({ data })
  } catch (err) {
    console.error('[api/quotations/item-suggestions GET]', err)
    return serverError()
  }
}
