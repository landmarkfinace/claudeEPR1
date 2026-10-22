'use client'

import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function StatCard({
  title,
  value,
  icon: Icon,
  tone = 'navy',
  onMoreInfo,
  moreInfoLabel = 'More info',
  sublabel,
  valuePrefix,
}: {
  title: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'navy' | 'gold' | 'green' | 'red' | 'amber' | 'violet' | 'teal'
  onMoreInfo?: () => void
  moreInfoLabel?: string
  sublabel?: string
  /** Small de-emphasized unit/prefix rendered before the value (e.g. "SAR") —
   *  visually unifies money cards with plain count cards */
  valuePrefix?: string
}) {
  const tones: Record<string, string> = {
    // Flat premium tints — cards never use gradients (hero panel only)
    navy: 'bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary',
    gold: 'bg-gold-soft text-gold-deep dark:bg-gold/15 dark:text-gold',
    green: 'bg-success-soft text-success dark:bg-success-soft dark:text-success-soft-foreground',
    red: 'bg-danger-soft text-danger dark:bg-danger-soft dark:text-danger-soft-foreground',
    amber: 'bg-warning-soft text-warning-soft-foreground dark:bg-warning-soft dark:text-warning-soft-foreground',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    teal: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  }
  return (
    <div className="group relative overflow-hidden rounded-xl border bg-card shadow-sm transition-all duration-150 hover:border-gold/50 hover:shadow-md">
      <div className={cn('flex items-start justify-between gap-3 p-4 sm:p-5', onMoreInfo && 'pb-11 sm:pb-11')}>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-muted-foreground" title={title}>
            {title}
          </p>
          <p
            className="mt-1.5 text-balance text-xl font-bold tabular-nums leading-tight tracking-tight break-words hyphens-none sm:text-2xl"
            title={valuePrefix ? `${valuePrefix} ${value}` : value}
          >
            {valuePrefix ? (
              <span className="mr-1.5 align-baseline text-sm font-semibold text-muted-foreground/80 sm:text-base">
                {valuePrefix}
              </span>
            ) : null}
            {value}
          </p>
          {sublabel ? <p className="mt-1 text-xs leading-snug text-muted-foreground">{sublabel}</p> : null}
        </div>
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 ring-black/5 sm:h-11 sm:w-11',
            tones[tone]
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
      {onMoreInfo ? (
        <button
          type="button"
          onClick={onMoreInfo}
          className="absolute inset-x-0 bottom-0 flex w-full items-center justify-between border-t bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
        >
          <span>{moreInfoLabel}</span>
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </button>
      ) : null}
    </div>
  )
}
