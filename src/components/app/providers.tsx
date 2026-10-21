'use client'

import { ThemeProvider } from 'next-themes'

/**
 * App-wide providers. The ThemeProvider lives in the root layout so its
 * no-flash theme script is rendered on the server (React 19 warns when the
 * script is injected by a client-only render, and dark mode would flash).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
      {children}
    </ThemeProvider>
  )
}
