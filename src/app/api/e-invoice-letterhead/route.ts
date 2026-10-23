// E-Invoice letterhead API — GET (read config) / PUT (save config).
// The E-Invoice module's own company letterhead: a 45 mm header band + a
// 25 mm footer band (full A4 width on every page) and an optional watermark
// centered behind the invoice body. Stored as five rows in the shared Setting
// KV table (NO schema change):
//   einvoice_lh_header               PNG data URL ('' when unset)
//   einvoice_lh_footer               PNG data URL ('' when unset)
//   einvoice_lh_watermark            PNG data URL ('' when unset)
//   einvoice_lh_watermark_opacity    '100' (10–100)
//   einvoice_lh_watermark_enabled    'true' | 'false'
// Images arrive as base64 data URLs and are validated PNG-ONLY (magic-byte
// sniffed via the shared validator, then the mime must be image/png — the
// watermark needs transparency and the bands are designed as PNG artwork),
// ≤ 2 MB decoded.
// GET requires einvoices.view OR settings.view (the print dialog and the
// Settings section both read it); PUT requires settings.edit (it is managed
// from Settings → Company Letterhead, like the other settings sections).
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
import type { EInvoiceLetterheadConfig } from '@/lib/types'

const KEYS = [
  'einvoice_lh_header',
  'einvoice_lh_footer',
  'einvoice_lh_watermark',
  'einvoice_lh_watermark_opacity',
  'einvoice_lh_watermark_enabled',
] as const

const DEFAULTS: Record<(typeof KEYS)[number], string> = {
  einvoice_lh_header: '',
  einvoice_lh_footer: '',
  einvoice_lh_watermark: '',
  einvoice_lh_watermark_opacity: '100',
  einvoice_lh_watermark_enabled: 'true',
}

const letterheadSchema = z.object({
  header: z.string().optional(),
  footer: z.string().optional(),
  watermark: z.string().optional(),
  watermarkOpacity: z.coerce.number().int().min(10).max(100).optional(),
  watermarkEnabled: z.boolean().optional(),
})

async function readConfigMap(): Promise<Record<string, string>> {
  const rows = await db.setting.findMany({ where: { key: { in: [...KEYS] } } })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return map
}

function mapToConfig(map: Record<string, string>): EInvoiceLetterheadConfig {
  const opacity = parseInt(map.einvoice_lh_watermark_opacity ?? DEFAULTS.einvoice_lh_watermark_opacity, 10)
  return {
    header: map.einvoice_lh_header ?? DEFAULTS.einvoice_lh_header,
    footer: map.einvoice_lh_footer ?? DEFAULTS.einvoice_lh_footer,
    watermark: map.einvoice_lh_watermark ?? DEFAULTS.einvoice_lh_watermark,
    watermarkOpacity: Number.isFinite(opacity)
      ? Math.min(100, Math.max(10, opacity))
      : 100,
    watermarkEnabled: (map.einvoice_lh_watermark_enabled ?? DEFAULTS.einvoice_lh_watermark_enabled) !== 'false',
  }
}

/** Upsert (value) or remove (null) one Setting row. */
async function writeSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.setting.deleteMany({ where: { key } })
    return
  }
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

export async function GET() {
  try {
    const user = await getSessionUser()
    if (!user) return unauthorized()
    // The config powers the E-Invoice print dialog and is managed from the
    // Settings view — either permission grants read access.
    if (!hasPermission(user, 'einvoices.view') && !hasPermission(user, 'settings.view')) {
      return forbidden()
    }
    const map = await readConfigMap()
    return ok(mapToConfig(map))
  } catch (err) {
    console.error('[api/e-invoice-letterhead GET]', err)
    return serverError()
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return unauthorized()
    if (!hasPermission(user, 'settings.edit')) return forbidden()

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

    // PNG image slots — '' clears the slot; anything else must be a valid
    // PNG data URL (the shared validator also caps it at 2 MB decoded).
    const imageSlots: Array<['header' | 'footer' | 'watermark', string | undefined]> = [
      ['header', body.header],
      ['footer', body.footer],
      ['watermark', body.watermark],
    ]
    const values: Record<string, string | null> = {}
    for (const [key, value] of imageSlots) {
      if (value === undefined) continue // not provided — keep as-is
      if (value === '') {
        values[`einvoice_lh_${key}`] = null // explicit clear
        continue
      }
      const valid = validateImageDataUrl(value)
      if (!valid || valid.mime !== 'image/png') {
        return badRequest(
          `${key}: image must be a PNG (transparent) data URL of at most 2 MB`
        )
      }
      values[`einvoice_lh_${key}`] = valid.dataUrl
    }
    if (body.watermarkOpacity !== undefined) {
      values.einvoice_lh_watermark_opacity = String(body.watermarkOpacity)
    }
    if (body.watermarkEnabled !== undefined) {
      values.einvoice_lh_watermark_enabled = body.watermarkEnabled ? 'true' : 'false'
    }

    for (const key of KEYS) {
      if (key in values) await writeSetting(key, values[key])
    }

    const map = await readConfigMap()
    const merged = mapToConfig(map)
    await logActivity({
      user,
      action: 'updated',
      module: 'einvoice',
      description: `E-Invoice letterhead settings updated (header ${merged.header ? 'on' : '—'}, footer ${merged.footer ? 'on' : '—'}, watermark ${merged.watermark && merged.watermarkEnabled ? `${merged.watermarkOpacity}%` : 'off'})`,
    })
    return ok(merged)
  } catch (err) {
    console.error('[api/e-invoice-letterhead PUT]', err)
    return serverError()
  }
}
