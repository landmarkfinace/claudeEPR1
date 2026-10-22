// Saved agreement parties — GET /api/agreements/parties.
// Powers the "Select saved party" dropdown in the editor. Requires
// agreements.view.
import { db } from '@/lib/db'
import {
  ok,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'

export async function GET() {
  try {
    const auth = await requirePermission('agreements.view')
    if (isResponse(auth)) return auth

    const rows = await db.agreementParty.findMany({ orderBy: { nameEn: 'asc' } })
    return ok(
      rows.map((r) => ({
        id: r.id,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        crNo: r.crNo,
        addressEn: r.addressEn,
        addressAr: r.addressAr,
        tel: r.tel,
        fax: r.fax,
        signatoryNameEn: r.signatoryNameEn,
        signatoryNameAr: r.signatoryNameAr,
        signatoryTitleEn: r.signatoryTitleEn,
        signatoryTitleAr: r.signatoryTitleAr,
      }))
    )
  } catch (err) {
    console.error('[api/agreements/parties GET]', err)
    return serverError()
  }
}
