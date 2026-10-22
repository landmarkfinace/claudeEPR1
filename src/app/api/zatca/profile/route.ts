// ZATCA profile — GET (any e-invoice viewer) / PUT (settings.edit).
// Company phase (Phase 1 / Phase 2), environment, EGS unit identity and the
// seller's national address. Keys, CSIDs and secrets are never returned.
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { ok, badRequest, serverError, requirePermission, isResponse, logActivity } from '@/lib/api-helpers'
import { readZatcaProfile, writeZatcaSetting, SELLER_ADDRESS_KEYS } from '@/lib/zatca'

export const dynamic = 'force-dynamic'

const profileSchema = z.object({
  mode: z.enum(['phase1', 'phase2']).optional(),
  env: z.enum(['local', 'sandbox', 'simulation', 'production']).optional(),
  egsSerial: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === '' || /^1-[^|]+\|2-[^|]+\|3-[^|]+$/.test(v), 'EGS serial must look like 1-Solution|2-Model|3-SerialNo')
    .optional(),
  egsName: z.string().trim().max(64).optional(),
  branchName: z.string().trim().max(64).optional(),
  industry: z.string().trim().max(64).optional(),
  invoiceTypes: z.enum(['1100', '1000', '0100']).optional(),
  sellerAddress: z
    .object({
      street: z.string().trim().max(120),
      buildingNo: z.string().trim().max(4).refine((v) => v === '' || /^\d{4}$/.test(v), 'Building number must be 4 digits'),
      additionalNo: z.string().trim().max(4).refine((v) => v === '' || /^\d{4}$/.test(v), 'Additional number must be 4 digits'),
      district: z.string().trim().max(120),
      city: z.string().trim().max(120),
      postalCode: z.string().trim().max(5).refine((v) => v === '' || /^\d{5}$/.test(v), 'Postal code must be 5 digits'),
    })
    .optional(),
})

export async function GET() {
  try {
    const auth = await requirePermission('einvoices.view')
    if (isResponse(auth)) return auth
    return ok(await readZatcaProfile())
  } catch {
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
    const parsed = profileSchema.safeParse(raw)
    if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    const b = parsed.data

    if (b.mode) await writeZatcaSetting('zatca_mode', b.mode)
    if (b.env) await writeZatcaSetting('zatca_environment', b.env)
    if (b.egsSerial !== undefined) await writeZatcaSetting('zatca_egs_serial', b.egsSerial)
    if (b.egsName !== undefined) await writeZatcaSetting('zatca_egs_name', b.egsName)
    if (b.branchName !== undefined) await writeZatcaSetting('zatca_branch_name', b.branchName)
    if (b.industry !== undefined) await writeZatcaSetting('zatca_branch_industry', b.industry)
    if (b.invoiceTypes) await writeZatcaSetting('zatca_invoice_types', b.invoiceTypes)
    if (b.sellerAddress) {
      for (const [k, key] of Object.entries(SELLER_ADDRESS_KEYS)) {
        await writeZatcaSetting(key, b.sellerAddress[k as keyof typeof b.sellerAddress] ?? '')
      }
    }

    const profile = await readZatcaProfile()
    await logActivity({
      user: auth,
      action: 'update',
      module: 'settings',
      description: `ZATCA settings updated (${profile.mode === 'phase2' ? 'Phase 2' : 'Phase 1'}, ${profile.env})`,
    })
    return ok(profile)
  } catch {
    return serverError()
  }
}
