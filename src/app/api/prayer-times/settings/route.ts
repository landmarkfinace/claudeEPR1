// Prayer times settings API — config for the dashboard widget (city,
// coordinates, timezone, prayer-start alert). Stored as ONE JSON row in the
// existing Setting key/value table (key 'prayerTimes') — purely additive, no
// new table. GET is for any signed-in user (the widget and the Settings form
// both read it); PUT requires settings.edit and is zod-validated.
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
import {
  DEFAULT_PRAYER_TIMES_CONFIG,
  isValidTimezone,
  sanitizePrayerConfig,
  type PrayerTimesConfig,
} from '@/lib/prayer-times'

export const dynamic = 'force-dynamic'

const SETTING_KEY = 'prayerTimes'

const schema = z.object({
  city: z.string().trim().min(1, 'City name is required').max(80, 'City name is too long'),
  latitude: z.coerce
    .number()
    .min(-90, 'Latitude must be between -90 and 90')
    .max(90, 'Latitude must be between -90 and 90'),
  longitude: z.coerce
    .number()
    .min(-180, 'Longitude must be between -180 and 180')
    .max(180, 'Longitude must be between -180 and 180'),
  timezone: z
    .string()
    .trim()
    .min(1, 'Timezone is required')
    .max(64, 'Timezone is too long')
    .refine(isValidTimezone, 'Unknown timezone'),
  notificationsEnabled: z.boolean(),
})

async function readConfig(): Promise<PrayerTimesConfig> {
  const row = await db.setting.findUnique({ where: { key: SETTING_KEY } })
  if (!row) return DEFAULT_PRAYER_TIMES_CONFIG
  try {
    return sanitizePrayerConfig(JSON.parse(row.value))
  } catch {
    return DEFAULT_PRAYER_TIMES_CONFIG
  }
}

export async function GET() {
  const auth = await requireAuth()
  if (isResponse(auth)) return auth
  try {
    return ok({ settings: await readConfig() })
  } catch {
    return serverError()
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requirePermission('settings.edit')
  if (isResponse(auth)) return auth
  try {
    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request body')
    }
    const config: PrayerTimesConfig = parsed.data
    const value = JSON.stringify(config)
    await db.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value },
      create: { key: SETTING_KEY, value },
    })
    await logActivity({
      user: auth,
      action: 'updated',
      module: 'settings',
      description: `Prayer times settings updated (${config.city}, ${config.latitude.toFixed(4)}, ${config.longitude.toFixed(4)}, ${config.timezone})`,
    })
    return ok({ settings: config })
  } catch {
    return serverError()
  }
}
