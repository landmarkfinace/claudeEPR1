'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

/** Skeleton for a row of stat/summary tiles above tables. */
export function StatTileSkeleton({ count = 4 }: { count?: number }) {
  // Static class maps (Tailwind can't compile dynamic class strings)
  const grid =
    count <= 2
      ? 'sm:grid-cols-2'
      : count === 3
        ? 'grid-cols-1 sm:grid-cols-3'
        : count === 4
          ? 'grid-cols-2 md:grid-cols-4'
          : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-5'
  return (
    <div className={cn('grid gap-3', grid)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-[104px] w-full" style={{ animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  )
}

/** Skeleton for a card widget (chart / list panel). */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-xl border bg-card p-4 sm:p-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-8 w-24" />
      </div>
      <Skeleton className="mt-5 h-[220px] w-full" />
    </div>
  )
}

/** Standard page skeleton: header row + summary tiles + table card. */
export function PageSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <StatTileSkeleton count={tiles} />
      <div className="rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b p-4">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="ml-auto h-9 w-28" />
        </div>
        <div className="divide-y">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-20" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-8" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
