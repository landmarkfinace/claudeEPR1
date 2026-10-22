// Agreement translation API — POST /api/agreements/translate
// Batched English→Arabic translation for the split-screen editor (permission:
// agreements.create OR agreements.edit). Never 500s on translation failure —
// per-entry 'failed' results + a single top-level providerError warning.
// Mirrors /api/e-invoices/translate with the agreement domain hint.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  ok,
  badRequest,
  forbidden,
  serverError,
  requireAuth,
  isResponse,
} from '@/lib/api-helpers'
import { hasPermission } from '@/lib/auth'
import { translateEntries } from '@/lib/translate'

const bodySchema = z.object({
  entries: z
    .array(
      z.object({
        key: z.string().min(1, 'Entry key is required').max(100, 'Entry key is too long'),
        text: z.string().max(4000, 'Text is too long (max 4000 characters)'),
        context: z.string().max(40, 'Context is too long').optional(),
      })
    )
    .min(1, 'At least one entry is required')
    .max(60, 'Too many entries (max 60 per request)'),
})

export async function POST(req: NextRequest) {
  try {
    // Translating is part of drafting — accept create OR edit permission
    const auth = await requireAuth()
    if (isResponse(auth)) return auth
    if (!hasPermission(auth, 'agreements.create') && !hasPermission(auth, 'agreements.edit')) {
      return forbidden('You do not have permission to translate agreement content')
    }

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }

    const { results, providerError } = await translateEntries(parsed.data.entries, {
      domainHint: 'legal contracts and sub-contract agreements',
    })
    return ok({ results, ...(providerError ? { providerError } : {}) })
  } catch (err) {
    console.error('[api/agreements/translate POST]', err)
    return serverError()
  }
}
