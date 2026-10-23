// Agreement PDF — GET /api/agreements/[id]/pdf.
// Server-rendered VECTOR PDF from the SAME bilingual template the editor
// previews: the row is mapped to the template object, the sheet fragment is
// built with its full stylesheet (Noto Naskh Arabic + Noto Sans embedded as
// data URLs, the template's own @media print block with
// @page { size: A4; margin: 12mm 12mm 14mm }) and rendered by the shared print
// daemon (pageMode 'flow' + preferCSSPageSize) — real selectable text, correct
// Arabic joining and RTL, images at original resolution.
// PRINT TEMPLATES: the row's saved template (else the module default from
// Settings) picks the layout — 'classic' renders the flow fragment above
// UNCHANGED; 'bilingual-cards' / 'official-form' / 'key-terms' render the
// same components the dialog shows (fixed A4 sheets, pageMode 'sheets',
// letterhead artwork from Settings) from the SAME data.
// File name: AgreementNo_OtherPartyName.pdf
import { NextRequest } from 'next/server'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { db } from '@/lib/db'
import { notFound, serverError, requirePermission, isResponse, logActivity } from '@/lib/api-helpers'
import {
  agreementFullInclude,
  mapAgreement,
} from '@/lib/agreement-server'
import { buildDaemonFragment, toTemplateAgreement } from '@/lib/agreement-template'
import { resolveAgreementPrintTemplate } from '@/lib/agreement-print-templates'
import { renderAgreementPrintTemplate } from '@/lib/agreement-pdf-render'
import type { LetterheadConfig } from '@/lib/types'
import { DEFAULT_LETTERHEAD } from '@/components/app/print/agreement-print-shared'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DAEMON_PORT = Number(process.env.PRINT_DAEMON_PORT || 3901)
const DAEMON_ORIGIN = `http://127.0.0.1:${DAEMON_PORT}`
const ENSURE_TIMEOUT_MS = 20_000

// ── minimal daemon client (same lifecycle as /api/print-pdf; additive, this
//    route is its only consumer — the shared route is untouched) ────────────
async function daemonHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${DAEMON_ORIGIN}/health`, { signal: AbortSignal.timeout(400) })
    return res.ok
  } catch {
    return false
  }
}

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
      env: { ...process.env, PRINT_REPO: repoRoot, PRINT_DAEMON_PORT: String(DAEMON_PORT) },
    }
  )
  child.unref()
}

let ensuring: Promise<boolean> | null = null
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

/** "AGR-2025-0001_Green Forest Company Limited" (filesystem-safe, Arabic kept). */
function pdfFileName(agreementNo: string, partyName: string): string {
  const clean = (s: string) =>
    s
      .replace(/[\\/:*?"<>|\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  const no = clean(agreementNo) || 'Agreement'
  const party = clean(partyName)
  return party ? `${no}_${party}` : no
}

type Params = { params: Promise<{ id: string }> }

/** Prisma CompanyLetterhead row → LetterheadConfig (same field mapping as
 *  GET /api/letterhead's readConfig). */
function toLetterheadConfig(row: {
  mode: string
  headerImage: string | null
  footerImage: string | null
  fullPageImage: string | null
  showCompanyDetails: boolean
  headerHeightMm: number
  footerHeightMm: number
} | null): LetterheadConfig {
  if (!row) return DEFAULT_LETTERHEAD
  const modes = ['none', 'header', 'header_footer', 'full'] as const
  return {
    mode: (modes as readonly string[]).includes(row.mode)
      ? (row.mode as LetterheadConfig['mode'])
      : 'none',
    headerImage: row.headerImage,
    footerImage: row.footerImage,
    fullPageImage: row.fullPageImage,
    showCompanyDetails: row.showCompanyDetails,
    headerHeightMm: row.headerHeightMm,
    footerHeightMm: row.footerHeightMm,
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('agreements.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const row = await db.agreement.findUnique({ where: { id }, include: agreementFullInclude })
    if (!row) return notFound('Agreement not found')

    const mapped = mapAgreement(row)

    // print-layout template: the row's saved choice, else the module
    // default from Settings (classic until changed). Purely cosmetic — the
    // same data flows to whichever layout is chosen.
    const defaultSetting = await db.setting.findUnique({
      where: { key: 'agreementDefaultTemplate' },
    })
    const template = resolveAgreementPrintTemplate(
      mapped.template,
      defaultSetting?.value ?? null
    )

    let html: string
    let pageMode: 'flow' | 'sheets' = 'flow'
    if (template === 'classic') {
      html = buildDaemonFragment(toTemplateAgreement(mapped))
    } else {
      // the 3 new layouts are fixed A4 sheets rendered from the SAME data —
      // server-rendered with the same components the dialog shows, plus the
      // shared letterhead artwork from Settings (react-dom/server behind
      // dynamic imports — Next forbids it in the route module graph)
      const lhRow = await db.companyLetterhead.findFirst()
      html = await renderAgreementPrintTemplate(
        template,
        toTemplateAgreement(mapped),
        toLetterheadConfig(lhRow)
      )
      pageMode = 'sheets'
    }

    if (!(await ensureDaemon())) return serverError()
    const res = await fetch(`${DAEMON_ORIGIN}/pdf`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html, orientation: 'portrait', pageMode }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      console.error('[api/agreements/[id]/pdf] daemon error', res.status, text.slice(0, 300))
      return serverError()
    }

    const filename = pdfFileName(mapped.agreementNo, mapped.otherPartyNameEn || mapped.otherPartyNameAr)
    const asciiFallback = filename.replace(/[^\x20-\x7E]+/g, '_').replace(/"/g, '')
    const bytes = new Uint8Array(await res.arrayBuffer())
    // Audit trail: bulk exports were invisible — log who pulled what.
    await logActivity({
      user: auth,
      action: 'export',
      module: 'agreement',
      description: `PDF export: ${mapped.agreementNo}`,
    })

    return new Response(bytes, {
      headers: {
        'content-type': 'application/pdf',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename="${asciiFallback}.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}.pdf`,
      },
    })
  } catch (err) {
    console.error('[api/agreements/[id]/pdf GET]', err)
    return serverError()
  }
}
