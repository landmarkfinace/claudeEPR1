// Agreement PDF verification — proves the ERP's server PDF matches the ORIGINAL
// uploaded template:
//   1. login → fetch /api/agreements/[id]/pdf for AGR-2025-0001 (the EXACT
//      sample data from the template file) and AGR-2025-0002 (amount mode) —
//      saved to /home/z/my-project/download/.
//   2. render the REFERENCE: the original agreement-template.html with the
//      Google Fonts <link> swapped for the same inlined data-URL @font-faces
//      (scripts/agr-reference.html), in a clean headless Chromium — exactly
//      what the boss's browser prints, no app CSS involved.
//   3. hand both to scripts/agr-verify-pdfs.py (pymupdf): page count, A4 size,
//      embedded fonts, normalized text equality, key-line geometry and a
//      rasterized pixel diff; writes agreement-layout-test-results.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const APP = 'http://127.0.0.1:3000'
const OUT = '/home/z/my-project/download'
const REF_HTML = '/home/z/my-project/scripts/agr-reference.html'

async function login() {
  const res = await fetch(`${APP}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'password' }),
  })
  if (!res.ok) throw new Error(`login failed ${res.status}`)
  return (await res.json()).token
}

const token = await login()
const auth = { Authorization: `Bearer ${token}` }

// ---- locate the two seeded agreements ----
const list = await (await fetch(`${APP}/api/agreements?pageSize=50`, { headers: auth })).json()
const sample = list.data.find((r) => r.agreementNo === 'AGR-2025-0001')
const qa = list.data.find((r) => r.agreementNo === 'AGR-2025-0002')
if (!sample || !qa) throw new Error('seeded agreements not found')

// ---- 1. ERP PDFs through the real server route ----
const files = []
for (const row of [sample, qa]) {
  const res = await fetch(`${APP}/api/agreements/${row.id}/pdf`, { headers: auth })
  if (!res.ok) throw new Error(`pdf failed ${res.status} for ${row.agreementNo}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const name = `${row.agreementNo}_${(row.otherPartyNameEn || row.otherPartyNameAr).replace(/[\\/:*?"<>|]+/g, '-')}.pdf`
  const file = path.join(OUT, `Agreement-${name}`)
  fs.writeFileSync(file, buf)
  const cd = res.headers.get('content-disposition') ?? ''
  files.push({ row, file, contentDisposition: cd })
  console.log(`ERP PDF: ${row.agreementNo} → ${file} (${(buf.length / 1024).toFixed(1)} KB, ${cd.slice(0, 80)})`)
}

// ---- 2. reference render (clean Chromium, print media, CSS @page honored) ----
function resolveChrome() {
  if (process.env.PRINT_CHROME && fs.existsSync(process.env.PRINT_CHROME)) return process.env.PRINT_CHROME
  const home = process.env.HOME || '/home/z'
  for (const dir of [`${home}/.cache/puppeteer/chrome`, `${home}/.cache/ms-playwright`]) {
    try {
      const found = []
      const walk = (d, depth) => {
        if (depth > 3) return
        for (const name of fs.readdirSync(d)) {
          const full = path.join(d, name)
          const st = fs.statSync(full)
          if (st.isDirectory()) walk(full, depth + 1)
          else if (/\/chrome$/.test(full) && fs.existsSync(full)) found.push(full)
        }
      }
      walk(dir, 0)
      if (found.length) return found.sort().at(-1)
    } catch {}
  }
  for (const flat of ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium']) {
    if (fs.existsSync(flat)) return flat
  }
  throw new Error('no chromium found')
}

const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--font-render-hinting=none', '--lang=en-US'],
})
let refFile = ''
try {
  const page = await browser.newPage()
  await page.setContent(fs.readFileSync(REF_HTML, 'utf8'), { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await new Promise((r) => setTimeout(r, 300))
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    scale: 1,
    preferCSSPageSize: true,
  })
  refFile = path.join(OUT, 'Agreement-REFERENCE-original-template.pdf')
  fs.writeFileSync(refFile, Buffer.from(pdf))
  console.log(`REFERENCE PDF: ${refFile} (${(pdf.length / 1024).toFixed(1)} KB)`)
} finally {
  await browser.close()
}

if (!refFile) throw new Error('reference render failed')

// ---- 3. comparison (argument order: reference, ERP sample, ERP QA) ----
const { spawnSync } = await import('node:child_process')
const run = spawnSync(
  'python3',
  [path.join(HERE, 'agr-verify-pdfs.py'), refFile, files[0].file, files[1].file],
  { stdio: 'inherit' }
)
if (run.status !== 0) throw new Error('comparison failed')
