// One-off VLM QA: compare the reference template render (top row) with the
// ERP server PDF render (bottom row). Left column = page 1, right = page 2.
// Asks the vision model to describe any visual differences.
import fs from 'node:fs'
import ZAI from 'z-ai-web-dev-sdk'

const b64 = fs.readFileSync('/tmp/agreement-side-by-side.png').toString('base64')
const zai = await ZAI.create()

const res = await zai.chat.completions.createVision({
  model: 'glm-4.5v',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${b64}` },
        },
        {
          type: 'text',
          text: `This image shows TWO renders of the same bilingual (English left column / Arabic right column) agreement document, laid out as a 2x2 grid:
- TOP row = the REFERENCE render (the original HTML template printed by a browser).
- BOTTOM row = the ERP system's server-generated PDF of the same document.
- LEFT column = page 1, RIGHT column = page 2.

Compare the bottom row against the top row carefully and answer:
1. Is the overall layout the same (same section order, same column split, same page breaks)?
2. List EVERY visible difference in text positioning, line wrapping, spacing, fonts, or content — be specific about which text/section differs and on which page.
3. Is the Arabic text properly connected (joined letters) and right-to-left in the bottom row?
4. Any missing or extra content in the bottom row?
Be concrete and terse.`,
        },
      ],
    },
  ],
  thinking: { type: 'disabled' },
})

console.log(res.choices[0]?.message?.content ?? '(no reply)')
