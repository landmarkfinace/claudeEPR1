// Next agreement number preview — GET /api/agreements/next-number?year=2026.
// Uses the exact same generator as POST /api/agreements (AGR-YYYY-NNNN) so the
// editor's Agreement No field can pre-fill with the number the document will
// actually receive. (Static segment wins over the dynamic [id] route.)
// Requires agreements.view.
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import { nextAgreementNo } from '@/lib/agreement-server'

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('agreements.view')
    if (isResponse(auth)) return auth

    const sp = req.nextUrl.searchParams
    const year = parseInt(sp.get('year') ?? '', 10)
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return badRequest('Invalid year')
    }

    const agreementNo = await db.$transaction((tx) => nextAgreementNo(tx, year))
    return ok({ agreementNo, year })
  } catch (err) {
    console.error('[api/agreements/next-number GET]', err)
    return serverError()
  }
}
