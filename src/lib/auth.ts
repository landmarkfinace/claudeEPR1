// Server-only auth: scrypt password hashing + cookie sessions (Session table)
import 'server-only'
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import { BASELINE_PERMISSIONS } from '@/lib/permissions'
import type { SessionUser } from '@/lib/types'

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>

export const SESSION_COOKIE = 'lig_session'
const SESSION_DAYS = 30

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [salt, key] = stored.split(':')
    if (!salt || !key) return false
    const derived = await scrypt(password, salt, 64)
    const keyBuf = Buffer.from(key, 'hex')
    if (keyBuf.length !== derived.length) return false
    return timingSafeEqual(keyBuf, derived)
  } catch {
    return false
  }
}

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await db.session.create({ data: { token, userId, expiresAt } })
  return token
}

export async function destroySession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { token } })
}

function parsePermissions(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    if (!token) return null
    const session = await db.session.findUnique({
      where: { token },
      include: {
        user: {
          include: { role: true },
        },
      },
    })
    if (!session) return null
    if (session.expiresAt < new Date()) {
      await db.session.delete({ where: { id: session.id } }).catch(() => {})
      return null
    }
    if (!session.user.isActive) return null
    return {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      avatar: session.user.avatar,
      role: session.user.role
        ? {
            id: session.user.role.id,
            name: session.user.role.name,
            permissions: parsePermissions(session.user.role.permissions),
          }
        : null,
    }
  } catch {
    return null
  }
}

export function hasPermission(
  user: SessionUser | null,
  permission: string
): boolean {
  if (!user) return false
  // Baseline permissions (e.g. vat.view) apply to every signed-in user
  if (BASELINE_PERMISSIONS.has(permission)) return true
  const perms = user.role?.permissions ?? []
  if (perms.includes('*')) return true
  return perms.includes(permission)
}
