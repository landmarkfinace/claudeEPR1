'use client'

import { cn } from '@/lib/utils'
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'

/**
 * Money — "SAR 12,345.00" with the currency code smaller and muted,
 * tabular numerals. Negative amounts render in the danger colour.
 */
export function MoneyText({
  value,
  currency = 'SAR',
  className,
  muted = false,
}: {
  value: number | null | undefined
  currency?: string
  className?: string
  /** muted = secondary/less emphasised money (subtotals, helper rows) */
  muted?: boolean
}) {
  const negative = (value ?? 0) < 0
  return (
    <span
      className={cn(
        'whitespace-nowrap tabular-nums',
        negative ? 'text-danger' : muted ? 'text-muted-foreground' : 'text-foreground',
        className
      )}
    >
      <span className="mr-1 text-[0.78em] font-medium uppercase tracking-wide text-muted-foreground/80">
        {currency}
      </span>
      {formatNumber(value)}
    </span>
  )
}

/** Date — "21 Oct 2026" (never raw ISO strings). */
export function DateText({
  value,
  className,
  fallback = '—',
}: {
  value: string | Date | null | undefined
  className?: string
  fallback?: string
}) {
  const formatted = formatDate(value)
  return (
    <span className={cn('whitespace-nowrap tabular-nums', className)}>
      {formatted === '—' ? fallback : formatted}
    </span>
  )
}

/** Date + time — "21 Oct 2026, 2:30 PM". */
export function DateTimeText({
  value,
  className,
  fallback = '—',
}: {
  value: string | Date | null | undefined
  className?: string
  fallback?: string
}) {
  const formatted = formatDateTime(value)
  return (
    <span className={cn('whitespace-nowrap tabular-nums', className)}>
      {formatted === '—' ? fallback : formatted}
    </span>
  )
}
