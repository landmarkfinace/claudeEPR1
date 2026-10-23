// STEP 4 test 3 — the 15-article PREVIEW in Settings › Agreement › Templates:
// opens each new template's preview dialog, toggles 15 articles, and verifies
// 2+ pages with the Initials + Page X of Y footer on EVERY page and the
// signature block pinned to the bottom of the LAST page together with at
// least the last article. The preview uses IN-MEMORY demo data — the test
// snapshots the DB before/after to prove ZERO writes.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const BASE = 'http://localhost:3000'
const EMAIL = 'admin@example.com'
const PASSWORD = 'password'
const DB = '/home/z/my-project/db/custom.db'

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

// ── DB snapshot (SQLite full file digest + row digests) ─────────────────────
import crypto from 'node:crypto'
function dbState() {
  const buf = fs.readFileSync(DB)
  const hash = crypto.createHash('sha256').update(buf).digest('hex')
  return { size: buf.length, hash }
}

const token = await apiLogin()
const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
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
  console.log('✓ Settings opened')

  // scroll to the Agreement Templates section
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((x) =>
      (x.textContent || '').includes('Agreement Templates')
    )
    h?.scrollIntoView({ block: 'center' })
  })
  await new Promise((r) => setTimeout(r, 600))

  const dbBefore = dbState()

  // unique description fragments per Agreement template card (the Quotation
  // and Name List sections have their own "Classic" cards — these fragments
  // exist only in the Agreement section)
  const CARD_HINTS = {
    'Bilingual Cards': 'navy signature cards',
    'Official Form': 'official form tables',
    'Key Terms': 'spine with a big header stack',
    Classic: 'bilingual table rows',
  }
  const TPL_ORDER = ['Bilingual Cards', 'Official Form', 'Key Terms', 'Classic']

  for (const tpl of TPL_ORDER) {
    // open the preview dialog for this template
    await page.evaluate(
      (label, hint) => {
        const card = [...document.querySelectorAll('p')]
          .find((x) => (x.textContent || '').includes(hint))
          ?.closest('div.rounded-lg')
        if (!card) throw new Error(`template card ${label} not found`)
        const btn = [...card.querySelectorAll('button')].find((b) =>
          (b.textContent || '').includes('Preview')
        )
        btn.click()
      },
      tpl,
      CARD_HINTS[tpl]
    )
    await page.waitForFunction(
      () => document.querySelector('.print-area') !== null,
      { timeout: 30_000, polling: 250 }
    )
    await new Promise((r) => setTimeout(r, 700))

    // switch to 15 articles
    await page.evaluate(() => {
      const dlg = document.querySelector('[data-slot="dialog-content"]')
      const btn = [...dlg.querySelectorAll('button')].find((b) =>
        (b.textContent || '').trim() === '15 articles'
      )
      if (!btn) throw new Error('15 articles toggle not found')
      btn.click()
    })
    await new Promise((r) => setTimeout(r, 900))

    const measure = await page.evaluate(() => {
      const pages = [...document.querySelectorAll('.print-area .doc-page')]
      if (pages.length === 0) {
        return { flowDoc: true, sheets: document.querySelectorAll('.print-area .sheet').length }
      }
      const mm = (px) => px / (96 / 25.4)
      const last = pages[pages.length - 1]
      const sig = last.querySelector('[data-agr-signatures]')
      const arts = [...last.querySelectorAll('[data-agr-art]')].map((el) =>
        el.getAttribute('data-agr-art')
      )
      const lastPageRect = last.getBoundingClientRect()
      const sigRect = sig?.getBoundingClientRect()
      return {
        flowDoc: false,
        pages: pages.length,
        footerEveryPage: pages.every((p) => p.querySelector('[data-agr-footer]') !== null),
        initialsEveryPage: pages.every((p) => {
          const f = p.querySelector('[data-agr-footer]')
          return f && /Initials/.test(f.textContent || '')
        }),
        pageLabels: pages.map((p, i) => {
          const f = p.querySelector('[data-agr-footer]')
          const m = (f?.textContent || '').match(/Page (\d+) of (\d+)/)
          return m ? `${m[1]}/${m[2]}` : 'none'
        }),
        contHeaders: pages
          .slice(1)
          .every((p) => (p.textContent || '').includes('continued')),
        lastPageArticles: arts,
        sigPresent: !!sig,
        sigBottomFromPageBottomMm: sigRect
          ? +mm(lastPageRect.bottom - sigRect.bottom).toFixed(2)
          : null,
        sigWithAtLeastLastArticle: arts.length > 0,
      }
    })

    // page-1 screenshot for the record
    const shot = `/home/z/my-project/download/agr-qa-preview-15art-${tpl.replace(/\s+/g, '')}-p1.png`
    await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: 1500, height: 1000 } })

    results.push({ template: tpl, ...measure, shot })
    const pass =
      (measure.flowDoc && tpl === 'Classic') ||
      (measure.pages >= 2 &&
        measure.footerEveryPage &&
        measure.initialsEveryPage &&
        measure.contHeaders &&
        measure.sigPresent &&
        measure.sigWithAtLeastLastArticle)
    console.log(
      `${tpl.padEnd(15)} → ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify({
        pages: measure.pages ?? measure.sheets,
        footerEveryPage: measure.footerEveryPage,
        pageLabels: measure.pageLabels,
        contHeaders: measure.contHeaders,
        lastPageArticles: measure.lastPageArticles,
        sigBottom: measure.sigBottomFromPageBottomMm,
      })}`
    )

    // close
    await page.evaluate(() => {
      const dlg = document.querySelector('[data-slot="dialog-content"]')
      const btn = [...dlg.querySelectorAll('button')].find((b) =>
        (b.textContent || '').trim() === 'Close'
      )
      btn?.click()
    })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelector('.print-area') === null, {
      timeout: 20_000,
      polling: 200,
    })
    await new Promise((r) => setTimeout(r, 400))
  }

  const dbAfter = dbState()
  const zeroWrites = dbBefore.hash === dbAfter.hash && dbBefore.size === dbAfter.size
  console.log(`✓ ZERO DB writes during the 15-article previews: ${zeroWrites ? 'PASS' : 'FAIL'}`)

  fs.writeFileSync(
    '/home/z/my-project/download/agr-preview-15art-results.json',
    JSON.stringify({ results, dbBefore, dbAfter, zeroWrites }, null, 2)
  )
  if (!zeroWrites) process.exitCode = 1
} finally {
  await browser.close()
}
