'use client'

// Prayer times widget for the home dashboard.
//
// - Times are calculated LOCALLY with the `adhan` library (Umm Al-Qura
//   method, Shafi asr) — no external API, works offline.
// - The snapshot is a pure function of the current clock, so the 1-second
//   heartbeat drives the countdown AND rolls the times over at midnight in
//   the configured timezone without any page reload.
// - After Isha the next prayer is tomorrow's Fajr (highlighted + tagged).
// - When a prayer starts, a small toast fires on the dashboard (toggle in
//   Settings → Prayer Times).

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapPin, MoonStar } from 'lucide-react'
import { toast } from 'sonner'
import { SectionCard } from '@/components/app/shared/page-header'
import { api } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import {
  PRAYER_LABELS,
  buildSnapshot,
  formatCountdown,
  type PrayerKey,
  type PrayerTimesConfig,
} from '@/lib/prayer-times'
import type { PrayerTimesSettingsView } from '@/lib/types'

export function PrayerTimesCard() {
  const [config, setConfig] = useState<PrayerTimesConfig | null>(null)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Load the location config once (defaults until an admin saves changes).
  useEffect(() => {
    let cancelled = false
    api
      .get<{ settings: PrayerTimesSettingsView }>('/api/prayer-times/settings')
      .then((res) => {
        if (!cancelled) setConfig(res.settings)
      })
      .catch(() => {
        // 401/403/network — hide the widget instead of blocking the dashboard
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 1s heartbeat: drives the countdown; at midnight (in the configured
  // timezone) the derived snapshot simply computes the new day's times.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const snap = useMemo(() => (config ? buildSnapshot(config, now) : null), [config, now])

  // Prayer-start alert: fires once when the "next" event changes AND the
  // previously-next event began within the last 20 seconds (i.e. we saw the
  // countdown hit zero). Day rollovers hours later do not fire.
  const prevNextRef = useRef<{ key: PrayerKey; instant: number; time12: string } | null>(null)
  useEffect(() => {
    if (!config || !snap?.next) return
    const prev = prevNextRef.current
    if (prev && prev.key !== snap.next.key) {
      const age = Date.now() - prev.instant
      if (age >= 0 && age < 20_000 && config.notificationsEnabled) {
        toast(`It is time for ${PRAYER_LABELS[prev.key].en} — حان الآن وقت ${PRAYER_LABELS[prev.key].ar}`, {
          description: `Started at ${prev.time12} · ${config.city}`,
        })
      }
    }
    if (snap.next) prevNextRef.current = { key: snap.next.key, instant: snap.next.instant, time12: snap.next.time12 }
  }, [snap, config])

  if (failed) return null

  if (!config || !snap) {
    // Same card shape, silent while loading
    return (
      <SectionCard className="overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
          <span className="h-10 w-10 animate-pulse rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-56 animate-pulse rounded bg-muted" />
          </div>
          <div className="hidden space-y-2 sm:block">
            <div className="h-4 w-44 animate-pulse rounded bg-muted" />
            <div className="h-3 w-36 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2.5 p-4 sm:grid-cols-6 sm:p-5">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </SectionCard>
    )
  }

  const next = snap.next
  const countdown = next ? formatCountdown(next.instant - now) : null

  return (
    <SectionCard className="overflow-hidden">
      {/* Header — bilingual title + city on the left, dates on the right */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-muted/30 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-soft ring-1 ring-gold/40">
            <MoonStar className="h-5 w-5 text-gold-deep" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-tight">
              Prayer Times <span className="font-normal text-muted-foreground">· مواقيت الصلاة</span>
            </h2>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0 text-gold-deep" />
              <span className="truncate">
                {snap.city} — Umm Al-Qura · Shafi
              </span>
            </p>
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-sm font-semibold leading-tight">{snap.gregorian}</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            {snap.hijriEn} · {snap.hijriAr}
          </p>
        </div>
      </div>

      {/* Countdown strip */}
      {next ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border/60 px-4 py-3 sm:px-5">
          <p className="text-sm">
            <span className="text-muted-foreground">Next: </span>
            <span className="font-semibold text-gold-deep dark:text-gold">
              {next.labelEn}
              {next.isTomorrow ? ' (tomorrow)' : ''} · {next.labelAr}
            </span>
            <span className="text-muted-foreground"> at {next.time12} — in</span>
          </p>
          <p
            className="text-xl font-bold leading-none tracking-tight tabular-nums text-gold-deep dark:text-gold"
            aria-live="off"
          >
            {countdown}
          </p>
        </div>
      ) : null}

      {/* The six times — next prayer highlighted in gold */}
      <div className="grid grid-cols-3 gap-2.5 p-4 sm:grid-cols-6 sm:p-5">
        {snap.times.map((t) => {
          const isNext = next !== null && t.key === next.key
          const displayTime = isNext && next.isTomorrow ? next.time12 : t.time12
          return (
            <div
              key={t.key}
              className={cn(
                'rounded-lg border p-3 text-center transition-colors',
                isNext
                  ? 'border-gold/70 bg-gold-soft/70 shadow-sm dark:bg-gold/15'
                  : 'border-border/70 bg-card'
              )}
            >
              <p
                className={cn(
                  'text-[11px] font-semibold uppercase tracking-wide',
                  isNext ? 'text-gold-deep dark:text-gold' : 'text-muted-foreground'
                )}
              >
                {PRAYER_LABELS[t.key].en}
              </p>
              <p
                className={cn(
                  'mt-0.5 text-[13px] leading-snug',
                  isNext ? 'text-gold-deep/80 dark:text-gold/80' : 'text-muted-foreground'
                )}
              >
                {PRAYER_LABELS[t.key].ar}
              </p>
              <p className="mt-1.5 text-lg font-bold leading-none tabular-nums">{displayTime}</p>
              {isNext && next.isTomorrow ? (
                <p className="mt-1 text-[10px] font-medium text-gold-deep dark:text-gold">tomorrow</p>
              ) : null}
            </div>
          )
        })}
      </div>

      <p className="border-t border-border/60 px-4 py-2 text-[11px] leading-relaxed text-muted-foreground sm:px-5">
        Calculated locally on this server — Umm Al-Qura method, Shafi asr. Times
        refresh automatically at midnight. <span>· يحسب محليًا دون اتصال بالإنترنت</span>
      </p>
    </SectionCard>
  )
}
