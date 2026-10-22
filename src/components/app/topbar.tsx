'use client'

import { useState } from 'react'
import { useSidebar } from '@/components/ui/sidebar'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ChevronRight, Keyboard, KeyRound, LogOut, Moon, PanelLeft, Search, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { can, useAppStore } from '@/lib/store'
import { useSyncExternalStore } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ShortcutsDialog } from '@/components/app/shortcuts-dialog'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { ChangePasswordDialog } from '@/components/app/change-password-dialog'
import { VIEW_SECTION } from '@/components/app/sidebar'
import { VIEW_LABELS } from '@/lib/types'
import type { ViewKey } from '@/lib/types'

const emptySubscribe = () => () => {}
/** true after hydration (avoids SSR/client theme mismatch) */
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )
}

const VIEW_TITLES: Partial<Record<ViewKey, { title: string; subtitle: string }>> = {
  dashboard: { title: 'Dashboard', subtitle: 'Company overview & financial performance' },
  projects: { title: 'Project Management', subtitle: 'Construction project directory' },
  'staff-list': { title: 'Staff List', subtitle: 'Workforce directory & profiles' },
  'staff-categories': { title: 'Staff Categories', subtitle: 'Job categories & classifications' },
  attendance: { title: 'Staff Attendance', subtitle: 'Check-in / check-out records' },
  payroll: { title: 'Payroll', subtitle: 'Monthly payroll processing' },
  advances: { title: 'Worker Advances', subtitle: 'Salary advances & payroll recovery' },
  'salary-sheet': { title: 'Salary Sheet', subtitle: 'Monthly payroll sheet & printing' },
  'salary-summary': { title: 'Staff Salary Summary', subtitle: 'Category-wise salary breakdown' },
  'client-salary-summary': { title: 'Client Salary Summary', subtitle: 'Client billing — payroll hours × client rate + VAT' },
  'income-list': { title: 'Income List', subtitle: 'Company income transactions' },
  'expense-list': { title: 'Expense List', subtitle: 'Company expense transactions' },
  'accounts-summary': { title: 'Accounts Summary', subtitle: 'Income vs expense analysis' },
  'transaction-categories': { title: 'Transaction Categories', subtitle: 'Income & expense categories' },
  'vat-return-expense': { title: 'VAT Return Expense', subtitle: 'Monthly VAT bill register & returns' },
  quotations: { title: 'Quotations', subtitle: 'Client offers & pricing documents' },
  'e-invoices': { title: 'E-Invoice', subtitle: 'ZATCA bilingual tax invoices' },
  'supplier-pos': { title: 'Supplier P.O.', subtitle: 'Manpower purchase orders' },
  agreements: { title: 'Agreements', subtitle: 'Contract management' },
  'name-list': { title: 'Name List', subtitle: 'Worker deployment lists' },
  deployments: { title: 'Worker Deployment', subtitle: 'Who works where' },
  clients: { title: 'Clients', subtitle: 'Client company directory' },
  roles: { title: 'Roles & Permissions', subtitle: 'Role-based access control' },
  users: { title: 'Users', subtitle: 'System user accounts' },
  settings: { title: 'Settings', subtitle: 'Company profile & preferences' },
  'activity-log': { title: 'Activity Log', subtitle: 'Full audit trail' },
  'ai-assistant': { title: 'AI Assistant', subtitle: 'Ask anything about your data' },
}

export function Topbar({
  onOpenPalette,
  onLogout,
}: {
  onOpenPalette: () => void
  onLogout: () => void
}) {
  const { view } = useAppStore()
  const { toggleSidebar } = useSidebar()
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useHydrated()
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [changePwOpen, setChangePwOpen] = useState(false)
  const { user } = useAppStore()

  const meta = VIEW_TITLES[view] ?? { title: VIEW_LABELS[view] ?? 'Dashboard', subtitle: '' }
  const section = VIEW_SECTION[view]

  return (
    <>
      <header
        className="sticky top-0 z-20 shrink-0 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex h-14 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>

          {/* Breadcrumb + page title */}
          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <li className="hidden sm:block">
                <button
                  type="button"
                  onClick={() => useAppStore.getState().setView('dashboard')}
                  className="rounded-sm outline-none transition-colors hover:text-foreground"
                >
                  Landmark
                </button>
              </li>
              {section && section !== 'Overview' ? (
                <>
                  <li aria-hidden className="hidden sm:block">
                    <ChevronRight className="h-3 w-3" />
                  </li>
                  <li className="hidden sm:block truncate">{section}</li>
                </>
              ) : null}
              <li aria-hidden>
                <ChevronRight className="h-3 w-3 sm:hidden" />
              </li>
              <li className="truncate text-foreground/80">{meta.title}</li>
            </ol>
            <h2 className="truncate text-sm font-semibold leading-tight">
              {meta.title}
              {meta.subtitle ? (
                <span className="ml-2 hidden text-xs font-normal text-muted-foreground lg:inline">
                  {meta.subtitle}
                </span>
              ) : null}
            </h2>
          </nav>

          <div className="flex items-center gap-1.5">
            {/* Global search / command palette trigger */}
            <button
              type="button"
              onClick={onOpenPalette}
              className="hidden h-9 items-center gap-2 rounded-lg border border-input bg-muted/40 px-3 text-sm text-muted-foreground shadow-sm transition-colors hover:bg-muted/80 hover:text-foreground md:flex"
              aria-label="Open command palette (Ctrl+K)"
            >
              <Search className="h-4 w-4" />
              <span className="leading-none">Search…</span>
              <kbd className="pointer-events-none ml-1 select-none rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground">
                Ctrl K
              </kbd>
            </button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 md:hidden"
              onClick={onOpenPalette}
              aria-label="Open command palette"
            >
              <Search className="h-4 w-4" />
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden h-9 w-9 sm:inline-flex"
                  onClick={() => setShortcutsOpen(true)}
                  aria-label="Keyboard shortcuts"
                >
                  <Keyboard className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
            </Tooltip>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {mounted && resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Separator orientation="vertical" className="!h-5" />
            <TopbarActions />

            {/* User menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Open user menu"
                  className="ml-0.5 rounded-full outline-none ring-gold transition-shadow hover:ring-2"
                >
                  <AvatarInitials name={user?.name} src={user?.avatar} className="h-9 w-9 text-xs" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
                    <AvatarInitials name={user?.name} src={user?.avatar} />
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-semibold">{user?.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {user?.role?.name ?? user?.email}
                      </span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setChangePwOpen(true)}>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Change password
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onLogout} className="text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      {/* thin gold brand hairline under the header */}
      <div className="gold-rule pointer-events-none sticky top-14 z-20 opacity-70" aria-hidden />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ChangePasswordDialog open={changePwOpen} onOpenChange={setChangePwOpen} />
    </>
  )
}

function TopbarActions() {
  const { view, user, setView, setPendingIntent } = useAppStore()
  if (view !== 'dashboard') return null
  // Hidden for users who cannot create transactions (the API would refuse anyway)
  if (!can(user, 'accounts.create')) return null
  // Open the module AND its "add" dialog directly (previously it only switched page)
  const open = (target: 'income-list' | 'expense-list') => {
    setPendingIntent({ view: target, kind: 'create' })
    setView(target)
  }
  return (
    <div className="hidden items-center gap-2 lg:flex">
      <Button size="sm" variant="outline" onClick={() => open('income-list')} className="h-8">
        Add Income
      </Button>
      <Button size="sm" onClick={() => open('expense-list')} className="h-8">
        Add Expense
      </Button>
    </div>
  )
}
