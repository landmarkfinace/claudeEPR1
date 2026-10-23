#!/usr/bin/env node
// Pay slip PDF export via the REAL pipeline: the browser serializes the
// active .print-area DOM (exactly what downloadPrintAreaAsPdf does), and we
// POST it to /api/print-pdf with the same payload the app sends.
// Usage: node scripts/testing/payslip-pdf.mjs <output.pdf> [mode]
//   The HTML is read from stdin (the .print-area outerHTML), mode = sheets|flow.
import fs from 'node:fs'

const [out, modeArg] = process.argv.slice(2)
if (!out) {
  console.error('usage: node payslip-pdf.mjs <output.pdf> [sheets|flow] < dom.html')
  process.exit(1)
}
const html = fs.readFileSync(0, 'utf8')
const pageMode = modeArg === 'flow' ? 'flow' : 'sheets'

const res = await fetch('http://localhost:3000/api/print-pdf', {
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie: process.env.LIG_COOKIE ?? '' },
  body: JSON.stringify({ html, orientation: 'portrait', pageMode }),
})
if (!res.ok) {
  console.error('print-pdf failed:', res.status, (await res.text()).slice(0, 300))
  process.exit(1)
}
const buf = Buffer.from(await res.arrayBuffer())
fs.writeFileSync(out, buf)
console.log(`${out}: ${res.status}, ${buf.length} bytes`)
