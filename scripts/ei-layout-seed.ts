// Layout-test data seeder for the E-Invoice print rework.
//
//   • fixes the demo data issues the boss reported:
//       – companyName setting → full legal name "Landmark Inter Gulf Co. LLC"
//       – INV-2026-00001 poRef was the QUOTATION number (QTN-2026-0002) →
//         now the CLIENT's P.O. number
//   • creates + issues the pagination test invoices (through the REAL API so
//     totals, PIH chain and QR data are produced by the actual server logic):
//       – 6-item invoice  (expected: 2 pages)
//       – 25-item invoice (expected: 3 pages)
//     (the existing INV-2026-00001 with its 2 items is the 1-page case)
//
// Run: bun run scripts/ei-layout-seed.ts
import { db } from '../src/lib/db'

const BASE = 'http://localhost:3000'
const EMAIL = 'admin@example.com'
const PASSWORD = 'password'

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

const okStatus = (s: number): boolean => s >= 200 && s < 300

const daysFromNow = (n: number): string =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const today = (): string => new Date().toISOString().slice(0, 10)

type Trade = { en: string; ar: string; qty: number; price: number }

const TRADES: Trade[] = [
  { en: 'Manpower Supply — General Laborers', ar: 'توريد العمالة — عمال عموميون', qty: 30, price: 2800 },
  { en: 'Manpower Supply — Scaffolders', ar: 'توريد العمالة — سقالون', qty: 12, price: 3500 },
  { en: 'Manpower Supply — Certified Welders (6G)', ar: 'توريد العمالة — لحّامون معتمدون (٦ج)', qty: 10, price: 4800 },
  { en: 'Manpower Supply — Electricians', ar: 'توريد العمالة — كهربائيون', qty: 14, price: 4100 },
  { en: 'Manpower Supply — Mechanical Technicians', ar: 'توريد العمالة — فنيون ميكانيكيون', qty: 18, price: 4300 },
  { en: 'Manpower Supply — Industrial Cleaners', ar: 'توريد العمالة — منظفون صناعيون', qty: 20, price: 2200 },
  { en: 'Manpower Supply — Safety Officers', ar: 'توريد العمالة — ضباط سلامة', qty: 6, price: 5200 },
  { en: 'Manpower Supply — Heavy Equipment Operators', ar: 'توريد العمالة — مشغلو معدات ثقيلة', qty: 9, price: 4900 },
  { en: 'Manpower Supply — Crane Operators', ar: 'توريد العمالة — مشغلو رافعات', qty: 7, price: 5500 },
  { en: 'Manpower Supply — Pipe Fitters', ar: 'توريد العمالة — تركيبون أنابيب', qty: 16, price: 3900 },
  { en: 'Manpower Supply — Structural Fabricators', ar: 'توريد العمالة — هياكل معدنية', qty: 11, price: 4200 },
  { en: 'Manpower Supply — Riggers', ar: 'توريد العمالة — مجهزو أحمال', qty: 8, price: 4000 },
  { en: 'Manpower Supply — Painters (Industrial)', ar: 'توريد العمالة — دهانون صناعيون', qty: 13, price: 3100 },
  { en: 'Manpower Supply — Insulation Technicians', ar: 'توريد العمالة — فنيو عزل', qty: 10, price: 3600 },
  { en: 'Manpower Supply — HVAC Technicians', ar: 'توريد العمالة — فنيو تكييف وتهوية', qty: 9, price: 4500 },
  { en: 'Manpower Supply — Plumber Helpers', ar: 'توريد العمالة — مساعدو سباكة', qty: 15, price: 2700 },
  { en: 'Manpower Supply — Store Keepers', ar: 'توريد العمالة — أمناء مستودعات', qty: 5, price: 3300 },
  { en: 'Manpower Supply — Time Keepers', ar: 'توريد العمالة — مسجلوا حضور', qty: 4, price: 3200 },
  { en: 'Manpower Supply — Surveyor Assistants', ar: 'توريد العمالة — مساعدو مساحة', qty: 6, price: 3400 },
  { en: 'Manpower Supply — Concrete Workers', ar: 'توريد العمالة — عمال خرسانة', qty: 22, price: 2900 },
  { en: 'Manpower Supply — Steel Fixers', ar: 'توريد العمالة — حدادو تسليح', qty: 17, price: 3300 },
  { en: 'Manpower Supply — Masons', ar: 'توريد العمالة — بنّاؤون', qty: 19, price: 3000 },
  { en: 'Site Safety Supervisor — Lump Sum', ar: 'مشرف سلامة موقع — مقطوعية', qty: 1, price: 15000 },
  { en: 'Site Medical First Aider — Lump Sum', ar: 'مسعف موقع — مقطوعية', qty: 1, price: 8500 },
  { en: 'Material Handling Crew — Lump Sum', ar: 'فريق مناولة مواد — مقطوعية', qty: 1, price: 12000 },
]

async function findByPoRef(poRef: string): Promise<{ id: string; status: string } | null> {
  const res = await api<{ rows?: { id: string; status: string }[] }>(
    'GET',
    `/api/e-invoices?search=${encodeURIComponent(poRef)}`
  )
  return res.json.rows?.[0] ?? null
}

async function createAndIssue(
  poRef: string,
  itemCount: number,
  projectEn: string,
  projectAr: string
): Promise<void> {
  const existing = await findByPoRef(poRef)
  if (existing) {
    console.log(`  · ${poRef} already exists (${existing.status}) — skipped`)
    return
  }
  const clients = await api<{ data?: { id: string; name: string }[] }>(
    'GET',
    '/api/clients?pageSize=200'
  )
  const client = (clients.json.data ?? []).find((c) =>
    c.name.includes('Eastern Province Industrial')
  )
  if (!client) throw new Error('client "Eastern Province Industrial Services" not found')

  const created = await api<{ id: string; invoiceNumber: string }>('POST', '/api/e-invoices', {
    docType: 'invoice',
    zatcaPhase: 1,
    clientId: client.id,
    clientNameEn: 'Eastern Province Industrial Services',
    clientNameAr: 'خدمات المنطقة الشرقية الصناعية',
    clientVatNumber: '310556789100003',
    clientCrNumber: '2050112233',
    clientAddressEn: 'King Abdulaziz Road, Industrial City 1, Dammam 34326, Saudi Arabia',
    clientAddressAr: 'طريق الملك عبدالعزيز، المدينة الصناعية ١، الدمام ٣٤٣٢٦، المملكة العربية السعودية',
    poRef,
    contractRef: 'LIG-EPIS-2026-014',
    projectEn,
    projectAr,
    paymentTermsEn: '30 days from invoice date',
    paymentTermsAr: '٣٠ يوماً من تاريخ الفاتورة',
    paymentMethodEn: 'Bank transfer',
    paymentMethodAr: 'تحويل بنكي',
    issueDate: today(),
    supplyDate: today(),
    dueDate: daysFromNow(30),
    items: TRADES.slice(0, itemCount).map((t) => ({
      descriptionEn: t.en,
      descriptionAr: t.ar,
      unitEn: 'Man-Month',
      unitAr: 'شهر/فرد',
      quantity: t.qty,
      unitPrice: t.price,
      vatPercent: 15,
    })),
  })
  if (!okStatus(created.status)) {
    throw new Error(`create ${poRef} failed (${created.status}): ${JSON.stringify(created.json)}`)
  }
  console.log(`  ✓ draft ${created.json.invoiceNumber} created (${itemCount} items)`)

  const issued = await api('POST', `/api/e-invoices/${created.json.id}/issue`, {})
  if (!okStatus(issued.status)) {
    throw new Error(`issue ${poRef} failed (${issued.status}): ${JSON.stringify(issued.json)}`)
  }
  console.log(`  ✓ ${created.json.invoiceNumber} issued (locked + real QR)`)
}

async function main() {
  console.log('— E-Invoice layout-test data seed —')

  // 0 ─ login
  const login = await api<{ token?: string }>('POST', '/api/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  })
  if (login.status !== 200 || !login.json.token) throw new Error('login failed')
  token = login.json.token as string
  console.log('  ✓ logged in as admin')

  // 1 ─ content fixes in the data (direct DB — issued invoices are locked)
  const company = await db.setting.findFirst({ where: { key: 'companyName' } })
  if (company && company.value !== 'Landmark Inter Gulf Co. LLC') {
    await db.setting.update({
      where: { key: 'companyName' },
      data: { value: 'Landmark Inter Gulf Co. LLC' },
    })
    console.log('  ✓ companyName → "Landmark Inter Gulf Co. LLC" (full legal name)')
  } else {
    console.log('  · companyName already the full legal name')
  }
  const inv1 = await db.eInvoice.findFirst({ where: { invoiceNumber: 'INV-2026-00001' } })
  if (inv1 && inv1.poRef === 'QTN-2026-0002') {
    await db.eInvoice.update({
      where: { id: inv1.id },
      data: { poRef: 'PO-EPIS-2026-0117' },
    })
    console.log('  ✓ INV-2026-00001 poRef → "PO-EPIS-2026-0117" (client P.O., was the quotation number)')
  } else {
    console.log(`  · INV-2026-00001 poRef already client-style (${inv1?.poRef ?? 'n/a'})`)
  }

  // 2 ─ pagination test invoices
  await createAndIssue(
    'PO-EPIS-2026-0221',
    6,
    'Dammam Warehouse Complex — Phase 3',
    'مجمع مستودعات الدمام — المرحلة الثالثة'
  )
  await createAndIssue(
    'PO-EPIS-2026-0222',
    25,
    'Jubail Industrial Maintenance Program',
    'برنامج الصيانة الصناعية بالجبيل'
  )

  console.log('\nSeed complete.')
}

main()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
