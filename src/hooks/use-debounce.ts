'use client'

import { useEffect, useState } from 'react'

/** Debounce a changing value (for search inputs). 300 ms matches the
 *  app-wide toolbar search spec — snappy but server-friendly. */
export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])
  return debounced
}
