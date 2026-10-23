// E-Invoice letterhead feature — export harness.
//
// Drives the REAL app in headless Chromium (login → E-Invoices → Preview),
// waits for the measured pagination to settle, serializes the print area and
// sends it through the REAL vector-PDF pipeline (POST /api/print-pdf → the
// print render daemon). Used for:
//   • BASELINE capture (before the code change) — the shared-letterhead
//     output that must stay byte-identical after the feature lands;
//   • AFTER capture (with the new E-Invoice letterhead uploaded, on/off).
//
// Usage: node scripts/ei-lh-export.mjs <tag> [numbers...]
//   e.g. node scripts/ei-lh-export.mjs baseline
//        node scripts/ei-lh-export.mjs after INV-2026-00001 INV-2026-00005
// Set EI_LH_OFF=1 to uncheck "Print with letterhead" before serializing
// (the artwork-hidden / pre-printed-paper variant).
// PDFs land in qa/ei-lh/<tag>/ and a JSON matrix is written alongside.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUTROOT = path.resolve(HERE, '..', 'qa', 'ei-lh')
const BASE = 'http://localhost:3000'
const EMAIL = 'admin@example.com'
const PASSWORD = 'password'

const tag = process.argv[2] || 'run'
const only = process.argv.slice(3)
const TARGETS = [
  { number: 'INV-2026-00001', items: 2 },
  { number: 'INV-2026-00004', items: 6 },
  { number: 'INV-2026-00005', items: 25 },
].filter((t) => only.length === 0 || only.includes(t.number))

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
console.log(`✓ logged in [tag: ${tag}]`)

const exe = resolveChrome()
if (!exe) throw new Error('no Chromium executable found')
console.log(`✓ chromium: ${exe}`)

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=en-US'],
})

const outDir = path.join(OUTROOT, tag)
fs.mkdirSync(outDir, { recursive: true })

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

  async function makePdf(t) {
    await page.evaluate((num) => {
      const btn = document.querySelector(`button[aria-label="Preview ${num}"]`)
      if (!btn) throw new Error(`Preview button for ${num} not found`)
      btn.click()
    }, t.number)

    await page.waitForFunction(
      () =>
        document.querySelector('.print-area .doc-page') !== null &&
        document.querySelector('[data-print-measure-rig]') === null,
      { timeout: 60_000, polling: 250 }
    )
    await new Promise((r) => setTimeout(r, 400))

    // optional: uncheck "Print with letterhead" (pre-printed paper variant)
    if (process.env.EI_LH_OFF === '1') {
      await page.click('label[title*="pre-printed"]')
      await new Promise((r) => setTimeout(r, 900))
    }

    const pageCount = await page.evaluate(
      () => document.querySelectorAll('.print-area .doc-page').length
    )
    const html = await page.evaluate(() => {
      const root = document.querySelector('.print-area')
      if (!root) throw new Error('print-area not found')
      return root.outerHTML
    })

    const pdf = await renderPdf(token, html)
    const file = path.join(outDir, `E-Invoice-${t.number}_${t.items}items_${pageCount}page${pageCount > 1 ? 's' : ''}.pdf`)
    fs.writeFileSync(file, pdf)
    console.log(
      `  ✓ ${t.number} (${t.items} items) → ${pageCount} page(s), ${(pdf.length / 1024).toFixed(0)} KB → ${path.basename(file)}`
    )

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
    return { number: t.number, items: t.items, domPages: pageCount, file: path.basename(file), bytes: pdf.length }
  }

  const results = []
  for (const t of TARGETS) results.push(await makePdf(t))

  fs.writeFileSync(
    path.join(outDir, 'matrix.json'),
    JSON.stringify({ tag, at: new Date().toISOString(), results }, null, 2)
  )
  console.log(`\n— ${tag} summary —`)
  for (const r of results) console.log(`  ${r.number}: ${r.domPages} page(s) → ${r.file}`)
} finally {
  await browser.close()
}
