'use client'

// Settings › Signatories — manage the people who approve documents.
// The quotation print's APPROVED BY box prints the DEFAULT signatory's
// name + designation; with no signatory configured the name line stays empty.

import { useEffect, useState } from 'react'
import { Plus, Save, Star, Trash2, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { SectionCard } from '@/components/app/shared/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Row = { name: string; designation: string; isDefault: boolean }

export function SignatoriesSettingsSection({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get<{ signatories: Row[] }>('/api/signatories')
        if (cancelled) return
        setRows(
          res.signatories.map((s) => ({
            name: s.name,
            designation: s.designation ?? '',
            isDefault: s.isDefault,
          }))
        )
      } catch {
        if (!cancelled) toast.error('Could not load signatories')
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) =>
      rs.map((r, idx) => (idx === i ? { ...r, ...patch } : patch.isDefault === true ? { ...r, isDefault: false } : r))
    )
  }

  function addRow() {
    setRows((rs) => [...rs, { name: '', designation: '', isDefault: rs.length === 0 }])
  }

  function removeRow(i: number) {
    setRows((rs) => {
      const next = rs.filter((_, idx) => idx !== i)
      if (next.length > 0 && !next.some((r) => r.isDefault)) next[0].isDefault = true
      return next
    })
  }

  async function save() {
    const clean = rows.filter((r) => r.name.trim())
    if (rows.some((r) => r.name.trim() && !r.name.trim())) return
    if (rows.length > 0 && clean.length !== rows.filter((r) => r.name).length) {
      toast.error('Enter a name for every signatory (or remove the empty row)')
      return
    }
    if (saving) return
    setSaving(true)
    try {
      await api.put('/api/signatories', {
        signatories: clean.map((r) => ({
          name: r.name.trim(),
          designation: r.designation.trim(),
          isDefault: r.isDefault,
        })),
      })
      toast.success('Signatories saved')
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save signatories')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <UserCheck className="h-4 w-4 text-muted-foreground" />
            Signatories
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            People who approve quotations. The <span className="font-medium">default</span> signatory is printed in the
            APPROVED BY box of every quotation — name and designation. With no signatory set, the name line stays empty.
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
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {loaded ? 'No signatory set — the quotation APPROVED BY name line will stay empty.' : 'Loading…'}
          </p>
        ) : null}
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Name</Label>
              <Input
                value={r.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="e.g. Ahmed Al-Dossary"
                disabled={!canEdit}
                className="h-9"
              />
            </div>
            <div className="min-w-[160px] flex-1 space-y-1">
              <Label className="text-[11px] text-muted-foreground">Designation</Label>
              <Input
                value={r.designation}
                onChange={(e) => update(i, { designation: e.target.value })}
                placeholder="e.g. General Manager"
                disabled={!canEdit}
                className="h-9"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={!canEdit || r.isDefault}
              onClick={() => update(i, { isDefault: true })}
              title="Print this signatory on quotations"
            >
              <Star className={cn('mr-1 h-4 w-4', r.isDefault && 'fill-amber-400 text-amber-500')} />
              {r.isDefault ? 'Default' : 'Set default'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={() => removeRow(i)}
              disabled={!canEdit || rows.length <= 1}
              aria-label="Remove signatory"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {canEdit ? (
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="mr-1 h-4 w-4" />
            Add signatory
          </Button>
        ) : null}
      </div>
    </SectionCard>
  )
}
