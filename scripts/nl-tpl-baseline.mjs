// PRECHANGE baseline exporter for the Name List template task.
//
// Runs BEFORE any code change: exports the CURRENT Classic print of
// NL-2026-0001 (interview, 8 workers) and NL-2026-0002 (mobilization,
// 10 workers — its saved Columns snapshot already hides Mobile) through the
// REAL app + REAL vector-PDF pipeline. The resulting PDFs + pdftotext dumps
// are the byte-identity baseline the refactored Classic must reproduce
// EXACTLY after the shared module is extracted and the 3 new templates are
// added.
//
// Run: node scripts/nl-tpl-baseline.mjs
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = '/home/z/my-project/download'
const BASE = 'http://localhost:3000'
const EMAIL = 'admin@example.com'
const PASSWORD = 'password'

const TARGETS = [
  { listNo: 'NL-2026-0001', workers: 8, expectPages: 1 },
  { listNo: 'NL-2026-0002', workers: 10, expectPages: 1 },
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
    const payload = JSON.stringify({ html, orientation: 'portrait', pageMode: 'sheets' })
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
    sigBottomFromPageMm: sigRect ? r2(pageRect.bottom - sigRect.bottom) : null,
    sigToNoteGapMm: sigRect && noteRect ? r2(noteRect.top - sigRect.bottom) : null,
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

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.evaluate((t) => window.localStorage.setItem('lig_session_token', t), token)
  await page.reload({ waitUntil: 'networkidle2', timeout: 90_000 })
  console.log('✓ app booted (authenticated)')

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

  async function makeBaseline(t) {
    await page.evaluate((no) => {
      const els = [...document.querySelectorAll('[title="Print / PDF"]')]
      const el = els.find((b) => {
        const row = b.closest('tr') || b.closest('[data-slot], div')
        return row && (row.textContent || '').includes(no)
      })
      if (!el) throw new Error(`Print button for ${no} not found`)
      el.click()
    }, t.listNo)

    await page.waitForFunction(
      () => document.querySelectorAll('.print-area .doc-page').length > 0,
      { timeout: 60_000, polling: 250 }
    )
    await new Promise((r) => setTimeout(r, 600))

    const domPages = await page.evaluate(
      () => document.querySelectorAll('.print-area .doc-page').length
    )
    if (domPages !== t.expectPages) {
      console.warn(`  ⚠ ${t.listNo}: expected ${t.expectPages}, DOM shows ${domPages} (recorded as-is)`)
    }
    const lastPageMeasure = await page.evaluate(measureLastPage)

    const html = await page.evaluate(() => {
      const root = document.querySelector('.print-area')
      if (!root) throw new Error('print-area not found')
      return root.outerHTML
    })
    const pdf = await renderPdf(token, html)

    const file = path.join(OUT, `PRECHANGE-baseline-NameList-${t.listNo}-Classic.pdf`)
    fs.writeFileSync(file, pdf)

    // pdftotext dump for the later identity comparison
    const txt = path.join(HERE, `nl-baseline-${t.listNo.slice(-4)}.txt`)
    fs.writeFileSync(txt, execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }))

    console.log(
      `  ✓ ${t.listNo} (${t.workers} workers) → ${domPages} page(s), ${(pdf.length / 1024).toFixed(0)} KB → ${path.basename(file)}`
    )
    console.log(`    · last-page geometry (mm): ${JSON.stringify(lastPageMeasure)}`)

    await page.evaluate(() => {
      const dlg = document.querySelector('[data-slot="dialog-content"]')
      const btn = dlg
        ? [...dlg.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Close')
        : null
      if (btn) btn.click()
    })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelector('.print-area') === null, {
      timeout: 20_000,
      polling: 200,
    })
    await new Promise((r) => setTimeout(r, 400))
    return { listNo: t.listNo, domPages, lastPageMeasure, file, txt }
  }

  const results = []
  for (const t of TARGETS) results.push(await makeBaseline(t))

  fs.writeFileSync(
    path.join(OUT, 'nl-template-baseline-results.json'),
    JSON.stringify(
      {
        task: 'PRECHANGE baseline — Name List Classic before the template task',
        letterhead: { mode: lh.mode, headerMm: lh.headerHeightMm, footerMm: lh.footerHeightMm },
        results,
      },
      null,
      2
    )
  )
  console.log('✓ baselines + pdftotext dumps written')
} finally {
  await browser.close()
}
