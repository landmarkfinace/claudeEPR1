// Browser QA for the E-Invoice letterhead feature.
//
// Drives the REAL app in headless Chromium:
//   Phase A — Settings UI: the new "Company Letterhead — E-Invoice" section
//     renders after Company Profile; upload the 3 test PNGs through the real
//     file inputs (preview + size appear), toggle the watermark switch, save,
//     mini-A4 preview shows the arrangement. Screenshots at every step.
//   Phase B — Print dialog (INV-2026-00005, 25 items → 3 pages): DOM-level
//     geometry assertions on EVERY page:
//       header img: top 0, full width, 45 mm band
//       footer img: bottom 0, full width, 25 mm band
//       watermark: centered in the body area, 120 mm wide, opacity 0.7,
//                  z-index BELOW the content column
//       page number line: just above the footer (≈26 mm), centered,
//                          "Page X of Y / صفحة X من Y"
//       content column: 12 mm side margins, 50 mm top / 30 mm bottom pads,
//                       no overlap with the header/footer bands
//   Phase C — "Print with letterhead" checkbox: default checked; unchecking
//     hides ALL artwork (imgs gone) while every geometry value stays the same.
//   Phase D — watermark off (Settings toggle): watermark layer skipped,
//     header/footer still active.
//
// Precondition: watermarkOpacity=70 set via API (the "boss configured it"
// state). Run: node scripts/ei-lh-browser-qa.mjs
import fs from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:3000'
const EMAIL = 'admin@example.com'
const PASSWORD = 'password'
const ASSETS = '/home/z/my-project/claudeEPR1/qa/ei-lh/assets'
const SHOTS = '/home/z/my-project/claudeEPR1/qa/ei-lh/shots'
fs.mkdirSync(SHOTS, { recursive: true })

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function resolveChrome() {
  const home = process.env.HOME || '/home/z'
  const { execSync } = require('node:child_process')
  try {
    return execSync(
      `ls -1 ${home}/.cache/puppeteer/chrome/*/chrome-linux64/chrome 2>/dev/null | tail -1`
    )
      .toString()
      .trim()
  } catch {}
  for (const flat of ['/usr/bin/google-chrome-stable', '/usr/bin/chromium']) {
    if (fs.existsSync(flat)) return flat
  }
  throw new Error('no chromium')
}

const { createRequire } = await import('node:module')
const require = createRequire(import.meta.url)

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  return (await res.json()).token
}

const token = await login()
console.log('✓ logged in')

// pre-state: opacity 70 (as if the boss set it in Settings)
{
  const res = await fetch(`${BASE}/api/e-invoice-letterhead`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ watermarkOpacity: 70, watermarkEnabled: true }),
  })
  if (!res.ok) throw new Error('pre-state PUT failed')
  console.log('✓ pre-state: watermarkOpacity=70, enabled=true')
}

const exe = resolveChrome()
const browser = await puppeteer.launch({
  executablePath: exe,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--lang=en-US'],
})

try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 1 })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.evaluate((t) => window.localStorage.setItem('lig_session_token', t), token)
  await page.reload({ waitUntil: 'networkidle2', timeout: 90_000 })
  console.log('✓ app booted')

  const shot = (name) =>
    page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false })

  // ───────────────────────────────────────────────────────── Phase A: settings
  console.log('— Phase A: Settings UI —')
  await page.waitForFunction(
    () => {
      const el = [...document.querySelectorAll('button, a')].find((b) =>
        (b.textContent || '').trim().startsWith('Settings')
      )
      if (!el) return false
      el.click()
      return true
    },
    { timeout: 60_000, polling: 500 }
  )
  await new Promise((r) => setTimeout(r, 2500))
  // the section renders below Company Profile — jump to it
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('h2')].some((h) =>
        (h.textContent || '').includes('Company Letterhead — E-Invoice')
      ),
    { timeout: 30_000, polling: 500 }
  )
  check('A: section "Company Letterhead — E-Invoice" present', true)

  const sectionBox = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find((h) =>
      (h.textContent || '').includes('Company Letterhead — E-Invoice')
    )
    const card = h2?.closest('div')
    h2?.scrollIntoView({ block: 'center' })
    return card ? card.getBoundingClientRect().top : null
  })
  await new Promise((r) => setTimeout(r, 600))
  await shot('A1-settings-section')

  // three upload slots + watermark controls present
  const slots = await page.evaluate(() => {
    const root = [...document.querySelectorAll('h2')]
      .find((h) => (h.textContent || '').includes('Company Letterhead — E-Invoice'))
      ?.closest('[data-slot="card"], div')
    const sec = root?.parentElement ?? document
    const labels = [...sec.querySelectorAll('p')].map((p) => p.textContent || '')
    return {
      header: labels.some((t) => t === 'Letterhead Header'),
      footer: labels.some((t) => t === 'Letterhead Footer'),
      watermark: labels.some((t) => t === 'Watermark'),
      opacity: [...sec.querySelectorAll('label')].some((l) =>
        (l.textContent || '').includes('Watermark opacity')
      ),
      toggle: [...sec.querySelectorAll('label')].some((l) =>
        (l.textContent || '').includes('Watermark on printed invoices')
      ),
      saveBtn: [...sec.querySelectorAll('button')].some((b) =>
        (b.textContent || '').includes('Save Letterhead')
      ),
    }
  })
  check('A: Letterhead Header slot', slots.header)
  check('A: Letterhead Footer slot', slots.footer)
  check('A: Watermark slot', slots.watermark)
  check('A: opacity control', slots.opacity)
  check('A: on/off toggle', slots.toggle)
  check('A: Save button', slots.saveBtn)

  // upload the 3 PNGs through the real (sr-only) file inputs
  const fileInputs = await page.$$('input[type=file][accept=' + JSON.stringify('image/png') + ']')
  // the section has 3 PNG inputs (accept=image/png); other sections use png/jpeg
  const pngInputs = []
  for (const fi of fileInputs) {
    const aria = await fi.evaluate((el) => el.getAttribute('aria-label'))
    if (aria && /Upload (Letterhead Header|Letterhead Footer|Watermark)/.test(aria)) {
      pngInputs.push({ fi, aria })
    }
  }
  check('A: 3 hidden PNG inputs found', pngInputs.length === 3, `got ${pngInputs.length}`)
  for (const { fi, aria } of pngInputs) {
    const file =
      /Header/.test(aria) ? 'lh-header.png' : /Footer/.test(aria) ? 'lh-footer.png' : 'lh-watermark.png'
    await fi.uploadFile(path.join(ASSETS, file))
    await new Promise((r) => setTimeout(r, 400))
  }
  await new Promise((r) => setTimeout(r, 600))
  // previews show the images + sizes
  const previews = await page.evaluate(() => {
    const root = [...document.querySelectorAll('h2')]
      .find((h) => (h.textContent || '').includes('Company Letterhead — E-Invoice'))
      ?.closest('div')
    const sec = root?.parentElement ?? document
    const imgs = [...sec.querySelectorAll('img')]
    return {
      count: imgs.filter((i) => i.src.startsWith('data:image/png')).length,
      replaceBtns: [...sec.querySelectorAll('button')].filter((b) =>
        (b.textContent || '').includes('Replace')
      ).length,
      removeBtns: [...sec.querySelectorAll('button')].filter((b) =>
        (b.textContent || '').includes('Remove') || b.getAttribute('aria-label')?.startsWith('Remove')
      ).length,
      miniHeader: imgs.some((i) => i.alt === 'Header band preview'),
      miniFooter: imgs.some((i) => i.alt === 'Footer band preview'),
      miniWm: imgs.some((i) => i.alt === 'Watermark preview'),
    }
  })
  check('A: 3 slot previews show the PNGs', previews.count >= 3, JSON.stringify(previews))
  check('A: Replace buttons (3)', previews.replaceBtns === 3, `got ${previews.replaceBtns}`)
  check('A: Remove buttons (3)', previews.removeBtns >= 3, `got ${previews.removeBtns}`)
  check('A: mini A4 preview — header band', previews.miniHeader)
  check('A: mini A4 preview — footer band', previews.miniFooter)
  check('A: mini A4 preview — watermark', previews.miniWm)
  await shot('A2-uploaded-previews')

  // opacity slider shows 70
  const opacityShown = await page.evaluate(() => {
    const root = [...document.querySelectorAll('h2')]
      .find((h) => (h.textContent || '').includes('Company Letterhead — E-Invoice'))
      ?.closest('div')
    const sec = root?.parentElement ?? document
    return [...sec.querySelectorAll('span')].some((s) => (s.textContent || '').trim().startsWith('70%'))
  })
  check('A: opacity shows 70%', opacityShown)

  // save
  await page.evaluate(() => {
    const root = [...document.querySelectorAll('h2')]
      .find((h) => (h.textContent || '').includes('Company Letterhead — E-Invoice'))
      ?.closest('div')
    const sec = root?.parentElement ?? document
    const btn = [...sec.querySelectorAll('button')].find((b) =>
      (b.textContent || '').includes('Save Letterhead')
    )
    if (!btn) throw new Error('save button not found')
    btn.click()
  })
  await new Promise((r) => setTimeout(r, 1500))
  const saved = await page.evaluate(() => document.body.textContent.includes('E-Invoice letterhead saved'))
  check('A: save toast appeared', saved)
  await shot('A3-saved')

  // verify persistence via API
  {
    const res = await fetch(`${BASE}/api/e-invoice-letterhead`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const c = await res.json()
    check('A: API persisted header', (c.header || '').length > 1000)
    check('A: API persisted footer', (c.footer || '').length > 1000)
    check('A: API persisted watermark', (c.watermark || '').length > 1000)
    check('A: API persisted opacity 70', c.watermarkOpacity === 70)
  }

  // ───────────────────────────────────────────────────────── Phase B: dialog
  console.log('— Phase B: print dialog geometry —')
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, a')].find((b) =>
      (b.textContent || '').trim().startsWith('E-Invoice')
    )
    el.click()
  })
  await page.waitForSelector('table', { timeout: 60_000 })
  await new Promise((r) => setTimeout(r, 2000))
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Preview INV-2026-00005"]')
    if (!btn) throw new Error('preview button not found')
    btn.click()
  })
  await page.waitForFunction(
    () =>
      document.querySelector('.print-area .doc-page') !== null &&
      document.querySelector('[data-print-measure-rig]') === null,
    { timeout: 60_000, polling: 250 }
  )
  await new Promise((r) => setTimeout(r, 500))

  const geo = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.print-area .doc-page')]
    const out = { pageCount: pages.length, pages: [] }
    for (const p of pages) {
      const pr = p.getBoundingClientRect()
      // px → mm: the page is exactly 210 mm wide regardless of any preview zoom
      const pxPerMm = pr.width / 210
      const rel = (el) => {
        const r = el.getBoundingClientRect()
        return {
          left: (r.left - pr.left) / pxPerMm,
          top: (r.top - pr.top) / pxPerMm,
          right: (r.right - pr.left) / pxPerMm,
          bottom: (r.bottom - pr.top) / pxPerMm,
          w: r.width / pxPerMm,
          h: r.height / pxPerMm,
        }
      }
      const imgs = [...p.querySelectorAll('img[aria-hidden="true"]')]
      const allMm = imgs.map((i) => ({ i, m: rel(i) }))
      const header = allMm.find(({ m }) => Math.abs(m.top) < 1.5 && m.h > 40 && m.h < 50)
      const footer = allMm.find(({ m }) => Math.abs(m.bottom - 296.5) < 2 && m.h > 20 && m.h < 30)
      const wmEl = [...p.querySelectorAll('img')].find(
        (i) => i.style.width === '120mm' || i.style.width === '120mm '
      )
      const contentCol = [...p.querySelectorAll('div')].find(
        (d) => d.className.includes('z-10') && d.className.includes('inset-0')
      )
      const pageNo = [...p.querySelectorAll('p')].find((el2) =>
        /Page \d+ of \d+/.test(el2.textContent || '') && (el2.textContent || '').includes('صفحة')
      )
      const thead = p.querySelector('thead')
      const note = [...p.querySelectorAll('p')].find((el2) =>
        (el2.textContent || '').includes('Printed')
      )
      // content column: absolute inset-0 → its zone is the border box MINUS
      // its padding (the padding IS the 50/30/12/12 mm spec insets)
      const colZone = (el) => {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        const pl = parseFloat(cs.paddingLeft), pt = parseFloat(cs.paddingTop)
        const pr2 = parseFloat(cs.paddingRight), pb = parseFloat(cs.paddingBottom)
        const m = (v) => v / pxPerMm
        return {
          left: m(r.left - pr.left + pl),
          top: m(r.top - pr.top + pt),
          right: m(r.right - pr.left - pr2),
          bottom: m(r.bottom - pr.top - pb),
          padLeftMm: pl / pxPerMm,
          padTopMm: pt / pxPerMm,
          padBottomMm: pb / pxPerMm,
        }
      }
      out.pages.push({
        header: header ? header.m : null,
        footer: footer ? footer.m : null,
        watermark: wmEl
          ? { ...rel(wmEl), opacity: getComputedStyle(wmEl).opacity }
          : null,
        pageNo: pageNo
          ? { ...rel(pageNo), text: (pageNo.textContent || '').replace(/\s+/g, ' ').trim() }
          : null,
        content: contentCol ? colZone(contentCol) : null,
        theadText: thead ? (thead.textContent || '').slice(0, 60) : null,
        noteText: note ? (note.textContent || '').replace(/\s+/g, ' ').slice(0, 120) : null,
        wmZ: wmEl ? getComputedStyle(wmEl.parentElement).zIndex : null,
        contentZ: contentCol ? getComputedStyle(contentCol).zIndex : null,
      })
    }
    return out
  })
  console.log(`  pages: ${geo.pageCount}`)
  check('B: 3 pages (25 items)', geo.pageCount === 3, `got ${geo.pageCount}`)

  for (let i = 0; i < geo.pageCount; i++) {
    const g = geo.pages[i]
    const n = i + 1
    check(`B${n}: header band 0-45mm full width`, g.header && g.header.top < 1 && Math.abs(g.header.h - 45) < 1 && g.header.left < 1 && Math.abs(g.header.w - 210) < 1, JSON.stringify(g.header))
    check(`B${n}: footer band 25mm at bottom`, g.footer && Math.abs(g.footer.h - 25) < 1 && Math.abs(g.footer.bottom - 296.5) < 1.5 && g.footer.left < 1, JSON.stringify(g.footer))
    check(`B${n}: watermark 120mm wide, centered, opacity 0.7`, g.watermark && Math.abs(g.watermark.w - 120) < 2 && Math.abs(g.watermark.left + g.watermark.w / 2 - 105) < 2 && Math.abs(parseFloat(g.watermark.opacity) - 0.7) < 0.02, JSON.stringify(g.watermark))
    check(`B${n}: watermark vertical center in body area`, g.watermark && Math.abs(g.watermark.top + g.watermark.h / 2 - 158.25) < 4, `wm ${g.watermark ? `${g.watermark.top}-${g.watermark.bottom}` : 'missing'}`)
    check(`B${n}: page number above footer, bilingual`, g.pageNo && Math.abs(g.pageNo.bottom - 296.5 + 26) < 2 && /Page \d+ of \d+\/صفحة \d+ من \d+/.test(g.pageNo.text), JSON.stringify(g.pageNo))
    check(`B${n}: page number does not touch footer band`, g.pageNo && g.pageNo.bottom < 296.5 - 25 - 0.5, `pageNo.bottom=${g.pageNo?.bottom}`)
    check(`B${n}: content 12mm side pads`, g.content && Math.abs(g.content.left - 12) < 1 && Math.abs(210 - g.content.right - 12) < 1, JSON.stringify(g.content))
    check(`B${n}: content top at 50mm`, g.content && Math.abs(g.content.top - 50) < 1.5, `top=${g.content?.top}`)
    check(`B${n}: content bottom ≤ 267mm (30mm pad)`, g.content && g.content.bottom <= 267.5, `bottom=${g.content?.bottom}`)
    check(`B${n}: watermark z BELOW content`, g.wmZ && g.contentZ && parseInt(g.wmZ) < parseInt(g.contentZ), `wm=${g.wmZ} content=${g.contentZ}`)
    if (i > 0) check(`B${n}: thead repeated`, Boolean(g.theadText), JSON.stringify(g.theadText?.slice(0, 40)))
  }
  // page numbers per page correct text (DOM textContent has no spaces around "/")
  check('B1: page number text p1', /Page 1 of 3\/صفحة 1 من 3/.test(geo.pages[0].pageNo?.text || ''), geo.pages[0].pageNo?.text)
  check('B3: page number text p3', /Page 3 of 3\/صفحة 3 من 3/.test(geo.pages[2].pageNo?.text || ''), geo.pages[2].pageNo?.text)
  // note line no longer carries the page number (dedupe)
  check('B: note line has no Page segment', !(geo.pages[0].noteText || '').includes('Page'), geo.pages[0].noteText)

  // dialog screenshot (page 1 visible)
  await shot('B1-dialog-letterhead')
  // scroll to the last page + shot
  await page.evaluate(() => {
    const dlg = document.querySelector('[data-slot="dialog-content"]')
    const scroller = dlg?.querySelector('.overflow-auto')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await new Promise((r) => setTimeout(r, 500))
  await shot('B2-dialog-lastpage')

  // ─────────────────────────────────────────────────── Phase C: checkbox off
  console.log('— Phase C: "Print with letterhead" unchecked —')
  const before = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.print-area .doc-page')]
    const p = pages[0]
    const pr = p.getBoundingClientRect()
    const pxPerMm = pr.width / 210
    const col = [...p.querySelectorAll('div')].find((d) => d.className.includes('z-10') && d.className.includes('inset-0'))
    const r = col.getBoundingClientRect()
    return {
      contentLeft: (r.left - pr.left) / pxPerMm,
      contentTop: (r.top - pr.top) / pxPerMm,
      pageCount: pages.length,
      firstRowText: (p.querySelector('tbody tr')?.textContent || '').slice(0, 30),
    }
  })
  await page.click('label[title*="pre-printed"]')
  await new Promise((r) => setTimeout(r, 800))
  const after = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('.print-area .doc-page')]
    const p = pages[0]
    const pr = p.getBoundingClientRect()
    const pxPerMm = pr.width / 210
    const col = [...p.querySelectorAll('div')].find((d) => d.className.includes('z-10') && d.className.includes('inset-0'))
    const r = col.getBoundingClientRect()
    return {
      artworkImgs: [...p.querySelectorAll('img[aria-hidden="true"]')].length,
      wmImgs: [...p.querySelectorAll('img')].filter((i) => i.style.width === '120mm').length,
      pageNo: [...p.querySelectorAll('p')].some((el) =>
        /Page 1 of 3\/صفحة 1 من 3/.test((el.textContent || '').replace(/\s+/g, ' '))
      ),
      contentLeft: (r.left - pr.left) / pxPerMm,
      contentTop: (r.top - pr.top) / pxPerMm,
      pageCount: pages.length,
      firstRowText: (p.querySelector('tbody tr')?.textContent || '').slice(0, 30),
    }
  })
  check('C: checkbox present + clickable', true)
  check('C: header/footer artwork hidden', after.artworkImgs === 0, `got ${after.artworkImgs}`)
  check('C: watermark hidden', after.wmImgs === 0)
  check('C: page number line kept', after.pageNo)
  check('C: same margins (12mm sides)', Math.abs(after.contentLeft - before.contentLeft) < 0.5, `${before.contentLeft}→${after.contentLeft}`)
  check('C: same top pad (50mm)', Math.abs(after.contentTop - before.contentTop) < 0.5, `${before.contentTop}→${after.contentTop}`)
  check('C: same page count', after.pageCount === before.pageCount)
  check('C: same first row (layout identical)', after.firstRowText === before.firstRowText)
  await shot('C1-checkbox-off')

  // ───────────────────────────────────────────── Phase D: watermark toggle off
  console.log('— Phase D: watermark Settings toggle off —')
  await fetch(`${BASE}/api/e-invoice-letterhead`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ watermarkEnabled: false }),
  })
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
  await new Promise((r) => setTimeout(r, 2000))
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Preview INV-2026-00001"]')
    if (!btn) throw new Error('preview button not found')
    btn.click()
  })
  await page.waitForFunction(
    () =>
      document.querySelector('.print-area .doc-page') !== null &&
      document.querySelector('[data-print-measure-rig]') === null,
    { timeout: 60_000, polling: 250 }
  )
  await new Promise((r) => setTimeout(r, 500))
  const dState = await page.evaluate(() => {
    const p = document.querySelector('.print-area .doc-page')
    return {
      wm: [...p.querySelectorAll('img')].filter((i) => i.style.width === '120mm').length,
      header: [...p.querySelectorAll('img[aria-hidden="true"]')].length > 0,
      pageNo: [...p.querySelectorAll('p')].some((el) =>
        /Page 1 of \d+\/صفحة 1 من \d+/.test((el.textContent || '').replace(/\s+/g, ' '))
      ),
    }
  })
  check('D: watermark gone', dState.wm === 0)
  check('D: header/footer still active', dState.header)
  check('D: page number still there', dState.pageNo)
  await shot('D1-watermark-off')
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
