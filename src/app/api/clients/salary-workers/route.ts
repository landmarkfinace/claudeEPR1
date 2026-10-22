// Client Salary Summary — manually added billing rows (workers WITHOUT a
// payroll record). One row = one worker on one project for one month:
//   { clientId, projectId?, month, year, name, iqamaNo, totalHours, rate }
// The row is billed to the CLIENT company at `rate` per hour (the price we
// charge the client — separate from the worker's own pay rate). Rows are
// merged into the client groups by GET /api/clients/salary-summary and join
// that client's Subtotal + 15% VAT + Grand Total, print and CSV automatically.
// POST /api/clients/salary-workers — permission: payroll.edit (same as typing
// client rates in the summary; the page itself is payroll.view gated).
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

const nullableTrim = (v: unknown) =>
  typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v === undefined ? null : v

export const workerSchema = z.object({
  clientId: z.string().min(1, 'Client is required'),
  // '' / undefined → null (worker not tied to a project)
  projectId: z.preprocess(nullableTrim, z.string().nullable()),
  month: z.coerce
    .number()
    .int()
    .min(1, 'Month must be between 1 and 12')
    .max(12, 'Month must be between 1 and 12'),
  year: z.coerce
    .number()
    .int()
    .min(1900, 'Year is out of range')
    .max(2200, 'Year is out of range'),
  name: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z.string().min(1, 'Worker name is required').max(120, 'Worker name is too long')
  ),
  iqamaNo: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : ''),
    z
      .string()
      .min(1, 'Iqama number is required')
      .max(60, 'Iqama number is too long')
      // same worker can appear on two projects — duplicates are allowed,
      // just not blank
  ),
  totalHours: z.coerce
    .number()
    .min(0.01, 'Total hours must be greater than 0')
    .max(2000, 'Total hours is out of range (max 2000)'),
  rate: z.coerce
    .number()
    .min(0.01, 'Rate must be greater than 0')
    .max(100000, 'Rate is out of range'),
})

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
    const parsed = workerSchema.safeParse(json)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return badRequest(
        first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body'
      )
    }
    const input = parsed.data

    const client = await db.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, name: true },
    })
    if (!client) return notFound('Client not found')

    if (input.projectId) {
      const project = await db.project.findUnique({
        where: { id: input.projectId },
        select: { id: true, name: true },
      })
      if (!project) return notFound('Project not found')
    }

    const created = await db.clientSalaryWorker.create({
      data: {
        clientId: input.clientId,
        projectId: input.projectId,
        month: input.month,
        year: input.year,
        name: input.name,
        iqamaNo: input.iqamaNo,
        totalHours: input.totalHours,
        rate: input.rate,
      },
    })

    await logActivity({
      user,
      module: 'payroll',
      action: 'created',
      description: `Added worker to client salary summary: ${created.name} (IQAMA ${created.iqamaNo}) — ${client.name} · ${created.month}/${created.year}: ${created.totalHours} h × ${created.rate}/h`,
    })

    return ok(
      {
        id: created.id,
        clientId: created.clientId,
        clientName: client.name,
        projectId: created.projectId,
        month: created.month,
        year: created.year,
        name: created.name,
        iqamaNo: created.iqamaNo,
        totalHours: created.totalHours,
        rate: created.rate,
        amount: Math.round(created.totalHours * created.rate * 100) / 100,
      },
      201
    )
  } catch (err) {
    console.error('[api/clients/salary-workers POST]', err)
    return serverError()
  }
}
