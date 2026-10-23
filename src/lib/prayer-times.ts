// Prayer-times engine — shared by the dashboard widget (client) and the
// settings API (server). All calculation is LOCAL: the `adhan` library
// (Umm Al-Qura method, Shafi asr) + Intl for calendars. No network calls.
//
// How adhan is used here:
//  - input date is constructed LOCALLY from the target calendar day, because
//    adhan reads the year/month/day with local getters;
//  - adhan returns TRUE UTC instants of each prayer for the coordinates, so
//    the wall-clock display is simply the instant formatted with Intl in the
//    configured timezone (works no matter which timezone the browser/server
//    runs in).

import * as adhan from 'adhan'

export type PrayerKey = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha'

export const PRAYER_ORDER: readonly PrayerKey[] = [
  'fajr',
  'sunrise',
  'dhuhr',
  'asr',
  'maghrib',
  'isha',
] as const

export const PRAYER_LABELS: Record<PrayerKey, { en: string; ar: string }> = {
  fajr: { en: 'Fajr', ar: 'الفجر' },
  sunrise: { en: 'Sunrise', ar: 'الشروق' },
  dhuhr: { en: 'Dhuhr', ar: 'الظهر' },
  asr: { en: 'Asr', ar: 'العصر' },
  maghrib: { en: 'Maghrib', ar: 'المغرب' },
  isha: { en: 'Isha', ar: 'العشاء' },
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export type PrayerTimesConfig = {
  city: string
  latitude: number
  longitude: number
  timezone: string
  notificationsEnabled: boolean
}

export const DEFAULT_PRAYER_TIMES_CONFIG: PrayerTimesConfig = {
  city: 'Al Jubail',
  latitude: 27.0174,
  longitude: 49.6225,
  timezone: 'Asia/Riyadh',
  notificationsEnabled: true,
}

export function isValidTimezone(tz: unknown): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Clamp/repair an untrusted value into a safe config. Used on the GET path
 *  (a stored row could be hand-edited); PUT bodies are zod-validated first. */
export function sanitizePrayerConfig(v: unknown): PrayerTimesConfig {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const d = DEFAULT_PRAYER_TIMES_CONFIG
  const clamp = (n: unknown, lo: number, hi: number, fallback: number): number =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback
  return {
    city:
      typeof o.city === 'string' && o.city.trim() !== ''
        ? o.city.trim().slice(0, 80)
        : d.city,
    latitude: clamp(o.latitude, -90, 90, d.latitude),
    longitude: clamp(o.longitude, -180, 180, d.longitude),
    timezone: isValidTimezone(o.timezone) ? (o.timezone as string) : d.timezone,
    notificationsEnabled:
      typeof o.notificationsEnabled === 'boolean' ? o.notificationsEnabled : d.notificationsEnabled,
  }
}

// ---------------------------------------------------------------------------
// Timezone helpers (Intl-based, formatter cache per timezone)
// ---------------------------------------------------------------------------

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>()

function zonedPartsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    partsFormatters.set(tz, f)
  }
  return f
}

/** Calendar + clock parts of an instant, as seen in `tz`. */
export function zonedParts(ms: number, tz: string): ZonedParts {
  const parts = zonedPartsFormatter(tz).formatToParts(new Date(ms))
  const num = (type: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === type)
    return p ? parseInt(p.value, 10) : 0
  }
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour'),
    minute: num('minute'),
    second: num('second'),
  }
}

const time12Formatters = new Map<string, Intl.DateTimeFormat>()

function time12(tz: string, instant: number): string {
  let f = time12Formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    time12Formatters.set(tz, f)
  }
  return f.format(new Date(instant))
}

const gregFormatters = new Map<string, Intl.DateTimeFormat>()

function gregorian(tz: string, instant: number): string {
  let f = gregFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
    gregFormatters.set(tz, f)
  }
  return f.format(new Date(instant))
}

const hijriFormatters = new Map<string, Intl.DateTimeFormat>()

/** Hijri date via the Umm Al-Qura civil calendar (built into Intl — offline). */
function hijri(tz: string, instant: number, arabic: boolean): string {
  const kind = arabic ? 'ar' : 'en'
  let f = hijriFormatters.get(`${kind}:${tz}`)
  if (!f) {
    f = new Intl.DateTimeFormat(
      arabic ? 'ar-SA-u-ca-islamic-umalqura' : 'en-US-u-ca-islamic-umalqura',
      { timeZone: tz, day: 'numeric', month: 'long', year: 'numeric' }
    )
    hijriFormatters.set(`${kind}:${tz}`, f)
  }
  return f.format(new Date(instant))
}

function ensureSuffix(s: string, suffix: string): string {
  return s.includes(suffix) ? s : `${s}${suffix}`
}

// ---------------------------------------------------------------------------
// Daily calculation (adhan — Umm Al-Qura, Shafi asr)
// ---------------------------------------------------------------------------

export type PrayerTimeEntry = {
  key: PrayerKey
  /** Wall-clock time in the configured timezone, 12-hour ("4:35 AM"). */
  time12: string
  /** True epoch ms of the event (countdowns compare against this). */
  instant: number
}

function computeDayTimes(
  config: PrayerTimesConfig,
  tz: string,
  year: number,
  month: number,
  day: number
): PrayerTimeEntry[] {
  const params = adhan.CalculationMethod.UmmAlQura()
  params.madhab = adhan.Madhab.Shafi
  // LOCAL construction: adhan extracts the calendar day with local getters,
  // so this yields the same Y/M/D in any runtime timezone.
  const date = new Date(year, month - 1, day)
  const pt = new adhan.PrayerTimes(
    new adhan.Coordinates(config.latitude, config.longitude),
    date,
    params
  )
  const sources: [PrayerKey, Date][] = [
    ['fajr', pt.fajr],
    ['sunrise', pt.sunrise],
    ['dhuhr', pt.dhuhr],
    ['asr', pt.asr],
    ['maghrib', pt.maghrib],
    ['isha', pt.isha],
  ]
  const out: PrayerTimeEntry[] = []
  for (const [key, t] of sources) {
    const instant = t.getTime()
    // Pathological coordinates (polar day/night) — skip broken entries.
    if (!Number.isFinite(instant)) continue
    out.push({ key, instant, time12: time12(tz, instant) })
  }
  return out
}

function nextCalendarDay(p: ZonedParts): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(p.year, p.month - 1, p.day + 1))
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() }
}

// ---------------------------------------------------------------------------
// Snapshot for the widget
// ---------------------------------------------------------------------------

export type NextPrayerInfo = {
  key: PrayerKey
  labelEn: string
  labelAr: string
  time12: string
  instant: number
  /** True after Isha, when the next prayer is tomorrow's Fajr. */
  isTomorrow: boolean
}

export type PrayerTimesSnapshot = {
  /** Calculation day in the configured timezone ('YYYY-MM-DD'). */
  dateKey: string
  city: string
  timezone: string
  gregorian: string
  hijriEn: string
  hijriAr: string
  times: PrayerTimeEntry[]
  next: NextPrayerInfo | null
}

/**
 * Everything the widget displays, derived from the current clock. Because the
 * calculation day comes from `nowMs` in the configured timezone, the snapshot
 * automatically rolls over to the next day's times at midnight — no reload,
 * no extra timer needed.
 */
export function buildSnapshot(config: PrayerTimesConfig, nowMs: number): PrayerTimesSnapshot {
  const tz = isValidTimezone(config.timezone) ? config.timezone : DEFAULT_PRAYER_TIMES_CONFIG.timezone
  const parts = zonedParts(nowMs, tz)
  const times = computeDayTimes(config, tz, parts.year, parts.month, parts.day)

  let nextEntry = times.find((e) => e.instant > nowMs) ?? null
  let isTomorrow = false
  if (!nextEntry) {
    // After Isha (or a day whose times all passed) → tomorrow's Fajr.
    const tom = nextCalendarDay(parts)
    const tomorrow = computeDayTimes(config, tz, tom.year, tom.month, tom.day)
    const fajr = tomorrow.find((e) => e.key === 'fajr') ?? null
    if (fajr) {
      nextEntry = fajr
      isTomorrow = true
    }
  }

  const next: NextPrayerInfo | null = nextEntry
    ? {
        key: nextEntry.key,
        labelEn: PRAYER_LABELS[nextEntry.key].en,
        labelAr: PRAYER_LABELS[nextEntry.key].ar,
        time12: nextEntry.time12,
        instant: nextEntry.instant,
        isTomorrow,
      }
    : null

  const pad2 = (n: number): string => String(n).padStart(2, '0')
  return {
    dateKey: `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`,
    city: config.city,
    timezone: tz,
    gregorian: gregorian(tz, nowMs),
    hijriEn: ensureSuffix(hijri(tz, nowMs, false), ' AH'),
    hijriAr: ensureSuffix(hijri(tz, nowMs, true), ' هـ'),
    times,
    next,
  }
}

/** "01:23:45" — clamped at 0, hours not capped (can exceed 24h in theory). */
export function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

// ---------------------------------------------------------------------------
// Timezone list for the Settings form
// ---------------------------------------------------------------------------

export function getSupportedTimezones(): string[] {
  let list: string[] = []
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf
    if (typeof supported === 'function') list = supported('timeZone') ?? []
  } catch {
    list = []
  }
  if (list.length === 0) {
    list = [
      'Asia/Riyadh',
      'Asia/Dubai',
      'Asia/Kuwait',
      'Asia/Qatar',
      'Asia/Bahrain',
      'Asia/Muscat',
      'Asia/Amman',
      'Asia/Baghdad',
      'Africa/Cairo',
      'Europe/Istanbul',
      'Europe/London',
      'UTC',
    ]
  }
  return list
}
