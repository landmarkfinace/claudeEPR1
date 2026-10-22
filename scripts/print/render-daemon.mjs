// Print render daemon — server-side VECTOR PDF generation for the ERP.
//
// A long-lived Node process that keeps one headless Chromium (puppeteer-core,
// resolved from the browsers already installed in this environment) and
// renders print documents with `page.pdf()`. Text stays REAL, selectable and
// sharply scalable vector text; Arabic shaping runs through Chromium's full
// text stack (correct joining + RTL); letterhead/signature/stamp images are
// embedded at their original uploaded resolution — never resampled.
//
// Endpoints (loopback only):
//   GET  /health               → { ok, chrome, pid }
//   GET  /doc/:token           → stored print HTML (render origin)
//   GET  /_next/static/*       → compiled assets (CSS + webfonts) served from
//                                the standalone (prod) or source (dev) build
//   GET  /_next/css/print.css  → every compiled stylesheet concatenated
//   POST /pdf                  → { html, orientation, pageMode } → PDF bytes
//
// pageMode:
//   'sheets' — the fragment is a stack of fixed A4 `.doc-page` sheets
//              (quotation, e-invoice, P.O.s, …): exact-bleed PDF pages with
//              `@page { size: A4 <orientation>; margin: 0 }` and one
//              page-break after every sheet.
//   'flow'   — a flowing document (reports, salary sheet, …): the app's own
//              print stylesheet decides margins/orientation (named landscape
//              pages, 8–10mm paper margins) exactly like window.print().
//
// Start: node scripts/print/render-daemon.mjs   (or via /api/print-pdf which
// spawns it on demand). Logs to <repo>/print-daemon.log.

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import puppeteer from 'puppeteer-core'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const PORT = Number(process.env.PRINT_DAEMON_PORT || 3901)
const APP_ORIGIN = (process.env.PRINT_APP_ORIGIN || 'http://127.0.0.1:3000').replace(/\/$/, '')
const SELF_ORIGIN = `http://127.0.0.1:${PORT}`
const LOG = path.join(REPO, 'print-daemon.log')

function log(line) {
  try {
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`)
  } catch {}
}

// ── static asset roots ─────────────────────────────────────────────────────
// prod standalone → Turbopack DEV build (.next/dev/static, created by
// `next dev` — CSS lives in .next/dev/static/chunks, fonts in ../media) →
// source prod build (.next/static).
function resolveStaticDir() {
  for (const candidate of [
    path.join(REPO, '.next', 'standalone', '.next', 'static'),
    path.join(REPO, '.next', 'dev', 'static'),
    path.join(REPO, '.next', 'static'),
  ]) {
    // compiled CSS lives under static/css (webpack) or static/chunks (Turbopack)
    if (fs.existsSync(path.join(candidate, 'css')) || fs.existsSync(path.join(candidate, 'chunks'))) {
      return candidate
    }
  }
  return null
}
const STATIC_DIR = resolveStaticDir()

// ── Chromium executable: explicit env, then the browsers cached on this host
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
          else if (pattern.test(full) && fs.existsSync(full)) found.push(full)
        }
      }
      walk(dir, 0)
      if (found.length > 0) {
        found.sort()
        return found[found.length - 1] // newest revision
      }
    } catch {}
  }
  for (const flat of [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ]) {
    if (fs.existsSync(flat)) return flat
  }
  return null
}

// ── browser lifecycle ──────────────────────────────────────────────────────
let browser = null
let launching = null

async function getBrowser() {
  if (browser && browser.connected) return browser
  if (launching) return launching
  launching = (async () => {
    const exe = resolveChrome()
    if (!exe) throw new Error('No Chromium executable found (set PRINT_CHROME)')
    log(`launching chrome: ${exe}`)
    const b = await puppeteer.launch({
      executablePath: exe,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none',
        '--lang=en-US',
      ],
    })
    b.once('disconnected', () => {
      log('browser disconnected')
      browser = null
    })
    browser = b
    return b
  })()
  try {
    return await launching
  } finally {
    launching = null
  }
}

// ── print HTML preparation ─────────────────────────────────────────────────
const MAX_HTML = 20 * 1024 * 1024

/**
 * Rewrite root-relative URLs so the fragment loads correctly from the
 * daemon origin: `/_next/*` assets are served by this daemon; everything
 * else (`/logo-mark.png`, `/uploads/...`) points at the running ERP app.
 * data: URLs (letterhead, signatures, QR codes) pass through untouched.
 */
function rewriteRootUrls(html) {
  let out = html
    .replace(/(src|href)=(["'])\/(?!\/)/g, (m, attr, q) => `${attr}=${q}${SELF_ORIGIN}/`)
    .replace(/url\((["']?)\/(?!\/)/g, (m, q) => `url(${q}${SELF_ORIGIN}/`)
    .replace(/(src|href)=(["'])\.\//g, (m, attr, q) => `${attr}=${q}${SELF_ORIGIN}/`)
  if (APP_ORIGIN !== SELF_ORIGIN) {
    out = out
      .replace(new RegExp(`(src|href)=(["'])${SELF_ORIGIN.replace(/[/\\]/g, '\\$&')}/(?!_next/)`, 'g'), (m, attr, q) => `${attr}=${q}${APP_ORIGIN}/`)
      .replace(new RegExp(`url\\((["']?)${SELF_ORIGIN.replace(/[/\\]/g, '\\$&')}/(?!_next/)`, 'g'), (m, q) => `url(${q}${APP_ORIGIN}/`)
  }
  return out
}

/** Defensive: strip scripts — serialized print DOM should never carry any. */
function stripScripts(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
}

function buildDocument(fragment, orientation, pageMode) {
  const extra =
    pageMode === 'sheets'
      ? `@page { size: A4 ${orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 0; }
.doc-page { break-after: page; }
.doc-page:last-child { break-after: auto; }
.doc-page { print-color-adjust: exact; -webkit-print-color-adjust: exact; }`
      : orientation === 'landscape'
        ? `@media print { @page { size: A4 landscape; margin: 8mm; } }`
        : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>print</title>
<link rel="stylesheet" href="/_next/css/print.css">
${extra ? `<style>${extra}</style>` : ''}
</head>
<body style="margin:0;background:#fff;">
${fragment}
</body>
</html>`
}

// ── render queue (sequential — print jobs are rare; avoids CPU stampede) ──
let queue = Promise.resolve()
function enqueue(job) {
  const run = queue.then(job, job)
  queue = run.catch(() => {})
  return run
}

// ── stored documents ───────────────────────────────────────────────────────
const docs = new Map() // token → full document html
function rememberDoc(token, html) {
  docs.set(token, html)
  if (docs.size > 30) {
    const first = docs.keys().next().value
    docs.delete(first)
  }
}

// ── HTTP server ────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, SELF_ORIGIN)

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, chrome: browser?.connected === true, pid: process.pid }))
    return
  }

  if (url.pathname === '/_next/css/print.css') {
    if (!STATIC_DIR) {
      res.writeHead(500).end('no static dir')
      return
    }
    try {
      // Turbopack emits CSS under chunks/, webpack under css/ — take both.
      const dirs = ['css', 'chunks']
        .map((d) => path.join(STATIC_DIR, d))
        .filter((d) => fs.existsSync(d))
      let css = ''
      for (const dir of dirs) {
        for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.css')).sort()) {
          css += fs.readFileSync(path.join(dir, f), 'utf8') + '\n'
        }
      }
      // The compiled @font-face rules use url(../media/…) (Turbopack dev
      // emits them QUOTED: url("../media/…")) relative to the css/chunks
      // dir — rewrite to this daemon's absolute static path so the webfonts
      // (Inter + Cairo subsets) actually load in the render page.
      css = css.replace(/url\((["']?)\.\.\/media\//g, 'url($1/_next/static/media/')
      css = css.replace(/url\((["']?)\.\.\/chunks\//g, 'url($1/_next/static/chunks/')
      // next/font defines --font-inter / --font-cairo on generated
      // `.__variable_*` classes applied to the app <body>. A serialized print
      // fragment doesn't carry them — hoist every --font-* custom property
      // onto :root so font-family:var(--font-…) chains resolve in the render.
      {
        const fontVars = new Set()
        for (const m of css.matchAll(/\.[^{]{0,120}__variable\s*\{([^}]+)\}/g)) {
          for (const decl of m[1].split(';')) {
            const t = decl.trim()
            if (t.startsWith('--font-')) fontVars.add(t)
          }
        }
        if (fontVars.size > 0) {
          css = `:root{${[...fontVars].join(';')}}\n` + css
        }
      }
      res.writeHead(200, { 'content-type': 'text/css; charset=utf-8' })
      res.end(css)
    } catch (e) {
      res.writeHead(500).end(String(e))
    }
    return
  }

  if (url.pathname.startsWith('/_next/static/')) {
    if (!STATIC_DIR) {
      res.writeHead(500).end('no static dir')
      return
    }
    const rel = path
      .normalize(url.pathname.slice('/_next/static/'.length))
      .replace(/^(\.\.[/\\])+/, '')
    const file = path.join(STATIC_DIR, rel)
    if (!file.startsWith(STATIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    const ext = path.extname(file).toLowerCase()
    const mime =
      ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.woff2' ? 'font/woff2'
      : ext === '.woff' ? 'font/woff'
      : ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.svg' ? 'image/svg+xml'
      : ext === '.js' ? 'text/javascript'
      : 'application/octet-stream'
    try {
      const buf = fs.readFileSync(file)
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=3600' })
      res.end(buf)
    } catch (e) {
      res.writeHead(500).end(String(e))
    }
    return
  }

  const docMatch = url.pathname.match(/^\/doc\/([0-9a-f-]{36})$/)
  if (docMatch && req.method === 'GET') {
    const html = docs.get(docMatch[1])
    if (!html) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
    return
  }

  if (url.pathname === '/pdf' && req.method === 'POST') {
    const chunks = []
    let size = 0
    let aborted = false
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_HTML + 1024) {
        aborted = true
        res.writeHead(413).end('payload too large')
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (aborted) return
      enqueue(async () => {
        try {
          const { html, orientation = 'portrait', pageMode = 'sheets' } = JSON.parse(
            Buffer.concat(chunks).toString('utf8')
          )
          if (typeof html !== 'string' || html.length === 0) throw new Error('missing html')

          let fragment = rewriteRootUrls(String(html))
          fragment = stripScripts(fragment)
          const token = randomUUID()
          rememberDoc(token, buildDocument(fragment, orientation, pageMode))

          const b = await getBrowser()
          const page = await b.newPage()
          page.on('requestfailed', (r) => {
            log(`request failed: ${r.url().slice(0, 120)} — ${r.failure()?.errorText}`)
          })
          try {
            await page.goto(`${SELF_ORIGIN}/doc/${token}`, {
              waitUntil: 'networkidle0',
              timeout: 30000,
            })
            await page.evaluate(() => document.fonts.ready)
            const fontInfo = await page.evaluate(() => ({
              status: document.fonts.status,
              loaded: [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`).slice(0, 12),
            }))
            log(`fonts: ${fontInfo.status}; ${fontInfo.loaded.join(' | ').slice(0, 400)}`)
            await page.evaluate(
              () =>
                new Promise((resolve) => {
                  if (document.readyState === 'complete') return resolve()
                  window.addEventListener('load', resolve, { once: true })
                  setTimeout(resolve, 3000) // safety
                })
            )
            const pdf = await page.pdf({
              format: 'A4',
              printBackground: true,
              margin: { top: 0, right: 0, bottom: 0, left: 0 },
              scale: 1,
              preferCSSPageSize: true,
            })
            res.writeHead(200, {
              'content-type': 'application/pdf',
              'cache-control': 'no-store',
            })
            res.end(pdf)
          } finally {
            await page.close().catch(() => {})
            docs.delete(token)
          }
        } catch (e) {
          log(`render error: ${e?.stack || e}`)
          if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: String(e?.message || e) }))
        }
      })
    })
    return
  }

  res.writeHead(404).end()
})

server.listen(PORT, '127.0.0.1', () => {
  log(`print render daemon on ${SELF_ORIGIN} (static: ${STATIC_DIR})`)
  console.log(`print render daemon on ${SELF_ORIGIN} (static: ${STATIC_DIR})`)
})

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log(`daemon ${sig}`)
    server.close()
    if (browser) browser.close().catch(() => {})
    process.exit(0)
  })
}
