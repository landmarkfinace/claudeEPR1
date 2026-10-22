// Layout-test PDF generator for the E-Invoice print rework.
//
// Drives the REAL app in headless Chromium (login → E-Invoices → Preview),
// waits for the measured pagination to settle, serializes the print area and
// sends it through the REAL vector-PDF pipeline (POST /api/print-pdf → the
// print render daemon). Produces the boss's test matrix:
//
//   INV-2026-00001 (2 items)  → 1 page   × with / without letterhead
//   INV-2026-00004 (6 items)  → 2 pages  × with / without letterhead
//   INV-2026-00005 (25 items) → 3 pages  × with / without letterhead
//
// The shared letterhead mode is toggled via the API between batches and
// always restored to its original mode afterwards.
//
// Run: node scripts/ei-layout-pdfs.mjs
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const OUT = '/home/z/my-project/download'
const BASE = 'http://localhost:3000'
const EMAIL = 'admin@example.com'
const PASSWORD = 'password'

const TARGETS = [
  { number: 'INV-2026-00001', items: 2, expectPages: 1 },
  { number: 'INV-2026-00004', items: 6, expectPages: 2 },
  { number: 'INV-2026-00005', items: 25, expectPages: 3 },
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
  const res = await fetch(`${BASE}${pathname}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`GET ${pathname} failed (${res.status})`)
  return res.json()
}

async function apiPut(token, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PUT ${pathname} failed (${res.status}): ${text.slice(0, 200)}`)
  }
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

// ── main ─────────────────────────────────────────────────────────────────────
const token = await apiLogin()
console.log('✓ logged in')

// remember the original letterhead mode and make sure it starts ON
const lh0 = await apiGet(token, '/api/letterhead')
console.log(`✓ letterhead mode: ${lh0.mode} (header ${lh0.headerHeightMm}mm / footer ${lh0.footerHeightMm}mm)`)
if (lh0.mode !== 'header_footer') {
  await apiPut(token, '/api/letterhead', { mode: 'header_footer' })
  console.log('  → switched to header_footer for the "with letterhead" batch')
}

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

  // open the E-Invoice module from the sidebar
  await page.waitForFunction(
    () => {
      const btns = [...document.querySelectorAll('button, a')]
      const el = btns.find((b) => (b.textContent || '').trim().startsWith('E-Invoice'))
      if (!el) return false
      el.click()
      return true
    },
    { timeout: 60_000, polling: 500 }
  )
  await page.waitForSelector('table', { timeout: 60_000 })
  await new Promise((r) => setTimeout(r, 1500))
  console.log('✓ E-Invoice module opened')

  /** Generate + save one PDF and return its page count (via the PDF itself). */
  async function makePdf(number, items, letterheadOn) {
    // open the preview dialog
    await page.evaluate((num) => {
      const btn = document.querySelector(`button[aria-label="Preview ${num}"]`)
      if (!btn) throw new Error(`Preview button for ${num} not found`)
      btn.click()
    }, number)

    // wait for the measured pagination to settle: pages exist, rig is gone
    await page.waitForFunction(
      () =>
        document.querySelector('.print-area .doc-page') !== null &&
        document.querySelector('[data-print-measure-rig]') === null,
      { timeout: 60_000, polling: 250 }
    )
    // one extra beat for the dialog scroll area to settle
    await new Promise((r) => setTimeout(r, 400))

    const pageCount = await page.evaluate(
      () => document.querySelectorAll('.print-area .doc-page').length
    )
    const html = await page.evaluate(() => {
      const root = document.querySelector('.print-area')
      if (!root) throw new Error('print-area not found')
      return root.outerHTML
    })

    const pdf = await renderPdf(token, html)
    const suffix = letterheadOn ? 'WithLetterhead' : 'WithoutLetterhead'
    const file = path.join(
      OUT,
      `E-Invoice-${number}_${items}items_${suffix}_${pageCount}page${pageCount > 1 ? 's' : ''}.pdf`
    )
    fs.writeFileSync(file, pdf)
    console.log(
      `  ✓ ${number} (${items} items, ${letterheadOn ? 'with' : 'NO'} letterhead) → ${pageCount} page(s), ${(pdf.length / 1024).toFixed(0)} KB → ${path.basename(file)}`
    )

    // CLOSE the dialog and wait for it to unmount before the next invoice
    await page.evaluate(() => {
      const dlg = document.querySelector('[data-slot="dialog-content"]')
      const btn = dlg
        ? [...dlg.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Close')
        : null
      if (btn) btn.click()
    })
    await page.keyboard.press('Escape') // fallback when the click was swallowed
    await page.waitForFunction(
      () => document.querySelector('.print-area') === null,
      { timeout: 20_000, polling: 200 }
    )
    await new Promise((r) => setTimeout(r, 400))
    return { number, items, letterheadOn, domPages: pageCount, file }
  }

  const results = []
  for (const t of TARGETS) results.push(await makePdf(t.number, t.items, true))

  // switch letterhead OFF → same three invoices (bands must be completely empty).
  // NOTE: the letterhead PUT replaces image slots not provided — always pass
  // the current artwork through so nothing is wiped.
  const lhCurrent = await apiGet(token, '/api/letterhead')
  await apiPut(token, '/api/letterhead', {
    mode: 'none',
    headerImage: lhCurrent.headerImage,
    footerImage: lhCurrent.footerImage,
    fullPageImage: lhCurrent.fullPageImage,
  })
  console.log('✓ letterhead switched OFF (mode none, artwork kept)')
  // the app caches the letterhead config in state — reload so the print
  // dialog re-fetches it fresh
  await page.reload({ waitUntil: 'networkidle2', timeout: 90_000 })
  await page.waitForFunction(
    () => {
      const el = [...document.querySelectorAll('button, a')].find((b) =>
        (b.textContent || '').trim().startsWith('E-Invoice')
      )
      if (!el) return false
      el.click()
      return true
    },
    { timeout: 60_000, polling: 500 }
  )
  await page.waitForSelector('table', { timeout: 60_000 })
  await new Promise((r) => setTimeout(r, 1500))
  for (const t of TARGETS) results.push(await makePdf(t.number, t.items, false))

  // restore the original letterhead mode (artwork passed through again)
  const lhNow = await apiGet(token, '/api/letterhead')
  await apiPut(token, '/api/letterhead', {
    mode: lh0.mode === 'none' ? 'none' : lh0.mode,
    headerImage: lhNow.headerImage,
    footerImage: lhNow.footerImage,
    fullPageImage: lhNow.fullPageImage,
  })
  console.log(`✓ letterhead restored to "${lh0.mode}"`)

  // summary
  console.log('\n— summary —')
  for (const r of results) {
    const expect = TARGETS.find((t) => t.number === r.number)?.expectPages
    const okMark = r.domPages === expect ? 'OK' : `EXPECTED ${expect}!`
    console.log(
      `  ${r.number} · ${r.items} items · ${r.letterheadOn ? 'LH on ' : 'LH off'} · ${r.domPages} page(s) [${okMark}]`
    )
  }
  fs.writeFileSync(
    path.join(OUT, 'e-invoice-layout-test-results.json'),
    JSON.stringify(results.map((r) => ({ ...r, file: path.basename(r.file) })), null, 2)
  )
} finally {
  await browser.close().catch(() => {})
}
