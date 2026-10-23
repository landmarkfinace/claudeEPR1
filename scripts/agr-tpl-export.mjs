// STEP 4 exporter for the Agreement template task.
//
// Exports AGR-2025-0001 + AGR-2025-0002 in ALL 4 print templates through the
// REAL app + REAL vector-PDF pipeline (dialog .print-area → POST
// /api/print-pdf). For each agreement it PATCHes the template (exactly what
// the dialog's dropdown does), opens the View/print dialog, waits for the
// document, serializes .print-area and renders the PDF.
//
// Also captures: per-template page-1 screenshots (VLM QA), DOM page counts,
// and the last-page signature geometry (mm from the page bottom).
//
// Run: node scripts/agr-tpl-export.mjs
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

const AGREEMENTS = [
  { id: 'cmvk4dv98000bsoj60dr6dnqs', no: 'AGR-2025-0001' },
  { id: 'cmvk4jt3m000bso02k7wlg9oj', no: 'AGR-2025-0002' },
]
const TEMPLATES = [
  { id: 'classic', label: 'Classic', pageMode: 'flow' },
  { id: 'bilingual-cards', label: 'BilingualCards', pageMode: 'sheets' },
  { id: 'official-form', label: 'OfficialForm', pageMode: 'sheets' },
  { id: 'key-terms', label: 'KeyTerms', pageMode: 'sheets' },
]

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

async function apiPatch(token, id, template) {
  const res = await fetch(`${BASE}/api/agreements/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ template }),
  })
  if (!res.ok) throw new Error(`PATCH ${id} ${template} failed (${res.status})`)
}

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

const PX_PER_MM = 96 / 25.4

const measureLastPage = `(() => {
  const PX_PER_MM = ${PX_PER_MM}
  const mm = (px) => px / PX_PER_MM
  const pages = document.querySelectorAll('.print-area .doc-page')
  const pageEl = pages[pages.length - 1]
  if (!pageEl) return { flowDoc: true }
  const sig = pageEl.querySelector('[data-agr-signatures]')
  const footer = pageEl.querySelector('[data-agr-footer]')
  const pageRect = pageEl.getBoundingClientRect()
  const sigRect = sig ? sig.getBoundingClientRect() : null
  const footerRect = footer ? footer.getBoundingClientRect() : null
  const r2 = (v) => (v == null ? null : +mm(v).toFixed(2))
  return {
    flowDoc: false,
    pages: pages.length,
    hasSignatures: !!sig,
    hasFooter: !!footer,
    footerText: footer ? footer.textContent.replace(/\\s+/g, ' ').trim().slice(0, 120) : null,
    sigBottomFromPageMm: sigRect ? r2(pageRect.bottom - sigRect.bottom) : null,
    sigToFooterGapMm: sigRect && footerRect ? r2(footerRect.top - sigRect.bottom) : null,
    everyPageFooter: [...pages].every((p) => p.querySelector('[data-agr-footer]') !== null),
  }
})()`

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

  for (const ag of AGREEMENTS) {
    for (const tpl of TEMPLATES) {
      // set the template exactly like the dialog's dropdown does
      await apiPatch(token, ag.id, tpl.id === 'classic' ? null : tpl.id)

      await page.evaluate((no) => {
        const els = [...document.querySelectorAll('button[title="View / print"]')]
        const el = els.find((b) => {
          const row = b.closest('tr')
          return row && (row.textContent || '').includes(no)
        })
        if (!el) throw new Error(`View/print button for ${no} not found`)
        el.click()
      }, ag.no)

      await page.waitForFunction(
        () =>
          document.querySelector('.print-area .sheet') !== null ||
          document.querySelectorAll('.print-area .doc-page').length > 0,
        { timeout: 60_000, polling: 250 }
      )
      await new Promise((r) => setTimeout(r, 900))

      const domPages = await page.evaluate(() => {
        const sheets = document.querySelectorAll('.print-area .doc-page').length
        return sheets > 0 ? sheets : document.querySelectorAll('.print-area .sheet').length
      })
      const lastPageMeasure = await page.evaluate(measureLastPage)

      // page-1 screenshot for VLM QA
      const shot = path.join(OUT, `agr-qa-${ag.no.slice(-4)}-${tpl.label}-p1.png`)
      await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 1500, height: 1000 } })

      const html = await page.evaluate(() => {
        const root = document.querySelector('.print-area')
        if (!root) throw new Error('print-area not found')
        return root.outerHTML
      })
      const pdf = await renderPdf(token, html, tpl.pageMode)

      const file = path.join(OUT, `Agreement-${ag.no}_${tpl.label}.pdf`)
      fs.writeFileSync(file, pdf)

      const txt = path.join(HERE, `agr-${ag.no.slice(-4)}-${tpl.label}.txt`)
      fs.writeFileSync(txt, execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' }))
      const info = execFileSync('pdfinfo', [file]).toString()
      const pdfPages = Number((info.match(/^Pages:\s+(\d+)/m) || [])[1])

      console.log(
        `  ✓ ${ag.no} × ${tpl.label.padEnd(14)} → DOM ${domPages} page(s), PDF ${pdfPages} page(s), ${(pdf.length / 1024).toFixed(0)} KB`
      )
      results.push({
        agreementNo: ag.no,
        template: tpl.id,
        domPages,
        pdfPages,
        lastPageMeasure,
        file,
        txt,
        shot,
      })

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
    // restore the row (template NULL = inherit default) after each agreement
    await apiPatch(token, ag.id, null)
  }

  fs.writeFileSync(
    path.join(OUT, 'agr-template-export-results.json'),
    JSON.stringify(
      {
        task: 'STEP 4 export — Agreement 4 templates × 2 live agreements',
        captured: new Date().toISOString(),
        pipeline: 'dialog .print-area → POST /api/print-pdf',
        results,
      },
      null,
      2
    )
  )
  console.log('✓ 8 PDFs + pdftotext dumps + screenshots + measures written')
} finally {
  await browser.close()
}
