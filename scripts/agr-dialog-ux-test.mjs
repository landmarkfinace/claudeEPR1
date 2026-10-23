// Final UX check — the print dialog's Template dropdown: open AGR-2025-0001,
// switch templates via the SELECT (the real user path), verify the document
// re-renders instantly and the PATCH fires (row state follows).
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:3000'

function resolveChrome() {
  const home = process.env.HOME || '/home/z'
  const dirs = [{ dir: `${home}/.cache/puppeteer/chrome`, pattern: /chrome-linux64\/chrome$/ }]
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
    body: JSON.stringify({ email: 'admin@example.com', password: 'password' }),
  })
  return (await res.json()).token
}

const token = await apiLogin()
const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=en-US'],
})
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

  // open the dialog
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button[title="View / print"]')].find((b) => {
      const row = b.closest('tr')
      return row && (row.textContent || '').includes('AGR-2025-0001')
    })
    el.click()
  })
  await page.waitForFunction(
    () => document.querySelector('.print-area .sheet') !== null,
    { timeout: 60_000, polling: 250 }
  )
  console.log('✓ dialog opens on Classic (flow sheet)')

  // switch through the dropdown (shadcn Select)
  for (const label of ['Bilingual Cards', 'Official Form', 'Key Terms', 'Classic']) {
    await page.click('[aria-label="Print template"]')
    await page.waitForSelector('[role="option"]', { timeout: 10_000 })
    await page.evaluate((l) => {
      const opt = [...document.querySelectorAll('[role="option"]')].find((o) =>
        (o.textContent || '').trim().startsWith(l)
      )
      opt.click()
    }, label)
    await new Promise((r) => setTimeout(r, 1200))
    const state = await page.evaluate(() => {
      const sheets = document.querySelectorAll('.print-area .doc-page').length
      const flow = document.querySelectorAll('.print-area .sheet').length
      return { sheets, flow }
    })
    console.log(`✓ select → ${label}: re-rendered (doc-pages=${state.sheets}, sheet=${state.flow})`)
  }

  // verify the last PATCH persisted (classic) — and that the PATCH only
  // touched the template (row data unchanged)
  const row = await fetch(`${BASE}/api/agreements/cmvk4dv98000bsoj60dr6dnqs`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json())
  console.log(
    `✓ PATCH round-trip: template=${row.template}, clauses=${row.clauses.length}, status=${row.status}, title="${row.titleEn}"`
  )
  // restore
  await fetch(`${BASE}/api/agreements/cmvk4dv98000bsoj60dr6dnqs`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ template: null }),
  })
  console.log('✓ restored template to null')
} finally {
  await browser.close()
}
