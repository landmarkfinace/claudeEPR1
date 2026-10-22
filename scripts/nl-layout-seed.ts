// Layout-test data seeder for the Name List signature-pinning rework.
//
// Creates the boss's two pagination test lists through the REAL API
// (numbering, workers, positions and columns snapshot all produced by the
// actual server logic), then marks them sent:
//
//   • NL-2026-0003 — Trade Test & Interview, 5 workers  (expected: 1 page,
//     signature cards bottom-pinned 3mm above the footer note)
//   • NL-2026-0004 — Trade Test & Interview, 25 workers (expected: 2 pages,
//     page 1 table only; page 2 remaining rows + trade summary + cards)
//
// Interview rows print tick-box results (result = null) — the realistic
// "client ticks by hand" look and the taller row height.
//
// Run: bun run scripts/nl-layout-seed.ts
import { db } from '../src/lib/db'

const BASE = 'http://localhost:3000'
const EMAIL = 'admin@example.com'
const PASSWORD = 'password'

const MARKER = 'NL-LAYOUT-TEST'

let token = ''

async function api<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  let json: T
  try {
    json = (await res.json()) as T
  } catch {
    json = {} as T
  }
  return { status: res.status, json }
}

// ── fixed ids from the demo dataset ─────────────────────────────────────────
const SUBJECT_INTERVIEW = 'cmvjzusc9004zso6bcv6ogfd0' // Trade Test & Interview
const PROJECT_SABIC = 'cmvjtltwd000lso0pifrpndcb' // SABIC Gas Plant Piping Works
// clients are resolved from the DB by name (see main)

// 5-worker batch — pipe fitters + welders + one rigger
const FIVE = [
  'cmvjtltx1001qso0p4php7ccg', // Dilip Kumar — PIPE FITTER
  'cmvjtltww001iso0p2jqiyb8n', // Mohammed Ashraf — PIPE FITTER
  'cmvjtltx2001sso0pvelryyy9', // Nasir Mehmood — PIPING WELDER
  'cmvjtltx5001wso0ppj01w8be', // Shahid Mahmood — PIPING WELDER
  'cmvjtltxd0026so0p2cybggch', // Zahid Akram — RIGGER
]

// 25-worker batch — realistic multi-trade trade-test day
const TWENTY_FIVE = [
  // PIPING QCI (3)
  'cmvjtltwo0018so0pf3tjba44', // Muhammad Rafiq
  'cmvjtltwq001aso0pslk7whdw', // Abdul Kareem
  'cmvjtltwr001cso0pjfqljyd3', // Suresh Kumar
  // PIPING QCS (2)
  'cmvjtltws001eso0peqam8mcd', // Rajesh Nair
  'cmvjtltwu001gso0pheoc5jxm', // Anil Menon
  // PIPE FITTER (6)
  'cmvjtltx0001oso0pco226k2o', // Ravi Prasad
  'cmvjtltwx001kso0p7gilo79d', // Imran Sheikh
  'cmvjtltwy001mso0p4bjpz583', // Joseph Santos
  'cmvjtltya003aso0p87dvfa7p', // Mehrab Jan
  'cmvjtltx1001qso0p4php7ccg', // Dilip Kumar
  'cmvjtltww001iso0p2jqiyb8n', // Mohammed Ashraf
  // PIPING WELDER (4)
  'cmvjtltx4001uso0pfvlztyf6', // Ajay Verma
  'cmvjtltx2001sso0pvelryyy9', // Nasir Mehmood
  'cmvjtltx8001yso0pe2z3eovy', // Ramesh Chandra
  'cmvjtltx5001wso0ppj01w8be', // Shahid Mahmood
  // WELDING QCS (2)
  'cmvjtltx90020so0pudauvvqi', // Rustam Ali
  'cmvjtltxa0022so0pptksdstr', // Ganesh Iyer
  // RIGGER (4)
  'cmvjtltxc0024so0pqj9fljn6', // Babar Hussain
  'cmvjtltxd0026so0p2cybggch', // Zahid Akram
  'cmvjtltxe0028so0pi96a8u8b', // Sanjay Patel
  'cmvjtltyb003cso0prm575rlk', // Sunil Shrestha
  // LINE CHECKER (2)
  'cmvjtltxo002kso0p0c14yxar', // Niraj Thapa
  'cmvjtltxp002mso0p5vjjnori', // Deepak Gurung
  // HELPER (2)
  'cmvjtltxg002aso0pl9qgxl9n', // Mohsin Raza
  'cmvjtltxi002cso0pal6sj5ig', // Alamin Hossain
]

const COLUMNS_SNAPSHOT = {
  trade: true,
  experience: true,
  nationality: true,
  iqama: true,
  mobile: true,
  result: true,
  remarks: true,
}

async function createList(payload: Record<string, unknown>) {
  const res = await api<{ id?: string; listNo?: string }>('POST', '/api/name-lists', payload)
  if (res.status !== 201 || !res.json.id || !res.json.listNo) {
    throw new Error(`create list failed (${res.status}): ${JSON.stringify(res.json).slice(0, 300)}`)
  }
  return res.json as { id: string; listNo: string }
}

async function main() {
  // guard — idempotent re-runs
  const existing = await db.nameList.findFirst({ where: { notes: { contains: MARKER } } })
  if (existing) {
    console.log(`Layout-test lists already exist (e.g. ${existing.listNo}) — skipping.`)
    return
  }

  // resolve the demo client ids from the DB (never hardcode blindly)
  const epis = await db.client.findFirst({ where: { name: { contains: 'Eastern Province' } } })
  const gcc = await db.client.findFirst({ where: { name: { contains: 'Gulf Crescent' } } })
  if (!epis || !gcc) throw new Error('demo clients not found')

  // 0 ─ login
  const login = await api<{ token?: string }>('POST', '/api/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  })
  if (login.status !== 200 || !login.json.token) throw new Error('login failed')
  token = login.json.token as string
  console.log('✓ logged in')

  // 1 ─ the 5-worker list (expected 1 page)
  const five = await createList({
    date: '2026-10-28',
    time: '09:00',
    clientId: epis.id,
    projectId: PROJECT_SABIC,
    subjectId: SUBJECT_INTERVIEW,
    location: 'Landmark Inter Gulf Training Yard — Jubail Industrial City',
    positions: ['Pipe Fitter', 'Piping Welder', 'Rigger'],
    clientContact: 'Nasser Al-Dosari',
    clientPhone: '+966 13 812 4460',
    transport: 'Company bus — Jubail Bus Station 07:30',
    refPoNo: 'LIG-EPIS-2026-014',
    notes: `${MARKER}: Trade test duration 2 hours per batch. Candidates must bring original Iqama and trade certificates.`,
    columns: COLUMNS_SNAPSHOT,
    workers: FIVE,
  })
  console.log(`✓ ${five.listNo} — Trade Test & Interview · 5 workers · EPIS`)

  // 2 ─ the 25-worker list (expected 2 pages)
  const big = await createList({
    date: '2026-11-02',
    time: '08:00',
    clientId: gcc.id,
    projectId: PROJECT_SABIC,
    subjectId: SUBJECT_INTERVIEW,
    location: 'SABIC Gas Plant — Gate 3 Trade Test Yard',
    positions: ['Pipe Fitter', 'Piping Welder', 'Rigger', 'Helper', 'Line Checker'],
    clientContact: 'Bandar Al-Suwailem',
    clientPhone: '+966 13 812 4460',
    transport: 'Two buses — camp departure 06:30',
    refPoNo: 'PO-GCC-88231',
    notes: `${MARKER}: Welders to bring 6G coupons. Safety shoes mandatory inside the yard.`,
    columns: COLUMNS_SNAPSHOT,
    workers: TWENTY_FIVE,
  })
  console.log(`✓ ${big.listNo} — Trade Test & Interview · 25 workers · GCC`)

  // 3 ─ mark both sent (draft → sent)
  for (const [no, id] of [
    [five.listNo, five.id],
    [big.listNo, big.id],
  ] as const) {
    const res = await api('PUT', `/api/name-lists/${id}/status`, { status: 'sent' })
    if (res.status !== 200) throw new Error(`status ${no} failed (${res.status})`)
    console.log(`✓ ${no} marked sent`)
  }

  console.log('Done.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
