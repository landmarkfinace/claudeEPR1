/**
 * PRODUCTION BOOTSTRAP — run this ONCE on a fresh database (after
 * `bunx prisma db push`) to create the Super Admin and the company
 * configuration (roles, settings, letterhead artwork, staff/transaction
 * categories, agreement template, name-list subjects, AI settings,
 * translation memory) captured from the live company setup.
 *
 *   bun run db:bootstrap
 *   ADMIN_EMAIL=boss@company.com ADMIN_PASSWORD='strong-pass' bun run db:bootstrap
 *
 * Idempotent: safe to re-run — it only creates what is MISSING and never
 * overwrites rows you have since edited in the UI.
 *
 * ⚠ NEVER run `bun run db:seed` in production — that script creates DEMO data.
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scrypt as _scrypt } from 'crypto'
import { promisify } from 'util'
import { readFileSync } from 'fs'
import path from 'path'

const scrypt = promisify(_scrypt) as (p: string, s: string, k: number) => Promise<Buffer>

/** Identical format to src/lib/auth.ts hashPassword(): `salt:scryptHex` */
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `${salt}:${derived.toString('hex')}`
}

interface Snapshot {
  roles: { name: string; description: string | null; permissions: string[] }[]
  settings: Record<string, string>
  letterhead: {
    mode: string
    headerImage: string | null
    footerImage: string | null
    fullPageImage: string | null
    showCompanyDetails: boolean
    headerHeightMm: number
    footerHeightMm: number
  }[]
  staffCategories: { name: string; description: string | null }[]
  transactionCategories: { name: string; type: string }[]
  defaultTerms: { content: string }[]
  agreementTemplates: {
    name: string
    titleEn: string
    titleAr: string
    introEn: string
    introAr: string
    clauses: { order: number; textEn: string; textAr: string }[]
  }[]
  nameListSubjects: {
    name: string
    color: string
    kind: string
    sortOrder: number
    isSystem: boolean
  }[]
  aiSettings: {
    provider: string
    model: string
    apiKeyEnc: string | null
    baseUrl: string | null
    maxTokens: number
    monthlyLimitSar: number
    inCostPer1k: number
    outCostPer1k: number
  }[]
  translationMemory: {
    sourceText: string
    translatedText: string
    fieldContext: string | null
  }[]
}

async function main() {
  const db = new PrismaClient()
  const snap: Snapshot = JSON.parse(
    readFileSync(path.join(__dirname, 'bootstrap-data.json'), 'utf-8')
  )
  const report: string[] = []

  // ---- 1. Roles ------------------------------------------------------------
  for (const r of snap.roles) {
    const existing = await db.role.findUnique({ where: { name: r.name } })
    if (!existing) {
      await db.role.create({
        data: {
          name: r.name,
          description: r.description,
          permissions: JSON.stringify(r.permissions),
        },
      })
      report.push(`role created: ${r.name}`)
    }
  }

  // ---- 2. Super Admin ------------------------------------------------------
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase()
  const adminPass = process.env.ADMIN_PASSWORD || 'password'
  const userCount = await db.user.count()
  if (userCount === 0) {
    const superRole = await db.role.findUnique({ where: { name: 'Super Admin' } })
    await db.user.create({
      data: {
        name: 'Administrator',
        email: adminEmail,
        password: await hashPassword(adminPass),
        roleId: superRole?.id ?? null,
      },
    })
    report.push(`Super Admin created: ${adminEmail}`)
  } else {
    report.push(`users already exist (${userCount}) — admin creation skipped`)
  }

  // ---- 3. Settings (create missing keys only) ------------------------------
  let settingsAdded = 0
  for (const [key, value] of Object.entries(snap.settings)) {
    const n = await db.setting.count({ where: { key } })
    if (n === 0) {
      await db.setting.create({ data: { key, value } })
      settingsAdded++
    }
  }
  report.push(`settings: ${settingsAdded} created, ${Object.keys(snap.settings).length - settingsAdded} already present`)

  // ---- 4. Letterhead artwork ----------------------------------------------
  if ((await db.companyLetterhead.count()) === 0 && snap.letterhead.length > 0) {
    const l = snap.letterhead[0]
    await db.companyLetterhead.create({
      data: {
        mode: String(l.mode),
        headerImage: l.headerImage ?? null,
        footerImage: l.footerImage ?? null,
        fullPageImage: l.fullPageImage ?? null,
        showCompanyDetails: Boolean(l.showCompanyDetails),
        headerHeightMm: Number(l.headerHeightMm) || 45,
        footerHeightMm: Number(l.footerHeightMm) || 25,
      },
    })
    report.push('letterhead artwork installed')
  }

  // ---- 5. Staff categories -------------------------------------------------
  let catsAdded = 0
  for (const c of snap.staffCategories) {
    const n = await db.staffCategory.count({ where: { name: c.name } })
    if (n === 0) {
      await db.staffCategory.create({ data: { name: c.name, description: c.description } })
      catsAdded++
    }
  }
  report.push(`staff categories: ${catsAdded} created`)

  // ---- 6. Transaction categories -------------------------------------------
  let txnAdded = 0
  for (const c of snap.transactionCategories) {
    const n = await db.transactionCategory.count({ where: { name: c.name, type: c.type } })
    if (n === 0) {
      await db.transactionCategory.create({ data: { name: c.name, type: c.type } })
      txnAdded++
    }
  }
  report.push(`transaction categories: ${txnAdded} created`)

  // ---- 7. Quotation default terms ------------------------------------------
  if ((await db.defaultTerms.count()) === 0 && snap.defaultTerms.length > 0) {
    await db.defaultTerms.create({ data: { content: snap.defaultTerms[0].content } })
    report.push('quotation default terms installed')
  }

  // ---- 8. Agreement template ------------------------------------------------
  for (const t of snap.agreementTemplates) {
    const existing = await db.agreementTemplate.findUnique({ where: { name: t.name } })
    if (!existing) {
      await db.agreementTemplate.create({
        data: {
          name: t.name,
          titleEn: t.titleEn,
          titleAr: t.titleAr,
          introEn: t.introEn,
          introAr: t.introAr,
          clauses: {
            create: t.clauses.map((cl) => ({
              order: cl.order,
              textEn: cl.textEn,
              textAr: cl.textAr,
            })),
          },
        },
      })
      report.push(`agreement template installed: ${t.name} (${t.clauses.length} clauses)`)
    }
  }

  // ---- 9. Name-list subjects -------------------------------------------------
  let subjectsAdded = 0
  for (const s of snap.nameListSubjects) {
    const n = await db.nameListSubject.count({ where: { name: s.name } })
    if (n === 0) {
      await db.nameListSubject.create({
        data: {
          name: s.name,
          color: s.color,
          kind: s.kind,
          sortOrder: Number(s.sortOrder) || 0,
          isSystem: Boolean(s.isSystem),
        },
      })
      subjectsAdded++
    }
  }
  report.push(`name-list subjects: ${subjectsAdded} created`)

  // ---- 10. AI settings --------------------------------------------------------
  if ((await db.aiSettings.count()) === 0 && snap.aiSettings.length > 0) {
    const a = snap.aiSettings[0]
    await db.aiSettings.create({
      data: {
        provider: String(a.provider),
        model: a.model ?? '',
        apiKeyEnc: a.apiKeyEnc ?? null,
        baseUrl: a.baseUrl ?? null,
        maxTokens: Number(a.maxTokens) || 4000,
        monthlyLimitSar: Number(a.monthlyLimitSar) || 0,
        inCostPer1k: Number(a.inCostPer1k) || 0,
        outCostPer1k: Number(a.outCostPer1k) || 0,
      },
    })
    report.push('AI settings installed')
  }

  // ---- 11. Translation memory --------------------------------------------------
  let tmAdded = 0
  if ((await db.translationMemory.count()) === 0) {
    for (const t of snap.translationMemory) {
      await db.translationMemory.create({
        data: {
          sourceText: t.sourceText,
          translatedText: t.translatedText,
          fieldContext: t.fieldContext,
          usageCount: 1,
        },
      })
      tmAdded++
    }
    report.push(`translation memory: ${tmAdded} entries installed`)
  }

  console.log('\n=== BOOTSTRAP REPORT ===')
  for (const line of report) console.log(' •', line)
  console.log('\n⚠  SECURITY: log in and change the admin password immediately')
  console.log('   (Settings → Users → edit admin). Default is admin@example.com / password\n')

  await db.$disconnect()
}

main().catch((e) => {
  console.error('Bootstrap failed:', e)
  process.exit(1)
})
