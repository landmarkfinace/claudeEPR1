'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Error state with a Retry action — the standard fetch-failure presentation
 * for every module screen. Shows a plain, human message (never a raw stack),
 * names what failed, and offers one obvious recovery action.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
  retryLabel = 'Retry',
  className,
  compact = false,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
  /** compact = inside a widget/card; default = full-view height */
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-danger/30 bg-danger-soft/40 p-6 text-center',
        compact ? 'py-8' : 'py-14',
        className
      )}
      role="alert"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-soft text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <div className="max-w-md">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1 gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          {retryLabel}
        </Button>
      ) : null}
    </div>
  )
}
