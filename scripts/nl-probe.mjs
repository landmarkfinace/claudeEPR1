// Minimal probe — why did the 0001-Classic export render without Mobile?
// Dumps: API detail columns value, dialog-resolved thead, localStorage keys.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:3000'
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@example.com', password: 'password' }),
}).then((r) => r.json())
const token = login.token
const get = (p) =>
  fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json())
const patch = (p, body) =>
  fetch(`${BASE}${p}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).then((r) => r.json())

const rows = await get('/api/name-lists?search=NL-2026-0001&page=1&pageSize=5')
const id = rows.data.find((l) => l.listNo === 'NL-2026-0001').id
const detail = await get(`/api/name-lists/${id}`)
console.log('API detail.columns =', JSON.stringify(detail.columns))
console.log('API detail.template =', JSON.stringify(detail.template))

function resolveChrome() {
  const home = process.env.HOME || '/home/z'
  for (const flat of [
    `${home}/.cache/puppeteer/chrome/linux-155.0.8059.39/chrome-linux64/chrome`,
    '/usr/bin/chromium',
  ]) {
    if (fs.existsSync(flat)) return flat
  }
  return '/usr/bin/chromium'
}

const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1500, height: 1000 })
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.evaluate((t) => window.localStorage.setItem('lig_session_token', t), token)
await page.reload({ waitUntil: 'networkidle2', timeout: 90_000 })
await page.waitForFunction(
  () => {
    const el = [...document.querySelectorAll('button, a')].find((b) =>
      (b.textContent || '').trim().startsWith('Name List')
    )
    if (!el) return false
    el.click()
    return true
  },
  { timeout: 60_000, polling: 500 }
)
await page.waitForSelector('table', { timeout: 60_000 })
await new Promise((r) => setTimeout(r, 1200))

await page.evaluate(() => {
  const els = [...document.querySelectorAll('[title="Print / PDF"]')]
  const el = els.find((b) => {
    const row = b.closest('tr') || b.closest('[data-slot], div')
    return row && (row.textContent || '').includes('NL-2026-0001')
  })
  el.click()
})
await page.waitForFunction(
  () => document.querySelectorAll('.print-area .doc-page').length > 0,
  { timeout: 60_000, polling: 250 }
)
await new Promise((r) => setTimeout(r, 800))
const probe = await page.evaluate(() => {
  const ls = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k.startsWith('namelist.')) ls[k] = localStorage.getItem(k)
  }
  return {
    ls,
    thead: [...document.querySelectorAll('.print-area thead th')].map((t) =>
      (t.innerText || '').split('\n')[0].trim()
    ),
    subtitle: document.querySelector('.print-area')?.closest('[data-slot="dialog-content"]')
      ? document.querySelector('[data-slot="dialog-content"]')?.innerText?.slice(0, 120)
      : null,
  }
})
console.log('localStorage namelist keys:', JSON.stringify(probe.ls))
console.log('dialog thead columns:', JSON.stringify(probe.thead))
await browser.close()
