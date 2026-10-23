// Dashboard API — headline stats, 6-month income/expense chart, payroll status,
// pending payouts, IQAMA document alerts and recent activity feed
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'
import { daysUntil, EXPIRY_WINDOW_DAYS } from '@/lib/expiry'
import {
  ok,
  serverError,
  requirePermission,
  isResponse,
} from '@/lib/api-helpers'
import { hasPermission } from '@/lib/auth'

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const LONG_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** Latest payroll month (by year, then month) that actually has records — null when no payroll exists. */
async function latestPayrollMonth(): Promise<{ month: number; year: number } | null> {
  const grouped = await db.payroll.groupBy({ by: ['month', 'year'] })
  if (grouped.length === 0) return null
  return grouped.reduce((best, g) => {
    if (g.year > best.year || (g.year === best.year && g.month > best.month)) {
      return { month: g.month, year: g.year }
    }
    return best
  })
}

export const dynamic = 'force-dynamic'

/** Chart period for the optional ?range= param. Default (no param) keeps the
 *  historical last-6-months behaviour so existing consumers never break. */
type ChartRange = 'month' | '3m' | 'year'

function parseRange(value: string | null): ChartRange | null {
  if (value === 'month' || value === '3m' || value === 'year') return value
  return null
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('dashboard.view')
    if (isResponse(auth)) return auth

    const now = new Date()
    const { searchParams } = new URL(req.url)
    const range = parseRange(searchParams.get('range'))

    const [totalStaff, totalUsers, incomeAgg, expenseAgg, salaryAgg, advanceRows] =
      await Promise.all([
        db.staff.count({ where: { deletedAt: null, status: 'active' } }),
        db.user.count(),
        db.transaction.aggregate({
          where: { type: 'income' },
          _sum: { amount: true },
        }),
        db.transaction.aggregate({
          where: { type: 'expense' },
          _sum: { amount: true },
        }),
        db.payroll.aggregate({
          where: { status: 'paid' },
          _sum: { netPay: true },
        }),
        db.workerAdvance.findMany({
          select: { amount: true, deductedAmount: true },
        }),
      ])

    // Chart buckets depend on ?range= — default keeps the historical 6-month window
    let chartBuckets: { month: string; income: number; expense: number }[]
    if (range === 'month') {
      // Weekly buckets of the current calendar month
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const weeks = Math.ceil(lastDay / 7)
      chartBuckets = Array.from({ length: weeks }, (_, i) => ({
        month: `Week ${i + 1}`,
        income: 0,
        expense: 0,
      }))
    } else {
      const months = range === '3m' ? 3 : range === 'year' ? 12 : 6
      chartBuckets = Array.from({ length: months }, (_, i) => {
        const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1)
        return { month: `${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`, income: 0, expense: 0 }
      })
    }

    // Window covering the chart buckets
    const chartStart = range
      ? range === 'month'
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(now.getFullYear(), now.getMonth() - (range === '3m' ? 2 : 11), 1)
      : new Date(now.getFullYear(), now.getMonth() - 5, 1)
    const chartEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    )
    const chartTxs = await db.transaction.findMany({
      where: { transactionDate: { gte: chartStart, lte: chartEnd } },
      select: { type: true, amount: true, transactionDate: true },
    })

    // Map month-label → bucket object (the SAME objects as chartBuckets, so
    // the mutation below is reflected in the chart result)
    const buckets = new Map<string, { month: string; income: number; expense: number }>()
    for (const b of chartBuckets) buckets.set(b.month, b)
    for (const t of chartTxs) {
      let bucket: { month: string; income: number; expense: number } | undefined
      if (range === 'month') {
        // Bucket by week-of-month (1-based)
        const day = t.transactionDate.getDate()
        const week = Math.floor((day - 1) / 7)
        bucket = chartBuckets[week]
      } else {
        const d = t.transactionDate
        bucket = buckets.get(`${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`)
      }
      if (!bucket) continue
      if (t.type === 'income') bucket.income += t.amount
      else bucket.expense += t.amount
    }
    const chart = chartBuckets.map((b) => ({
      month: b.month,
      income: round2(b.income),
      expense: round2(b.expense),
    }))

    // Activity feed is only sent to users who may open the Activity Log
    const recentActivityRows = hasPermission(auth, 'activity.view')
      ? await db.activityLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 8,
        })
      : []
    const recentActivity = recentActivityRows.map((a) => ({
      id: a.id,
      userName: a.userName,
      action: a.action,
      module: a.module,
      description: a.description,
      amount: a.amount === null ? null : round2(a.amount),
      createdAt: a.createdAt.toISOString(),
    }))

    const totalIncome = round2(incomeAgg._sum.amount ?? 0)
    const totalExpense = round2(expenseAgg._sum.amount ?? 0)

    // ---- IQAMA document alerts (staff.view gated) ----
    let documentAlerts: {
      expired: { staffId: string; fullName: string; iqamaId: string; iqamaExpiry: string; daysLeft: number }[]
      expiring: { staffId: string; fullName: string; iqamaId: string; iqamaExpiry: string; daysLeft: number }[]
    } | null = null
    if (hasPermission(auth, 'staff.view')) {
      const windowEnd = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 86_400_000)
      const docRows = await db.staff.findMany({
        where: {
          deletedAt: null,
          status: 'active',
          OR: [{ iqamaExpiry: { lt: now } }, { iqamaExpiry: { gte: now, lte: windowEnd } }],
        },
        select: { id: true, fullName: true, iqamaId: true, iqamaExpiry: true },
        orderBy: { iqamaExpiry: 'asc' },
      })
      const toAlert = (r: (typeof docRows)[number]) => ({
        staffId: r.id,
        fullName: r.fullName,
        iqamaId: r.iqamaId,
        iqamaExpiry: (r.iqamaExpiry as Date).toISOString(),
        daysLeft: daysUntil(r.iqamaExpiry) ?? 0,
      })
      documentAlerts = {
        expired: docRows.filter((r) => (daysUntil(r.iqamaExpiry) ?? 0) < 0).map(toAlert),
        expiring: docRows.filter((r) => (daysUntil(r.iqamaExpiry) ?? 0) >= 0).map(toAlert),
      }
    }

    // ---- Payroll status for the latest month that has payroll records ----
    let payrollStatus: {
      month: string
      pendingCount: number
      paidCount: number
      pendingAmount: number
      paidAmount: number
      pending: { id: string; staffId: string; staffName: string; netPay: number }[]
    } | null = null

    const latest = await latestPayrollMonth()
    if (latest) {
      const { searchParams } = new URL(req.url)
      // "Show all pending" toggle fetches a longer list (clamped)
      const pendingLimit = Math.min(
        Math.max(Number(searchParams.get('pendingLimit')) || 6, 1),
        200
      )
      const periodRows = await db.payroll.findMany({
        where: { month: latest.month, year: latest.year },
        include: { staff: { select: { id: true, fullName: true } } },
        orderBy: { netPay: 'desc' },
      })
      const pendingRows = periodRows.filter((p) => p.status === 'pending')
      const paidRows = periodRows.filter((p) => p.status === 'paid')
      payrollStatus = {
        month: `${LONG_MONTHS[latest.month - 1]} ${latest.year}`,
        pendingCount: pendingRows.length,
        paidCount: paidRows.length,
        pendingAmount: round2(pendingRows.reduce((s, p) => s + p.netPay, 0)),
        paidAmount: round2(paidRows.reduce((s, p) => s + p.netPay, 0)),
        pending: pendingRows.slice(0, pendingLimit).map((p) => ({
          id: p.id,
          staffId: p.staff.id,
          staffName: p.staff.fullName,
          netPay: round2(p.netPay),
        })),
      }
    }

    // ---- Client deployment overview (clients.view gated) ----
    let clientDeployment: {
      clientCount: number
      activeClients: number
      deployedWorkers: number
      topClients: { id: string; name: string; city: string | null; workers: number }[]
    } | null = null
    if (hasPermission(auth, 'clients.view')) {
      const [clientTotal, activeTotal, psRows] = await Promise.all([
        db.client.count(),
        db.client.count({ where: { status: 'active' } }),
        db.projectStaff.findMany({
          // only real, active workers count as deployed (soft-deleted / inactive excluded)
          where: {
            project: { clientId: { not: null } },
            staff: { deletedAt: null, status: 'active' },
          },
          select: {
            staffId: true,
            project: { select: { client: { select: { id: true, name: true, city: true } } } },
          },
          take: 5000,
        }),
      ])
      // Distinct deployed workers per client (a worker on 2 projects counts once)
      const perClient = new Map<string, { name: string; city: string | null; staff: Set<string> }>()
      for (const ps of psRows) {
        const c = ps.project.client
        if (!c) continue
        let entry = perClient.get(c.id)
        if (!entry) {
          entry = { name: c.name, city: c.city, staff: new Set() }
          perClient.set(c.id, entry)
        }
        entry.staff.add(ps.staffId)
      }
      const topClients = Array.from(perClient.entries())
        .map(([id, e]) => ({ id, name: e.name, city: e.city, workers: e.staff.size }))
        .sort((a, b) => b.workers - a.workers)
        .slice(0, 5)
      clientDeployment = {
        clientCount: clientTotal,
        activeClients: activeTotal,
        deployedWorkers: new Set(psRows.map((ps) => ps.staffId)).size,
        topClients,
      }
    }

    // ---- Advance outstanding (advances.view gated) ----
    let advanceOutstanding: number | null = null
    if (hasPermission(auth, 'advances.view')) {
      advanceOutstanding = round2(
        advanceRows.reduce((s, a) => s + a.amount - a.deductedAmount, 0)
      )
    }

    // ---- Workforce availability (staff.view gated) ----
    let workforce: { active: number; onSite: number; available: number; inInterview: number } | null = null
    if (hasPermission(auth, 'staff.view')) {
      try {
        const [onSiteRows, inInterview] = await Promise.all([
          db.projectStaff.findMany({
            where: { staff: { deletedAt: null, status: 'active' } },
            select: { staffId: true },
            distinct: ['staffId'],
          }),
          db.staff.count({
            where: { deletedAt: null, status: 'active', deploymentStatus: 'in_interview' },
          }),
        ])
        const onSite = onSiteRows.length
        workforce = {
          active: totalStaff,
          onSite,
          available: Math.max(totalStaff - onSite, 0),
          inInterview,
        }
      } catch {
        workforce = null
      }
    }

    // ---- Receivables: open e-invoices (einvoices.view gated) ----
    let receivables: {
      openCount: number
      outstanding: number
      overdueCount: number
      overdueAmount: number
      invoicedThisMonth: number
    } | null = null
    if (hasPermission(auth, 'einvoices.view')) {
      try {
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const [openRows, noteRows, monthAgg] = await Promise.all([
          db.eInvoice.findMany({
            where: { docType: 'invoice', status: { in: ['issued', 'partially_paid'] } },
            select: { id: true, totalDue: true, paidAmount: true, dueDate: true },
          }),
          // Non-draft credit/debit notes net against the invoice they correct
          // (the old receivables card ignored notes entirely, so a credit note
          // never reduced what the dashboard said clients owe).
          db.eInvoice.findMany({
            where: { docType: { in: ['credit_note', 'debit_note'] }, status: { not: 'draft' } },
            select: { relatedInvoiceId: true, docType: true, totalDue: true },
          }),
          db.eInvoice.aggregate({
            where: {
              docType: 'invoice',
              status: { not: 'draft' },
              issueDate: { gte: monthStart, lte: chartEnd },
            },
            _sum: { totalDue: true },
          }),
        ])
        const debitByInvoice = new Map<string, number>()
        const creditByInvoice = new Map<string, number>()
        for (const n of noteRows) {
          if (!n.relatedInvoiceId) continue
          const map = n.docType === 'debit_note' ? debitByInvoice : creditByInvoice
          map.set(n.relatedInvoiceId, (map.get(n.relatedInvoiceId) ?? 0) + n.totalDue)
        }
        let outstanding = 0
        let overdueCount = 0
        let overdueAmount = 0
        for (const r of openRows) {
          const eff = r.totalDue + (debitByInvoice.get(r.id) ?? 0) - (creditByInvoice.get(r.id) ?? 0)
          const bal = Math.max(eff - r.paidAmount, 0)
          outstanding += bal
          if (r.dueDate && r.dueDate < todayStart && bal > 0.004) {
            overdueCount += 1
            overdueAmount += bal
          }
        }
        receivables = {
          openCount: openRows.length,
          outstanding: round2(outstanding),
          overdueCount,
          overdueAmount: round2(overdueAmount),
          invoicedThisMonth: round2(monthAgg._sum.totalDue ?? 0),
        }
      } catch {
        receivables = null
      }
    }

    // ---- Pipeline: quotations awaiting reply + open supplier P.O.s ----
    let pipeline: {
      quotationsSent: number | null
      quotationsSentValue: number | null
      quotationsDraft: number | null
      posOrdered: number | null
      posOrderedValue: number | null
    } | null = null
    const canQuotes = hasPermission(auth, 'quotations.view')
    const canPos = hasPermission(auth, 'supplierpo.view')
    if (canQuotes || canPos) {
      try {
        const [qSent, qDraft, poOrdered] = await Promise.all([
          canQuotes
            ? db.quotation.aggregate({ where: { status: 'sent' }, _count: { _all: true }, _sum: { total: true } })
            : null,
          canQuotes ? db.quotation.count({ where: { status: 'draft' } }) : null,
          canPos
            ? db.supplierPo.aggregate({ where: { status: 'ordered' }, _count: { _all: true }, _sum: { total: true } })
            : null,
        ])
        pipeline = {
          quotationsSent: qSent ? qSent._count._all : null,
          quotationsSentValue: qSent ? round2(qSent._sum.total ?? 0) : null,
          quotationsDraft: qDraft,
          posOrdered: poOrdered ? poOrdered._count._all : null,
          posOrderedValue: poOrdered ? round2(poOrdered._sum.total ?? 0) : null,
        }
      } catch {
        pipeline = null
      }
    }

    // ---- Today's name lists (namelist.view gated) ----
    let todayLists: {
      listCount: number
      workerCount: number
      lists: {
        id: string
        listNo: string
        time: string | null
        clientName: string
        subjectName: string
        subjectColor: string
        status: string
        workers: number
      }[]
    } | null = null
    if (hasPermission(auth, 'namelist.view')) {
      try {
        const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
        const rows = await db.nameList.findMany({
          where: { date: { gte: dayStart, lte: dayEnd }, status: { not: 'cancelled' } },
          select: {
            id: true,
            listNo: true,
            time: true,
            status: true,
            client: { select: { name: true } },
            subject: { select: { name: true, color: true } },
            _count: { select: { workers: true } },
          },
          orderBy: [{ time: 'asc' }, { seq: 'asc' }],
        })
        todayLists = {
          listCount: rows.length,
          workerCount: rows.reduce((s, r) => s + r._count.workers, 0),
          lists: rows.slice(0, 8).map((r) => ({
            id: r.id,
            listNo: r.listNo,
            time: r.time,
            clientName: r.client?.name ?? '—',
            subjectName: r.subject.name,
            subjectColor: r.subject.color,
            status: r.status,
            workers: r._count.workers,
          })),
        }
      } catch {
        todayLists = null
      }
    }

    // ---- Period-over-period trends (this calendar month vs previous) ----
    let trends: {
      income: { current: number; previous: number } | null
      expense: { current: number; previous: number } | null
      salaryPaid: { current: number; previous: number } | null
    } | null = null
    try {
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      const canAccountsTrend = hasPermission(auth, 'accounts.view')
      const [inM, exM, inP, exP, salM, salP] = await Promise.all([
        canAccountsTrend
          ? db.transaction.aggregate({ where: { type: 'income', transactionDate: { gte: thisMonthStart, lte: chartEnd } }, _sum: { amount: true } })
          : null,
        canAccountsTrend
          ? db.transaction.aggregate({ where: { type: 'expense', transactionDate: { gte: thisMonthStart, lte: chartEnd } }, _sum: { amount: true } })
          : null,
        canAccountsTrend
          ? db.transaction.aggregate({ where: { type: 'income', transactionDate: { gte: prevMonthStart, lte: prevMonthEnd } }, _sum: { amount: true } })
          : null,
        canAccountsTrend
          ? db.transaction.aggregate({ where: { type: 'expense', transactionDate: { gte: prevMonthStart, lte: prevMonthEnd } }, _sum: { amount: true } })
          : null,
        db.payroll.aggregate({ where: { status: 'paid', payDate: { gte: thisMonthStart, lte: chartEnd } }, _sum: { netPay: true } }),
        db.payroll.aggregate({ where: { status: 'paid', payDate: { gte: prevMonthStart, lte: prevMonthEnd } }, _sum: { netPay: true } }),
      ])
      trends = {
        income: inM && inP ? { current: round2(inM._sum.amount ?? 0), previous: round2(inP._sum.amount ?? 0) } : null,
        expense: exM && exP ? { current: round2(exM._sum.amount ?? 0), previous: round2(exP._sum.amount ?? 0) } : null,
        salaryPaid: { current: round2(salM._sum.netPay ?? 0), previous: round2(salP._sum.netPay ?? 0) },
      }
    } catch {
      trends = null
    }

    // ---- ZATCA Phase 2 clearance queue (einvoices.view gated) ----
    // Issued (signed) invoices whose zatcaStatus is still pending/rejected —
    // i.e. not yet cleared (standard) or reported (simplified).
    let zatcaPending: { count: number; rejected: number } | null = null
    if (hasPermission(auth, 'einvoices.view')) {
      try {
        const [pendingCount, rejectedCount] = await Promise.all([
          db.eInvoice.count({ where: { signedXml: { not: null }, zatcaStatus: 'pending' } }),
          db.eInvoice.count({ where: { signedXml: { not: null }, zatcaStatus: 'rejected' } }),
        ])
        zatcaPending = { count: pendingCount + rejectedCount, rejected: rejectedCount }
      } catch {
        zatcaPending = null
      }
    }

    return ok({
      stats: {
        totalStaff,
        totalUsers,
        totalIncome,
        totalExpense,
        netBalance: round2(totalIncome - totalExpense),
        salaryPaid: round2(salaryAgg._sum.netPay ?? 0),
        advanceOutstanding,
      },
      payrollStatus,
      chart,
      recentActivity,
      documentAlerts,
      clientDeployment,
      workforce,
      receivables,
      pipeline,
      todayLists,
      trends,
      zatcaPending,
    })
  } catch {
    return serverError()
  }
}
