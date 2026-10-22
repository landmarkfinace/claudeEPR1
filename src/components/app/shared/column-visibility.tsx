'use client'

import { useCallback, useState } from 'react'
import { Columns3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/**
 * Column visibility for data tables. Give it the ordered column ids + labels;
 * it returns which columns are on and a toolbar trigger menu. First column
 * can be pinned (always visible) — usually the row identity column.
 */
export function useColumnVisibility<T extends string>(
  columns: readonly { id: T; label: string }[],
  opts: { initiallyHidden?: T[]; pinFirst?: boolean } = {}
) {
  const [hidden, setHidden] = useState<Set<T>>(new Set(opts.initiallyHidden ?? []))

  const toggle = useCallback((id: T) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const isVisible = useCallback((id: T) => !hidden.has(id), [hidden])

  const menu = (
    <ColumnVisibilityMenu
      columns={columns}
      hidden={hidden}
      onToggle={toggle}
      pinFirst={opts.pinFirst ?? true}
    />
  )

  return { hidden, toggle, isVisible, menu }
}

function ColumnVisibilityMenu<T extends string>({
  columns,
  hidden,
  onToggle,
  pinFirst,
}: {
  columns: readonly { id: T; label: string }[]
  hidden: Set<T>
  onToggle: (id: T) => void
  pinFirst: boolean
}) {
  const toggleable = pinFirst ? columns.slice(1) : [...columns]
  const visibleCount = toggleable.filter((c) => !hidden.has(c.id)).length
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-1.5"
          aria-label="Toggle column visibility"
        >
          <Columns3 className="h-4 w-4" />
          <span className="hidden sm:inline">Columns</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {visibleCount} of {toggleable.length} columns shown
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {toggleable.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.id}
            checked={!hidden.has(c.id)}
            onCheckedChange={() => onToggle(c.id)}
            onSelect={(e) => e.preventDefault()}
            className="text-sm capitalize"
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
