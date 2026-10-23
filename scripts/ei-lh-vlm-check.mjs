// VLM visual QA for the E-Invoice letterhead exports.
import fs from 'node:fs'
import ZAI from 'z-ai-web-dev-sdk'

const zai = await ZAI.create()

async function ask(imagePath, text) {
  const b64 = fs.readFileSync(imagePath).toString('base64')
  const res = await zai.chat.completions.createVision({
    model: 'glm-4.5v',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          { type: 'text', text },
        ],
      },
    ],
    thinking: { type: 'disabled' },
  })
  return res.choices[0]?.message?.content ?? '(no reply)'
}

const q1 = `This image shows ONE bilingual (English/Arabic) tax invoice document as a 2x2 grid:
- TOP row = printed WITH the company letterhead (header artwork band at the top, footer artwork band at the bottom, plus a watermark behind the body text).
- BOTTOM row = the same invoice printed with "Print with letterhead" UNCHECKED (artwork hidden for pre-printed paper — the layout/margins must stay identical).
- LEFT column = page 1, RIGHT column = page 2.

Answer these checks concretely (PASS/FAIL each, one line reason):
1. Top row: does the header artwork appear at the very top of BOTH pages, spanning the full page width, with no gap above it?
2. Top row: does the footer artwork appear at the very bottom of BOTH pages?
3. Top row: is there a watermark (light gray diamond + LANDMARK wordmark) centered BEHIND the body text on both pages, and is the text still clearly readable over it?
4. Top row: is there a page number line ("Page X of Y / Arabic") just above the footer artwork band on both pages?
5. Bottom row: is ALL artwork (header/footer/watermark) gone, with the invoice content in exactly the same positions as the top row (same line positions, same table rows)?
6. Any text cut off, overlapping, or clipped anywhere in either row?
7. Is the Arabic text properly joined (connected letters) everywhere?
Be terse.`

const a1 = await ask('/tmp/ei-lh-side-by-side.png', q1)
console.log('=== QA 1: letterhead on/off (INV-2026-00004, 2 pages) ===')
console.log(a1)

const q2 = `This is page 1 of a 3-page bilingual tax invoice printed with the company letterhead: a 45mm header artwork band at the top, a 25mm footer artwork band at the bottom, and a light-gray watermark (diamond + LANDMARK wordmark) behind the body.

Answer concretely (PASS/FAIL each, one line reason):
1. Is the watermark positioned BEHIND the items table so the table text is fully readable?
2. Does the invoice body (title, boxes, items table) stay clear of the header band (no overlap) and of the footer band?
3. Is the table's column heading row (dark navy with white text) present above the item rows?
4. Is there a page number line just above the footer artwork, bilingual English + Arabic?
5. Any clipped or overlapping content?
Be terse.`

const a2 = await ask('/tmp/ei-lh-p1-25items.png', q2)
console.log('\n=== QA 2: 25-item invoice page 1 (watermark behind text) ===')
console.log(a2)
