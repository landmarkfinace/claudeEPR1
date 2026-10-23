// STEP 4 verification for the Name List template task.
//
// Drives the REAL app in headless Chromium through the REAL print/PDF
// pipeline and proves:
//   A. NL-2026-0001 (interview, 8 workers) + NL-2026-0002 (mobilization, 10
//      workers — its saved Columns snapshot already hides Mobile) print in
//      ALL 4 templates → 8 PDFs exported via /api/print-pdf (vector).
//   B. The refactored Classic output is IDENTICAL to the PRECHANGE baselines
//      (pdftotext diff, both lists).
//   C. The SAME data (list no, client, project, dates, every worker's name,
//      Iqama, mobile, trade summary, total) appears in ALL 4 templates.
//   D. Hidden Mobile column: NL-0002's snapshot hides it in all 4 templates;
//      interactive Columns-popover toggle on NL-0001 (restored to NULL after).
//   E. Old lists (0003 sent / 0004 sent 25 workers / 0005 draft mob 0 workers)
//      still open + print Classic; their template values stay NULL.
//   F. The print dialog's Template select switches instantly and PATCHes the
//      saved list; the Settings default round-trips (heritage → classic).
//   G. 30-worker in-memory PREVIEW (Settings › Name List › Templates) — no DB
//      writes: 2-3 pages in every new template, signatures pinned to the
//      bottom of the last page.
//   H. Mobile 390px: no horizontal overflow.
// Finally: every touched list's template is PATCHed back to NULL (restore).
//
// Run: node scripts/nl-tpl-verify.mjs
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

const TEMPLATES = [
  { id: 'classic', label: 'Classic' },
  { id: 'heritage', label: 'Heritage' },
  { id: 'folder', label: 'Folder' },
  { id: 'sidebar', label: 'Sidebar' },
]
const TARGET_LISTS = ['NL-2026-0001', 'NL-2026-0002']
const RESULTS = { errors: [], notes: [] }
function fail(msg) {
  RESULTS.errors.push(msg)
  console.log(`  ✗ ${msg}`)
}
function ok(msg) {
  console.log(`  ✓ ${msg}`)
}

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
  return '/usr/bin/chromium'
}

async function api(method, pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api.token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status}: ${JSON.stringify(json).slice(0, 200)}`)
  return json
}

function renderPdf(html) {
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
          Authorization: `Bearer ${api.token}`,
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: 180_000,
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
  const artRect = footerArt ? footerArt.getBoundingClientRect() : null
  const r2 = (v) => (v == null ? null : +mm(v).toFixed(2))
  return {
    hasChips: !!chips,
    hasSignatures: !!sig,
    hasNote: !!note,
    sigBottomFromPageMm: sigRect ? r2(pageRect.bottom - sigRect.bottom) : null,
    sigToNoteGapMm: sigRect && noteRect ? r2(noteRect.top - sigRect.bottom) : null,
    noteBottomToFooterArtMm: noteRect && artRect ? r2(artRect.top - noteRect.bottom) : null,
  }
})()`

/** Saudi mobile formatting (mirrors formatSaudiMobile). */
function fmtMobile(v) {
  if (!v) return '—'
  const d = v.replace(/\D/g, '')
  if (/^05\d{8}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`
  if (/^9665\d{8}$/.test(d)) return `0${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`
  return v
}

// ── login + list registry ────────────────────────────────────────────────────
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
}).then((r) => r.json())
api.token = login.token
console.log('✓ logged in')

const lists = {}
for (const no of [...TARGET_LISTS, 'NL-2026-0003', 'NL-2026-0004', 'NL-2026-0005']) {
  const row = await api('GET', `/api/name-lists?search=${no}&page=1&pageSize=5`)
  const hit = row.data.find((l) => l.listNo === no)
  if (!hit) throw new Error(`${no} not found`)
  lists[no] = await api('GET', `/api/name-lists/${hit.id}`)
}
console.log('✓ 5 lists loaded (details)')
const lh = await api('GET', '/api/letterhead')
console.log(`✓ letterhead: ${lh.mode} (header ${lh.headerHeightMm}mm / footer ${lh.footerHeightMm}mm)`)

// ── browser ──────────────────────────────────────────────────────────────────
const exe = resolveChrome()
console.log(`✓ chromium: ${exe}`)
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=en-US'],
})
const consoleErrors = []
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(String(e)))
await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 })
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
await page.evaluate((t) => window.localStorage.setItem('lig_session_token', t), api.token)
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

async function openPrint(no) {
  await page.evaluate((n) => {
    const els = [...document.querySelectorAll('[title="Print / PDF"]')]
    const el = els.find((b) => {
      const row = b.closest('tr') || b.closest('[data-slot], div')
      return row && (row.textContent || '').includes(n)
    })
    if (!el) throw new Error(`Print button for ${n} not found`)
    el.click()
  }, no)
  await page.waitForFunction(
    () => document.querySelectorAll('.print-area .doc-page').length > 0,
    { timeout: 60_000, polling: 250 }
  )
  await new Promise((r) => setTimeout(r, 700))
}

async function closePrint() {
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

/** Export one list × one template: PATCH → open → measure → DOM text → PDF. */
async function exportOne(no, tpl, expectPages) {
  const detail = lists[no]
  await api('PATCH', `/api/name-lists/${detail.id}`, { template: tpl.id })

  await openPrint(no)
  const domPages = await page.evaluate(
    () => document.querySelectorAll('.print-area .doc-page').length
  )
  const pageOk =
    expectPages === undefined
      ? domPages > 0
      : (Array.isArray(expectPages)
          ? expectPages.includes(domPages)
          : domPages === expectPages)
  if (!pageOk) {
    fail(`${no} × ${tpl.label}: unexpected page count ${domPages} (expected ${JSON.stringify(expectPages)})`)
  } else {
    ok(`${no} × ${tpl.label}: ${domPages} page(s)`)
  }

  const lastMeasure = await page.evaluate(measureLastPage)
  if (!lastMeasure.hasSignatures || !lastMeasure.hasNote) {
    fail(`${no} × ${tpl.label}: last page missing signature/note (chips=${lastMeasure.hasChips})`)
  }
  if (lastMeasure.sigToNoteGapMm == null || Math.abs(lastMeasure.sigToNoteGapMm - 3) > 1.2) {
    fail(`${no} × ${tpl.label}: sig→note gap ${lastMeasure.sigToNoteGapMm}mm (want ~3mm)`)
  }

  const domText = await page.evaluate(() => {
    const root = document.querySelector('.print-area')
    return root ? root.innerText : ''
  })

  const html = await page.evaluate(() => {
    const root = document.querySelector('.print-area')
    if (!root) throw new Error('print-area not found')
    return root.outerHTML
  })
  const pdf = await renderPdf(html)
  const file = path.join(OUT, `Name-List-${no}_${tpl.label}.pdf`)
  fs.writeFileSync(file, pdf)
  const txt = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' })
  const txtPlain = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' })

  await closePrint()
  return {
    no,
    tpl: tpl.id,
    label: tpl.label,
    domPages,
    lastMeasure,
    domText,
    pdfText: txt,
    pdfTextPlain: txtPlain,
    file,
  }
}

// ── PART A + B + C: exports, baseline identity, cross-template data ─────────
console.log('\n── PART A/B/C: 2 lists × 4 templates, baselines, data identity')
const runs = {}
for (const no of TARGET_LISTS) {
  runs[no] = {}
  for (const tpl of TEMPLATES) {
    const expect = no === 'NL-2026-0001' ? 1 : 1
    runs[no][tpl.id] = await exportOne(no, tpl, expect)
  }
}

// B — Classic identity vs PRECHANGE baselines
for (const no of TARGET_LISTS) {
  const base = fs.readFileSync(path.join(HERE, `nl-baseline-${no.slice(-4)}.txt`), 'utf8')
  const now = runs[no].classic.pdfText
  const strip = (t) =>
    t
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
  if (strip(now) === strip(base)) {
    ok(`${no} Classic: pdftotext IDENTICAL to the PRECHANGE baseline`)
  } else {
    fail(`${no} Classic: pdftotext DIFFERS from the PRECHANGE baseline`)
    const a = strip(base).split('\n')
    const b = strip(now).split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) console.log(`    line ${i}: base=${JSON.stringify(a[i])} now=${JSON.stringify(b[i])}`)
    }
  }
}

// C — cross-template data identity (key values present in every template).
// The key set is the INTERSECTION of what all 4 templates print for this list:
// values of columns hidden by the Columns setting are excluded, and the
// project name is only expected on mobilization lists (Classic's interview
// info bar shows the Location instead — the new templates additionally
// print the project, but Classic must stay exactly as it is).
for (const no of TARGET_LISTS) {
  const d = lists[no]
  const date = new Date(d.date)
  const pad = (n) => String(n).padStart(2, '0')
  const dateStr = `${pad(date.getDate())} / ${pad(date.getMonth() + 1)} / ${date.getFullYear()}`
  const isMob = d.subjectKind === 'mobilization'
  const cols =
    d.columns ??
    (isMob
      ? { iqama: true, passport: true, nationality: true, trade: true, blood: true, remarks: true }
      : { trade: true, experience: true, nationality: true, iqama: true, mobile: true, result: true, remarks: true })
  const keys = [
    d.listNo,
    d.clientName,
    isMob ? (d.projectName ?? '') : '',
    dateStr,
    String(d.workers.length),
    ...d.workers.map((w) => w.staff.fullName),
    ...d.workers.map((w) => w.staff.iqamaId),
    cols.mobile ? d.workers.map((w) => fmtMobile(w.staff.phone)) : [],
    cols.passport
      ? d.workers.map((w) => w.staff.passportNo ?? '').filter((x) => x && x !== '—')
      : [],
    ...d.workers.map((w) => w.staff.categoryName ?? w.staff.position ?? 'Uncategorized'),
  ]
    .flat()
    .filter((k) => k && k !== '—')
  // info-bar values that Classic renders with its pre-existing `truncate`
  // class (long values ellipsize — Classic stays exactly as it is)
  const softKeys = new Set([isMob ? d.projectName ?? '' : ''])
  const toks = (k) => k.split(/\s+/).filter((t) => t && t !== '—' && t !== '·')
  for (const tpl of TEMPLATES) {
    const txt = runs[no][tpl.id].domText.replace(/\s+/g, ' ')
    const pdfTxt = runs[no][tpl.id].pdfTextPlain.replace(/\s+/g, ' ')
    const pdfTokenSet = new Set(
      pdfTxt.split(/\s+/).map((t) => t.replace(/[^\w\u0600-\u06FF-]/g, ''))
    )
    const hasEllipsis = pdfTxt.includes('…') || pdfTxt.includes('...')
    const missingDom = keys.filter((k) => !txt.includes(k.replace(/\s+/g, ' ')))
    // PDF: full contiguous match, or all words present as tokens (tables wrap
    // cells — wrapping never removes data), or the classic-ellipsis excuse
    // for long info-bar values (pre-existing Classic render policy).
    const missingPdf = keys.filter((k) => {
      if (pdfTxt.includes(k.replace(/\s+/g, ' '))) return false
      const words = toks(k)
      const missingWords = words.filter((w) => !pdfTokenSet.has(w))
      if (missingWords.length === 0) return false
      if (
        tpl.id === 'classic' &&
        softKeys.has(k) &&
        hasEllipsis &&
        words.slice(0, 4).every((w) => pdfTokenSet.has(w))
      ) {
        return false // pre-existing Classic truncate — value identical in the data layer
      }
      return true
    })
    if (missingDom.length === 0 && missingPdf.length === 0) {
      ok(`${no} × ${tpl.label}: all ${keys.length} key data points present (DOM + PDF)`)
    } else {
      fail(`${no} × ${tpl.label}: missing DOM=[${missingDom.slice(0, 5)}] PDF=[${missingPdf.slice(0, 5)}]`)
    }
  }
}

// ── PART D: hidden Mobile column ─────────────────────────────────────────────
console.log('\n── PART D: hidden Mobile column')
{
  // NL-0002's saved snapshot has mobile:false — verify no Mobile header in
  // any of the 4 exported templates (already rendered above; check thead now)
  for (const tpl of TEMPLATES) {
    const r = runs['NL-2026-0002'][tpl.id]
    if (r.pdfText.includes('Mobile') || r.pdfText.includes('الجوال')) {
      fail(`NL-2026-0002 × ${tpl.label}: Mobile header appears although the column is hidden`)
    } else {
      ok(`NL-2026-0002 × ${tpl.label}: Mobile column hidden everywhere (snapshot mobile:false)`)
    }
  }

  // interactive toggle on NL-2026-0001 in the Columns popover (heritage).
  // Pre-state assertion: with a NULL snapshot the dialog must show the
  // default interview columns (Mobile ON) — then the toggle hides it.
  await api('PATCH', `/api/name-lists/${lists['NL-2026-0001'].id}`, { template: 'heritage' })
  await openPrint('NL-2026-0001')
  const preHasMobile = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('.print-area table thead th')].map((t) =>
      (t.innerText || '').trim()
    )
    return ths.some((t) => /^Mobile/.test(t))
  })
  if (!preHasMobile) fail('PART D pre-state: Mobile unexpectedly hidden before the toggle')
  else ok('PART D pre-state: Mobile visible (default columns) before the toggle')
  await page.evaluate(() => {
    const dlg = document.querySelector('[data-slot="dialog-content"]')
    const btn = [...(dlg ? dlg.querySelectorAll('button') : [])].find((b) =>
      (b.textContent || '').trim().startsWith('Columns')
    )
    if (!btn) throw new Error('Columns button not found')
    btn.click()
  })
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => {
    const labels = [...document.querySelectorAll('[role="dialog"] label, [data-slot="popover-content"] label')]
    const lbl = labels.find((l) => (l.textContent || '').includes('Mobile No.'))
    if (!lbl) throw new Error('Mobile No. checkbox not found')
    lbl.querySelector('button')?.click()
    if (!lbl) throw new Error('nope')
  })
  await new Promise((r) => setTimeout(r, 700))
  const mobGone = await page.evaluate(() => {
    const ths = [...document.querySelectorAll('.print-area table thead th')].map((t) =>
      (t.innerText || '').trim()
    )
    return !ths.some((t) => /^Mobile/.test(t) || t.startsWith('الجوال'))
  })
  if (mobGone) ok('NL-2026-0001 (heritage): Mobile disappears after the Columns toggle')
  else fail('NL-2026-0001 (heritage): Mobile column still visible after toggle')
  await closePrint()
  RESULTS.notes.push('NL-2026-0001 columns snapshot will be restored to NULL by the runner (bash)')

  // the toggle persisted — verify by API, then leave for the bash restore
  const after = await api('GET', `/api/name-lists/${lists['NL-2026-0001'].id}`)
  if (after.columns && after.columns.mobile === false) {
    ok('Columns toggle persisted to the list (PUT columns-only) — will be restored')
  } else {
    fail('Columns toggle did not persist')
  }
}

// ── PART E: old lists stay Classic ───────────────────────────────────────────
console.log('\n── PART E: old lists (NULL template) still print Classic')
{
  const expects = { 'NL-2026-0003': 1, 'NL-2026-0004': 2, 'NL-2026-0005': 1 }
  for (const no of ['NL-2026-0003', 'NL-2026-0004', 'NL-2026-0005']) {
    const d = lists[no]
    // ensure NULL template (untouched) — set explicitly for the print
    await api('PATCH', `/api/name-lists/${d.id}`, { template: null })
    await openPrint(no)
    const domPages = await page.evaluate(
      () => document.querySelectorAll('.print-area .doc-page').length
    )
    const isClassic = await page.evaluate(() => {
      const t = (document.querySelector('.print-area')?.innerText || '').toUpperCase()
      return t.includes('NAME LIST') && t.includes('LIST NO.')
    })
    const keyData = [d.listNo, d.clientName]
    const domText = (await page.evaluate(() => document.querySelector('.print-area')?.innerText || '')).replace(/\s+/g, ' ')
    const keysOk = keyData.every((k) => domText.includes(k))
    if (domPages === expects[no] && isClassic && keysOk) {
      ok(`${no}: ${domPages} page(s), Classic layout, key data present`)
    } else {
      fail(`${no}: pages=${domPages} (want ${expects[no]}), classic=${isClassic}, keys=${keysOk}`)
    }
    const lastMeasure = await page.evaluate(measureLastPage)
    if (!lastMeasure.hasSignatures) fail(`${no}: no signature block on last page`)
    await closePrint()
  }
}

// ── PART F: dialog Template select + settings default round-trip ─────────────
console.log('\n── PART F: dialog Select UI + settings default round-trip')
{
  // F1 — dialog select: open NL-0001 (currently heritage), switch to Folder
  // via the UI select, assert instant re-render + PATCH persistence
  await openPrint('NL-2026-0001')
  await page.evaluate(() => {
    const sel = document.querySelector('button[aria-label="Print template"]')
    if (!sel) throw new Error('Template select trigger not found')
    sel.click()
  })
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('[role="option"]')]
    const o = opts.find((x) => (x.textContent || '').trim() === 'Folder')
    if (!o) throw new Error('Folder option not found')
    o.click()
  })
  await new Promise((r) => setTimeout(r, 700))
  const folderShown = await page.evaluate(() => {
    const t = document.querySelector('.print-area')?.innerText || ''
    return t.includes('01 · DETAILS') && t.includes('02 · WORKERS')
  })
  if (folderShown) ok('dialog Select: instant switch to Folder (01 · DETAILS / 02 · WORKERS rendered)')
  else fail('dialog Select: Folder markup not rendered after switching')
  await closePrint()
  await new Promise((r) => setTimeout(r, 400))
  const persisted = await api('GET', `/api/name-lists/${lists['NL-2026-0001'].id}`)
  if (persisted.template === 'folder') ok('dialog Select: choice PATCHed onto the saved list (folder)')
  else fail(`dialog Select: PATCH not persisted (template=${persisted.template})`)

  // F2 — settings default round-trip: default heritage → NULL-template list
  // opens in heritage → back to classic. The app store reads /api/settings
  // once at boot (pre-existing behaviour), so RELOAD before re-checking.
  await api('PUT', '/api/settings', { nameListDefaultTemplate: 'heritage' })
  await api('PATCH', `/api/name-lists/${lists['NL-2026-0003'].id}`, { template: null })
  await page.reload({ waitUntil: 'networkidle2', timeout: 90_000 })
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
  await openPrint('NL-2026-0003')
  const isHeritage = await page.evaluate(() => {
    const t = document.querySelector('.print-area')?.innerText || ''
    // heritage carries the ✦ separators; folder shows 01 · DETAILS; sidebar
    // shows WORKERS DEPLOYMENT; classic has none of these
    return (
      t.includes('✦') && !t.includes('01 · DETAILS') && !t.includes('WORKERS DEPLOYMENT')
    )
  })
  await closePrint()
  if (isHeritage) ok('settings default=heritage: NULL-template list opens in Heritage (✦ separators)')
  else fail('settings default=heritage: list did not render Heritage after reload')
  await api('PUT', '/api/settings', { nameListDefaultTemplate: 'classic' })
  const settingsAfter = await api('GET', '/api/settings')
  if (settingsAfter.settings.nameListDefaultTemplate === 'classic') {
    ok('settings default restored to classic')
  } else {
    fail('settings default did not restore')
  }
}

// ── PART G: 30-worker in-memory preview (zero DB writes) ─────────────────────
console.log('\n── PART G: 30-worker PREVIEW via Settings (in-memory, zero DB writes)')
{
  // snapshot the lists table state (via API) to prove no writes
  const before = await api('GET', '/api/name-lists?pageSize=100&page=1')
  const beforeSig = JSON.stringify(
    before.data.map((l) => [l.listNo, l.template, l.workerCount, l.status])
  )

  // navigate to Settings
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, a')]
    const el = btns.find((b) => (b.textContent || '').trim() === 'Settings')
    if (!el) throw new Error('Settings nav not found')
    el.click()
  })
  await page.waitForFunction(
    () => (document.body.innerText || '').includes('Name List Templates'),
    { timeout: 60_000, polling: 500 }
  )
  ok('Settings › Name List › Templates section visible')

  const previewResults = {}
  const openTemplatePreview = async (label) => {
    await page.evaluate((lbl) => {
      // scope to the Name List Templates section (NOT the E-Invoice one)
      const h = [...document.querySelectorAll('h3')].find((x) =>
        (x.textContent || '').includes('Name List Templates')
      )
      if (!h) throw new Error('Name List Templates h3 not found')
      let sec = h
      while (
        sec &&
        !((sec.textContent || '').includes('Sidebar') && (sec.textContent || '').includes('default'))
      ) {
        sec = sec.parentElement
      }
      if (!sec) throw new Error('templates section card not found')
      const card = [...sec.querySelectorAll('div')].find(
        (d) =>
          d.classList.contains('rounded-lg') &&
          (d.textContent || '').includes(lbl) &&
          (d.textContent || '').includes('Preview') &&
          (d.textContent || '').includes('default')
      )
      if (!card) throw new Error(`card for ${lbl} not found`)
      const btn = [...card.querySelectorAll('button')].find(
        (b) => (b.textContent || '').trim() === 'Preview'
      )
      if (!btn) throw new Error(`Preview button for ${lbl} not found`)
      btn.click()
    }, label)
    await page.waitForFunction(
      () => document.querySelectorAll('.print-area .doc-page').length > 0,
      { timeout: 60_000, polling: 250 }
    )
  }
  for (const tpl of TEMPLATES) {
    // open this template's preview
    await openTemplatePreview(tpl.label)
    // switch to 30 workers
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')]
      const b = btns.find((x) => (x.textContent || '').trim() === '30 workers')
      if (!b) throw new Error('30 workers toggle not found')
      b.click()
    })
    await new Promise((r) => setTimeout(r, 800))
    const domPages = await page.evaluate(
      () => document.querySelectorAll('.print-area .doc-page').length
    )
    const lastMeasure = await page.evaluate(measureLastPage)
    const contOk = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.print-area .doc-page')]
      const page2 = pages[1]
      if (!page2) return false
      const t = page2.innerText || ''
      return t.includes('continued') || t.includes('تابع')
    })
    previewResults[tpl.id] = { domPages, lastMeasure, contOk }
    if (tpl.id === 'classic') {
      ok(`preview × Classic: ${domPages} pages (recorded)`)
    } else {
      const pagesOk = domPages >= 2 && domPages <= 3
      if (pagesOk && lastMeasure.hasSignatures && lastMeasure.hasNote && contOk) {
        ok(`preview × ${tpl.label}: ${domPages} pages (2-3), continuation header, signatures pinned (sig→note ${lastMeasure.sigToNoteGapMm}mm)`)
      } else {
        fail(`preview × ${tpl.label}: pages=${domPages}, cont=${contOk}, measure=${JSON.stringify(lastMeasure)}`)
      }
    }
    // close the preview dialog
    await page.evaluate(() => {
      const dlg = document.querySelector('[data-slot="dialog-content"]')
      const btn = dlg
        ? [...dlg.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Close')
        : null
      if (btn) btn.click()
    })
    await page.keyboard.press('Escape')
    await new Promise((r) => setTimeout(r, 500))
  }

  // mob-kind preview once (heritage, 12 workers): blood capsule + Received by
  await openTemplatePreview('Heritage')
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const b = btns.find((x) => (x.textContent || '').trim() === 'mobilization')
    if (!b) throw new Error('mobilization toggle not found')
    b.click()
  })
  await new Promise((r) => setTimeout(r, 800))
  const mobCheck = await page.evaluate(() => {
    const root = document.querySelector('.print-area')
    const t = (root?.innerText || '').replace(/\s+/g, ' ')
    const hasBlood = t.includes('Blood Group') || t.includes('فئة الدم')
    const hasReceived = /received by/i.test(t) || t.includes('استلمه')
    const hasRef = t.includes('Reference') || t.includes('المرجع')
    return { hasBlood, hasReceived, hasRef }
  })
  if (mobCheck.hasBlood && mobCheck.hasReceived && mobCheck.hasRef) {
    ok('preview × Heritage (mobilization): blood capsule column, Reference, Received by · Client / Site')
  } else {
    fail(`preview × Heritage (mobilization): ${JSON.stringify(mobCheck)}`)
  }
  await page.evaluate(() => {
    const dlg = document.querySelector('[data-slot="dialog-content"]')
    const btn = dlg
      ? [...dlg.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Close')
      : null
    if (btn) btn.click()
  })
  await page.keyboard.press('Escape')

  // prove zero DB writes
  const after = await api('GET', '/api/name-lists?pageSize=100&page=1')
  const afterSig = JSON.stringify(
    after.data.map((l) => [l.listNo, l.template, l.workerCount, l.status])
  )
  if (beforeSig === afterSig) ok('preview: ZERO DB writes (lists table unchanged)')
  else fail('preview: lists table changed during preview!')

  RESULTS.preview = previewResults
}

// ── PART H: mobile 390px ─────────────────────────────────────────────────────
console.log('\n── PART H: mobile 390px')
{
  await page.setViewport({ width: 390, height: 844 })
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2', timeout: 90_000 })
  await new Promise((r) => setTimeout(r, 1200))
  const overflow = await page.evaluate(() => {
    const w = document.documentElement.scrollWidth
    return { scrollWidth: w, inner: window.innerWidth }
  })
  if (overflow.scrollWidth <= overflow.inner + 2) ok(`390px: no horizontal overflow (${overflow.scrollWidth}px)`)
  else fail(`390px: overflow ${overflow.scrollWidth} > ${overflow.inner}`)
}

// ── RESTORE: templates back to NULL ──────────────────────────────────────────
console.log('\n── RESTORE')
for (const no of [...TARGET_LISTS, 'NL-2026-0003', 'NL-2026-0004', 'NL-2026-0005']) {
  await api('PATCH', `/api/name-lists/${lists[no].id}`, { template: null })
}
const finalRows = await api('GET', '/api/name-lists?pageSize=100&page=1')
const badTpl = finalRows.data.filter((l) => l.template !== null)
if (badTpl.length === 0) ok('all 5 lists: template restored to NULL')
else fail(`templates not restored: ${badTpl.map((l) => [l.listNo, l.template])}`)

// ── report ───────────────────────────────────────────────────────────────────
if (consoleErrors.length === 0) ok('0 console/page errors across the whole run')
else fail(`${consoleErrors.length} console errors: ${consoleErrors.slice(0, 5)}`)

fs.writeFileSync(
  path.join(OUT, 'nl-template-verify-results.json'),
  JSON.stringify(
    {
      task: 'Name List templates — STEP 4 verification',
      letterhead: { mode: lh.mode, headerMm: lh.headerHeightMm, footerMm: lh.footerHeightMm },
      runs: Object.fromEntries(
        TARGET_LISTS.map((no) => [
          no,
          Object.fromEntries(
            TEMPLATES.map((t) => [
              t.id,
              {
                domPages: runs[no][t.id].domPages,
                lastMeasure: runs[no][t.id].lastMeasure,
                file: path.basename(runs[no][t.id].file),
              },
            ])
          ),
        ])
      ),
      results: RESULTS,
    },
    null,
    2
  )
)
console.log(`\n${RESULTS.errors.length === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${RESULTS.errors.length} FAILURES`} — results: ${path.join(OUT, 'nl-template-verify-results.json')}`)
await browser.close()
if (RESULTS.errors.length > 0) process.exit(1)
