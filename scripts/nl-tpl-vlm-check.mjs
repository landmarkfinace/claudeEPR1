// VLM visual QA for the Name List template exports.
// Renders page 1 of each new-template PDF (plus Classic as control) and asks
// a vision model for concrete cut/overlap/joining checks.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
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

const BASE = (name) => `/home/z/my-project/download/Name-List-${name}.pdf`
const TMP = (n) => `/tmp/nl-vlm-${n}.png`

const targets = [
  { file: 'NL-2026-0001_Classic', png: 'classic-0001', tpl: 'Classic (control)' },
  { file: 'NL-2026-0001_Heritage', png: 'heritage-0001', tpl: 'Heritage' },
  { file: 'NL-2026-0001_Folder', png: 'folder-0001', tpl: 'Folder' },
  { file: 'NL-2026-0001_Sidebar', png: 'sidebar-0001', tpl: 'Sidebar' },
  { file: 'NL-2026-0002_Heritage', png: 'heritage-0002', tpl: 'Heritage (mobilization list)' },
  { file: 'NL-2026-0002_Folder', png: 'folder-0002', tpl: 'Folder (mobilization list)' },
  { file: 'NL-2026-0002_Sidebar', png: 'sidebar-0002', tpl: 'Sidebar (mobilization list)' },
]

for (const t of targets) {
  execFileSync('pdftoppm', ['-png', '-r', '100', '-f', '1', '-l', '1', BASE(t.file), `/tmp/nl-vlm-x-${t.png}`])
  // pdftoppm appends page suffix -1
  fs.renameSync(`/tmp/nl-vlm-x-${t.png}-1.png`, TMP(t.png))
}

const generic = (tpl) => `This is page 1 of a bilingual (English/Arabic) worker name list document printed on A4 with a company letterhead (header artwork band at top, footer artwork band at bottom). Template style: ${tpl}.

Answer these checks concretely (PASS/FAIL each, one short reason):
1. Does the body content stay clear of the header artwork band and the footer artwork band (no overlap)?
2. Is any text cut off, clipped, or overlapping anywhere?
3. Is the workers table complete: a header row with bilingual column titles, numbered rows (01, 02...), worker names, trade, and Iqama numbers all visible?
4. Is the Arabic text properly joined (connected letters) everywhere it appears?
5. Are the signature lines (two labelled signature blocks with Name/Date lines) visible above the footer?
Be terse.`

const perTpl = {
  'heritage-0001': `This is page 1 of a "Heritage" style bilingual worker name list: a navy title band with a geometric star pattern and cut corners at the top (with a gold hexagon holding the list number in the middle), a row of small info cells separated by small gold star marks (✦), then a workers table with a cream header row with gold rules, trade chips and a navy TOTAL box at the bottom.

Answer concretely (PASS/FAIL each, one short reason):
1. Is the navy title band rendered with its pattern, cut corners, white/gold title text, and the gold hexagon carrying the list number (NL-2026-0001)?
2. Are the ✦ separators visible between the info cells without touching any text?
3. Is the workers table complete and readable (numbered rows, names, trades, Iqama numbers, tick-box result column with Selected/Rejected/Absent)?
4. Any text cut off, clipped, or overlapping anywhere (check the Arabic lines too)?
5. Arabic properly joined everywhere?
Be terse.`,
  'folder-0001': `This is page 1 of a "Folder" style bilingual worker name list: a title row (NAME LIST + Arabic + a coloured subject pill), then boxed sections with dark folder tabs labelled "01 · DETAILS", "02 · WORKERS" (the workers table inside), and at the bottom "03 · SUMMARY" with a gold tab and "04 · SIGN-OFF".

Answer concretely (PASS/FAIL each, one short reason):
1. Are the folder tabs visible, sitting on the box borders, with their folded corner, not covering any text?
2. Does the 01 · DETAILS box show two rows of info cells (client, project, date, positions / location, contact, transport, subject) all readable?
3. Is the workers table inside 02 · WORKERS complete and readable (numbered rows, names, trades, Iqama, tick-box result column)?
4. Are 03 · SUMMARY (trade chips + navy TOTAL box) and 04 · SIGN-OFF (two signature blocks) present at the bottom?
5. Any text cut off, clipped, or overlapping anywhere (check Arabic too)?
6. Arabic properly joined everywhere?
Be terse.`,
  'sidebar-0001': `This is page 1 of a "Sidebar" style bilingual worker name list: a full-height cream sidebar on the left with a gold gradient edge, carrying a stacked "NAME LIST" title, a subject pill, the list number, info sections, and a navy TOTAL WORKERS box with per-trade counts at its bottom; the right main column has a headline row and the workers table.

Answer concretely (PASS/FAIL each, one short reason):
1. Does the sidebar run the full content height with its gold left edge, and stay clear of the header/footer artwork bands?
2. Is the navy TOTAL WORKERS box (with the big number and the per-trade rows) visible at the sidebar's bottom?
3. Is the workers table in the main column complete and readable (numbered rows, names, trades, Iqama numbers, tick-box result column with Selected/Rejected/Absent)?
4. Any text cut off, clipped, or overlapping anywhere (check the Arabic lines and the sidebar/main column boundary)?
5. Arabic properly joined everywhere?
Be terse.`,
  'heritage-0002': `This is page 1 of a "Heritage" style bilingual MOBILIZATION name list (navy star band + gold hexagon list number). Mobilization lists use different columns: Iqama No., Passport No., Nationality, Trade, Blood Group (a small light-red capsule), Remarks.

Answer concretely (PASS/FAIL each, one short reason):
1. Is the blood group column shown with light-red capsule styling (not plain text)?
2. Are the passport numbers shown (mono/digit font) and readable?
3. Is the "Received by · Client / Site" signature block present (mobilization lists use Received by, not Interviewed by)?
4. Any text cut off, clipped, or overlapping anywhere (check Arabic too)?
5. Arabic properly joined everywhere?
Be terse.`,
  'folder-0002': `This is page 1 of a "Folder" style bilingual MOBILIZATION name list (tabbed sections 01 · DETAILS / 02 · WORKERS / 03 · SUMMARY gold / 04 · SIGN-OFF). Mobilization lists use different columns: Iqama No., Passport No., Nationality, Trade, Blood Group (light-red capsule), Remarks; and the details box shows a Reference (interview list + PO number).

Answer concretely (PASS/FAIL each, one short reason):
1. Does the details box show the Reference (interview list number and/or PO number) instead of interview positions?
2. Is the blood group column shown with light-red capsule styling?
3. Is the "RECEIVED BY · CLIENT / SITE" signature block present in 04 · SIGN-OFF?
4. Any text cut off, clipped, or overlapping anywhere (check Arabic too)?
5. Arabic properly joined everywhere?
Be terse.`,
  'sidebar-0002': `This is page 1 of a "Sidebar" style bilingual MOBILIZATION name list (full-height cream sidebar + navy TOTAL WORKERS box). Mobilization lists use different columns: Iqama, Passport, Nationality, Trade, Blood Group (light-red capsule), Remarks; the sidebar shows a REFERENCE section.

Answer concretely (PASS/FAIL each, one short reason):
1. Does the sidebar show a REFERENCE section (with the interview list number / PO number)?
2. Is the blood group column shown with light-red capsule styling?
3. Is the "RECEIVED BY · CLIENT / SITE" signature block present in the main column's bottom?
4. Any text cut off, clipped, or overlapping anywhere (check Arabic too)?
5. Arabic properly joined everywhere?
Be terse.`,
}

const failures = []
for (const t of targets) {
  const q = perTpl[t.png] ?? generic(t.tpl)
  const a = await ask(TMP(t.png), q)
  console.log(`\n=== ${t.tpl} — ${t.file} (page 1) ===`)
  console.log(a)
  if (/FAIL/i.test(a)) failures.push(`${t.tpl} (${t.file}): ${a.split('\n').filter((l) => /FAIL/i.test(l)).join(' | ')}`)
}

console.log('\n──────── SUMMARY ────────')
if (failures.length === 0) {
  console.log('✓ VLM visual QA: all template renders clean (no FAIL lines)')
} else {
  console.log(`✗ ${failures.length} renders with FAIL lines:`)
  for (const f of failures) console.log('  -', f)
}
if (failures.length > 0) process.exit(1)
