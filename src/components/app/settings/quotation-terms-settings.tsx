'use client'

// Settings › Quotation › Default Terms & Conditions.
// A numbered list; each item has an optional bold title and a text.
// Every NEW quotation copies these defaults (then they are editable per
// quotation). Printed as the full-width TERMS & CONDITIONS box on the
// quotation document.

import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ListOrdered, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import {
  DEFAULT_QUOTATION_TERMS,
  parseTerms,
  serializeTerms,
  validateTerms,
  type TermItem,
} from '@/lib/quotation-terms'
import { SectionCard } from '@/components/app/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function QuotationTermsSettingsSection({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<TermItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get<{ content: string | null }>('/api/default-terms')
        if (cancelled) return
        const parsed = parseTerms(res.content)
        setRows(parsed.length > 0 ? parsed : DEFAULT_QUOTATION_TERMS)
      } catch {
        if (!cancelled) toast.error('Could not load the default terms')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function update(i: number, patch: Partial<TermItem>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  function addRow() {
    setRows((rs) => [...rs, { title: '', text: '' }])
  }

  function removeRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i))
  }

  function move(i: number, dir: -1 | 1) {
    setRows((rs) => {
      const j = i + dir
      if (j < 0 || j >= rs.length) return rs
      const next = [...rs]
      const tmp = next[i]
      next[i] = next[j]
      next[j] = tmp
      return next
    })
  }

  async function save() {
    const err = validateTerms(rows)
    if (err) {
      toast.error(err)
      return
    }
    if (saving) return
    setSaving(true)
    try {
      const content = serializeTerms(rows)
      await api.put('/api/default-terms', { content })
      toast.success('Default terms saved — new quotations will start with this list')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the default terms')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ListOrdered className="h-4 w-4 text-muted-foreground" />
            Quotation · Default Terms &amp; Conditions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The numbered list printed on every quotation. Each item has an optional{' '}
            <span className="font-medium">bold title</span> and a text. Every new quotation copies this list — you can
            then edit, add or remove items for that quotation only.
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => void save()} disabled={saving || !loaded}>
            <Save className="mr-1 h-4 w-4" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        ) : null}
      </div>

      <div className="mt-4 space-y-3">
        {rows.map((r, i) => (
          <div key={i} className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold tabular-nums text-muted-foreground">{i + 1}.</p>
              <div className="flex items-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => move(i, -1)}
                  disabled={i === 0 || !canEdit}
                  aria-label="Move up"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1 || !canEdit}
                  aria-label="Move down"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => removeRow(i)}
                  disabled={!canEdit}
                  aria-label="Remove term"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="mt-1 grid gap-2 sm:grid-cols-[minmax(0,220px)_1fr]">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Bold title (optional)</Label>
                <Input
                  value={r.title ?? ''}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder="e.g. Minimum Working Hours"
                  disabled={!canEdit}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Text</Label>
                <Textarea
                  value={r.text}
                  onChange={(e) => update(i, { text: e.target.value })}
                  placeholder="The term text printed on the quotation"
                  disabled={!canEdit}
                  rows={2}
                />
              </div>
            </div>
          </div>
        ))}
        {canEdit ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="mr-1 h-4 w-4" />
              Add item
            </Button>
            {rows.length === 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setRows(DEFAULT_QUOTATION_TERMS)}
              >
                Restore the standard 10 items
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SectionCard>
  )
}
