// Duplicate an agreement — POST /api/agreements/[id]/duplicate.
// Copies everything (parties, clauses, price, period, letterhead toggle) into a
// fresh row with a NEW auto AGR number and status draft.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'
import {
  agreementFullInclude,
  mapAgreement,
  nextAgreementNo,
  type AgreementFull,
} from '@/lib/agreement-server'

type Params = { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('agreements.create')
    if (isResponse(auth)) return auth
    const { id } = await params

    const existing = await db.agreement.findUnique({
      where: { id },
      include: agreementFullInclude,
    })
    if (!existing) return notFound('Agreement not found')

    const now = new Date()
    const duplicated: AgreementFull = await db.$transaction(async (tx) => {
      const agreementNo = await nextAgreementNo(tx, existing.date.getFullYear())
      const { id: _omit, createdAt: _c, updatedAt: _u, clauses: _cl, ...rest } = existing
      return tx.agreement.create({
        data: {
          ...rest,
          agreementNo,
          status: 'draft',
          lastEditedBy: auth.name,
          lastEditedAt: now,
          createdByName: auth.name,
          clauses: {
            create: existing.clauses
              .map((c) => ({ order: c.order, textEn: c.textEn, textAr: c.textAr })),
          },
        },
        include: agreementFullInclude,
      })
    })

    await logActivity({
      user: auth,
      action: 'created',
      module: 'agreement',
      description: `Agreement ${duplicated.agreementNo} duplicated from ${existing.agreementNo} — ${duplicated.titleEn}`,
    })
    return ok(mapAgreement(duplicated), 201)
  } catch (err) {
    console.error('[api/agreements/[id]/duplicate POST]', err)
    return serverError()
  }
}
