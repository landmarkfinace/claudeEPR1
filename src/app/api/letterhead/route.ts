// Company letterhead API — GET (read config) / PUT (save config).
// Single-row configuration powering the A4 quotation document: uploaded
// header/footer/full-page artwork, layout mode, reserved heights and the
// textual company-details toggle. Images arrive as base64 data URLs and are
// validated (PNG/JPEG only, magic-byte sniffed, ≤ 2 MB decoded).
// GET requires quotations.view / supplierpo.view / einvoices.view (the
// print documents that read this config); PUT requires quotations.edit OR
// supplierpo.edit (the shared design can be managed from either module).
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSessionUser, hasPermission } from '@/lib/auth'
import { validateImageDataUrl } from '@/lib/image-data-url'
import {
  ok,
  badRequest,
  forbidden,
  serverError,
  logActivity,
  unauthorized,
} from '@/lib/api-helpers'
import type { LetterheadConfig } from '@/lib/types'

const MODES = ['none', 'header', 'header_footer', 'full'] as const

const letterheadSchema = z.object({
  mode: z.enum(MODES),
  headerImage: z.string().nullable().optional(),
  footerImage: z.string().nullable().optional(),
  fullPageImage: z.string().nullable().optional(),
  showCompanyDetails: z.boolean().optional(),
  headerHeightMm: z.coerce.number().min(10).max(90).optional(),
  footerHeightMm: z.coerce.number().min(8).max(60).optional(),
})

/** Current row (created lazily with defaults) → API shape. */
async function readConfig(): Promise<LetterheadConfig> {
  let row = await db.companyLetterhead.findFirst()
  if (!row) {
    row = await db.companyLetterhead.create({ data: {} })
  }
  return {
    mode: (MODES as readonly string[]).includes(row.mode)
      ? (row.mode as LetterheadConfig['mode'])
      : 'none',
    headerImage: row.headerImage,
    footerImage: row.footerImage,
    fullPageImage: row.fullPageImage,
    showCompanyDetails: row.showCompanyDetails,
    headerHeightMm: row.headerHeightMm,
    footerHeightMm: row.footerHeightMm,
  }
}

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) return unauthorized()
    // The company letterhead powers the printed Quotation, Supplier P.O.,
    // E-Invoice, Agreement, bulk/new-layout Pay slip and By-Category Client
    // Salary Summary documents — any of those modules' view/print permission
    // grants read access.
    if (
      !hasPermission(user, 'quotations.view') &&
      !hasPermission(user, 'supplierpo.view') &&
      !hasPermission(user, 'einvoices.view') &&
      !hasPermission(user, 'agreements.view') &&
      !hasPermission(user, 'payroll.print') &&
      !hasPermission(user, 'payroll.view')
    ) {
      return forbidden()
    }
    return ok(await readConfig())
  } catch (err) {
    console.error('[api/letterhead GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest) {
  try {
    // The letterhead is shared by the Quotation and Supplier P.O. documents —
    // either module's edit permission allows managing it.
    const user = await getSessionUser()
    if (!user) return unauthorized()
    if (!hasPermission(user, 'quotations.edit') && !hasPermission(user, 'supplierpo.edit')) {
      return forbidden()
    }

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = letterheadSchema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const body = parsed.data

    // Validate any provided image data URLs (null clears the slot)
    const imageSlots: Array<[string, string | null | undefined]> = [
      ['headerImage', body.headerImage],
      ['footerImage', body.footerImage],
      ['fullPageImage', body.fullPageImage],
    ]
    const data: Record<string, unknown> = {
      mode: body.mode,
      showCompanyDetails: body.showCompanyDetails ?? true,
      headerHeightMm: body.headerHeightMm ?? 45,
      footerHeightMm: body.footerHeightMm ?? 25,
    }
    for (const [key, value] of imageSlots) {
      if (value === null || value === undefined) {
        data[key] = null
        continue
      }
      const valid = validateImageDataUrl(value)
      if (!valid) {
        return badRequest(
          `${key}: image must be a PNG or JPEG data URL of at most 2 MB`
        )
      }
      data[key] = valid.dataUrl
    }

    // Mode sanity: switching to a mode whose image is missing is rejected
    const current = await readConfig()
    const merged = { ...current, ...data } as LetterheadConfig
    if (merged.mode !== 'none') {
      const needsImage = merged.mode === 'full' ? merged.fullPageImage : merged.headerImage
      if (!needsImage) {
        return badRequest(
          `Upload the ${merged.mode === 'full' ? 'full-page' : 'header'} image before switching to the "${merged.mode}" letterhead mode`
        )
      }
    }

    const row = await db.companyLetterhead.findFirst()
    if (row) {
      await db.companyLetterhead.update({ where: { id: row.id }, data })
    } else {
      await db.companyLetterhead.create({ data: data as never })
    }

    await logActivity({
      user,
      action: 'updated',
      module: 'quotation',
      description: `Company letterhead settings updated (mode: ${merged.mode})`,
    })
    return ok(merged)
  } catch (err) {
    console.error('[api/letterhead PUT]', err)
    return serverError()
  }
}
