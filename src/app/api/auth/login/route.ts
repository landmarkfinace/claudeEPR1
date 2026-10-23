// POST /api/auth/login — email + password → session cookie
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword, createSession, SESSION_COOKIE } from '@/lib/auth'
import { ok, badRequest, unauthorized, serverError, logActivity } from '@/lib/api-helpers'
import type { SessionUser } from '@/lib/types'

/**
 * Minimal in-memory brute-force guard for this single-instance deployment.
 * Tracks failed attempts per (email, ip); 5 failures inside 15 minutes locks
 * that pair out. A successful login clears the counter. Server restart
 * resets the window (acceptable — sessions are 30-day cookie logins, not a
 * high-traffic public endpoint).
 */
const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000
const attempts = new Map<string, { count: number; firstAt: number; lockedUntil: number }>()

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for')
  // LAST entry: the trusted gateway (caddy) appends the real client IP —
  // client-supplied spoofed entries at the front must not reset the counter.
  return (fwd ? (fwd.split(',').pop()?.trim() ?? '') : '') || 'local'
}

function tooManyAttempts(key: string, now: number): number {
  // returns remaining lockout seconds, or 0 when allowed
  const a = attempts.get(key)
  if (!a) return 0
  if (a.lockedUntil > now) return Math.ceil((a.lockedUntil - now) / 1000)
  if (now - a.firstAt > WINDOW_MS) {
    attempts.delete(key) // window expired — fresh start
    return 0
  }
  return 0
}

function recordFailure(key: string, now: number): void {
  const a = attempts.get(key)
  if (!a || now - a.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 })
    return
  }
  a.count += 1
  if (a.count >= MAX_FAILURES) a.lockedUntil = now + WINDOW_MS
  if (attempts.size > 1000) {
    // opportunistic GC so the map can never grow unbounded
    for (const [k, v] of attempts) {
      if (v.lockedUntil < now && now - v.firstAt > WINDOW_MS) attempts.delete(k)
    }
  }
}

const bodySchema = z.object({
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
    z.email('Please enter a valid email address')
  ),
  password: z.string('Password is required').min(1, 'Password is required'),
})

function parsePermissions(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export async function POST(req: NextRequest) {
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
    const { email, password } = parsed.data

    const now = Date.now()
    const limiterKey = `${email.toLowerCase()}|${clientIp(req)}`
    const lockoutLeft = tooManyAttempts(limiterKey, now)
    if (lockoutLeft > 0) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${Math.ceil(lockoutLeft / 60)} minute(s).` },
        { status: 429, headers: { 'Retry-After': String(lockoutLeft) } }
      )
    }

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { role: true },
    })
    if (!user || !user.isActive) {
      recordFailure(limiterKey, Date.now())
      return unauthorized('Invalid email or password')
    }

    const valid = await verifyPassword(password, user.password)
    if (!valid) {
      recordFailure(limiterKey, Date.now())
      return unauthorized('Invalid email or password')
    }

    attempts.delete(limiterKey) // success clears the counter

    const token = await createSession(user.id)

    const sessionUser: SessionUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role
        ? {
            id: user.role.id,
            name: user.role.name,
            permissions: parsePermissions(user.role.permissions),
          }
        : null,
    }

    await logActivity({
      user: sessionUser,
      action: 'login',
      module: 'user',
      description: `${user.name} signed in`,
    })

    // Token is ALSO returned in the JSON body: the client stores it and sends
    // it as an Authorization: Bearer header. Required for the sandbox preview
    // iframe where SameSite=Lax cookies are blocked by the browser.
    const res = ok({ user: sessionUser, token })
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    })
    return res
  } catch (err) {
    console.error('[api/auth/login]', err)
    return serverError()
  }
}
