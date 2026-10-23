// Agreements API — GET (paginated list + totals) / POST (create).
// Bilingual, template-driven agreements printed as the EXACT uploaded
// agreement-template.html. Parties are full template-shape JSON snapshots;
// clauses live in their own table (order, text_en, text_ar). Status is stored
// draft|signed; 'expired' is DERIVED (signed + Period To passed) and exposed
// through the ?status= filter exactly like a stored one.
// Filters: ?search (no / title / other-party name EN+AR) ?status
// (draft|signed|expired) ?dateFrom ?dateTo (agreement date).
import { NextRequest } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
  parsePagination,
  paginatedResponse,
  parseDate,
  toInt,
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
  nextAgreementNo,
  type AgreementFull,
} from '@/lib/agreement-server'

function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

// ---------------------------------------------------------------------------
// GET — list with filters + totals
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('agreements.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const p = parsePagination(sp)
    const where: Prisma.AgreementWhereInput = {}
    const ands: Prisma.AgreementWhereInput[] = []

    const search = sp.get('search')?.trim()
    if (search) {
      where.OR = [
        { agreementNo: { contains: search } },
        { titleEn: { contains: search } },
        { titleAr: { contains: search } },
        { otherPartyNameEn: { contains: search } },
        { otherPartyNameAr: { contains: search } },
      ]
    }

    const status = sp.get('status')?.trim()
    const today = startOfToday()
    if (status === 'draft') {
      ands.push({ status: 'draft' })
    } else if (status === 'signed') {
      // signed and NOT yet past its Period To (derived-expired excluded)
      ands.push({ status: 'signed', periodTo: { gte: today } })
    } else if (status === 'expired') {
      // signed and the Period To date has passed
      ands.push({ status: 'signed', periodTo: { lt: today } })
    }

    const dateFrom = parseDate(sp.get('dateFrom') ?? undefined)
    if (dateFrom) ands.push({ date: { gte: dateFrom } })
    const dateTo = parseDate(sp.get('dateTo') ?? undefined)
    if (dateTo) {
      const end = new Date(dateTo)
      end.setHours(23, 59, 59, 999)
      ands.push({ date: { lte: end } })
    }
    if (ands.length > 0) where.AND = ands

    const signedBase: Prisma.AgreementWhereInput = { AND: [where, { status: 'signed' }] }
    const activeWhere: Prisma.AgreementWhereInput = {
      AND: [where, { status: 'signed' }, { periodTo: { gte: today } }],
    }
    const [rows, total, agg, signedCount, activeCount] = await Promise.all([
      db.agreement.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: p.skip,
        take: p.take,
        include: agreementFullInclude,
      }),
      db.agreement.count({ where }),
      db.agreement.aggregate({ where, _count: { _all: true }, _sum: { priceAmount: true } }),
      db.agreement.count({ where: signedBase }),
      db.agreement.count({ where: activeWhere }),
    ])

    return paginatedResponse(rows.map(mapAgreement), total, p, {
      count: agg._count._all,
      totalAmount: agg._sum.priceAmount ?? 0,
      signedCount,
      active: activeCount,
    })
  } catch (err) {
    console.error('[api/agreements GET]', err)
    return serverError()
  }
}

// ---------------------------------------------------------------------------
// POST — create with clauses in one transaction
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const auth = await requirePermission('agreements.create')
    if (isResponse(auth)) return auth

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

    let created: AgreementFull | null = null
    try {
      created = await db.$transaction(async (tx) => {
        // Saved party ("Save this party for future agreements")
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

        return tx.agreement.create({
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
            // print-layout template — cosmetic only (null = module default)
            template: body.template ?? null,
            status: body.status,
            lastEditedBy: auth.name,
            lastEditedAt: now,
            createdByName: auth.name,
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
    if (!created) return serverError('Could not create the agreement — try again')

    await logActivity({
      user: auth,
      action: 'created',
      module: 'agreement',
      description: `Agreement ${created.agreementNo} — ${created.titleEn} (${created.otherPartyNameEn})`,
    })
    return ok(mapAgreement(created), 201)
  } catch (err) {
    console.error('[api/agreements POST]', err)
    return serverError()
  }
}
