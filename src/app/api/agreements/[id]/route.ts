// Agreement API — GET / PUT / DELETE a single agreement.
// GET returns the row with clauses ordered by `order` and both party JSON
// snapshots parsed. PUT performs a FULL REPLACE of the clauses inside one
// transaction and stamps lastEditedBy / lastEditedAt. DELETE cascades to the
// clauses (schema-level onDelete: Cascade).
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  parseDate,
  logActivity,
} from '@/lib/api-helpers'
import {
  agreementBodySchema,
  agreementFullInclude,
  mapAgreement,
  normalizeClauses,
  validateAgreementBody,
  splitParties,
  upsertSavedParty,
  type AgreementFull,
} from '@/lib/agreement-server'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('agreements.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const agreement = await db.agreement.findUnique({
      where: { id },
      include: agreementFullInclude,
    })
    if (!agreement) return notFound('Agreement not found')
    return ok(mapAgreement(agreement))
  } catch (err) {
    console.error('[api/agreements/[id] GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('agreements.edit')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.agreement.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return notFound('Agreement not found')

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = agreementBodySchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    const date = parseDate(body.date)
    if (!date) return badRequest('Invalid agreement date')
    const periodFrom = parseDate(body.periodFrom)
    const periodTo = parseDate(body.periodTo)
    if (!periodFrom || !periodTo) return badRequest('Invalid period dates')

    const validationError = validateAgreementBody(body, periodFrom, periodTo)
    if (validationError) return badRequest(validationError)

    const { otherParty } = splitParties(body)
    const normalized = normalizeClauses(body)
    const now = new Date()

    let updated: AgreementFull
    try {
      updated = await db.$transaction(async (tx) => {
        let otherPartyId = body.otherPartyId?.trim() || null
        if (body.saveOtherParty) {
          const saved = await upsertSavedParty(tx, otherParty, otherPartyId, now)
          otherPartyId = saved.id
        } else if (otherPartyId) {
          const exists = await tx.agreementParty.findUnique({
            where: { id: otherPartyId },
            select: { id: true },
          })
          if (!exists) otherPartyId = null
        }

        // Full replace of the clause set with fresh ordering
        await tx.agreementClause.deleteMany({ where: { agreementId: id } })

        return tx.agreement.update({
          where: { id },
          data: {
            agreementNo: body.agreementNo,
            date,
            titleEn: body.titleEn,
            titleAr: body.titleAr,
            ourCompanyIs: body.ourCompanyIs,
            firstPartyJson: JSON.stringify(body.firstParty),
            secondPartyJson: JSON.stringify(body.secondParty),
            otherPartyId,
            otherPartyNameEn: otherParty.name.en.trim(),
            otherPartyNameAr: otherParty.name.ar.trim(),
            introEn: body.introEn,
            introAr: body.introAr,
            periodFrom,
            periodTo,
            priceMode: body.priceMode,
            priceAmount: body.priceMode === 'amount' ? body.priceAmount ?? null : null,
            priceEn: body.priceEn,
            priceAr: body.priceAr,
            showLetterheadSpace: body.showLetterheadSpace,
            status: body.status,
            lastEditedBy: auth.name,
            lastEditedAt: now,
            clauses: { create: normalized },
          },
          include: agreementFullInclude,
        })
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return badRequest(`Agreement No ${body.agreementNo} already exists — pick another.`)
      }
      throw e
    }

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'agreement',
      description: `Agreement ${updated.agreementNo} — ${updated.titleEn} (${updated.otherPartyNameEn})`,
    })
    return ok(mapAgreement(updated))
  } catch (err) {
    console.error('[api/agreements/[id] PUT]', err)
    return serverError()
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('agreements.delete')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.agreement.findUnique({
      where: { id },
      select: { id: true, agreementNo: true, titleEn: true, otherPartyNameEn: true },
    })
    if (!existing) return notFound('Agreement not found')

    await db.agreement.delete({ where: { id } })

    await logActivity({
      user: auth,
      action: 'deleted',
      module: 'agreement',
      description: `Agreement ${existing.agreementNo} — ${existing.titleEn} (${existing.otherPartyNameEn})`,
    })
    return ok({ deleted: true })
  } catch (err) {
    console.error('[api/agreements/[id] DELETE]', err)
    return serverError()
  }
}
