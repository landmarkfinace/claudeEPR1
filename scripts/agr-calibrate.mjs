// Calibrate the article-height estimators of the 3 new agreement templates
// against REAL rendered DOM heights. Opens each live agreement in each new
// template (via PATCH + the View/print dialog, exactly like the exporter),
// measures every [data-agr-art] row in mm and compares with estArticleMm.
// Output: per-template worst-case ratio actual/estimate → tune the specs so
// estimate >= actual for every row.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:3000'
const EMAIL = 'admin@example.com'
const PASSWORD = 'password'
const AGREEMENTS = [
  { id: 'cmvk4dv98000bsoj60dr6dnqs', no: 'AGR-2025-0001' },
  { id: 'cmvk4jt3m000bso02k7wlg9oj', no: 'AGR-2025-0002' },
]
const TEMPLATES = ['bilingual-cards', 'official-form', 'key-terms']

const PX_PER_MM = 96 / 25.4

function resolveChrome() {
  const home = process.env.HOME || '/home/z'
  const dirs = [
    { dir: `${home}/.cache/puppeteer/chrome`, pattern: /chrome-linux64\/chrome$/ },
    { dir: `${home}/.cache/ms-playwright`, pattern: /chromium-[^/]+\/chrome-linux64\/chrome$/ },
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
      if (found.length > 0) return found[found.length - 1]
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
  return (await res.json()).token
}

async function apiPatch(token, id, template) {
  const res = await fetch(`${BASE}/api/agreements/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ template }),
  })
  if (!res.ok) throw new Error(`PATCH failed ${res.status}`)
}

const token = await apiLogin()
const exe = resolveChrome()
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=en-US'],
})

const report = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.evaluate((t) => window.localStorage.setItem('lig_session_token', t), token)
  await page.reload({ waitUntil: 'networkidle2', timeout: 90_000 })
  await page.waitForFunction(
    () => {
      const el = [...document.querySelectorAll('button, a')].find((b) =>
        (b.textContent || '').trim().startsWith('Agreements')
      )
      if (!el) return false
      el.click()
      return true
    },
    { timeout: 60_000, polling: 500 }
  )
  await page.waitForSelector('table', { timeout: 60_000 })
  await new Promise((r) => setTimeout(r, 1200))

  for (const ag of AGREEMENTS) {
    for (const tpl of TEMPLATES) {
      await apiPatch(token, ag.id, tpl)
      await page.evaluate((no) => {
        const el = [...document.querySelectorAll('button[title="View / print"]')].find((b) => {
          const row = b.closest('tr')
          return row && (row.textContent || '').includes(no)
        })
        el.click()
      }, ag.no)
      await page.waitForFunction(
        () => document.querySelectorAll('.print-area .doc-page').length > 0,
        { timeout: 60_000, polling: 250 }
      )
      await new Promise((r) => setTimeout(r, 800))
      const rows = await page.evaluate((PX) => {
        const mm = (px) => px / PX
        return [...document.querySelectorAll('.print-area [data-agr-art]')].map((el) => ({
          art: el.getAttribute('data-agr-art'),
          h: +mm(el.getBoundingClientRect().height).toFixed(2),
        }))
      }, PX_PER_MM)
      // page-1 fixed blocks: every child of the content column BEFORE the
      // first article row, plus margins (offsets) — calibrates page1Fixed
      const fixed = await page.evaluate((PX) => {
        const mm = (px) => px / PX
        const page1 = document.querySelector('.print-area .doc-page')
        if (!page1) return null
        const col = [...page1.children].find((c) => c.tagName === 'DIV' && /flex-col/.test(c.className || '')) || page1.children[0]
        const kids = [...col.children]
        const out = []
        let prevBottom = null
        for (const k of kids) {
          const r = k.getBoundingClientRect()
          const gap = prevBottom == null ? 0 : +mm(r.top - prevBottom).toFixed(2)
          out.push({
            tag: k.tagName.toLowerCase(),
            data: k.getAttribute('data-agr-art') || k.getAttribute('data-agr-footer') || k.getAttribute('data-agr-signatures') || (k.className || '').toString().slice(0, 30),
            h: +mm(r.height).toFixed(2),
            gapBefore: gap,
          })
          prevBottom = r.bottom
        }
        return out
      }, PX_PER_MM)
      report.push({ agreementNo: ag.no, template: tpl, rows, fixed })
      console.log(`${ag.no} × ${tpl}:`)
      for (const f of fixed ?? []) console.log(`    ${f.tag.padEnd(5)} ${String(f.data).padEnd(30)} h=${f.h}mm gap=${f.gapBefore}mm`)
      console.log(`    arts: ${rows.map((r) => `#${r.art}=${r.h}mm`).join(' ')}`)
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
      await new Promise((r) => setTimeout(r, 300))
    }
    await apiPatch(token, ag.id, null)
  }
  fs.writeFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'agr-estimator-calibration.json'),
    JSON.stringify(report, null, 2)
  )
  console.log('✓ calibration written')
} finally {
  await browser.close()
}
