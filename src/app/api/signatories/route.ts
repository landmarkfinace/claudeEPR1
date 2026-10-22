// Signatories API — GET (read) / PUT (save).
// Stored as one Setting row (key "signatories") holding a JSON array of
// { id, name, designation, isDefault }. The quotation print's APPROVED BY
// box reads the default signatory (name + designation) from here; when no
// signatory is set the name line stays empty.
// GET requires quotations.view (the print preview needs it);
// PUT requires settings.edit.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import {
  MAX_SIGNATORIES,
  SIGNATORIES_KEY,
  parseSignatories,
  normalizeDefaultSignatory,
} from '@/lib/signatories'

const item = z.object({
  name: z.string().trim().min(1, 'Signatory name is required').max(120, 'Name is too long'),
  designation: z.string().trim().max(120, 'Designation is too long').optional().default(''),
  isDefault: z.boolean().optional().default(false),
})

const bodySchema = z.object({
  signatories: z.array(item).max(MAX_SIGNATORIES, `At most ${MAX_SIGNATORIES} signatories`).min(0),
})

export async function GET() {
  try {
    const auth = await requirePermission('quotations.view')
    if (isResponse(auth)) return auth
    const row = await db.setting.findUnique({ where: { key: SIGNATORIES_KEY } })
    return ok({ signatories: normalizeDefaultSignatory(parseSignatories(row?.value)) })
  } catch (err) {
    console.error('[api/signatories GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await requirePermission('settings.edit')
    if (isResponse(auth)) return auth

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

    const rows = normalizeDefaultSignatory(
      parsed.data.signatories.map((s, i) => ({
        id: `sig-${Date.now().toString(36)}-${i + 1}`,
        name: s.name,
        designation: s.designation ?? '',
        isDefault: s.isDefault,
      }))
    )
    const value = JSON.stringify(rows)
    const existing = await db.setting.findUnique({ where: { key: SIGNATORIES_KEY } })
    if (existing) {
      await db.setting.update({ where: { key: SIGNATORIES_KEY }, data: { value } })
    } else {
      await db.setting.create({ data: { key: SIGNATORIES_KEY, value } })
    }

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'settings',
      description: `Signatories updated (${rows.length})`,
    })
    return ok({ signatories: rows })
  } catch (err) {
    console.error('[api/signatories PUT]', err)
    return serverError()
  }
}
