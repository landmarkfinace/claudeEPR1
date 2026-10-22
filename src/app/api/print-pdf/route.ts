// POST /api/print-pdf — server-side VECTOR PDF for every print surface.
//
// The client serializes the active `.print-area` DOM (the exact markup the
// browser would print) and POSTs it here; this route forwards it to the
// local print render daemon (scripts/print/render-daemon.mjs) which renders
// it in headless Chromium with page.pdf({ format:'A4', printBackground:true,
// margin:0, scale:1, preferCSSPageSize:true }). The response is a true vector
// PDF: real selectable text, embedded webfonts (Arabic shaping intact),
// original-resolution images.
//
// The daemon is spawned on demand (detached, survives restarts) and is
// reusable across requests; it serves the app's compiled CSS + webfonts to
// the render page so the PDF is styled identically to the screen preview.
//
// Auth: any active session (printing shows data the user can already view).
import { NextRequest } from 'next/server'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'

import { getSessionUser } from '@/lib/auth'
import { unauthorized, badRequest, serverError } from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DAEMON_PORT = Number(process.env.PRINT_DAEMON_PORT || 3901)
const DAEMON_ORIGIN = `http://127.0.0.1:${DAEMON_PORT}`
const MAX_HTML = 20 * 1024 * 1024
const ENSURE_TIMEOUT_MS = 20_000

let ensuring: Promise<boolean> | null = null

/** Is the daemon answering /health right now? */
async function daemonHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${DAEMON_ORIGIN}/health`, {
      signal: AbortSignal.timeout(400),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Resolve the repo root that carries scripts/print/render-daemon.mjs.
 * The standalone server runs with cwd = <repo>/.next/standalone, so the
 * parent-of-parent is the repo; in dev the cwd IS the repo.
 */
function resolveRepoRoot(): string | null {
  const candidates = [
    process.env.PRINT_REPO,
    path.join(process.cwd(), '..', '..'), // .next/standalone → repo
    process.cwd(),
  ].filter(Boolean) as string[]
  for (const p of candidates) {
    try {
      if (fs.existsSync(path.join(p, 'scripts', 'print', 'render-daemon.mjs'))) return p
    } catch {}
  }
  return null
}

/** Spawn the render daemon (detached so it outlives requests/restarts).
 * The command is expanded by bash at RUNTIME from env vars — nothing for the
 * bundler to resolve (spawning `node <script>` directly makes Turbopack try
 * to bundle the script as a worker). */
function spawnDaemon(): void {
  const repoRoot = resolveRepoRoot()
  if (!repoRoot) throw new Error('render-daemon.mjs not found (set PRINT_REPO)')
  const child = spawn(
    '/bin/bash',
    [
      '-c',
      'exec "${PRINT_NODE:-node}" "${PRINT_REPO}/scripts/print/render-daemon.mjs" >> "${PRINT_REPO}/print-daemon.log" 2>&1',
    ],
    {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PRINT_REPO: repoRoot,
        PRINT_DAEMON_PORT: String(DAEMON_PORT),
      },
    }
  )
  child.unref()
}

/** Make sure the daemon is up (one attempt at a time); true when healthy. */
async function ensureDaemon(): Promise<boolean> {
  if (await daemonHealthy()) return true
  if (ensuring) return ensuring
  ensuring = (async () => {
    const deadline = Date.now() + ENSURE_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (await daemonHealthy()) return true
      try {
        spawnDaemon()
      } catch {}
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500))
        if (await daemonHealthy()) return true
      }
    }
    return false
  })()
  try {
    return await ensuring
  } finally {
    ensuring = null
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user) return unauthorized()

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return badRequest('Invalid JSON body')
    }
    const body = raw as {
      html?: unknown
      orientation?: unknown
      pageMode?: unknown
    }
    if (typeof body.html !== 'string' || body.html.length === 0) {
      return badRequest('html is required')
    }
    if (body.html.length > MAX_HTML) {
      return badRequest('html too large')
    }
    const orientation = body.orientation === 'landscape' ? 'landscape' : 'portrait'
    const pageMode = body.pageMode === 'flow' ? 'flow' : 'sheets'

    if (!(await ensureDaemon())) {
      return serverError()
    }

    const res = await fetch(`${DAEMON_ORIGIN}/pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: body.html, orientation, pageMode }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[print-pdf] daemon error', res.status, text.slice(0, 300))
      return serverError()
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    return new Response(bytes, {
      headers: {
        'content-type': 'application/pdf',
        'cache-control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[print-pdf]', e)
    return serverError()
  }
}
