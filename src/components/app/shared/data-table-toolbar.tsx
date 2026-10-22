'use client'

import { useEffect, useRef, useState } from 'react'
import { Filter, Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * DataTableToolbar — the standard list-toolbar pattern for every module:
 *
 *   [ Search… (debounced 300 ms) ] [ filter chips / popovers … ] [ Clear ]
 *                                    (collapse behind "Filters" on mobile)
 *                                    right slot: exports · column visibility · primary action
 *
 * The search input is CONTROLLED: `search` is the raw value, views keep their
 * own `useDebounce(search)` (300 ms) wired into their query — one debounce,
 * no double-wait. "/" focuses the field (when not already typing in one).
 */
export function DataTableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  filters,
  onClear,
  activeFilterCount = 0,
  clearLabel = 'Clear filters',
  children,
  className,
}: {
  search?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  /** Filter controls (FilterSelect, date inputs, chips…) — collapses on mobile */
  filters?: React.ReactNode
  /** Clear-filters handler; renders only when provided */
  onClear?: () => void
  /** Number of active filters — badges the mobile toggle */
  activeFilterCount?: number
  clearLabel?: string
  /** Right-aligned slot: exports, column visibility, primary action */
  children?: React.ReactNode
  className?: string
}) {
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const hasSearch = search !== undefined && onSearchChange !== undefined
  const hasFilters = Boolean(filters)
  const hasClear = Boolean(onClear)

  // "/" focuses search — desktop power-user affordance
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement | null)?.tagName ?? '')
      ) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      {/* Row 1: search (full-width on mobile) + right slot */}
      <div className="flex flex-wrap items-center gap-2">
        {hasSearch ? (
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" aria-hidden />
            <input
              ref={inputRef}
              type="search"
              value={search}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-9 w-full rounded-lg border border-input bg-background pl-8 pr-8 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus-visible:border-ring"
            />
            {search ? (
              <button
                type="button"
                onClick={() => onSearchChange?.('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Mobile: filters toggle */}
        {hasFilters ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 md:hidden"
            onClick={() => setMobileFiltersOpen((v) => !v)}
            aria-expanded={mobileFiltersOpen}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 ? (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold tabular-nums text-primary-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
      </div>

      {/* Row 2: filters — inline on desktop, collapsible panel on mobile */}
      {hasFilters || hasClear ? (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2',
            !mobileFiltersOpen && 'hidden md:flex'
          )}
        >
          {filters}
          {hasClear ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1 px-2.5 text-muted-foreground hover:text-foreground"
              onClick={onClear}
            >
              <X className="h-3.5 w-3.5" />
              {clearLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** A single static "chip" label for the filter row (e.g. a date-range summary). */
export function ToolbarChip({
  icon: Icon,
  children,
  onRemove,
}: {
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  onRemove?: () => void
}) {
  if (onRemove) {
    return (
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-muted/50 px-3 text-sm text-foreground transition-colors hover:bg-muted"
      >
        {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
        {children}
        <X className="h-3 w-3 text-muted-foreground" />
      </button>
    )
  }
  return (
    <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-muted/50 px-3 text-sm text-foreground">
      {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
      {children}
    </span>
  )
}

/** Re-exported icon so adopters don't import lucide directly for the same purpose. */
export { Filter as ToolbarFilterIcon }
