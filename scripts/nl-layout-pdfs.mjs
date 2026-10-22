// Layout-test PDF generator for the Name List signature-pinning rework.
//
// Drives the REAL app in headless Chromium (login → Name List → Lists →
// row Print button), waits for the paginated A4 pages, MEASURES the exact
// DOM geometry of the pinned bottom group (signature cards → 3mm → note
// line → letterhead footer band), then serializes the print area through
// the REAL vector-PDF pipeline (POST /api/print-pdf). Produces:
//
//   NL-2026-0003 (5 workers)  → 1 page  (cards bottom-pinned on page 1)
//   NL-2026-0004 (25 workers) → 2 pages (page 1 table only; page 2 = rest
//                                        + trade summary + cards + note)
//
// The letterhead stays exactly as configured (no toggling in this task).
//
// Run: node scripts/nl-layout-pdfs.mjs
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = '/home/z/my-project/download'
const BASE = 'http://localhost:3000'
const EMAIL = 'admin@example.com'
const PASSWORD = 'password'

const TARGETS = [
  { listNo: 'NL-2026-0003', workers: 5, expectPages: 1 },
  { listNo: 'NL-2026-0004', workers: 25, expectPages: 2 },
]

// ── helpers ──────────────────────────────────────────────────────────────────
function resolveChrome() {
  if (process.env.PRINT_CHROME && fs.existsSync(process.env.PRINT_CHROME)) {
    return process.env.PRINT_CHROME
  }
  const home = process.env.HOME || '/home/z'
  const dirs = [
    { dir: `${home}/.cache/puppeteer/chrome`, pattern: /chrome-linux64\/chrome$/ },
    { dir: `${home}/.cache/puppeteer/chrome`, pattern: /chrome-linux\/chrome$/ },
    { dir: `${home}/.cache/ms-playwright`, pattern: /chromium-[^/]+\/chrome-linux64\/chrome$/ },
    { dir: `${home}/.cache/ms-playwright`, pattern: /chromium-[^/]+\/chrome-linux\/chrome$/ },
  ]
  for (const { dir, pattern } of dirs) {
    try {
      const found = []
      const walk = (d, depth) => {
        if (depth > 3) return
        for (const name of fs.readdirSync(d)) {
          const full = path.join(d, name)
          const st = fs.statSync(full)
          if (st.isDirectory()) walk(full, depth + 1)
          else if (pattern.test(full)) found.push(full)
        }
      }
      walk(dir, 0)
      if (found.length > 0) {
        found.sort()
        return found[found.length - 1]
      }
    } catch {}
  }
  for (const flat of [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]) {
    if (fs.existsSync(flat)) return flat
  }
  return null
}

async function apiLogin() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`login failed (${res.status})`)
  const json = await res.json()
  return json.token
}

async function apiGet(token, pathname) {
  const res = await fetch(`${BASE}${pathname}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) throw new Error(`GET ${pathname} failed (${res.status})`)
  return res.json()
}

/** POST /api/print-pdf via plain http (returns PDF buffer). */
function renderPdf(token, html) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      html,
      orientation: 'portrait',
      pageMode: 'sheets',
    })
    const req = http.request(
      {
        host: 'localhost',
        port: 3000,
        path: '/api/print-pdf',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 120_000,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          if (res.statusCode !== 200) {
            reject(new Error(`print-pdf ${res.statusCode}: ${buf.toString('utf8').slice(0, 300)}`))
          } else {
            resolve(buf)
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('print-pdf timeout')))
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

const PX_PER_MM = 96 / 25.4

/** Self-contained measurement of the pinned bottom group on the LAST page
 *  (runs inside the page via page.evaluate — no closure references). */
const measureLastPage = `(() => {
  const PX_PER_MM = ${PX_PER_MM}
  const mm = (px) => px / PX_PER_MM
  const pages = document.querySelectorAll('.print-area .doc-page')
  const pageEl = pages[pages.length - 1]
  if (!pageEl) return { error: 'no page' }
  const sig = pageEl.querySelector('[data-nl-signatures]')
  const note = pageEl.querySelector('[data-nl-note]')
  const chips = pageEl.querySelector('[data-nl-chips]')
  const footerArt = [...pageEl.querySelectorAll('img')].find((i) => /bottom-0/.test(i.className))
  const pageRect = pageEl.getBoundingClientRect()
  const sigRect = sig ? sig.getBoundingClientRect() : null
  const noteRect = note ? note.getBoundingClientRect() : null
  const chipsRect = chips ? chips.getBoundingClientRect() : null
  const artRect = footerArt ? footerArt.getBoundingClientRect() : null
  const r2 = (v) => (v == null ? null : +mm(v).toFixed(2))
  return {
    pageHeightMm: +mm(pageRect.height).toFixed(2),
    hasChips: !!chips,
    hasSignatures: !!sig,
    chipsBottomFromPageMm: chipsRect ? r2(pageRect.bottom - chipsRect.bottom) : null,
    spacerMm: sigRect && chipsRect ? r2(sigRect.top - chipsRect.bottom) : null,
    sigBottomFromPageMm: sigRect ? r2(pageRect.bottom - sigRect.bottom) : null,
    sigToNoteGapMm: sigRect && noteRect ? r2(noteRect.top - sigRect.bottom) : null,
    sigBottomToFooterArtMm: sigRect && artRect ? r2(artRect.top - sigRect.bottom) : null,
    noteHeightMm: noteRect ? r2(noteRect.height) : null,
    noteBottomFromPageMm: noteRect ? r2(pageRect.bottom - noteRect.bottom) : null,
    noteBottomToFooterArtMm: noteRect && artRect ? r2(artRect.top - noteRect.bottom) : null,
  }
})()`

// ── main ─────────────────────────────────────────────────────────────────────
const token = await apiLogin()
console.log('✓ logged in')

const lh = await apiGet(token, '/api/letterhead')
console.log(
  `✓ letterhead mode: ${lh.mode} (header ${lh.headerHeightMm}mm / footer ${lh.footerHeightMm}mm) — left exactly as configured`
)

const exe = resolveChrome()
if (!exe) throw new Error('no Chromium executable found')
console.log(`✓ chromium: ${exe}`)

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=en-US'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 })

  // boot the app with the session token in localStorage (Bearer auth)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.evaluate((t) => window.localStorage.setItem('lig_session_token', t), token)
  await page.reload({ waitUntil: 'networkidle2', timeout: 90_000 })
  console.log('✓ app booted (authenticated)')

  // open the Name List module from the sidebar
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll('button, a')]
      const el = btns.find((b) => (b.textContent || '').trim().startsWith('Name List'))
      if (!el) return false
      el.click()
      return true
    },
    { timeout: 60_000, polling: 500 }
  )
  await page.waitForSelector('table', { timeout: 60_000 })
  await new Promise((r) => setTimeout(r, 1500))
  console.log('✓ Name List module opened (Lists tab)')

  /** Generate + measure + save one PDF. */
  async function makePdf(listNo, workers, expectPages) {
    // open the print preview via the row's Print / PDF button
    await page.evaluate((no) => {
      const els = [...document.querySelectorAll('[title="Print / PDF"]')]
      const el = els.find((b) => {
        const row = b.closest('tr') || b.closest('[data-slot], div')
        return row && (row.textContent || '').includes(no)
      })
      if (!el) throw new Error(`Print button for ${no} not found`)
      el.click()
    }, listNo)

    // wait for the paginated pages
    await page.waitForFunction(
      () => document.querySelectorAll('.print-area .doc-page').length > 0,
      { timeout: 60_000, polling: 250 }
    )
    // a beat for the dialog scroll + letterhead images
    await new Promise((r) => setTimeout(r, 600))

    const domPages = await page.evaluate(() => document.querySelectorAll('.print-area .doc-page').length)
    if (domPages !== expectPages) {
      throw new Error(`${listNo}: expected ${expectPages} page(s), DOM shows ${domPages}`)
    }

    // per-page measurements (live DOM, mm)
    const pageReports = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.print-area .doc-page')]
      return pages.map((p) => {
        const sig = p.querySelector('[data-nl-signatures]')
        const note = p.querySelector('[data-nl-note]')
        const chips = p.querySelector('[data-nl-chips]')
        const table = p.querySelector('table')
        return {
          hasTable: !!table,
          tableRows: table ? table.querySelectorAll('tbody tr').length : 0,
          hasChips: !!chips,
          hasSignatures: !!sig,
          hasNote: !!note,
        }
      })
    })
    const lastPageMeasure = await page.evaluate(measureLastPage)

    // serialize the print area → real vector PDF
    const html = await page.evaluate(() => {
      const root = document.querySelector('.print-area')
      if (!root) throw new Error('print-area not found')
      return root.outerHTML
    })
    const pdf = await renderPdf(token, html)

    const file = path.join(
      OUT,
      `Name-List-${listNo}_${workers}workers_${domPages}page${domPages > 1 ? 's' : ''}.pdf`
    )
    fs.writeFileSync(file, pdf)
    console.log(
      `  ✓ ${listNo} (${workers} workers) → ${domPages} page(s), ${(pdf.length / 1024).toFixed(0)} KB → ${path.basename(file)}`
    )
    console.log(`    · pages: ${JSON.stringify(pageReports)}`)
    console.log(`    · last-page geometry (mm): ${JSON.stringify(lastPageMeasure)}`)

    // CLOSE the dialog and wait for it to unmount before the next list
    await page.evaluate(() => {
      const dlg = document.querySelector('[data-slot="dialog-content"]')
      const btn = dlg
        ? [...dlg.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Close')
        : null
      if (btn) btn.click()
    })
    await page.keyboard.press('Escape')
    await page.waitForFunction(
      () => document.querySelector('.print-area') === null,
      { timeout: 20_000, polling: 200 }
    )
    await new Promise((r) => setTimeout(r, 400))
    return { listNo, workers, domPages, pageReports, lastPageMeasure, file }
  }

  const results = []
  for (const t of TARGETS) results.push(await makePdf(t.listNo, t.workers, t.expectPages))

  fs.writeFileSync(
    path.join(OUT, 'name-list-layout-test-results.json'),
    JSON.stringify(
      {
        task: 'Name List — signature row bottom-pinning (last page only)',
        letterhead: { mode: lh.mode, headerMm: lh.headerHeightMm, footerMm: lh.footerHeightMm },
        expectations: {
          sigToNoteGapMm: 3.0,
          spacerMinMm: 2.4,
          noteBottomToFooterArtMm: 4.0,
          note: '3mm binds the signature cards to the footer note line (the page footer); the note line then sits 4mm above the letterhead footer artwork (1mm above the reserved band + 3mm breathing from geometryFor)',
        },
        results,
      },
      null,
      2
    )
  )
  console.log('✓ results JSON written')
} finally {
  await browser.close()
}
