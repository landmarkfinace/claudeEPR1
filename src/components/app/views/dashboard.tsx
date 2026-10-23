'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { TooltipProps } from 'recharts'
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  BellRing,
  BookUser,
  Building2,
  CheckCircle2,
  HandCoins,
  ChevronsDown,
  ChevronsUp,
  Clock,
  FileOutput,
  FileText,
  FolderKanban,
  IdCard,
  Loader2,
  MapPin,
  Package,
  Plus,
  ReceiptText,
  RotateCcw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
  UsersRound,
  Wallet,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/app/shared/empty-state'
import { SectionCard } from '@/components/app/shared/page-header'
import { StatTile } from '@/components/app/shared/stat-tile'
import { PrayerTimesCard } from '@/components/app/dashboard/prayer-times-card'
import { AvatarInitials } from '@/components/app/shared/avatar-initials'
import { api } from '@/lib/api-client'
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type { ActivityRow, DashboardData, DocumentAlert, ViewKey } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ExpiryBadge } from '@/components/app/shared/status-badge'

const INCOME_COLOR = '#10b981'
const EXPENSE_COLOR = '#f43f5e'
const PAID_COLOR = '#10b981'
const PENDING_COLOR = '#f59e0b'

/** Compact Y-axis tick: 1400000 → "1.4M", 700000 → "700K" */
function compactAxis(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${+(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(value / 1_000)}K`
  return String(value)
}

function ChartTooltip({
  active,
  payload,
  label,
  currency,
}: TooltipProps<number, string> & { currency: string }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-md">
      <p className="mb-1.5 text-xs font-semibold">{label}</p>
      {payload.map((item) => (
        <div key={String(item.dataKey)} className="flex items-center gap-2 py-0.5">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: item.color ?? '#94a3b8' }}
          />
          <span className="text-muted-foreground">{String(item.name ?? '')}</span>
          <span className="ml-auto pl-4 font-semibold tabular-nums">
            {formatMoney(Number(item.value), currency)}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Donut tooltip for the payroll status chart */
function DonutTooltip({
  active,
  payload,
}: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null
  const item = payload[0]
  return (
    <div className="rounded-lg border bg-popover px-3 py-1.5 text-popover-foreground shadow-md">
      <span className="text-xs font-semibold">{String(item.name)}</span>
      <span className="ml-2 text-xs tabular-nums text-muted-foreground">
        {Number(item.value)} payslips
      </span>
    </div>
  )
}

/** Payroll status donut + pending payouts quick list (latest payroll month) */
function PayrollStatusSection({
  status,
  currency,
  onMarkPaid,
  markingId,
  expanded,
  onToggleExpand,
  expanding,
}: {
  status: NonNullable<DashboardData['payrollStatus']>
  currency: string
  onMarkPaid: (row: { id: string; staffName: string; netPay: number }) => void
  markingId: string | null
  expanded: boolean
  onToggleExpand: () => void
  expanding: boolean
}) {
  const { user, setView } = useAppStore()
  const canEditPayroll = can(user, 'payroll.edit')
  const totalCount = status.paidCount + status.pendingCount
  const paidShare = totalCount > 0 ? Math.round((status.paidCount / totalCount) * 100) : 0
  const donutData = [
    { name: 'Paid', value: status.paidCount, fill: PAID_COLOR },
    { name: 'Pending', value: status.pendingCount, fill: PENDING_COLOR },
  ]

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Status donut */}
      <SectionCard className="overflow-hidden">
        <div className="border-b p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Payroll Status</h2>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {status.month}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">Latest payroll month</p>
        </div>
        <div className="flex items-center justify-center p-4 pb-2">
          <div className="relative h-[150px] w-[150px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={donutData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={52}
                  outerRadius={70}
                  paddingAngle={status.paidCount > 0 && status.pendingCount > 0 ? 3 : 0}
                  cornerRadius={6}
                  strokeWidth={0}
                  startAngle={90}
                  endAngle={-270}
                >
                  {donutData.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Pie>
                <Tooltip content={<DonutTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums leading-none">{totalCount}</span>
              <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                payslips
              </span>
            </div>
          </div>
        </div>
        <div className="space-y-3 p-4 pt-2 sm:px-5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
              style={{ width: `${paidShare}%` }}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="text-muted-foreground">Paid</span>
              <span className="ml-auto font-semibold tabular-nums">{status.paidCount}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500" />
              <span className="text-muted-foreground">Pending</span>
              <span className="ml-auto font-semibold tabular-nums">{status.pendingCount}</span>
            </div>
          </div>
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-xs text-muted-foreground">Disbursed</span>
            <span className="text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatMoney(status.paidAmount, currency)}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Awaiting payment</span>
            <span className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">
              {formatMoney(status.pendingAmount, currency)}
            </span>
          </div>
        </div>
      </SectionCard>

      {/* Pending payouts list */}
      <SectionCard className="flex flex-col overflow-hidden lg:col-span-2">
        <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="text-base font-semibold">Pending Payouts</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Top net payouts still awaiting disbursement — {status.month}
            </p>
          </div>
          {status.pendingCount > 0 ? (
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              <Clock className="h-3.5 w-3.5" />
              {status.pendingCount} pending · {formatMoney(status.pendingAmount, currency)}
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              All paid
            </div>
          )}
        </div>
        {status.pendingCount === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Everything is disbursed"
            description={`All ${totalCount} payroll entries for ${status.month} are marked as paid.`}
            className="flex-1"
          />
        ) : (
          <ul className="nice-scrollbar max-h-[268px] divide-y overflow-y-auto">
            {status.pending.map((row, i) => (
              <li key={row.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                {expanded && status.pending.length > 6 ? (
                  <span className="w-5 shrink-0 text-right text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                ) : null}
                <AvatarInitials name={row.staffName} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.staffName}</p>
                  <p className="text-xs text-muted-foreground">Net payout</p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums">
                  {formatMoney(row.netPay, currency)}
                </span>
                {canEditPayroll ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 border-emerald-600 bg-emerald-600 font-semibold text-white shadow-sm hover:border-emerald-700 hover:bg-emerald-700 hover:text-white dark:border-emerald-500 dark:bg-emerald-600 dark:hover:border-emerald-400 dark:hover:bg-emerald-500"
                    disabled={markingId !== null}
                    onClick={() => onMarkPaid(row)}
                  >
                    {markingId === row.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Banknote className="h-3.5 w-3.5" />
                    )}
                    Mark Paid
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {status.pendingCount > 6 ? (
          <div className="border-t px-4 py-2 sm:px-5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              onClick={onToggleExpand}
              disabled={expanding}
            >
              {expanding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : expanded ? (
                <ChevronsUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronsDown className="h-3.5 w-3.5" />
              )}
              {expanded
                ? 'Show top 6'
                : `Show all ${status.pendingCount} pending payouts`}
            </Button>
          </div>
        ) : null}
        <div className="mt-auto border-t px-4 py-3 sm:px-5">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setView('payroll')}>
            <Wallet className="h-4 w-4" />
            Open payroll module
          </Button>
        </div>
      </SectionCard>
    </div>
  )
}

/** IQAMA document-compliance alert card — expired + expiring-soon workforce documents */
function DocumentAlertsSection({
  alerts,
  onReview,
}: {
  alerts: NonNullable<DashboardData['documentAlerts']>
  onReview: () => void
}) {
  const expired = alerts.expired
  const expiring = alerts.expiring
  const total = expired.length + expiring.length
  if (total === 0) return null
  return (
    <SectionCard className="overflow-hidden border-amber-200/70 dark:border-amber-900/50">
      <div className="flex flex-col gap-2 border-b border-amber-100 bg-amber-50/60 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5 dark:border-amber-950 dark:bg-amber-950/30">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-semibold">Document Compliance</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {expired.length > 0 ? (
                <>
                  <span className="text-base font-bold tabular-nums text-rose-600 dark:text-rose-400">{expired.length}</span>
                  <span className="font-medium"> expired</span>
                  {' and '}
                </>
              ) : null}
              <span className="text-base font-bold tabular-nums text-amber-600 dark:text-amber-400">{expiring.length}</span>
              <span className="font-medium"> expiring</span> IQAMA{total === 1 ? '' : 's'} within 90 days
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={onReview}>
          <IdCard className="h-4 w-4" />
          Review staff
        </Button>
      </div>
      <ul className="nice-scrollbar max-h-72 divide-y overflow-y-auto">
        {expired.map((d) => (
          <DocumentAlertRow key={d.staffId} alert={d} />
        ))}
        {expiring.map((d) => (
          <DocumentAlertRow key={d.staffId} alert={d} />
        ))}
      </ul>
    </SectionCard>
  )
}

function DocumentAlertRow({ alert }: { alert: DocumentAlert }) {
  const expired = alert.daysLeft < 0
  return (
    <li className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40 sm:px-5">
      <AvatarInitials name={alert.fullName} className="h-8 w-8 text-xs" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{alert.fullName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">IQAMA {alert.iqamaId}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-medium tabular-nums">{formatDate(alert.iqamaExpiry)}</p>
        <ExpiryBadge
          status={expired ? 'expired' : 'expiring'}
          daysLeft={alert.daysLeft}
          className="mt-0.5"
        />
      </div>
    </li>
  )
}

function ActivityModuleIcon({ module }: { module: string }) {
  switch (module) {
    case 'payroll':
      return <Wallet className="h-4 w-4 text-muted-foreground" />
    case 'transaction':
    case 'transaction_category':
      return <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
    case 'staff':
    case 'staff_category':
      return <UserPlus className="h-4 w-4 text-muted-foreground" />
    case 'project':
      return <FolderKanban className="h-4 w-4 text-muted-foreground" />
    case 'user':
    case 'role':
      return <UsersRound className="h-4 w-4 text-muted-foreground" />
    case 'quotation':
      return <FileText className="h-4 w-4 text-muted-foreground" />
    case 'einvoice':
    case 'e-invoice':
    case 'e_invoice':
      return <FileOutput className="h-4 w-4 text-muted-foreground" />
    case 'namelist':
    case 'name_list':
      return <BookUser className="h-4 w-4 text-muted-foreground" />
    case 'supplier_po':
    case 'supplierpo':
      return <Package className="h-4 w-4 text-muted-foreground" />
    case 'advance':
    case 'advances':
      return <HandCoins className="h-4 w-4 text-muted-foreground" />
    default:
      return <Activity className="h-4 w-4 text-muted-foreground" />
  }
}

/** Client deployment overview — which companies our workers are at (clients.view gated) */
function ClientDeploymentSection({
  deployment,
  onViewDeployments,
}: {
  deployment: NonNullable<DashboardData['clientDeployment']>
  onViewDeployments: () => void
}) {
  const max = deployment.topClients[0]?.workers || 1
  return (
    <SectionCard className="overflow-hidden">
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Building2 className="h-4 w-4 text-primary" />
            Workforce by Client
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {deployment.deployedWorkers.toLocaleString()} workers deployed across{' '}
            <span className="font-semibold tabular-nums text-foreground">{deployment.activeClients}</span>{' '}
            active client{deployment.activeClients === 1 ? '' : 's'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 text-xs text-muted-foreground hover:text-foreground"
          onClick={onViewDeployments}
        >
          View deployments
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="space-y-2.5 p-4 sm:p-5">
        {deployment.topClients.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">
            No workers deployed to client projects yet.
          </p>
        ) : (
          deployment.topClients.map((c, i) => (
            <div key={c.id} className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-4 w-4 text-primary" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium">{c.name}</span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">
                    {c.workers} worker{c.workers === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 max-w-[220px] flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.max(6, (c.workers / max) * 100)}%`, opacity: 1 - i * 0.1 }}
                    />
                  </div>
                  {c.city ? (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {c.city}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  )
}

function ActivityItem({ item, currency }: { item: ActivityRow; currency: string }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3 sm:px-5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
        <ActivityModuleIcon module={item.module} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{item.description}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {item.userName ?? 'System'}, {formatDateTime(item.createdAt)}
        </p>
      </div>
      {item.amount !== null && item.amount !== undefined ? (
        // Neutral amount: the log does not say whether money came in or went out,
        // so it is no longer forced to a red minus figure.
        <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-semibold tabular-nums text-foreground/80">
          {formatMoney(Math.abs(item.amount), currency)}
        </span>
      ) : null}
    </li>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <Skeleton className="h-[250px] w-full rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[112px] w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-[360px] w-full lg:col-span-2" />
        <Skeleton className="h-[360px] w-full" />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/*  Hero: company position at a glance on a blueprint-grid navy panel        */
/* ------------------------------------------------------------------------ */

function greetingFor(date: Date): string {
  const h = date.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

type QuickAction = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  onClick: () => void
  mobileOnly?: boolean
}

function HeroPanel({
  firstName,
  companyName,
  currency,
  stats,
  monthIncome,
  monthExpense,
  monthLabel,
  canAccounts,
  actions,
  onOpen,
  incomeTrend,
  expenseTrend,
}: {
  firstName: string
  companyName: string
  currency: string
  stats: DashboardData['stats']
  monthIncome: number
  monthExpense: number
  monthLabel: string
  canAccounts: boolean
  actions: QuickAction[]
  onOpen: (view: ViewKey) => void
  incomeTrend?: { current: number; previous: number } | null
  expenseTrend?: { current: number; previous: number } | null
}) {
  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  const negative = stats.netBalance < 0
  return (
    <section
      className="relative overflow-hidden rounded-2xl bg-[#0F1F3D] text-[#EDE8DA] shadow-sm ring-1 ring-[#0F1F3D]/40 dark:bg-[#0B1730] dark:ring-white/5"
      aria-label="Company overview"
    >
      {/* blueprint grid — the site-drawing paper the business runs on */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.16]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(212,175,55,.35) 1px, transparent 1px), linear-gradient(90deg, rgba(212,175,55,.35) 1px, transparent 1px), linear-gradient(rgba(237,232,218,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(237,232,218,.18) 1px, transparent 1px)',
          backgroundSize: '96px 96px, 96px 96px, 24px 24px, 24px 24px',
          maskImage: 'linear-gradient(105deg, transparent 20%, black 75%)',
          WebkitMaskImage: 'linear-gradient(105deg, transparent 20%, black 75%)',
        }}
      />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-[#D4AF37] via-[#E8CB6A] to-[#B8942C]" />

      <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <p className="text-sm text-[#EDE8DA]/65">{dateLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-[1.9rem]">
            {greetingFor(now)}, {firstName}
          </h1>
          <p className="mt-1 max-w-xl text-sm text-[#EDE8DA]/70">
            Here is where {companyName} stands today.
          </p>

          {canAccounts ? (
            <div className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-5">
              <button
                type="button"
                onClick={() => onOpen('accounts-summary')}
                className="group rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
              >
                <span className="block text-xs text-[#EDE8DA]/60">Net balance, all time</span>
                <span
                  className={cn(
                    'mt-1 block text-4xl font-bold tabular-nums tracking-tight sm:text-5xl',
                    negative ? 'text-rose-300' : 'text-[#E8CB6A]'
                  )}
                >
                  <span className="mr-2 align-baseline text-lg font-semibold text-[#EDE8DA]/55 sm:text-xl">
                    {currency}
                  </span>
                  {formatNumber(stats.netBalance)}
                </span>
                <span className="mt-1 flex items-center gap-1 text-xs text-[#EDE8DA]/55 group-hover:text-[#E8CB6A]">
                  Open accounts summary
                  <ArrowUpRight className="h-3 w-3" />
                </span>
              </button>

              <div className="grid w-full grid-cols-2 gap-x-6 gap-y-3 border-t border-white/10 pt-4 sm:w-auto sm:gap-x-8 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0">
                <HeroFigure
                  label="Total income"
                  value={`${currency} ${formatNumber(stats.totalIncome)}`}
                  tone="up"
                  onClick={() => onOpen('income-list')}
                />
                <HeroFigure
                  label="Total expense"
                  value={`${currency} ${formatNumber(stats.totalExpense)}`}
                  tone="down"
                  onClick={() => onOpen('expense-list')}
                />
                <HeroFigure
                  label={`Income in ${monthLabel}`}
                  value={`${currency} ${formatNumber(monthIncome)}`}
                  trend={incomeTrend}
                />
                <HeroFigure
                  label={`Expense in ${monthLabel}`}
                  value={`${currency} ${formatNumber(monthExpense)}`}
                  trend={expenseTrend}
                  invertTrend
                />
              </div>
            </div>
          ) : null}
        </div>

        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2 lg:max-w-[340px] lg:flex-col lg:items-stretch">
            {actions.map((a) => (
              <Button
                key={a.label}
                size="sm"
                onClick={a.onClick}
                className={cn(
                  'h-9 gap-1.5 border border-white/15 bg-white/[0.06] font-medium text-white shadow-none hover:bg-[#D4AF37] hover:text-[#0F1F3D] focus-visible:ring-[#D4AF37]',
                  a.mobileOnly && 'lg:hidden'
                )}
              >
                <a.icon className="h-4 w-4" />
                {a.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function HeroFigure({
  label,
  value,
  tone,
  onClick,
  trend,
  invertTrend,
}: {
  label: string
  value: string
  tone?: 'up' | 'down'
  onClick?: () => void
  trend?: { current: number; previous: number } | null
  /** expense: an increase is bad — flip the trend colour */
  invertTrend?: boolean
}) {
  const trendChip = trend && trend.previous > 0 ? buildTrendChip(trend, invertTrend) : null
  const content = (
    <>
      <span className="block text-xs text-[#EDE8DA]/55">{label}</span>
      <span className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[15px] font-semibold tabular-nums text-white sm:text-lg">
        {tone === 'up' ? <TrendingUp className="h-4 w-4 text-emerald-300" /> : null}
        {tone === 'down' ? <TrendingDown className="h-4 w-4 text-rose-300" /> : null}
        {value}
      </span>
      {trendChip}
    </>
  )
  if (!onClick) return <div>{content}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md text-left outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
    >
      {content}
    </button>
  )
}

/** Small hero trend chip: emerald when good, rose when bad. */
function buildTrendChip(
  trend: { current: number; previous: number },
  invert?: boolean
): React.ReactNode {
  const pct = ((trend.current - trend.previous) / trend.previous) * 100
  if (!Number.isFinite(pct)) return null
  const rounded = Math.round(Math.abs(pct))
  if (rounded === 0)
    return (
      <span className="mt-1 block text-[11px] font-medium text-[#EDE8DA]/55">No change vs last month</span>
    )
  const up = pct > 0
  const good = invert ? !up : up
  return (
    <span
      className={cn(
        'mt-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
        good ? 'bg-emerald-400/15 text-emerald-300' : 'bg-rose-400/15 text-rose-300'
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {rounded}%
      <span className="font-normal text-[#EDE8DA]/55">vs last month</span>
    </span>
  )
}

/* ------------------------------------------------------------------------ */
/*  Needs-attention queue                                                    */
/* ------------------------------------------------------------------------ */

type AttentionItem = {
  key: string
  tone: 'red' | 'amber' | 'blue'
  count: number
  text: string
  view: ViewKey
}

function AttentionStrip({ items, onOpen }: { items: AttentionItem[]; onOpen: (v: ViewKey) => void }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Nothing needs your attention right now.
      </div>
    )
  }
  const toneClass: Record<AttentionItem['tone'], string> = {
    red: 'border-rose-200 bg-rose-50 text-rose-900 hover:border-rose-300 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200',
    amber:
      'border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-300 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
    blue: 'border-sky-200 bg-sky-50 text-sky-900 hover:border-sky-300 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200',
  }
  const numClass: Record<AttentionItem['tone'], string> = {
    red: 'bg-rose-600 text-white',
    amber: 'bg-amber-500 text-white',
    blue: 'bg-sky-600 text-white',
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex w-full items-center gap-1.5 pr-1 text-sm font-semibold text-foreground sm:w-auto">
        <BellRing className="h-4 w-4 text-[#B8942C]" />
        Needs attention
      </span>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => onOpen(it.view)}
          className={cn(
            'flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
            toneClass[it.tone]
          )}
        >
          <span
            className={cn(
              'flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums',
              numClass[it.tone]
            )}
          >
            {it.count}
          </span>
          {it.text}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------------ */
/*  Business pipeline: receivables, quotations, supplier P.O.s               */
/* ------------------------------------------------------------------------ */

function PipelineSection({
  receivables,
  pipeline,
  currency,
  onOpen,
}: {
  receivables: DashboardData['receivables']
  pipeline: DashboardData['pipeline']
  currency: string
  onOpen: (v: ViewKey) => void
}) {
  const rows: {
    key: string
    icon: React.ComponentType<{ className?: string }>
    title: string
    detail: string
    amount: string | null
    warn?: boolean
    view: ViewKey
  }[] = []
  if (receivables) {
    rows.push({
      key: 'recv',
      icon: FileOutput,
      title: 'Unpaid invoices',
      detail:
        receivables.openCount === 0
          ? 'All issued invoices are paid'
          : `${receivables.openCount} open invoice${receivables.openCount === 1 ? '' : 's'}`,
      amount: formatMoney(receivables.outstanding, currency),
      view: 'e-invoices',
    })
    if (receivables.overdueCount > 0) {
      rows.push({
        key: 'overdue',
        icon: AlertTriangle,
        title: 'Overdue',
        detail: `${receivables.overdueCount} invoice${receivables.overdueCount === 1 ? '' : 's'} past the due date`,
        amount: formatMoney(receivables.overdueAmount, currency),
        warn: true,
        view: 'e-invoices',
      })
    }
    rows.push({
      key: 'billed',
      icon: ReceiptText,
      title: 'Invoiced this month',
      detail: 'Issued invoices, including VAT',
      amount: formatMoney(receivables.invoicedThisMonth, currency),
      view: 'e-invoices',
    })
  }
  if (pipeline && pipeline.quotationsSent !== null) {
    rows.push({
      key: 'quotes',
      icon: FileText,
      title: 'Quotations awaiting reply',
      detail:
        `${pipeline.quotationsSent} sent` +
        (pipeline.quotationsDraft ? `, ${pipeline.quotationsDraft} still in draft` : ''),
      amount: formatMoney(pipeline.quotationsSentValue ?? 0, currency),
      view: 'quotations',
    })
  }
  if (pipeline && pipeline.posOrdered !== null) {
    rows.push({
      key: 'pos',
      icon: Package,
      title: 'Supplier P.O.s on order',
      detail: `${pipeline.posOrdered} not yet received`,
      amount: formatMoney(pipeline.posOrderedValue ?? 0, currency),
      view: 'supplier-pos',
    })
  }
  if (rows.length === 0) return null
  return (
    <SectionCard className="flex flex-col overflow-hidden">
      <div className="border-b p-4 sm:p-5">
        <h2 className="text-base font-semibold">Money in the pipeline</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">Billing, offers and purchase orders still open</p>
      </div>
      <ul className="flex-1 divide-y">
        {rows.map((r) => (
          <li key={r.key}>
            <button
              type="button"
              onClick={() => onOpen(r.view)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted sm:px-5"
            >
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  r.warn ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300' : 'bg-[#F5EDD8] text-[#7A5F14] dark:bg-[#D4AF37]/15 dark:text-[#E8CB6A]'
                )}
              >
                <r.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.detail}</span>
              </span>
              {r.amount ? (
                <span
                  className={cn(
                    'shrink-0 text-sm font-semibold tabular-nums',
                    r.warn && 'text-rose-700 dark:text-rose-400'
                  )}
                >
                  {r.amount}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/* ------------------------------------------------------------------------ */
/*  Today's name lists                                                       */
/* ------------------------------------------------------------------------ */

const LIST_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  sent: 'Sent',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

function TodayListsSection({
  today,
  canCreate,
  onOpenModule,
  onCreate,
}: {
  today: NonNullable<DashboardData['todayLists']>
  canCreate: boolean
  onOpenModule: () => void
  onCreate: () => void
}) {
  return (
    <SectionCard className="flex flex-col overflow-hidden">
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <BookUser className="h-4 w-4 text-primary dark:text-[#E8CB6A]" />
            Name lists today
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {today.listCount === 0
              ? 'No workers are scheduled to go out today'
              : `${today.listCount} list${today.listCount === 1 ? '' : 's'}, ${today.workerCount} worker${today.workerCount === 1 ? '' : 's'} going out`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 text-xs text-muted-foreground hover:text-foreground"
          onClick={onOpenModule}
        >
          Open name lists
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      {today.listCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">Sending workers for an interview or mobilization today?</p>
          {canCreate ? (
            <Button size="sm" variant="outline" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              New name list
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="nice-scrollbar max-h-[300px] divide-y overflow-y-auto">
          {today.lists.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
              <span className="w-12 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
                {l.time || '—'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{l.clientName}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.subjectColor }} />
                  {l.subjectName}, {l.listNo}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums">
                  {l.workers} <span className="text-xs font-normal text-muted-foreground">workers</span>
                </span>
                <span className="block text-[11px] text-muted-foreground">{LIST_STATUS_LABEL[l.status] ?? l.status}</span>
              </span>
            </li>
          ))}
          {today.listCount > today.lists.length ? (
            <li className="px-4 py-2 text-xs text-muted-foreground sm:px-5">
              {today.listCount - today.lists.length} more list{today.listCount - today.lists.length === 1 ? '' : 's'} in the module
            </li>
          ) : null}
        </ul>
      )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------------ */
/*  Financial chart (period switcher: 6 months · this month · 3 months · year) */
/* ------------------------------------------------------------------------ */

type ChartRangeKey = 'default' | 'month' | '3m' | 'year'

const RANGE_OPTIONS: { key: ChartRangeKey; label: string }[] = [
  { key: 'default', label: '6 months' },
  { key: 'month', label: 'This month' },
  { key: '3m', label: 'Last 3 months' },
  { key: 'year', label: 'This year' },
]

function FinancialChart({
  data,
  currency,
  range,
  onRangeChange,
  loading,
}: {
  data: DashboardData['chart']
  currency: string
  range: ChartRangeKey
  onRangeChange: (r: ChartRangeKey) => void
  loading?: boolean
}) {
  const hasAny = data.some((d) => d.income !== 0 || d.expense !== 0)
  const rows = data.map((d) => ({ ...d, label: d.month.split(' ')[0] }))
  const subtitle =
    range === 'month'
      ? 'Current month, by week'
      : range === '3m'
        ? 'Last 3 months, by month'
        : range === 'year'
          ? 'Last 12 months, by month'
          : 'Last 6 months, by month'
  return (
    <SectionCard className="overflow-hidden lg:col-span-2">
      <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h2 className="text-base font-semibold">Income and expense</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {/* Period switcher — refetches /api/dashboard?range=… */}
        <div
          role="tablist"
          aria-label="Chart period"
          className="flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"
        >
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              role="tab"
              aria-selected={range === opt.key}
              onClick={() => onRangeChange(opt.key)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors outline-none',
                range === opt.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 px-4 pt-3 text-xs text-muted-foreground sm:px-5">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: INCOME_COLOR }} />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: EXPENSE_COLOR }} />
          Expense
        </span>
      </div>
      {hasAny ? (
        <div className={cn('h-[300px] w-full p-2 sm:p-4', loading && 'opacity-60 transition-opacity')}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4} barCategoryGap="28%">
              <CartesianGrid stroke="#94a3b8" strokeOpacity={0.25} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickMargin={8}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: '#64748b' }}
                width={52}
                tickFormatter={(value) => compactAxis(Number(value))}
              />
              <Tooltip
                cursor={{ fill: '#94a3b8', fillOpacity: 0.1 }}
                content={<ChartTooltip currency={currency} />}
                labelFormatter={(_, p) => (p?.[0]?.payload?.month as string) ?? ''}
              />
              <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={34} />
              <Bar dataKey="expense" name="Expense" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={34} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <EmptyState
          icon={BarChart3}
          title="No income or expense in this period"
          description="Add income and expense entries in Accounts and they will be charted here."
          className="py-14"
        />
      )}
    </SectionCard>
  )
}

/* ------------------------------------------------------------------------ */
/*  Main view                                                                */
/* ------------------------------------------------------------------------ */

export function DashboardView() {
  const { setView, setPendingIntent, user, settings } = useAppStore()
  const currency = settings.currency
  const canViewActivity = can(user, 'activity.view')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Pending payouts "show all" toggle (6 → full list and back)
  const [pendingLimit, setPendingLimit] = useState(6)
  const [expanding, setExpanding] = useState(false)
  // Chart / KPI-trend period (default = historical 6-month behaviour).
  // range lives in a ref so `load` stays stable across period switches
  // (no double-fetch from the pendingLimit effect below).
  const [range, setRange] = useState<ChartRangeKey>('default')
  const rangeRef = useRef<ChartRangeKey>('default')
  const [rangeLoading, setRangeLoading] = useState(false)

  const load = useCallback(
    async (showLoading = true, r?: ChartRangeKey) => {
      const effRange = r ?? rangeRef.current
      if (showLoading) setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (pendingLimit !== 6) params.set('pendingLimit', String(pendingLimit))
        if (effRange !== 'default') params.set('range', effRange)
        const qs = params.toString()
        const res = await api.get<DashboardData>(`/api/dashboard${qs ? `?${qs}` : ''}`)
        setData(res)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Something went wrong'
        setError(message)
        toast.error(message)
      } finally {
        if (showLoading) setLoading(false)
      }
    },
    [pendingLimit]
  )

  // Single load driver: full skeleton on mount, silent refresh on expansion change
  const pendingLimitRef = useRef(6)
  useEffect(() => {
    const isInitial = pendingLimitRef.current === pendingLimit
    pendingLimitRef.current = pendingLimit
    if (isInitial) {
      void load(true)
    } else {
      setExpanding(true)
      load(false)
        .catch(() => undefined)
        .finally(() => setExpanding(false))
    }
  }, [load, pendingLimit])

  // Period switch: silent refresh (the previous data dims instead of a skeleton)
  const handleRangeChange = useCallback(
    (r: ChartRangeKey) => {
      if (r === rangeRef.current) return
      rangeRef.current = r
      setRange(r)
      setRangeLoading(true)
      load(false, r)
        .catch(() => undefined)
        .finally(() => setRangeLoading(false))
    },
    [load]
  )

  // Quick action: mark a pending payroll as paid (syncs the linked Salary expense)
  const [markingId, setMarkingId] = useState<string | null>(null)
  async function handleMarkPaid(row: { id: string; staffName: string; netPay: number }) {
    setMarkingId(row.id)
    try {
      await api.post(`/api/payrolls/${row.id}/mark-paid`, {})
      toast.success(`Salary paid: ${row.staffName}, ${formatMoney(row.netPay, currency)}`)
      await load(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to mark payroll as paid')
    } finally {
      setMarkingId(null)
    }
  }

  const openCreate = useCallback(
    (view: ViewKey) => {
      setPendingIntent({ view, kind: 'create' })
      setView(view)
    },
    [setPendingIntent, setView]
  )

  if (loading && !data) return <DashboardSkeleton />

  if (!data) {
    return (
      <SectionCard>
        <EmptyState
          icon={AlertTriangle}
          title="The dashboard could not load"
          description={error ?? 'Check your connection, then try again.'}
          action={
            <Button variant="outline" onClick={() => void load()}>
              <RotateCcw className="h-4 w-4" />
              Try again
            </Button>
          }
        />
      </SectionCard>
    )
  }

  const { stats } = data
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? 'there'
  const canAccounts = can(user, 'accounts.view')
  // Month figures come from the trends payload (always the CURRENT calendar
  // month) so the hero stays correct regardless of the chart period switch.
  const monthLabel = new Date().toLocaleDateString('en-GB', { month: 'long' })
  const monthIncome = data.trends?.income?.current ?? 0
  const monthExpense = data.trends?.expense?.current ?? 0

  // Quick actions (only the ones this user may perform)
  const actions: QuickAction[] = []
  if (can(user, 'namelist.create')) actions.push({ label: 'New name list', icon: BookUser, onClick: () => openCreate('name-list') })
  if (can(user, 'einvoices.create')) actions.push({ label: 'New invoice', icon: FileOutput, onClick: () => openCreate('e-invoices') })
  if (can(user, 'quotations.create')) actions.push({ label: 'New quotation', icon: FileText, onClick: () => openCreate('quotations') })
  // Add Income / Add Expense live in the top bar on desktop; on phones the top
  // bar has no room, so they are shown here (mobileOnly) instead.
  if (can(user, 'accounts.create')) {
    actions.push({ label: 'Add income', icon: TrendingUp, onClick: () => openCreate('income-list'), mobileOnly: true })
    actions.push({ label: 'Add expense', icon: TrendingDown, onClick: () => openCreate('expense-list'), mobileOnly: true })
  }

  // Needs-attention queue
  const attention: AttentionItem[] = []
  if (data.documentAlerts) {
    if (data.documentAlerts.expired.length > 0)
      attention.push({ key: 'iq-exp', tone: 'red', count: data.documentAlerts.expired.length, text: `IQAMA expired`, view: 'staff-list' })
    const soon = data.documentAlerts.expiring.filter((d) => d.daysLeft <= 30).length
    if (soon > 0)
      attention.push({ key: 'iq-soon', tone: 'amber', count: soon, text: 'IQAMA expiring within 30 days', view: 'staff-list' })
  }
  if (data.receivables && data.receivables.overdueCount > 0)
    attention.push({ key: 'inv-od', tone: 'red', count: data.receivables.overdueCount, text: 'Overdue invoices', view: 'e-invoices' })
  if (data.payrollStatus && can(user, 'payroll.view') && data.payrollStatus.pendingCount > 0)
    attention.push({ key: 'pay', tone: 'amber', count: data.payrollStatus.pendingCount, text: `Salaries unpaid for ${data.payrollStatus.month}`, view: 'payroll' })
  if (data.pipeline?.quotationsSent)
    attention.push({ key: 'q', tone: 'blue', count: data.pipeline.quotationsSent, text: 'Quotations awaiting reply', view: 'quotations' })
  if (data.todayLists && data.todayLists.listCount > 0)
    attention.push({ key: 'nl', tone: 'blue', count: data.todayLists.listCount, text: 'Name lists going out today', view: 'name-list' })
  // Phase 2 e-invoices signed but not yet cleared/reported (or rejected)
  if (data.zatcaPending && data.zatcaPending.count > 0)
    attention.push({
      key: 'zatca',
      tone: data.zatcaPending.rejected > 0 ? 'red' : 'amber',
      count: data.zatcaPending.count,
      text:
        data.zatcaPending.rejected > 0
          ? `Phase 2 invoices rejected by ZATCA`
          : 'Phase 2 invoices not yet cleared',
      view: 'e-invoices',
    })

  const wf = data.workforce
  const onSitePct = wf && wf.active > 0 ? Math.round((wf.onSite / wf.active) * 100) : 0

  return (
    <div className="space-y-4 sm:space-y-6">
      <h1 className="sr-only">Dashboard</h1>
      <HeroPanel
        firstName={firstName}
        companyName={settings.companyName || 'the company'}
        currency={currency}
        stats={stats}
        monthIncome={monthIncome}
        monthExpense={monthExpense}
        monthLabel={monthLabel}
        canAccounts={canAccounts}
        actions={actions}
        onOpen={setView}
        incomeTrend={data.trends?.income ?? null}
        expenseTrend={data.trends?.expense ?? null}
      />

      <AttentionStrip items={attention} onOpen={setView} />

      {/* Prayer times — locally calculated (Umm Al-Qura), rolls over at midnight */}
      <PrayerTimesCard />

      {/* Metric tiles — every original "more info" link is kept; trends show
          where previous-period data exists */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Total staff"
          value={stats.totalStaff.toLocaleString()}
          note={wf ? `${wf.onSite} on site, ${wf.available} available` : 'Active workforce members'}
          icon={Users}
          tone="navy"
          linkLabel="View staff"
          onOpen={() => setView('staff-list')}
        >
          {wf && wf.active > 0 ? (
            <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-muted" title={`${onSitePct}% on site`}>
              <span className="block h-full rounded-full bg-primary dark:bg-gold" style={{ width: `${onSitePct}%` }} />
            </span>
          ) : null}
        </StatTile>
        <StatTile
          label="Salary paid"
          value={formatNumber(stats.salaryPaid)}
          prefix={currency}
          note="Disbursed payroll total"
          icon={BadgeDollarSign}
          tone="teal"
          trend={data.trends?.salaryPaid ?? undefined}
          linkLabel="View payroll"
          onOpen={() => setView('payroll')}
        />
        {stats.advanceOutstanding !== null ? (
          <StatTile
            label="Advance outstanding"
            value={formatNumber(stats.advanceOutstanding)}
            prefix={currency}
            note="Not yet recovered from salaries"
            icon={HandCoins}
            tone="warning"
            linkLabel="View advances"
            onOpen={() => setView('advances')}
          />
        ) : null}
        {data.receivables ? (
          <StatTile
            label="To collect"
            value={formatNumber(data.receivables.outstanding)}
            prefix={currency}
            note={`${data.receivables.openCount} unpaid invoice${data.receivables.openCount === 1 ? '' : 's'}`}
            icon={FileOutput}
            tone="gold"
            linkLabel="View invoices"
            onOpen={() => setView('e-invoices')}
          />
        ) : null}
        <StatTile
          label="System users"
          value={stats.totalUsers.toLocaleString()}
          note="Accounts that can sign in"
          icon={UsersRound}
          tone="violet"
          linkLabel="View users"
          onOpen={() => setView('users')}
        />
      </div>

      {/* Chart + money pipeline */}
      <div className="grid gap-4 lg:grid-cols-3">
        {canAccounts ? (
          <FinancialChart
            data={data.chart}
            currency={currency}
            range={range}
            onRangeChange={handleRangeChange}
            loading={rangeLoading}
          />
        ) : null}
        <PipelineSection
          receivables={data.receivables ?? null}
          pipeline={data.pipeline ?? null}
          currency={currency}
          onOpen={setView}
        />
      </div>

      {/* Payroll status (latest payroll month) */}
      {data.payrollStatus && can(user, 'payroll.view') ? (
        <PayrollStatusSection
          status={data.payrollStatus}
          currency={currency}
          onMarkPaid={(row) => void handleMarkPaid(row)}
          markingId={markingId}
          expanded={pendingLimit !== 6}
          onToggleExpand={() => setPendingLimit((l) => (l === 6 ? 200 : 6))}
          expanding={expanding}
        />
      ) : null}

      {/* People on the ground: today's lists + client deployment */}
      {data.todayLists || data.clientDeployment ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.todayLists ? (
            <TodayListsSection
              today={data.todayLists}
              canCreate={can(user, 'namelist.create')}
              onOpenModule={() => setView('name-list')}
              onCreate={() => openCreate('name-list')}
            />
          ) : null}
          {data.clientDeployment ? (
            <ClientDeploymentSection
              deployment={data.clientDeployment}
              onViewDeployments={() => setView('deployments')}
            />
          ) : null}
        </div>
      ) : null}

      {/* IQAMA compliance + activity */}
      <div className="grid gap-4 lg:grid-cols-5">
        {data.documentAlerts &&
        data.documentAlerts.expired.length + data.documentAlerts.expiring.length > 0 ? (
          <div className={canViewActivity ? 'lg:col-span-3' : 'lg:col-span-5'}>
            <DocumentAlertsSection alerts={data.documentAlerts} onReview={() => setView('staff-list')} />
          </div>
        ) : null}

        {canViewActivity ? (
          <SectionCard
            className={cn(
              'flex flex-col overflow-hidden',
              data.documentAlerts && data.documentAlerts.expired.length + data.documentAlerts.expiring.length > 0
                ? 'lg:col-span-2'
                : 'lg:col-span-5'
            )}
          >
            <div className="flex items-center justify-between gap-2 border-b p-4 sm:p-5">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">Recent activity</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">Latest actions across all modules</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setView('activity-log')}
              >
                View all
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            {data.recentActivity.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No activity yet"
                description="Sign-ins, payroll runs and new entries will show up here."
                className="flex-1"
              />
            ) : (
              <ul className="nice-scrollbar max-h-[420px] divide-y overflow-y-auto">
                {data.recentActivity.map((item) => (
                  <ActivityItem key={item.id} item={item} currency={currency} />
                ))}
              </ul>
            )}
          </SectionCard>
        ) : null}
      </div>
    </div>
  )
}
