'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Generic confirmation dialog for consequential actions.
 * ALWAYS names the item (e.g. "Delete payroll for Ahmed Al-Farsi — Sep 2026?"),
 * explains the consequence, and offers a clear Cancel. Destructive variants
 * use the danger styling. ConfirmDelete remains available for simple deletes;
 * this is the richer, app-wide pattern.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  item,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => Promise<void> | void
  /** Action title, e.g. "Delete quotation?" */
  title: string
  /** Consequence explanation shown under the title. */
  description?: string
  /** The named item — rendered in bold so users see exactly what they act on. */
  item?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {item ? (
              <>
                <span className="font-semibold text-foreground">{item}</span>
                {description ? <span> — {description}</span> : null}
              </>
            ) : (
              description
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <ConfirmButton onConfirm={onConfirm} label={confirmLabel} destructive={destructive} onDone={() => onOpenChange(false)} />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ConfirmButton({
  onConfirm,
  label,
  destructive,
  onDone,
}: {
  onConfirm: () => Promise<void> | void
  label: string
  destructive: boolean
  onDone: () => void
}) {
  // Self-managing busy state: disables + spinner while the action runs,
  // closes the dialog only on success (caller toasts errors).
  const [busy, setBusy] = useConfirmBusy()
  return (
    <button
      type="button"
      disabled={busy}
      className={cn(
        buttonVariants({ variant: destructive ? 'destructive' : 'default' }),
        busy && 'cursor-not-allowed opacity-80'
      )}
      onClick={async () => {
        setBusy(true)
        try {
          await onConfirm()
          onDone()
        } catch {
          // Leave the dialog open — the caller surfaces the error via toast.
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      {label}
    </button>
  )
}

// Tiny local state hook (avoids re-rendering the whole dialog while confirming)
function useConfirmBusy(): [boolean, (v: boolean) => void] {
  const [busy, setBusy] = useState(false)
  return [busy, setBusy]
}
