'use client'

// Settings → Prayer Times section: city / coordinates / timezone for the
// dashboard prayer-times widget + the prayer-start alert toggle. Saved via
// PUT /api/prayer-times/settings (settings.edit) as one JSON row in the
// existing Setting table — the dashboard widget picks the change up the next
// time it mounts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BellRing,
  Loader2,
  MapPin,
  MoonStar,
  RotateCcw,
  Save,
} from 'lucide-react'
import { toast } from 'sonner'
import { SectionCard } from '@/components/app/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api-client'
import {
  getSupportedTimezones,
  type PrayerTimesConfig,
} from '@/lib/prayer-times'
import type { PrayerTimesSettingsView } from '@/lib/types'
import { cn } from '@/lib/utils'

type FormState = {
  city: string
  latitude: string
  longitude: string
  timezone: string
  notificationsEnabled: boolean
}

function toForm(c: PrayerTimesConfig): FormState {
  return {
    city: c.city,
    latitude: String(c.latitude),
    longitude: String(c.longitude),
    timezone: c.timezone,
    notificationsEnabled: c.notificationsEnabled,
  }
}

export function PrayerTimesSettingsSection({ canEdit }: { canEdit: boolean }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<FormState | null>(null)

  const timezones = useMemo(() => getSupportedTimezones(), [])

  const load = useCallback(async () => {
    try {
      const res = await api.get<{ settings: PrayerTimesSettingsView }>('/api/prayer-times/settings')
      setForm(toForm(res.settings))
    } catch (e) {
      // leave whatever is in the form; surface the reason
      toast.error(e instanceof Error ? e.message : 'Could not load prayer times settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading || !form) {
    return (
      <SectionCard className="p-6">
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading prayer times settings…
        </div>
      </SectionCard>
    )
  }

  const lat = Number(form.latitude)
  const lng = Number(form.longitude)
  const latOk = form.latitude.trim() !== '' && Number.isFinite(lat) && lat >= -90 && lat <= 90
  const lngOk = form.longitude.trim() !== '' && Number.isFinite(lng) && lng >= -180 && lng <= 180
  const cityOk = form.city.trim() !== ''
  const canSave = canEdit && cityOk && latOk && lngOk && !saving

  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const res = await api.put<{ settings: PrayerTimesSettingsView }>('/api/prayer-times/settings', {
        city: form.city,
        latitude: lat,
        longitude: lng,
        timezone: form.timezone,
        notificationsEnabled: form.notificationsEnabled,
      })
      setForm(toForm(res.settings))
      toast.success(`Prayer times saved — the dashboard widget now shows ${res.settings.city}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save prayer times settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard className="p-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-soft ring-1 ring-gold/40">
          <MoonStar className="h-5 w-5 text-gold-deep" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Prayer Times</h2>
          <p className="text-sm text-muted-foreground">
            Location for the dashboard widget. Times are calculated locally on
            this server (Umm Al-Qura method, Shafi asr) — no internet needed.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="prayer-city">City name</Label>
          <div className="relative">
            <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="prayer-city"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
              placeholder="e.g. Al Jubail"
              className="pl-8"
              disabled={!canEdit}
            />
          </div>
          <p className="text-xs text-muted-foreground">Shown on the widget header.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="prayer-tz">Timezone</Label>
          <Select
            value={form.timezone}
            onValueChange={(v) => setForm({ ...form, timezone: v })}
            disabled={!canEdit}
          >
            <SelectTrigger id="prayer-tz" className="w-full">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            All times, the Hijri date and the midnight refresh follow this zone.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="prayer-lat">Latitude</Label>
          <Input
            id="prayer-lat"
            type="number"
            inputMode="decimal"
            step="any"
            min={-90}
            max={90}
            value={form.latitude}
            onChange={(e) => setForm({ ...form, latitude: e.target.value })}
            placeholder="27.0174"
            disabled={!canEdit}
            className={cn('font-mono', form.latitude !== '' && !latOk && 'border-destructive')}
            aria-invalid={form.latitude !== '' && !latOk}
          />
          <p className="text-xs text-muted-foreground">Between -90 and 90.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="prayer-lng">Longitude</Label>
          <Input
            id="prayer-lng"
            type="number"
            inputMode="decimal"
            step="any"
            min={-180}
            max={180}
            value={form.longitude}
            onChange={(e) => setForm({ ...form, longitude: e.target.value })}
            placeholder="49.6225"
            disabled={!canEdit}
            className={cn('font-mono', form.longitude !== '' && !lngOk && 'border-destructive')}
            aria-invalid={form.longitude !== '' && !lngOk}
          />
          <p className="text-xs text-muted-foreground">Between -180 and 180.</p>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-muted/30 p-3.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gold-soft ring-1 ring-gold/30">
            <BellRing className="h-4 w-4 text-gold-deep" />
          </span>
          <div>
            <p className="text-sm font-semibold">Prayer-start alert</p>
            <p className="text-xs leading-snug text-muted-foreground">
              Show a small notification on the dashboard when a prayer time begins.
            </p>
          </div>
        </div>
        <Switch
          checked={form.notificationsEnabled}
          onCheckedChange={(v) => setForm({ ...form, notificationsEnabled: v })}
          disabled={!canEdit}
          aria-label="Prayer-start alert"
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()} disabled={!canSave} className="gap-1.5">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save settings
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          className="gap-1.5 text-muted-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset form
        </Button>
      </div>
    </SectionCard>
  )
}
