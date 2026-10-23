// POST /api/auth/change-password — current user updates own password
import { NextRequest } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword, hashPassword, getCurrentSessionToken } from '@/lib/auth'
import { ok, badRequest, unauthorized, serverError, logActivity, requireAuth, isResponse } from '@/lib/api-helpers'

const bodySchema = z.object({
  currentPassword: z.string('Current password is required').min(1, 'Current password is required'),
  newPassword: z
    .string('New password is required')
    .min(8, 'New password must be at least 8 characters')
    .max(100, 'New password is too long'),
})

export async function POST(req: NextRequest) {
  const auth = await requireAuth()
  if (isResponse(auth)) return auth

  try {
    let json: unknown = null
    try {
      json = await req.json()
    } catch {
      json = null
    }
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid request data')
    }
    const { currentPassword, newPassword } = parsed.data

    const user = await db.user.findUnique({ where: { id: auth.id } })
    if (!user) return unauthorized()

    const valid = await verifyPassword(currentPassword, user.password)
    if (!valid) {
      return badRequest('Current password is incorrect')
    }
    if (currentPassword === newPassword) {
      return badRequest('New password must be different from the current password')
    }

    const hashed = await hashPassword(newPassword)
    await db.user.update({ where: { id: user.id }, data: { password: hashed } })

    // The new password invalidates every OTHER session (a stolen session
    // otherwise survives the change for up to 30 days). The CURRENT session
    // stays alive so the user is not logged out mid-request.
    const keepToken = await getCurrentSessionToken()
    await db.session.deleteMany({
      where: keepToken
        ? { userId: user.id, token: { not: keepToken } }
        : { userId: user.id },
    })

    await logActivity({
      user: auth,
      action: 'updated',
      module: 'user',
      description: `${user.name} changed own password`,
    })

    return ok({ changed: true })
  } catch (err) {
    console.error('[api/auth/change-password]', err)
    return serverError()
  }
}
