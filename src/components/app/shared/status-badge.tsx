'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/**
 * ONE colour map for every status in the app.
 * Tokens (success / warning / danger / info / neutral / brand) are CSS
 * variables defined in globals.css for light AND dark mode — gold is never
 * used for success or errors.
 */
export type BadgeKind =
  // brand
  | 'active' // navy (brand)
  // success family
  | 'paid' | 'completed' | 'accepted' | 'deducted' | 'received' | 'signed' | 'income' | 'success'
  // warning family
  | 'pending' | 'partially_paid' | 'partially_deducted' | 'warning'
  // danger family
  | 'expense' | 'rejected' | 'expired' | 'overdue' | 'danger'
  // info family
  | 'issued' | 'sent' | 'ordered' | 'final' | 'info'
  // neutral family
  | 'inactive' | 'draft' | 'cancelled' | 'neutral'

const S = {
  brand: 'border-primary/25 bg-primary/10 text-primary dark:border-white/20 dark:bg-white/10 dark:text-white',
  success:
    'border-success/25 bg-success-soft text-success-soft-foreground dark:bg-success-soft dark:text-success-soft-foreground',
  warning:
    'border-warning/30 bg-warning-soft text-warning-soft-foreground dark:bg-warning-soft dark:text-warning-soft-foreground',
  danger:
    'border-danger/25 bg-danger-soft text-danger-soft-foreground dark:bg-danger-soft dark:text-danger-soft-foreground',
  info: 'border-info/25 bg-info-soft text-info-soft-foreground dark:bg-info-soft dark:text-info-soft-foreground',
  neutral: 'border-border bg-muted text-muted-foreground',
  neutralSoft: 'border-border bg-muted/60 text-muted-foreground',
} as const

const styles: Record<BadgeKind, string> = {
  active: S.brand,
  paid: S.success,
  completed: S.success,
  accepted: S.success,
  deducted: S.success,
  received: S.success,
  signed: S.success,
  income: S.success,
  success: S.success,
  pending: S.warning,
  partially_paid: S.warning,
  partially_deducted: S.warning,
  warning: S.warning,
  expense: S.danger,
  rejected: S.danger,
  expired: S.danger,
  overdue: S.danger,
  danger: S.danger,
  issued: S.info,
  sent: S.info,
  ordered: S.info,
  final: S.info,
  info: S.info,
  inactive: S.neutralSoft,
  draft: S.neutral,
  cancelled: S.neutralSoft,
  neutral: S.neutral,
}

const labels: Record<BadgeKind, string> = {
  active: 'Active',
  paid: 'Paid',
  completed: 'Completed',
  accepted: 'Accepted',
  deducted: 'Deducted',
  received: 'Received',
  signed: 'Signed',
  income: 'Income',
  success: 'Success',
  pending: 'Pending',
  partially_paid: 'Partially paid',
  partially_deducted: 'Partially deducted',
  warning: 'Warning',
  expense: 'Expense',
  rejected: 'Rejected',
  expired: 'Expired',
  overdue: 'Overdue',
  danger: 'Error',
  issued: 'Issued',
  sent: 'Sent',
  ordered: 'Ordered',
  final: 'Final',
  info: 'Info',
  inactive: 'Inactive',
  draft: 'Draft',
  cancelled: 'Cancelled',
  neutral: '—',
}

export function StatusBadge({ kind, label, className }: { kind: BadgeKind; label?: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-medium', styles[kind], className)}>
      {label ?? labels[kind]}
    </Badge>
  )
}

/**
 * Map ANY raw status string from the API to the shared badge.
 * Unknown values fall back to a neutral chip with the capitalised raw value,
 * so no view ever needs its own colour map again.
 */
export function BadgeForStatus({ status, className }: { status: string; className?: string }) {
  const normalised = status?.toLowerCase().replace(/[\s-]+/g, '_') ?? ''
  const kind = (normalised in styles ? normalised : 'neutral') as BadgeKind
  const label =
    normalised === ''
      ? '—'
      : (normalised in labels ? labels[normalised as BadgeKind] : status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()))
  return <StatusBadge kind={kind} label={label} className={className} />
}

/** Small colored category chip used across lists */
export function CategoryChip({ label, className }: { label: string; className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'max-w-[160px] truncate border-primary/20 bg-primary/10 font-medium text-primary hover:bg-primary/10',
        className
      )}
    >
      {label}
    </Badge>
  )
}

/**
 * IQAMA / passport validity badge (90-day alert window).
 * expired → danger, expiring (≤90 days) → warning, valid → neutral, unknown → muted dash.
 */
export function ExpiryBadge({
  status,
  daysLeft,
  className,
}: {
  status: 'expired' | 'expiring' | 'valid' | 'unknown'
  daysLeft?: number | null
  className?: string
}) {
  const styles = {
    expired:
      'border-danger/25 bg-danger-soft text-danger-soft-foreground dark:bg-danger-soft dark:text-danger-soft-foreground',
    expiring:
      'border-warning/30 bg-warning-soft text-warning-soft-foreground dark:bg-warning-soft dark:text-warning-soft-foreground',
    valid: 'border-border bg-muted/60 text-muted-foreground',
    unknown: 'border-border bg-muted/40 text-muted-foreground/80',
  } as const
  const labels = {
    expired: 'Expired',
    expiring: daysLeft === null || daysLeft === undefined ? 'Expiring soon' : `In ${daysLeft}d`,
    valid: 'Valid',
    unknown: 'No date',
  } as const
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-medium', styles[status], className)}>
      {labels[status]}
    </Badge>
  )
}
