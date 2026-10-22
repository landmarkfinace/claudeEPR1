'use client'

import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'

/**
 * StatTile — the premium flat summary tile (Linear/Stripe-style).
 * No gradients: border + shadow-sm elevation, an accent icon chip and an
 * optional trend vs the previous period. The whole tile can link to its
 * module; the "More info" affordance is preserved through `linkLabel`.
 */
export function StatTile({
  label,
  value,
  prefix,
  icon: Icon,
  tone = 'default',
  note,
  trend,
  linkLabel,
  onOpen,
  children,
}: {
  label: string
  /** Pre-formatted value (counts may use toLocaleString, money uses formatNumber). */
  value: string
  /** Currency code / unit rendered small and muted before the value. */
  prefix?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'default' | 'navy' | 'gold' | 'success' | 'warning' | 'danger' | 'info' | 'violet' | 'teal'
  note?: string
  /** Trend vs previous period — rendered as a coloured chip with %. */
  trend?: { current: number; previous: number; invert?: boolean }
  linkLabel?: string
  onOpen?: () => void
  children?: React.ReactNode
}) {
  const toneChip: Record<string, string> = {
    default: 'bg-muted text-foreground',
    navy: 'bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary',
    gold: 'bg-gold-soft text-gold-deep dark:bg-gold/15 dark:text-gold',
    success: 'bg-success-soft text-success dark:bg-success-soft dark:text-success-soft-foreground',
    warning: 'bg-warning-soft text-warning-soft-foreground dark:text-warning-soft-foreground',
    danger: 'bg-danger-soft text-danger-soft-foreground dark:text-danger-soft-foreground',
    info: 'bg-info-soft text-info-soft-foreground dark:text-info-soft-foreground',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    teal: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  }
  const accentBar: Record<string, string> = {
    default: 'bg-muted-foreground/40',
    navy: 'bg-primary',
    gold: 'bg-gold',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
    violet: 'bg-violet-500',
    teal: 'bg-teal-500',
  }

  const body = (
    <>
      <span aria-hidden className={cn('absolute left-0 top-4 h-8 w-[3px] rounded-r', accentBar[tone])} />
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-medium text-muted-foreground">{label}</span>
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', toneChip[tone])}>
          <Icon className="h-4 w-4" />
        </span>
      </span>
      <span
        className="mt-2 flex items-baseline gap-1.5 truncate text-[22px] font-bold leading-none tracking-tight tabular-nums"
        title={prefix ? `${prefix} ${value}` : value}
      >
        {prefix ? <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{prefix}</span> : null}
        {value}
      </span>
      {trend && trend.previous > 0 ? <TrendChip trend={trend} /> : null}
      {note ? <span className="mt-1.5 truncate text-xs leading-snug text-muted-foreground">{note}</span> : null}
      {children}
      {linkLabel && onOpen ? (
        <span className="mt-3 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          {linkLabel}
          <ArrowUpRight className="h-3 w-3" />
        </span>
      ) : null}
    </>
  )

  if (linkLabel && onOpen) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="group relative flex min-w-0 flex-col rounded-xl border bg-card p-4 text-left shadow-sm outline-none transition-all duration-150 hover:border-gold/60 hover:shadow-md active:translate-y-px"
      >
        {body}
      </button>
    )
  }
  return (
    <div className="relative flex min-w-0 flex-col rounded-xl border bg-card p-4 shadow-sm">
      {body}
    </div>
  )
}

/** Trend chip: +12% vs previous period. `invert` flips semantics (expense up = bad). */
function TrendChip({ trend }: { trend: { current: number; previous: number; invert?: boolean } }) {
  const { current, previous, invert } = trend
  if (previous <= 0) return null
  const pct = ((current - previous) / previous) * 100
  if (!Number.isFinite(pct)) return null
  const rounded = Math.round(Math.abs(pct))
  if (rounded === 0) {
    return (
      <span className="mt-1.5 inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground">
        <Minus className="h-3 w-3" /> No change
      </span>
    )
  }
  const up = pct > 0
  const good = invert ? !up : up
  return (
    <span
      className={cn(
        'mt-1.5 inline-flex w-fit items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        good ? 'bg-success-soft text-success-soft-foreground' : 'bg-danger-soft text-danger-soft-foreground'
      )}
      title={`${formatNumber(current)} vs ${formatNumber(previous)} in the previous period`}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {rounded}%
    </span>
  )
}

/**
 * SummaryStrip — the compact in-card totals row rendered above a table
 * (e.g. E-Invoice: Total · Paid · Outstanding · Overdue). Money values use
 * the muted-currency MoneyText pattern; each item can show a tone dot.
 */
export function SummaryStrip({
  items,
  className,
}: {
  items: {
    label: string
    value: string
    tone?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gold'
  }[]
  className?: string
}) {
  const dot: Record<string, string> = {
    default: 'bg-muted-foreground/50',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
    gold: 'bg-gold',
  }
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-2 border-b bg-muted/30 px-4 py-2.5 sm:px-5',
        className
      )}
    >
      {items.map((it) => (
        <span key={it.label} className="flex items-baseline gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', dot[it.tone ?? 'default'])} />
            {it.label}
          </span>
          <span className="font-semibold tabular-nums">{it.value}</span>
        </span>
      ))}
    </div>
  )
}
