// Agreement templates — GET (list for the chooser) / POST ("Save as Template").
// A template stores title + intro + clauses under a name (e.g. "Sub-Contract
// Agreement"); POST upserts by name (saving with an existing name replaces its
// content). GET/POST require agreements.view / create|edit respectively.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requireAuth,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import { hasPermission } from '@/lib/auth'

const templateBodySchema = z.object({
  name: z.string().trim().min(1, 'Template name is required').max(80, 'Name is too long'),
  titleEn: z.string().trim().min(1, 'Title (English) is required').max(300),
  titleAr: z.string().trim().max(300),
  introEn: z.string().max(4000),
  introAr: z.string().max(4000),
  clauses: z
    .array(
      z.object({
        textEn: z.string().trim().max(4000),
        textAr: z.string().trim().max(4000),
      })
    )
    .max(60, 'Too many clauses (max 60)'),
})

export async function GET() {
  try {
    const auth = await requirePermission('agreements.view')
    if (isResponse(auth)) return auth

    const rows = await db.agreementTemplate.findMany({
      orderBy: { createdAt: 'asc' },
      include: { clauses: { orderBy: { order: 'asc' } } },
    })
    return ok(
      rows.map((t) => ({
        id: t.id,
        name: t.name,
        titleEn: t.titleEn,
        titleAr: t.titleAr,
        introEn: t.introEn,
        introAr: t.introAr,
        clauses: t.clauses.map((c) => ({ order: c.order, textEn: c.textEn, textAr: c.textAr })),
      }))
    )
  } catch (err) {
    console.error('[api/agreements/templates GET]', err)
    return serverError()
  }
}

export async function POST(req: NextRequest) {
  try {
    // Saving a template is part of drafting — accept create OR edit permission
    const auth = await requireAuth()
    if (isResponse(auth)) return auth
    if (!hasPermission(auth, 'agreements.create') && !hasPermission(auth, 'agreements.edit')) {
      return badRequest('You do not have permission to save agreement templates')
    }

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = templateBodySchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const clauses = body.clauses
      .filter((c) => c.textEn.trim() || c.textAr.trim())
      .map((c, idx) => ({ order: idx + 1, textEn: c.textEn.trim(), textAr: c.textAr.trim() }))

    const saved = await db.$transaction(async (tx) => {
      const existing = await tx.agreementTemplate.findUnique({ where: { name: body.name } })
      if (existing) {
        await tx.agreementTemplateClause.deleteMany({ where: { templateId: existing.id } })
        return tx.agreementTemplate.update({
          where: { id: existing.id },
          data: {
            titleEn: body.titleEn,
            titleAr: body.titleAr,
            introEn: body.introEn,
            introAr: body.introAr,
            clauses: { create: clauses },
          },
          include: { clauses: { orderBy: { order: 'asc' } } },
        })
      }
      return tx.agreementTemplate.create({
        data: {
          name: body.name,
          titleEn: body.titleEn,
          titleAr: body.titleAr,
          introEn: body.introEn,
          introAr: body.introAr,
          clauses: { create: clauses },
        },
        include: { clauses: { orderBy: { order: 'asc' } } },
      })
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'agreement',
      description: `Agreement template saved — ${saved.name}`,
    })
    return ok(
      {
        id: saved.id,
        name: saved.name,
        titleEn: saved.titleEn,
        titleAr: saved.titleAr,
        introEn: saved.introEn,
        introAr: saved.introAr,
        clauses: saved.clauses.map((c) => ({ order: c.order, textEn: c.textEn, textAr: c.textAr })),
      },
      201
    )
  } catch (err) {
    console.error('[api/agreements/templates POST]', err)
    return serverError()
  }
}
