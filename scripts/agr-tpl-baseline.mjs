// PRECHANGE baseline exporter for the Agreement template task.
//
// Runs BEFORE any code change: exports the CURRENT Classic print of
// AGR-2025-0001 and AGR-2025-0002 through the REAL app + REAL vector-PDF
// pipeline (dialog → .print-area → POST /api/print-pdf, pageMode 'flow').
// The PDFs + pdftotext dumps are the identity baseline the untouched Classic
// must reproduce EXACTLY after the 3 new print templates are added.
//
// Run: node scripts/agr-tpl-baseline.mjs
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

const TARGETS = ['AGR-2025-0001', 'AGR-2025-0002']

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
  return null
}

async function apiLogin() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  if (!res.ok) throw new Error(`login failed (${res.status})`)
  return (await res.json()).token
}

/** POST /api/print-pdf via plain http (returns PDF buffer). */
function renderPdf(token, html, pageMode) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ html, orientation: 'portrait', pageMode })
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

const token = await apiLogin()
console.log('✓ logged in')

const exe = resolveChrome()
if (!exe) throw new Error('no Chromium executable found')
console.log(`✓ chromium: ${exe}`)

const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=en-US'],
})

const results = []
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
      const el = btns.find((b) => (b.textContent || '').trim().startsWith('Agreements'))
      if (!el) return false
      el.click()
      return true
    },
    { timeout: 60_000, polling: 500 }
  )
  await page.waitForSelector('table', { timeout: 60_000 })
  await new Promise((r) => setTimeout(r, 1500))
  console.log('✓ Agreements module opened')

  for (const no of TARGETS) {
    await page.evaluate((agreementNo) => {
      const els = [...document.querySelectorAll('button[title="View / print"]')]
      const el = els.find((b) => {
        const row = b.closest('tr')
        return row && (row.textContent || '').includes(agreementNo)
      })
      if (!el) throw new Error(`View/print button for ${agreementNo} not found`)
      el.click()
    }, no)

    await page.waitForFunction(
      () => document.querySelector('.print-area .sheet') !== null,
      { timeout: 60_000, polling: 250 }
    )
    await new Promise((r) => setTimeout(r, 800))

    const html = await page.evaluate(() => {
      const root = document.querySelector('.print-area')
      if (!root) throw new Error('print-area not found')
      return root.outerHTML
    })
    const pdf = await renderPdf(token, html, 'flow')

    const file = path.join(OUT, `PRECHANGE-baseline-Agreement-${no}-Classic.pdf`)
    fs.writeFileSync(file, pdf)

    const txt = path.join(HERE, `agr-baseline-${no.slice(-4)}.txt`)
    fs.writeFileSync(txt, execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }))

    const pages = execFileSync('pdfinfo', [file]).toString().match(/^Pages:\s+(\d+)/m)
    console.log(
      `  ✓ ${no} → ${pages ? pages[1] : '?'} page(s), ${(pdf.length / 1024).toFixed(0)} KB → ${path.basename(file)}`
    )
    results.push({ agreementNo: no, file, txt, pages: pages ? Number(pages[1]) : null })

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
  }

  fs.writeFileSync(
    path.join(OUT, 'agr-template-baseline-results.json'),
    JSON.stringify(
      {
        task: 'PRECHANGE baseline — Agreement Classic before the template task',
        captured: new Date().toISOString(),
        pipeline: 'dialog .print-area → POST /api/print-pdf (pageMode flow)',
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
