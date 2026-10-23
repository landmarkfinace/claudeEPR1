// Probe: measure article-row heights in the DIALOG under PRINT media
// emulation — the daemon renders with page.pdf() (print media), where text
// metrics/wrapping can differ from screen media. Reproduces the clipping.
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:3000'
const EMAIL = 'admin@example.com'
const PASSWORD = 'password'

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
  await fetch(`${BASE}/api/agreements/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ template }),
  })
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

  await apiPatch(token, 'cmvk4dv98000bsoj60dr6dnqs', 'key-terms')
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button[title="View / print"]')].find((b) => {
      const row = b.closest('tr')
      return row && (row.textContent || '').includes('AGR-2025-0001')
    })
    el.click()
  })
  await page.waitForFunction(
    () => document.querySelectorAll('.print-area .doc-page').length > 0,
    { timeout: 60_000, polling: 250 }
  )
  await new Promise((r) => setTimeout(r, 800))

  const PX_PER_MM = 96 / 25.4
  for (const media of ['screen', 'print']) {
    await page.emulateMediaType(media)
    await new Promise((r) => setTimeout(r, 400))
    const rows = await page.evaluate((PX) => {
      const mm = (px) => px / PX
      return [...document.querySelectorAll('.print-area [data-agr-art]')].map((el) => ({
        art: el.getAttribute('data-agr-art'),
        h: +mm(el.getBoundingClientRect().height).toFixed(2),
        pages: document.querySelectorAll('.print-area .doc-page').length,
      }))
    }, PX_PER_MM)
    console.log(
      `media=${media}: pages=${rows[0]?.pages} arts=${rows.map((r) => `#${r.art}=${r.h}mm`).join(' ')}`
    )
  }
  await apiPatch(token, 'cmvk4dv98000bsoj60dr6dnqs', null)
} finally {
  await browser.close()
}
