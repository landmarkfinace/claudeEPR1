// Client Salary Summary — COPY system for manually added billing rows.
// The workers added once (e.g. 10 workers in October) keep working next month,
// so re-typing them every month is a chore: this endpoint copies a client's
// (or every client's) manual rows from their most recent EARLIER month into
// the target month. Afterwards the copied rows are normal rows of the target
// month — add more / remove / edit each one freely.
//   POST /api/clients/salary-workers/copy
//   { toMonth, toYear, clientId? }            — auto source: per client, the
//                                               most recent month that has rows
//   { toMonth, toYear, clientId?, fromMonth, fromYear } — explicit source
// Skips (never duplicates):
//   • a worker already manually added to the target month (same iqama)
//   • a worker already billed via a payroll record of the target month
//     (same client + iqama) — prevents double billing after copying
// Permission: payroll.edit (same as creating a manual row).
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import {
  ok,
  badRequest,
  notFound,
  serverError,
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

const bodySchema = z
  .object({
    // copy only this client; omit = every client that has earlier rows
    clientId: z.string().trim().min(1).optional(),
    toMonth: z.coerce.number().int().min(1).max(12),
    toYear: z.coerce.number().int().min(1900).max(2200),
    // optional explicit source month (must be strictly before the target)
    fromMonth: z.coerce.number().int().min(1).max(12).optional(),
    fromYear: z.coerce.number().int().min(1900).max(2200).optional(),
  })
  .refine((b) => (b.fromMonth === undefined) === (b.fromYear === undefined), {
    message: 'fromMonth and fromYear must be given together',
  })
  .refine(
    (b) =>
      b.fromYear === undefined ||
      b.fromYear < b.toYear ||
      (b.fromYear === b.toYear && b.fromMonth! < b.toMonth),
    { message: 'The source month must be earlier than the target month' }
  )

type PriorRow = {
  clientId: string
  projectId: string | null
  name: string
  iqamaNo: string
  totalHours: number
  rate: number
  month: number
  year: number
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePermission('payroll.edit')
    if (isResponse(user)) return user

    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return badRequest(
        first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body'
      )
    }
    const input = parsed.data

    if (input.clientId) {
      const client = await db.client.findUnique({
        where: { id: input.clientId },
        select: { id: true },
      })
      if (!client) return notFound('Client not found')
    }

    // ---- 1) every manual row before the target month (scope-filtered) ----
    const priorWhere = input.fromMonth && input.fromYear
      ? {
          month: input.fromMonth,
          year: input.fromYear,
          ...(input.clientId ? { clientId: input.clientId } : {}),
        }
      : {
          OR: [{ year: { lt: input.toYear } }, { year: input.toYear, month: { lt: input.toMonth } }],
          ...(input.clientId ? { clientId: input.clientId } : {}),
        }
    const priorRows = await db.clientSalaryWorker.findMany({
      where: priorWhere,
      select: {
        clientId: true,
        projectId: true,
        name: true,
        iqamaNo: true,
        totalHours: true,
        rate: true,
        month: true,
        year: true,
      },
    })

    // ---- 2) per client: the most recent of their earlier months ----
    const byClient = new Map<string, PriorRow[]>()
    for (const r of priorRows) {
      const list = byClient.get(r.clientId)
      if (list) list.push(r)
      else byClient.set(r.clientId, [r])
    }

    type SourceAgg = {
      clientId: string
      fromMonth: number
      fromYear: number
      rows: PriorRow[]
      copied: number
      skippedManual: number
      skippedPayroll: number
    }
    const sources: SourceAgg[] = []
    for (const [clientId, rows] of byClient) {
      // latest (year, month) among this client's rows — with an explicit
      // source month every row already matches it, so the pick is a no-op
      let best = rows[0]
      for (const r of rows) {
        if (r.year > best.year || (r.year === best.year && r.month > best.month)) best = r
      }
      sources.push({
        clientId,
        fromMonth: best.month,
        fromYear: best.year,
        rows: rows.filter((r) => r.month === best.month && r.year === best.year),
        copied: 0,
        skippedManual: 0,
        skippedPayroll: 0,
      })
    }

    // nothing anywhere → tell the caller instead of creating anything
    if (sources.length === 0) {
      return ok({
        target: { month: input.toMonth, year: input.toYear },
        copied: 0,
        skippedManual: 0,
        skippedPayroll: 0,
        sources: [],
      })
    }

    const clientIds = sources.map((s) => s.clientId)

    // ---- 3) who is already in the target month? (never duplicate) ----
    const existing = await db.clientSalaryWorker.findMany({
      where: { month: input.toMonth, year: input.toYear, clientId: { in: clientIds } },
      select: { clientId: true, iqamaNo: true },
    })
    const manualKeys = new Set(
      existing.map((r) => `${r.clientId}|${r.iqamaNo.trim().toLowerCase()}`)
    )

    // workers already billed through a payroll record of the target month
    // (project → client): copying them would double-bill the same iqama
    const payrollLines = await db.payroll.findMany({
      where: { month: input.toMonth, year: input.toYear, project: { clientId: { in: clientIds } } },
      select: { project: { select: { clientId: true } }, staff: { select: { iqamaId: true } } },
    })
    const payrollKeys = new Set(
      payrollLines
        .filter((p) => p.project?.clientId)
        .map((p) => `${p.project!.clientId}|${p.staff.iqamaId.trim().toLowerCase()}`)
    )

    // ---- 4) build the copies ----
    const copies: {
      clientId: string
      projectId: string | null
      month: number
      year: number
      name: string
      iqamaNo: string
      totalHours: number
      rate: number
    }[] = []
    let skippedManual = 0
    let skippedPayroll = 0
    for (const s of sources) {
      for (const r of s.rows) {
        const key = `${s.clientId}|${r.iqamaNo.trim().toLowerCase()}`
        if (manualKeys.has(key)) {
          skippedManual += 1
          s.skippedManual += 1
          continue
        }
        if (payrollKeys.has(key)) {
          skippedPayroll += 1
          s.skippedPayroll += 1
          continue
        }
        copies.push({
          clientId: r.clientId,
          projectId: r.projectId,
          month: input.toMonth,
          year: input.toYear,
          name: r.name,
          iqamaNo: r.iqamaNo,
          totalHours: r.totalHours,
          rate: r.rate,
        })
        s.copied += 1
      }
    }

    if (copies.length > 0) {
      await db.clientSalaryWorker.createMany({ data: copies })
    }

    // client names for the response (per-source detail)
    const clients = await db.client.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, name: true },
    })
    const nameOf = new Map(clients.map((c) => [c.id, c.name]))

    if (copies.length > 0) {
      await logActivity({
        user,
        module: 'payroll',
        action: 'created',
        description: `Copied ${copies.length} worker${copies.length === 1 ? '' : 's'} into ${input.toMonth}/${input.toYear} from earlier months` +
          (skippedManual + skippedPayroll > 0
            ? ` — skipped ${skippedManual} already added, ${skippedPayroll} already on payroll`
            : ''),
      })
    }

    return ok({
      target: { month: input.toMonth, year: input.toYear },
      copied: copies.length,
      skippedManual,
      skippedPayroll,
      sources: sources.map((s) => ({
        clientId: s.clientId,
        clientName: nameOf.get(s.clientId) ?? 'Unknown client',
        fromMonth: s.fromMonth,
        fromYear: s.fromYear,
        copied: s.copied,
        skippedManual: s.skippedManual,
        skippedPayroll: s.skippedPayroll,
      })),
    })
  } catch (err) {
    console.error('[api/clients/salary-workers/copy POST]', err)
    return serverError()
  }
}
