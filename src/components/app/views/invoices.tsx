'use client'

// Invoices view — client-facing tax invoices (ZATCA-style) for the manpower
// supply business:
//   • KPI cards: Total Invoiced / Collected / Outstanding / Overdue count
//     (overdue = issued invoices past their due date)
//   • list with search (number / client / subject), status + issue-year filters
//   • add/edit dialog with a live line-items editor (per-line totals, subtotal,
//     VAT and grand total recomputed while typing; the server always recomputes)
//   • per-invoice ZATCA phase designation (Phase 1 QR-only / Phase 2 Integration)
//     with the Phase 2 "connect system" submission dialog, Approved By /
//     Received By signature overrides and a per-invoice bank-details override
//   • quick "Mark Paid" action, per-invoice A4 TAX INVOICE print with the
//     phase-aware ZATCA QR code, CSV export
// Role-based: add/edit/delete buttons only appear with invoices.create/edit/delete.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  BookCheck,
  Calculator,
  CheckCircle2,
  Download,
  FileCode,
  Hash,
  Pencil,
  Plus,
  Printer,
  QrCode,
  ReceiptText,
  Send,
  ShieldCheck,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'

import { api, qs } from '@/lib/api-client'
import { buildCsv, csvFilename, downloadCsv } from '@/lib/csv'
import { formatDate, formatDateTime, formatMoney, formatNumber, round2, toDateInputValue } from '@/lib/format'
import { can, useAppStore } from '@/lib/store'
import type { ClientRow, DocItemRow, InvoiceRow, Paginated } from '@/lib/types'
import { useDebounce } from '@/hooks/use-debounce'
import { useViewIntent } from '@/hooks/use-view-intent'
import { cn } from '@/lib/utils'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'

import { StatusBadge } from '../shared/status-badge'
import { ConfirmDelete } from '../shared/confirm-delete'
import { DataTablePagination } from '../shared/data-table-pagination'
import { EmptyState, TableSkeleton } from '../shared/empty-state'
import { FilterBar, FilterSelect, SearchInput } from '../shared/filter-select'
import { PageHeader, SectionCard, MobileFab } from '../shared/page-header'
import { StatCard } from '../shared/stat-card'
import { InvoicePrintDialog, type InvoicePrintData } from '../print/invoice-print'
import {
  ZatcaStatusBadge,
  ZatcaSubmitDialog,
  downloadInvoiceUbl,
} from './invoice-zatca-submit'

type InvoiceTotals = {
  count: number
  total: number
  paid: number
  outstanding: number
  overdue: number
}

type InvoicesResponse = Paginated<InvoiceRow> & { totals: InvoiceTotals; years: number[] }

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'issued', label: 'Issued' },
  { value: 'paid', label: 'Paid' },
  { value: 'cancelled', label: 'Cancelled' },
]

/** Line item as typed in the dialog (strings for controlled inputs). */
type ItemForm = {
  description: string
  unit: string
  quantity: string
  unitPrice: string
}

type InvoiceForm = {
  clientId: string // '' = free-text client
  clientName: string
  subject: string
  issueDate: string
  dueDate: string
  status: string
  // ZATCA document type: standard (B2B) or simplified (B2C)
  invoiceType: string
  vatRatePercent: string // typed as percent (15), converted to a fraction on save
  paidAmount: string
  notes: string
  items: ItemForm[]
  // Per-invoice ZATCA designation: '1' = Phase 1 Generation · '2' = Phase 2 Integration
  zatcaPhase: string
  // Signature blocks (empty = company default on print)
  approvedBy: string
  approvedByTitle: string
  receivedBy: string
  receivedByTitle: string
  // Bank details override (useCompanyBank=true → the 6 fields are sent empty → server null → Settings fallback)
  useCompanyBank: boolean
  bankName: string
  bankAccountName: string
  bankAccountNumber: string
  bankIban: string
  bankSwiftCode: string
  bankAddress: string
}

const EMPTY_ITEM: ItemForm = { description: '', unit: '', quantity: '1', unitPrice: '' }

function emptyForm(vatRatePercent: number): InvoiceForm {
  return {
    clientId: '',
    clientName: '',
    subject: '',
    issueDate: toDateInputValue(new Date()),
    dueDate: '',
    status: 'draft',
    invoiceType: 'standard',
    vatRatePercent: String(vatRatePercent),
    paidAmount: '',
    notes: '',
    items: [{ ...EMPTY_ITEM }],
    zatcaPhase: '1',
    approvedBy: '',
    approvedByTitle: '',
    receivedBy: '',
    receivedByTitle: '',
    useCompanyBank: true,
    bankName: '',
    bankAccountName: '',
    bankAccountNumber: '',
    bankIban: '',
    bankSwiftCode: '',
    bankAddress: '',
  }
}

/** Status pill — draft=secondary, issued=amber, paid=emerald, cancelled=red/muted. */
function InvoiceStatusBadge({ status }: { status: string }) {
  if (status === 'paid') return <StatusBadge kind="paid" label="Paid" />
  if (status === 'issued') return <StatusBadge kind="pending" label="Issued" />
  if (status === 'cancelled') return <StatusBadge kind="expense" label="Cancelled" />
  return <Badge variant="secondary" className="font-medium">Draft</Badge>
}

/** Issued and past its due date? */
function isOverdue(row: InvoiceRow): boolean {
  if (row.status !== 'issued' || !row.dueDate) return false
  return new Date(row.dueDate).getTime() < startOfToday()
}

/** True when the invoice carries any per-invoice bank override field. */
function hasBankOverride(row: InvoiceRow): boolean {
  return Boolean(
    row.bankName ||
      row.bankAccountName ||
      row.bankAccountNumber ||
      row.bankIban ||
      row.bankSwiftCode ||
      row.bankAddress
  )
}

/**
 * Small ZATCA phase chip for the list rows — "P1" (neutral) or "P2"
 * (emerald-tinted), with a tooltip explaining the designation.
 */
function PhaseChip({ phase }: { phase: number }) {
  const isP2 = phase === 2
  return (
    <span
      title={
        isP2
          ? 'ZATCA Phase 2 — Integration (full e-invoice: cryptographic QR + UBL + submission)'
          : 'ZATCA Phase 1 — Generation (5-tag QR, no portal submission)'
      }
      className={cn(
        'inline-flex items-center rounded px-1 py-px text-[9px] font-bold uppercase leading-none tabular-nums',
        isP2
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground'
      )}
    >
      {isP2 ? 'P2' : 'P1'}
    </span>
  )
}

function startOfToday(): number {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function InvoicesView() {
  const { user, settings } = useAppStore()
  const currency = settings.currency
  const canCreate = can(user, 'invoices.create')
  const canEdit = can(user, 'invoices.edit')
  const canDelete = can(user, 'invoices.delete')
  const canCreateClient = can(user, 'clients.create')

  const currentYear = new Date().getFullYear()

  // ---- list state ----
  const [rows, setRows] = useState<InvoiceRow[]>([])
  const [totals, setTotals] = useState<InvoiceTotals>({
    count: 0, total: 0, paid: 0, outstanding: 0, overdue: 0,
  })
  const [years, setYears] = useState<number[]>([currentYear])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  // ---- filters ----
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)
  const [statusFilter, setStatusFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')
  const [zatcaPhaseFilter, setZatcaPhaseFilter] = useState('all')
  const [zatcaStatusFilter, setZatcaStatusFilter] = useState('all')

  // ---- add/edit dialog ----
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<InvoiceRow | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<InvoiceForm>(() => emptyForm(settings.vatRate || 15))
  const [clientOptions, setClientOptions] = useState<ClientRow[]>([])

  // ---- quick-add client (inside the invoice dialog) ----
  const [quickClientOpen, setQuickClientOpen] = useState(false)
  const [quickClientSaving, setQuickClientSaving] = useState(false)
  const [quickClient, setQuickClient] = useState({
    name: '',
    nameAr: '',
    vatNumber: '',
    phone: '',
    city: '',
  })

  // ---- print ----
  const [printOpen, setPrintOpen] = useState(false)
  const [printInvoice, setPrintInvoice] = useState<InvoicePrintData | null>(null)
  const [printLoadingId, setPrintLoadingId] = useState<string | null>(null)

  // ---- ZATCA Phase 2 submission (connect system) ----
  const [zatcaOpen, setZatcaOpen] = useState(false)
  const [zatcaInvoice, setZatcaInvoice] = useState<InvoiceRow | null>(null)

  /** The client record currently selected in the form (null = free text). */
  const selectedClient = useMemo(
    () => clientOptions.find((c) => c.id === form.clientId) ?? null,
    [clientOptions, form.clientId]
  )

  // guard against out-of-order list responses
  const requestId = useRef(0)

  function setField<K extends keyof InvoiceForm>(key: K, value: InvoiceForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function setItem(idx: number, key: keyof ItemForm, value: string) {
    setForm((f) => ({
      ...f,
      items: f.items.map((it, i) => (i === idx ? { ...it, [key]: value } : it)),
    }))
  }

  function addItem() {
    setForm((f) => ({ ...f, items: [...f.items, { ...EMPTY_ITEM }] }))
  }

  function removeItem(idx: number) {
    setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))
  }

  // -----------------------------------------------------------------------
  // LIVE totals — mirrors the server math (lineTotal = round2(qty × price),
  // subtotal = Σ, vat = round2(subtotal × rate), total = subtotal + vat).
  // -----------------------------------------------------------------------
  const vatRate = useMemo(() => {
    const pct = parseFloat(form.vatRatePercent)
    return isFinite(pct) && pct >= 0 && pct <= 100 ? pct / 100 : 0
  }, [form.vatRatePercent])

  const calc = useMemo(() => {
    let subtotal = 0
    const lineTotals = form.items.map((it) => {
      const qty = parseFloat(it.quantity)
      const price = parseFloat(it.unitPrice)
      if (!isFinite(qty) || !isFinite(price) || qty <= 0 || price < 0) return 0
      const lt = round2(qty * price)
      subtotal += lt
      return lt
    })
    subtotal = round2(subtotal)
    const vatAmount = round2(subtotal * vatRate)
    return { lineTotals, subtotal, vatAmount, total: round2(subtotal + vatAmount) }
  }, [form.items, vatRate])

  // -----------------------------------------------------------------------
  // Data loading
  // -----------------------------------------------------------------------
  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    try {
      const res = await api.get<InvoicesResponse>(
        `/api/invoices${qs({
          search: debouncedSearch,
          status: statusFilter === 'all' ? '' : statusFilter,
          year: yearFilter === 'all' ? '' : yearFilter,
          zatcaPhase: zatcaPhaseFilter === 'all' ? '' : zatcaPhaseFilter,
          zatcaStatus: zatcaStatusFilter === 'all' ? '' : zatcaStatusFilter,
          page,
          pageSize,
        })}`
      )
      if (id !== requestId.current) return
      if (res.data.length === 0 && res.total > 0 && res.page > res.totalPages) {
        setPage(res.totalPages)
        return
      }
      setRows(res.data)
      setTotals(res.totals ?? { count: 0, total: 0, paid: 0, outstanding: 0, overdue: 0 })
      setYears(res.years?.length ? res.years : [currentYear])
      setTotal(res.total)
      setTotalPages(res.totalPages)
    } catch (e) {
      if (id !== requestId.current) return
      setRows([])
      setTotal(0)
      setTotalPages(1)
      toast.error(e instanceof Error ? e.message : 'Failed to load invoices')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [
    debouncedSearch,
    statusFilter,
    yearFilter,
    zatcaPhaseFilter,
    zatcaStatusFilter,
    page,
    pageSize,
    currentYear,
  ])

  useEffect(() => {
    void load()
  }, [load])

  // Client companies for the dialog's link selector (small list, loaded once)
  const loadClientOptions = useCallback(() => {
    api
      .get<Paginated<ClientRow>>('/api/clients?pageSize=100')
      .then((r) => setClientOptions(r.data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadClientOptions()
  }, [loadClientOptions])

  /** Create a client from inside the invoice dialog and auto-select it. */
  async function handleQuickAddClient() {
    const name = quickClient.name.trim()
    if (!name) {
      toast.error('Client name is required')
      return
    }
    const vat = quickClient.vatNumber.replace(/[\s-]/g, '')
    if (vat && !/^\d{15}$/.test(vat)) {
      toast.error('VAT number must be exactly 15 digits')
      return
    }
    try {
      setQuickClientSaving(true)
      const created = await api.post<ClientRow>('/api/clients', {
        name,
        nameAr: quickClient.nameAr.trim(),
        vatNumber: vat,
        phone: quickClient.phone.trim(),
        city: quickClient.city.trim(),
      })
      setClientOptions((opts) => [created, ...opts])
      setForm((f) => ({ ...f, clientId: created.id, clientName: created.name }))
      setQuickClientOpen(false)
      setQuickClient({ name: '', nameAr: '', vatNumber: '', phone: '', city: '' })
      toast.success(`Client "${created.name}" created & selected`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the client')
    } finally {
      setQuickClientSaving(false)
    }
  }

  const yearOptions = useMemo(() => {
    const set = new Set<number>(years)
    set.add(currentYear)
    return Array.from(set).sort((a, b) => b - a)
  }, [years, currentYear])

  const hasFilters =
    debouncedSearch !== '' ||
    statusFilter !== 'all' ||
    yearFilter !== 'all' ||
    zatcaPhaseFilter !== 'all' ||
    zatcaStatusFilter !== 'all'

  function resetFilters() {
    setSearch('')
    setStatusFilter('all')
    setYearFilter('all')
    setZatcaPhaseFilter('all')
    setZatcaStatusFilter('all')
    setPage(1)
  }

  // -----------------------------------------------------------------------
  // Add / Edit dialog
  // -----------------------------------------------------------------------
  function openAdd() {
    setEditing(null)
    setForm(emptyForm(settings.vatRate || 15))
    setDialogOpen(true)
  }

  // Deep-open the create dialog when arriving via the command palette
  const shouldOpenCreate = useViewIntent('invoices', 'create')
  useEffect(() => {
    if (shouldOpenCreate) openAdd()
  }, [shouldOpenCreate])

  async function openEdit(row: InvoiceRow) {
    try {
      const inv = await api.get<InvoicePrintData>(`/api/invoices/${row.id}`)
      setEditing(row)
      setForm({
        clientId: inv.clientId ?? '',
        clientName: inv.clientName,
        subject: inv.subject ?? '',
        issueDate: toDateInputValue(inv.issueDate),
        dueDate: inv.dueDate ? toDateInputValue(inv.dueDate) : '',
        status: inv.status,
        invoiceType: inv.invoiceType === 'simplified' ? 'simplified' : 'standard',
        vatRatePercent: String(round2(inv.vatRate * 100)),
        paidAmount: String(inv.paidAmount),
        notes: inv.notes ?? '',
        items:
          inv.items.length > 0
            ? inv.items.map((it: DocItemRow) => ({
                description: it.description,
                unit: it.unit ?? '',
                quantity: String(it.quantity),
                unitPrice: String(it.unitPrice),
              }))
            : [{ ...EMPTY_ITEM }],
        zatcaPhase: inv.zatcaPhase === 2 ? '2' : '1',
        approvedBy: inv.approvedBy ?? '',
        approvedByTitle: inv.approvedByTitle ?? '',
        receivedBy: inv.receivedBy ?? '',
        receivedByTitle: inv.receivedByTitle ?? '',
        // an invoice carrying any bank override field starts with the override ON
        useCompanyBank: !hasBankOverride(inv),
        bankName: inv.bankName ?? '',
        bankAccountName: inv.bankAccountName ?? '',
        bankAccountNumber: inv.bankAccountNumber ?? '',
        bankIban: inv.bankIban ?? '',
        bankSwiftCode: inv.bankSwiftCode ?? '',
        bankAddress: inv.bankAddress ?? '',
      })
      setDialogOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load the invoice')
    }
  }

  async function handleSubmit() {
    // Friendly client-side validation before hitting the API
    if (!form.clientId && !form.clientName.trim()) {
      toast.error('Select a client or type the client name')
      return
    }
    if (!form.issueDate) {
      toast.error('Issue date is required')
      return
    }
    const pct = parseFloat(form.vatRatePercent)
    if (!isFinite(pct) || pct < 0 || pct > 100) {
      toast.error('VAT rate must be between 0 and 100')
      return
    }
    for (const [idx, it] of form.items.entries()) {
      if (!it.description.trim()) {
        toast.error(`Item ${idx + 1}: description is required`)
        return
      }
      const qty = parseFloat(it.quantity)
      if (!isFinite(qty) || qty <= 0) {
        toast.error(`Item ${idx + 1}: quantity must be greater than 0`)
        return
      }
      const price = parseFloat(it.unitPrice)
      if (!isFinite(price) || price < 0) {
        toast.error(`Item ${idx + 1}: unit price cannot be negative`)
        return
      }
    }
    const paid = form.paidAmount.trim() === '' ? 0 : parseFloat(form.paidAmount)
    if (!isFinite(paid) || paid < 0) {
      toast.error('Paid amount cannot be negative')
      return
    }
    if (paid > calc.total) {
      toast.error('Paid amount cannot exceed the invoice total')
      return
    }

    setSaving(true)
    try {
      const body = {
        clientId: form.clientId || null,
        clientName: form.clientName.trim() || null,
        subject: form.subject.trim() || null,
        issueDate: form.issueDate,
        dueDate: form.dueDate || null,
        status: form.status,
        invoiceType: form.invoiceType === 'simplified' ? 'simplified' : 'standard',
        zatcaPhase: form.zatcaPhase === '2' ? 2 : 1,
        vatRate: round2(pct / 100),
        paidAmount: round2(paid),
        notes: form.notes.trim() || null,
        approvedBy: form.approvedBy.trim(),
        approvedByTitle: form.approvedByTitle.trim(),
        receivedBy: form.receivedBy.trim(),
        receivedByTitle: form.receivedByTitle.trim(),
        // empty string → server stores null → company Settings fallback
        bankName: form.useCompanyBank ? '' : form.bankName.trim(),
        bankAccountName: form.useCompanyBank ? '' : form.bankAccountName.trim(),
        bankAccountNumber: form.useCompanyBank ? '' : form.bankAccountNumber.trim(),
        bankIban: form.useCompanyBank ? '' : form.bankIban.trim(),
        bankSwiftCode: form.useCompanyBank ? '' : form.bankSwiftCode.trim(),
        bankAddress: form.useCompanyBank ? '' : form.bankAddress.trim(),
        items: form.items.map((it) => ({
          description: it.description.trim(),
          unit: it.unit.trim() || null,
          quantity: parseFloat(it.quantity),
          unitPrice: parseFloat(it.unitPrice || '0'),
        })),
      }
      if (editing) {
        const updated = await api.put<InvoiceRow>(`/api/invoices/${editing.id}`, body)
        toast.success(`Invoice ${updated.invoiceNumber} updated`)
      } else {
        const created = await api.post<InvoiceRow>('/api/invoices', body)
        toast.success(`Invoice ${created.invoiceNumber} created`)
      }
      setDialogOpen(false)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save the invoice')
    } finally {
      setSaving(false)
    }
  }

  /** Quick action: mark an issued invoice as fully paid. */
  async function handleMarkPaid(row: InvoiceRow) {
    try {
      await api.put<InvoiceRow>(`/api/invoices/${row.id}`, {
        status: 'paid',
        paidAmount: row.total,
      })
      toast.success(`Invoice ${row.invoiceNumber} marked as paid`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark the invoice as paid')
    }
  }

  async function handleDelete(row: InvoiceRow) {
    try {
      await api.del(`/api/invoices/${row.id}`)
      toast.success(`Invoice ${row.invoiceNumber} deleted`)
      void load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete the invoice')
    }
  }

  // -----------------------------------------------------------------------
  // ZATCA Phase 2 submission (connect system)
  // -----------------------------------------------------------------------
  function openZatca(row: InvoiceRow) {
    setZatcaInvoice(row)
    setZatcaOpen(true)
  }

  /** After a successful submission — refresh the list + the open row states. */
  function handleZatcaSubmitted() {
    void load()
    const targetId = zatcaInvoice?.id ?? editing?.id
    if (!targetId) return
    api
      .get<InvoiceRow>(`/api/invoices/${targetId}`)
      .then((fresh) => {
        setEditing((e) => (e && e.id === fresh.id ? fresh : e))
        setZatcaInvoice((z) => (z && z.id === fresh.id ? fresh : z))
      })
      .catch(() => {}) // keep the stale row — the dialog already shows the result
  }

  /** UBL XML download from the edit dialog (Phase 2 invoices only). */
  async function handleDownloadUbl(row: InvoiceRow) {
    try {
      await downloadInvoiceUbl(row.id, row.invoiceNumber)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed')
    }
  }

  // -----------------------------------------------------------------------
  // Print + CSV export
  // -----------------------------------------------------------------------
  async function openPrint(row: InvoiceRow) {
    setPrintLoadingId(row.id)
    try {
      const inv = await api.get<InvoicePrintData>(`/api/invoices/${row.id}`)
      setPrintInvoice(inv)
      setPrintOpen(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not prepare the invoice')
    } finally {
      setPrintLoadingId(null)
    }
  }

  /** Walk every page of the filtered list (server caps pageSize at 100). */
  async function fetchAllFiltered(): Promise<InvoiceRow[]> {
    const all: InvoiceRow[] = []
    let p = 1
    for (;;) {
      const res = await api.get<InvoicesResponse>(
        `/api/invoices${qs({
          search: debouncedSearch,
          status: statusFilter === 'all' ? '' : statusFilter,
          year: yearFilter === 'all' ? '' : yearFilter,
          zatcaPhase: zatcaPhaseFilter === 'all' ? '' : zatcaPhaseFilter,
          zatcaStatus: zatcaStatusFilter === 'all' ? '' : zatcaStatusFilter,
          page: p,
          pageSize: 100,
        })}`
      )
      all.push(...res.data)
      if (p >= res.totalPages || res.data.length === 0) break
      p += 1
    }
    return all
  }

  async function handleExportCsv() {
    if (exporting) return
    setExporting(true)
    try {
      const invoices = await fetchAllFiltered()
      const csv = buildCsv(
        [
          'Invoice Number',
          'Client',
          'Subject',
          'Issue Date',
          'Due Date',
          'Status',
          `Subtotal (${currency})`,
          'VAT Rate %',
          `VAT Amount (${currency})`,
          `Total (${currency})`,
          `Paid (${currency})`,
          `Balance (${currency})`,
        ],
        invoices.map((r) => [
          r.invoiceNumber,
          r.clientName,
          r.subject ?? '',
          r.issueDate.slice(0, 10),
          r.dueDate ? r.dueDate.slice(0, 10) : '',
          r.status,
          r.subtotal.toFixed(2),
          (r.vatRate * 100).toFixed(0),
          r.vatAmount.toFixed(2),
          r.total.toFixed(2),
          r.paidAmount.toFixed(2),
          round2(r.total - r.paidAmount).toFixed(2),
        ])
      )
      downloadCsv(csvFilename('invoices'), csv)
      toast.success(`Exported ${invoices.length} invoice${invoices.length === 1 ? '' : 's'} to CSV`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const money = (n: number) => formatMoney(n, currency)
  const vatPercent = Math.round(vatRate * 100)

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <div className="print-hidden">
        <PageHeader
          title="Invoices"
          description={`Issue ZATCA-style tax invoices with ${Math.round(
            (settings.vatRate || 15)
          )}% VAT and track collection.`}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleExportCsv()}
            disabled={exporting || total === 0}
          >
            {exporting ? <Calculator className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export CSV
          </Button>
          {canCreate ? (
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4" />
              New Invoice
            </Button>
          ) : null}
        </PageHeader>
      </div>

      {canCreate ? <MobileFab label="New Invoice" onClick={openAdd} icon={Plus} /> : null}

      {/* ---- KPI cards ---- */}
      <div className="print-hidden grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Invoiced"
          value={formatMoney(totals.total, currency).replace(`${currency} `, '')}
          valuePrefix={currency}
          icon={BookCheck}
          tone="navy"
          sublabel={`${totals.count} invoice${totals.count === 1 ? '' : 's'} (excl. cancelled)`}
        />
        <StatCard
          title="Collected"
          value={formatMoney(totals.paid, currency).replace(`${currency} `, '')}
          valuePrefix={currency}
          icon={Wallet}
          tone="green"
          sublabel="Payments received"
        />
        <StatCard
          title="Outstanding"
          value={formatMoney(totals.outstanding, currency).replace(`${currency} `, '')}
          valuePrefix={currency}
          icon={ReceiptText}
          tone="gold"
          sublabel="Invoiced − collected"
        />
        <StatCard
          title="Overdue"
          value={String(totals.overdue)}
          icon={AlertTriangle}
          tone="red"
          sublabel="Issued past the due date"
        />
      </div>

      {/* ---- Invoices list ---- */}
      <SectionCard className="print-hidden overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-base font-semibold">All Invoices</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {hasFilters ? 'Filtered — matches your search/filters' : 'All records'} — newest
              first
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums text-muted-foreground">
              {total} invoice{total === 1 ? '' : 's'}
            </span>
            {totals.overdue > 0 ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
                <AlertTriangle className="h-3 w-3" />
                {totals.overdue} overdue
              </span>
            ) : null}
          </div>
        </div>

        <div className="border-b p-4 sm:p-6">
          <FilterBar
            search={
              <SearchInput
                value={search}
                onChange={(v) => {
                  setSearch(v)
                  setPage(1)
                }}
                placeholder="Search invoice no, client, subject…"
                className="w-full sm:w-[240px]"
              />
            }
            activeCount={
              (statusFilter !== 'all' ? 1 : 0) +
              (yearFilter !== 'all' ? 1 : 0) +
              (zatcaPhaseFilter !== 'all' ? 1 : 0) +
              (zatcaStatusFilter !== 'all' ? 1 : 0)
            }
          >
            <FilterSelect
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v)
                setPage(1)
              }}
              options={STATUS_OPTIONS}
              placeholder="All Statuses"
              className="sm:w-[150px]"
            />
            <FilterSelect
              value={yearFilter}
              onChange={(v) => {
                setYearFilter(v)
                setPage(1)
              }}
              options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}
              placeholder="All Years"
              className="sm:w-[120px]"
            />
            <FilterSelect
              value={zatcaPhaseFilter}
              onChange={(v) => {
                setZatcaPhaseFilter(v)
                setPage(1)
              }}
              options={[
                { value: '1', label: 'Phase 1 — QR only' },
                { value: '2', label: 'Phase 2 — Integration' },
              ]}
              placeholder="All ZATCA Phases"
              className="sm:w-[160px]"
            />
            <FilterSelect
              value={zatcaStatusFilter}
              onChange={(v) => {
                setZatcaStatusFilter(v)
                setPage(1)
              }}
              options={[
                { value: 'reported', label: 'Reported' },
                { value: 'cleared', label: 'Cleared' },
                { value: 'rejected', label: 'Rejected' },
              ]}
              placeholder="All ZATCA Statuses"
              className="sm:w-[150px]"
            />
            {hasFilters ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-muted-foreground"
                onClick={resetFilters}
              >
                <X className="h-4 w-4" />
                Reset
              </Button>
            ) : null}
          </FilterBar>
        </div>

        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={BookCheck}
            title="No invoices found"
            description={
              hasFilters
                ? 'Nothing matches your current filters. Try adjusting them.'
                : 'Create your first tax invoice — numbers are assigned automatically (INV-YYYY-NNNN).'
            }
            action={
              canCreate ? (
                <Button size="sm" onClick={openAdd}>
                  <Plus className="h-4 w-4" />
                  New Invoice
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop: full table */}
            <div className="nice-scrollbar hidden overflow-x-auto md:block">
              <Table className="min-w-[1020px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-[140px]">Invoice No</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="w-[96px]">Issued</TableHead>
                    <TableHead className="w-[96px]">Due</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="w-[104px]">Status</TableHead>
                    <TableHead className="w-[160px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const overdue = isOverdue(row)
                    const balance = round2(row.total - row.paidAmount)
                    return (
                      <TableRow key={row.id} className="group">
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
                            <Hash className="h-3 w-3 text-muted-foreground" />
                            {row.invoiceNumber}
                            <PhaseChip phase={row.zatcaPhase} />
                          </span>
                          {row.subject ? (
                            <p
                              className="mt-0.5 max-w-[220px] truncate text-xs text-muted-foreground"
                              title={row.subject}
                            >
                              {row.subject}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate font-medium" title={row.clientName}>
                          {row.clientName}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                          {formatDate(row.issueDate)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {row.dueDate ? (
                            <span className={cn(overdue && 'font-semibold text-rose-600 dark:text-rose-400')}>
                              {formatDate(row.dueDate)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {overdue ? (
                            <p className="text-[10px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                              Overdue
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {money(row.total)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.paidAmount > 0 ? (
                            <>
                              <span className="text-emerald-700 dark:text-emerald-400">
                                {money(row.paidAmount)}
                              </span>
                              {balance > 0 ? (
                                <p className="text-[11px] text-muted-foreground tabular-nums">
                                  Bal: {money(balance)}
                                </p>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <InvoiceStatusBadge status={row.status} />
                          {row.zatcaStatus ? (
                            <div className="mt-1">
                              <ZatcaStatusBadge status={row.zatcaStatus} />
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            {canEdit && row.zatcaPhase === 2 ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => openZatca(row)}
                                aria-label={`ZATCA submission for invoice ${row.invoiceNumber}`}
                                title="ZATCA (Phase 2) — submit / status"
                              >
                                <ShieldCheck className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {canEdit && row.status === 'issued' ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950"
                                onClick={() => void handleMarkPaid(row)}
                                aria-label={`Mark invoice ${row.invoiceNumber} as paid`}
                                title="Mark Paid"
                              >
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => void openPrint(row)}
                              disabled={printLoadingId === row.id}
                              aria-label={`Print invoice ${row.invoiceNumber}`}
                              title="Print / Save PDF"
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            {canEdit ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                onClick={() => void openEdit(row)}
                                aria-label={`Edit invoice ${row.invoiceNumber}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            ) : null}
                            {canDelete ? (
                              <ConfirmDelete
                                onConfirm={() => void handleDelete(row)}
                                title="Delete invoice?"
                                description={`Invoice ${row.invoiceNumber} (${money(
                                  row.total
                                )}) and its line items will be permanently removed.`}
                              />
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile: stacked cards */}
            <ul className="space-y-3 p-4 sm:p-6 md:hidden">
              {rows.map((row) => {
                const overdue = isOverdue(row)
                const balance = round2(row.total - row.paidAmount)
                return (
                  <li
                    key={row.id}
                    className="rounded-xl border bg-card p-3 shadow-sm transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 font-semibold tabular-nums">
                          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
                          {row.invoiceNumber}
                          <PhaseChip phase={row.zatcaPhase} />
                        </p>
                        <p className="mt-0.5 truncate text-sm font-medium" title={row.clientName}>
                          {row.clientName}
                        </p>
                        {row.subject ? (
                          <p className="truncate text-xs text-muted-foreground" title={row.subject}>
                            {row.subject}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          Issued {formatDate(row.issueDate)}
                          {row.dueDate ? ` · Due ${formatDate(row.dueDate)}` : ''}
                        </p>
                        {overdue ? (
                          <p className="text-[11px] font-bold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                            Overdue
                          </p>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold tabular-nums">{money(row.total)}</p>
                        {row.paidAmount > 0 ? (
                          <p className="text-[11px] font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                            Paid {money(row.paidAmount)}
                          </p>
                        ) : null}
                        {balance > 0 ? (
                          <p className="text-[11px] tabular-nums text-muted-foreground">
                            Bal {money(balance)}
                          </p>
                        ) : null}
                        <div className="mt-1">
                          <InvoiceStatusBadge status={row.status} />
                        </div>
                        {row.zatcaStatus ? (
                          <div className="mt-1 flex justify-end">
                            <ZatcaStatusBadge status={row.zatcaStatus} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-0.5 border-t pt-2">
                      {canEdit && row.zatcaPhase === 2 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                          onClick={() => openZatca(row)}
                        >
                          <ShieldCheck className="h-4 w-4" />
                          ZATCA
                        </Button>
                      ) : null}
                      {canEdit && row.status === 'issued' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 gap-1.5 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-950"
                          onClick={() => void handleMarkPaid(row)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Mark Paid
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => void openPrint(row)}
                        aria-label={`Print invoice ${row.invoiceNumber}`}
                      >
                        <Printer className="h-4 w-4" />
                      </Button>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => void openEdit(row)}
                          aria-label={`Edit invoice ${row.invoiceNumber}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <ConfirmDelete
                          onConfirm={() => void handleDelete(row)}
                          title="Delete invoice?"
                          description={`Invoice ${row.invoiceNumber} (${money(
                            row.total
                          )}) will be permanently removed.`}
                        />
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <div className="print-hidden">
          <DataTablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            totalPages={totalPages}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
            unit="invoices"
          />
        </div>
      </SectionCard>

      {/* ---- Add / Edit dialog ---- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Invoice ${editing.invoiceNumber}` : 'New Invoice'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the invoice — totals are always recomputed from the line items.'
                : 'The invoice number (INV-YYYY-NNNN) is assigned automatically on save.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void handleSubmit()
            }}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="inv-client">Client</Label>
                  {canCreateClient ? (
                    <button
                      type="button"
                      onClick={() => setQuickClientOpen(true)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Client
                    </button>
                  ) : null}
                </div>
                <Select
                  value={form.clientId || 'none'}
                  onValueChange={(v) => {
                    // Radix can emit '' spuriously when the current value's
                    // SelectItem is not yet mounted (content renders only
                    // while open — e.g. right after quick-adding a client).
                    // Ignore it so the freshly selected client is kept.
                    if (v === '') return
                    const id = v === 'none' ? '' : v
                    const client = clientOptions.find((c) => c.id === id)
                    setForm((f) => ({
                      ...f,
                      clientId: id,
                      clientName: client ? client.name : f.clientName,
                    }))
                  }}
                >
                  <SelectTrigger id="inv-client" className="w-full" aria-label="Client">
                    <SelectValue>
                      {form.clientId
                        ? selectedClient?.name ?? form.clientName
                        : 'Free text / unregistered'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Free text / unregistered</SelectItem>
                    {clientOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          {c.name}
                          {c.vatNumber ? (
                            <span className="text-[10px] text-emerald-600">✓ VAT</span>
                          ) : null}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedClient ? (
                  <p className="text-xs text-muted-foreground">
                    {selectedClient.vatNumber ? (
                      <>
                        VAT:{' '}
                        <span className="font-mono tabular-nums text-emerald-600">
                          {selectedClient.vatNumber}
                        </span>
                      </>
                    ) : form.invoiceType === 'standard' ? (
                      <span className="text-amber-600">
                        No VAT number on this client — needed for B2B tax invoices.
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Pick a registered client or type a name below.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-client-name">
                  Client Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="inv-client-name"
                  value={form.clientName}
                  onChange={(e) => setField('clientName', e.target.value)}
                  placeholder="e.g. Al Rushaid Construction Co."
                  readOnly={Boolean(form.clientId)}
                  required
                />
                {form.clientId && selectedClient?.nameAr ? (
                  <p lang="ar" dir="rtl" className="truncate text-xs text-muted-foreground">
                    {selectedClient.nameAr}
                  </p>
                ) : form.clientId ? (
                  <p className="text-xs text-muted-foreground">From the linked client record.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="inv-type">Invoice Type (ZATCA)</Label>
                <Select
                  value={form.invoiceType}
                  onValueChange={(v) => setField('invoiceType', v)}
                >
                  <SelectTrigger id="inv-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">
                      Standard — B2B Tax Invoice فاتورة ضريبية
                    </SelectItem>
                    <SelectItem value="simplified">
                      Simplified — B2C فاتورة ضريبية مبسطة
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {form.invoiceType === 'standard'
                    ? 'B2B — buyer VAT number printed on the invoice.'
                    : 'B2C — QR-verified simplified invoice.'}
                </p>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="inv-subject">Subject</Label>
                <Input
                  id="inv-subject"
                  value={form.subject}
                  onChange={(e) => setField('subject', e.target.value)}
                  placeholder="e.g. Manpower supply — October 2026"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="inv-issue-date">
                  Issue Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="inv-issue-date"
                  type="date"
                  value={form.issueDate}
                  onChange={(e) => setField('issueDate', e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-due-date">Due Date</Label>
                <Input
                  id="inv-due-date"
                  type="date"
                  value={form.dueDate}
                  onChange={(e) => setField('dueDate', e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="inv-vat-rate">VAT Rate (%)</Label>
                <Input
                  id="inv-vat-rate"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.vatRatePercent}
                  onChange={(e) => setField('vatRatePercent', e.target.value)}
                  className="tabular-nums"
                />
                <p className="text-xs text-muted-foreground">
                  Saudi standard VAT is {Math.round(settings.vatRate || 15)}%.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="inv-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => {
                    // convenience: switching to "paid" fills the paid amount with the live total
                    if (v === 'paid') {
                      setForm((f) => ({ ...f, status: v, paidAmount: calc.total ? String(calc.total) : '' }))
                    } else {
                      setField('status', v)
                    }
                  }}
                >
                  <SelectTrigger id="inv-status" className="w-full" aria-label="Status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* ---- Line items editor ---- */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line Items</Label>
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={addItem}>
                  <Plus className="h-3.5 w-3.5" />
                  Add Item
                </Button>
              </div>
              <div className="space-y-2">
                {form.items.map((item, idx) => (
                  <div key={idx} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-muted-foreground">
                        Item {idx + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => removeItem(idx)}
                        disabled={form.items.length === 1}
                        aria-label={`Remove item ${idx + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Input
                      value={item.description}
                      onChange={(e) => setItem(idx, 'description', e.target.value)}
                      placeholder="Description — e.g. Manpower supply (October) *"
                    />
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Input
                        value={item.unit}
                        onChange={(e) => setItem(idx, 'unit', e.target.value)}
                        placeholder="Unit (e.g. day)"
                        aria-label={`Item ${idx + 1} unit`}
                      />
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        step="any"
                        value={item.quantity}
                        onChange={(e) => setItem(idx, 'quantity', e.target.value)}
                        placeholder="Qty *"
                        className="tabular-nums"
                        aria-label={`Item ${idx + 1} quantity`}
                      />
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => setItem(idx, 'unitPrice', e.target.value)}
                        placeholder="Unit Price"
                        className="tabular-nums"
                        aria-label={`Item ${idx + 1} unit price`}
                      />
                      <div className="flex h-9 items-center justify-end rounded-md border bg-muted/60 px-3 text-sm font-semibold tabular-nums text-muted-foreground">
                        {formatNumber(calc.lineTotals[idx] ?? 0)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* live totals footer */}
              <div className="rounded-lg border bg-muted/40 p-3">
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">Subtotal</p>
                    <p className="text-sm font-semibold tabular-nums">{money(calc.subtotal)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">VAT ({vatPercent}%)</p>
                    <p className="text-sm font-semibold tabular-nums">{money(calc.vatAmount)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium text-muted-foreground">Total</p>
                    <p className="text-base font-bold tabular-nums">{money(calc.total)}</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="inv-paid">Paid Amount ({currency})</Label>
                <Input
                  id="inv-paid"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.paidAmount}
                  onChange={(e) => setField('paidAmount', e.target.value)}
                  placeholder="0.00"
                  className="tabular-nums"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty for 0. Balance:{' '}
                  <span className="font-semibold tabular-nums">
                    {formatNumber(round2(calc.total - (parseFloat(form.paidAmount) || 0)))}
                  </span>
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="inv-notes">Notes</Label>
                <Textarea
                  id="inv-notes"
                  value={form.notes}
                  onChange={(e) => setField('notes', e.target.value)}
                  placeholder="Optional — payment terms, bank details, remarks…"
                  rows={2}
                />
              </div>
            </div>

            {/* ---- ZATCA e-Invoicing (per-invoice phase designation) ---- */}
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-semibold">ZATCA e-Invoicing</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Phase 1 and Phase 2 are separate per-invoice designations — choose the
                  compliance track for this invoice.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setField('zatcaPhase', '1')}
                  aria-pressed={form.zatcaPhase !== '2'}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    form.zatcaPhase !== '2'
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <QrCode className="h-4 w-4 shrink-0" />
                    Phase 1 — Generation (QR only)
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    TLV QR with the 5 mandatory tags. No portal submission.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setField('zatcaPhase', '2')}
                  aria-pressed={form.zatcaPhase === '2'}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors',
                    form.zatcaPhase === '2'
                      ? 'border-emerald-600/70 bg-emerald-50/70 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/40'
                      : 'hover:bg-muted/50'
                  )}
                >
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    Phase 2 — Integration (Full e-invoice)
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    8-tag cryptographic QR + UBL XML + reporting to ZATCA (Fatoora).
                  </p>
                </button>
              </div>

              {/* Submission state + Phase 2 actions — only when editing an existing invoice */}
              {editing ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
                  {editing.zatcaStatus ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <ZatcaStatusBadge status={editing.zatcaStatus} />
                      <span className="text-xs text-muted-foreground">
                        submitted{' '}
                        {editing.zatcaSubmittedAt
                          ? formatDateTime(editing.zatcaSubmittedAt)
                          : ''}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Not submitted
                      {editing.zatcaPhase === 2
                        ? ' — report it to ZATCA (Fatoora) when ready'
                        : ''}
                    </span>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {editing.zatcaPhase === 2 && canEdit ? (
                      <>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8"
                          onClick={() => openZatca(editing)}
                        >
                          <Send className="h-3.5 w-3.5" />
                          Submit to ZATCA
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-muted-foreground hover:text-foreground"
                          onClick={() => void handleDownloadUbl(editing)}
                        >
                          <FileCode className="h-3.5 w-3.5" />
                          UBL XML
                        </Button>
                      </>
                    ) : form.zatcaPhase === '2' ? (
                      <span className="text-xs text-muted-foreground">
                        Save the invoice to enable Phase 2 submission.
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  After creating the invoice, Phase 2 submissions run from here or the
                  list row's <ShieldCheck className="inline h-3 w-3" aria-hidden /> action.
                </p>
              )}
            </div>

            {/* ---- Signatures (Approved By / Received By) ---- */}
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <p className="text-sm font-semibold">Signatures</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Printed in the invoice signature area. Leave empty to use the company
                  default for “Approved By”.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="inv-approved-by">Approved By</Label>
                  <Input
                    id="inv-approved-by"
                    value={form.approvedBy}
                    onChange={(e) => setField('approvedBy', e.target.value)}
                    placeholder={settings.authorizedSignatory || 'Authorized Signatory'}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inv-approved-by-title">Approved By — Title</Label>
                  <Input
                    id="inv-approved-by-title"
                    value={form.approvedByTitle}
                    onChange={(e) => setField('approvedByTitle', e.target.value)}
                    placeholder={settings.signatoryTitle || 'Authorized Signatory'}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inv-received-by">Received By</Label>
                  <Input
                    id="inv-received-by"
                    value={form.receivedBy}
                    onChange={(e) => setField('receivedBy', e.target.value)}
                    placeholder={form.clientName.trim() || 'Client name'}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inv-received-by-title">Received By — Title</Label>
                  <Input
                    id="inv-received-by-title"
                    value={form.receivedByTitle}
                    onChange={(e) => setField('receivedByTitle', e.target.value)}
                    placeholder="Client Representative"
                  />
                </div>
              </div>
            </div>

            {/* ---- Bank details (per-invoice override) ---- */}
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Bank Details</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Printed in the payment instructions box of this invoice.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Label
                    htmlFor="inv-use-company-bank"
                    className="text-xs font-normal text-muted-foreground"
                  >
                    Use company bank details
                  </Label>
                  <Switch
                    id="inv-use-company-bank"
                    checked={form.useCompanyBank}
                    onCheckedChange={(v) => setField('useCompanyBank', v)}
                  />
                </div>
              </div>
              {form.useCompanyBank ? (
                <p className="text-xs text-muted-foreground">
                  Company defaults from Settings
                  {settings.bankName ? ` — ${settings.bankName}` : ' — no bank name set'}
                  {settings.bankIban ? ` · ${settings.bankIban}` : ''}. Switch off to
                  override for this invoice only.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="inv-bank-name">Bank Name</Label>
                    <Input
                      id="inv-bank-name"
                      value={form.bankName}
                      onChange={(e) => setField('bankName', e.target.value)}
                      placeholder={settings.bankName || 'e.g. Saudi National Bank'}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inv-bank-account-name">Account Name</Label>
                    <Input
                      id="inv-bank-account-name"
                      value={form.bankAccountName}
                      onChange={(e) => setField('bankAccountName', e.target.value)}
                      placeholder={settings.bankAccountName || 'e.g. Landmark Inter Gulf Co.'}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inv-bank-account-number">Account Number</Label>
                    <Input
                      id="inv-bank-account-number"
                      value={form.bankAccountNumber}
                      onChange={(e) => setField('bankAccountNumber', e.target.value)}
                      placeholder={settings.bankAccountNumber || '00000000000000'}
                      className="font-mono"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inv-bank-iban">IBAN Number</Label>
                    <Input
                      id="inv-bank-iban"
                      value={form.bankIban}
                      onChange={(e) => setField('bankIban', e.target.value)}
                      placeholder={settings.bankIban || 'SA00 0000 0000 0000 0000 0000'}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inv-bank-swift">Swift Code</Label>
                    <Input
                      id="inv-bank-swift"
                      value={form.bankSwiftCode}
                      onChange={(e) => setField('bankSwiftCode', e.target.value)}
                      placeholder={settings.bankSwiftCode || 'NCBKSAJE'}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="inv-bank-address">Bank Address</Label>
                    <Input
                      id="inv-bank-address"
                      value={form.bankAddress}
                      onChange={(e) => setField('bankAddress', e.target.value)}
                      placeholder={settings.bankAddress || 'e.g. Jubail Industrial City, KSA'}
                    />
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  'Saving…'
                ) : editing ? (
                  'Save Changes'
                ) : (
                  'Create Invoice'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Quick-add client (opened from inside the invoice dialog) */}
      <Dialog open={quickClientOpen} onOpenChange={setQuickClientOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Client</DialogTitle>
            <DialogDescription>
              Create a client on the fly — you can enrich VAT, address and bank details later in
              Client Management.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="qc-name">
                Company Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="qc-name"
                value={quickClient.name}
                onChange={(e) => setQuickClient((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Al Rushaid Construction Co."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="qc-name-ar">
                Name — <span lang="ar" dir="rtl">العربية</span>
              </Label>
              <Input
                id="qc-name-ar"
                lang="ar"
                dir="rtl"
                value={quickClient.nameAr}
                onChange={(e) => setQuickClient((f) => ({ ...f, nameAr: e.target.value }))}
                placeholder="الاسم بالعربية"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="qc-vat">VAT Number</Label>
                <Input
                  id="qc-vat"
                  value={quickClient.vatNumber}
                  onChange={(e) => setQuickClient((f) => ({ ...f, vatNumber: e.target.value }))}
                  placeholder="3XXXXXXXXXXXXX3"
                  inputMode="numeric"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qc-phone">Phone</Label>
                <Input
                  id="qc-phone"
                  value={quickClient.phone}
                  onChange={(e) => setQuickClient((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+966 13 000 0000"
                  inputMode="tel"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="qc-city">City</Label>
              <Input
                id="qc-city"
                value={quickClient.city}
                onChange={(e) => setQuickClient((f) => ({ ...f, city: e.target.value }))}
                placeholder="e.g. Jubail"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setQuickClientOpen(false)}
              disabled={quickClientSaving}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleQuickAddClient()} disabled={quickClientSaving}>
              {quickClientSaving ? 'Saving…' : 'Create & Select'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Print dialog (A4 TAX INVOICE + ZATCA QR) ---- */}
      <InvoicePrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        invoice={printInvoice}
      />

      {/* ---- ZATCA Phase 2 submission dialog (connect system) ---- */}
      <ZatcaSubmitDialog
        open={zatcaOpen}
        onOpenChange={setZatcaOpen}
        invoice={zatcaInvoice}
        onSubmitted={handleZatcaSubmitted}
      />
    </div>
  )
}
