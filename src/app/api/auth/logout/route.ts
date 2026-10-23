// POST /api/auth/logout — destroy session + clear cookie/token (no auth required)
import { NextRequest } from 'next/server'
import { destroySession, SESSION_COOKIE, getSessionUser } from '@/lib/auth'
import { ok, serverError, logActivity } from '@/lib/api-helpers'

export async function POST(req: NextRequest) {
  try {
    // Accept the session token from the cookie OR the Authorization header —
    // inside the sandbox preview iframe only the Bearer header reaches us.
    let token = req.cookies.get(SESSION_COOKIE)?.value ?? null
    const authHeader = req.headers.get('authorization')
    if (!token && authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice('Bearer '.length).trim() || null
    }
    if (!token) {
      // Last resort: { token } JSON body (client sends its stored token)
      try {
        const body = await req.json()
        if (body && typeof body === 'object' && 'token' in body) {
          const t = (body as { token?: unknown }).token
          if (typeof t === 'string' && t) token = t
        }
      } catch {
        // no body — fine
      }
    }
    // Audit trail: logouts were invisible — log who signed out BEFORE the
    // session row is destroyed (best-effort: unknown user is skipped).
    let who: Awaited<ReturnType<typeof getSessionUser>> = null
    try {
      who = await getSessionUser()
    } catch {
      who = null
    }
    if (token) {
      try {
        await destroySession(token)
      } catch {
        // clearing the cookie below is enough even if the row is already gone
      }
    }
    if (who) {
      try {
        await logActivity({
          user: who,
          action: 'logout',
          module: 'user',
          description: `${who.name} signed out`,
        })
      } catch {
        // logging must never block the logout itself
      }
    }
    const res = ok({ success: true })
    res.cookies.set(SESSION_COOKIE, '', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    })
    return res
  } catch (err) {
    console.error('[api/auth/logout]', err)
    return serverError()
  }
}
