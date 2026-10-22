// Client Salary Summary — edit / delete one manually added billing row.
//   PATCH   /api/clients/salary-workers/[id]  { name?, iqamaNo?, projectId?,
//             totalHours?, rate? }  (projectId null = clear the project)
//   DELETE  /api/clients/salary-workers/[id]
// Permission: payroll.edit (same as the rest of the summary's write actions).
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

const patchSchema = z
  .object({
    name: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() : v ?? ''),
      z.string().min(1, 'Worker name is required').max(120, 'Worker name is too long')
    ),
    iqamaNo: z.preprocess(
      (v) => (typeof v === 'string' ? v.trim() : v ?? ''),
      z.string().min(1, 'Iqama number is required').max(60, 'Iqama number is too long')
    ),
    projectId: z.preprocess(nullableTrim, z.string().nullable()),
    totalHours: z.coerce
      .number()
      .min(0.01, 'Total hours must be greater than 0')
      .max(2000, 'Total hours is out of range (max 2000)'),
    rate: z.coerce
      .number()
      .min(0.01, 'Rate must be greater than 0')
      .max(100000, 'Rate is out of range'),
  })
  .partial()

async function findRow(id: string) {
  const row = await db.clientSalaryWorker.findUnique({
    where: { id },
    include: { client: { select: { name: true } } },
  })
  return row
}

// PATCH /api/clients/salary-workers/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePermission('payroll.edit')
    if (isResponse(user)) return user

    const { id } = await params

    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = patchSchema.safeParse(json)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return badRequest(
        first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body'
      )
    }
    const input = parsed.data
    if (Object.keys(input).length === 0) {
      return badRequest('Nothing to update — provide at least one field')
    }

    const existing = await findRow(id)
    if (!existing) return notFound('Worker row not found')

    if (input.projectId) {
      const project = await db.project.findUnique({
        where: { id: input.projectId },
        select: { id: true },
      })
      if (!project) return notFound('Project not found')
    }

    const updated = await db.clientSalaryWorker.update({
      where: { id },
      data: input,
    })

    await logActivity({
      user,
      module: 'payroll',
      action: 'updated',
      description: `Updated client salary summary worker: ${updated.name} — ${existing.client.name} · ${updated.month}/${updated.year}: ${updated.totalHours} h × ${updated.rate}/h`,
    })

    return ok({
      id: updated.id,
      name: updated.name,
      iqamaNo: updated.iqamaNo,
      projectId: updated.projectId,
      totalHours: updated.totalHours,
      rate: updated.rate,
      amount: Math.round(updated.totalHours * updated.rate * 100) / 100,
    })
  } catch (err) {
    console.error('[api/clients/salary-workers/[id] PATCH]', err)
    return serverError()
  }
}

// DELETE /api/clients/salary-workers/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requirePermission('payroll.edit')
    if (isResponse(user)) return user

    const { id } = await params

    const existing = await findRow(id)
    if (!existing) return notFound('Worker row not found')

    await db.clientSalaryWorker.delete({ where: { id } })

    await logActivity({
      user,
      module: 'payroll',
      action: 'deleted',
      description: `Removed worker from client salary summary: ${existing.name} — ${existing.client.name} · ${existing.month}/${existing.year}`,
    })

    return ok({ id })
  } catch (err) {
    console.error('[api/clients/salary-workers/[id] DELETE]', err)
    return serverError()
  }
}
