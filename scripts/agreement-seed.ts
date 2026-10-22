// Live-DB seed for the Agreements module (idempotent — safe to re-run):
//   • settings: fax / Arabic signatory keys — inserted ONLY when missing
//     (never overwrites values the boss already set)
//   • "Sub-Contract Agreement" template — upserted by name (content refreshed)
//   • reference agreement AGR-2025-0001 (the EXACT uploaded sample) and the
//     amount-mode QA agreement AGR-2025-0002 (already expired) — skipped when
//     the number already exists (preserves edits)
//   • two saved parties for the editor dropdown — upserted by name
// Run: bun scripts/agreement-seed.ts
import { PrismaClient } from '@prisma/client'
import {
  SUBCONTRACT_TEMPLATE,
  buildSampleAgreement,
  buildQaAgreement,
  SEED_SAVED_PARTIES,
  AGREEMENT_SEED_SETTINGS,
} from '../src/lib/agreement-seed-data'
import { ourPartyFromSettings } from '../src/lib/agreement-template'

const db = new PrismaClient()

async function main() {
  const now = new Date()

  // ---- settings keys (only when missing) ----
  for (const [key, value] of Object.entries(AGREEMENT_SEED_SETTINGS)) {
    const existing = await db.setting.findUnique({ where: { key } })
    if (existing) {
      console.log(`settings ${key}: kept existing "${existing.value.slice(0, 40)}"`)
    } else {
      await db.setting.create({ data: { key, value } })
      console.log(`settings ${key}: seeded`)
    }
  }

  // ---- template (upsert by name — content refreshed) ----
  const tpl = await db.agreementTemplate.upsert({
    where: { name: SUBCONTRACT_TEMPLATE.name },
    update: {},
    create: {
      name: SUBCONTRACT_TEMPLATE.name,
      titleEn: SUBCONTRACT_TEMPLATE.titleEn,
      titleAr: SUBCONTRACT_TEMPLATE.titleAr,
      introEn: SUBCONTRACT_TEMPLATE.introEn,
      introAr: SUBCONTRACT_TEMPLATE.introAr,
      clauses: {
        create: SUBCONTRACT_TEMPLATE.clauses.map((c, i) => ({
          order: i + 1,
          textEn: c.textEn,
          textAr: c.textAr,
        })),
      },
    },
  })
  // refresh content on every run (the upsert above only handles creates)
  await db.agreementTemplateClause.deleteMany({ where: { templateId: tpl.id } })
  await db.agreementTemplate.update({
    where: { id: tpl.id },
    data: {
      titleEn: SUBCONTRACT_TEMPLATE.titleEn,
      titleAr: SUBCONTRACT_TEMPLATE.titleAr,
      introEn: SUBCONTRACT_TEMPLATE.introEn,
      introAr: SUBCONTRACT_TEMPLATE.introAr,
      clauses: {
        create: SUBCONTRACT_TEMPLATE.clauses.map((c, i) => ({
          order: i + 1,
          textEn: c.textEn,
          textAr: c.textAr,
        })),
      },
    },
  })
  console.log(`template: ${tpl.name} upserted (${SUBCONTRACT_TEMPLATE.clauses.length} clauses)`)

  // ---- our party from the LIVE settings (API defaults as fallbacks so the
  //      demo agreement always carries the bilingual identity) ----
  const settingsMap: Record<string, string> = {}
  for (const r of await db.setting.findMany()) settingsMap[r.key] = r.value
  const our = ourPartyFromSettings({
    companyName: settingsMap.companyName ?? 'Landmark Inter Gulf Co. LLC',
    companyNameAr: settingsMap.companyNameAr ?? 'لاندمارك انتر جلف',
    crNumber: settingsMap.crNumber ?? '1010357489',
    address: settingsMap.address,
    addressAr:
      settingsMap.addressAr ??
      'مركز السويدي التجاري، مكتب 103، الدور الأول، ص.ب. 35712، الجبيل، المملكة العربية السعودية',
    phone: settingsMap.phone,
    fax: settingsMap.fax,
    authorizedSignatory: settingsMap.authorizedSignatory,
    authorizedSignatoryAr: settingsMap.authorizedSignatoryAr,
    signatoryTitle: settingsMap.signatoryTitle,
    signatoryTitleAr: settingsMap.signatoryTitleAr,
    companySignature: settingsMap.companySignature,
    companyStamp: settingsMap.companyStamp,
  })

  // ---- agreements (skip when the number exists) ----
  for (const build of [buildSampleAgreement, () => buildQaAgreement(our)]) {
    const a = build()
    const existing = await db.agreement.findUnique({ where: { agreementNo: a.agreementNo } })
    if (existing) {
      console.log(`agreement ${a.agreementNo}: kept existing (${existing.status})`)
      continue
    }
    await db.agreement.create({
      data: {
        agreementNo: a.agreementNo,
        date: new Date(`${a.date}T00:00:00`),
        titleEn: a.titleEn,
        titleAr: a.titleAr,
        ourCompanyIs: a.ourCompanyIs,
        firstPartyJson: JSON.stringify(a.firstParty),
        secondPartyJson: JSON.stringify(a.secondParty),
        otherPartyNameEn: a.otherPartyNameEn,
        otherPartyNameAr: a.otherPartyNameAr,
        introEn: a.introEn,
        introAr: a.introAr,
        periodFrom: new Date(`${a.periodFrom}T00:00:00`),
        periodTo: new Date(`${a.periodTo}T00:00:00`),
        priceMode: a.priceMode,
        priceAmount: a.priceAmount,
        priceEn: a.priceEn,
        priceAr: a.priceAr,
        showLetterheadSpace: a.showLetterheadSpace,
        status: a.status,
        lastEditedBy: 'Seed',
        lastEditedAt: now,
        createdByName: 'Seed',
        clauses: {
          create: a.clauses
            .filter((c) => c.textEn.trim() || c.textAr.trim())
            .map((c, i) => ({ order: i + 1, textEn: c.textEn, textAr: c.textAr })),
        },
      },
    })
    console.log(`agreement ${a.agreementNo}: seeded (${a.status}, price ${a.priceMode})`)
  }

  // ---- saved parties (upsert by name) ----
  for (const p of SEED_SAVED_PARTIES) {
    const existing = await db.agreementParty.findFirst({ where: { nameEn: p.name.en } })
    const data = {
      nameEn: p.name.en,
      nameAr: p.name.ar,
      crNo: p.crNo,
      addressEn: p.address.en,
      addressAr: p.address.ar,
      tel: p.tel,
      fax: p.fax,
      signatoryNameEn: p.signatory.name.en,
      signatoryNameAr: p.signatory.name.ar,
      signatoryTitleEn: p.signatory.title.en,
      signatoryTitleAr: p.signatory.title.ar,
    }
    if (existing) {
      await db.agreementParty.update({ where: { id: existing.id }, data })
      console.log(`party: ${p.name.en} updated`)
    } else {
      await db.agreementParty.create({ data: { ...data, createdAt: now, updatedAt: now } as never })
      console.log(`party: ${p.name.en} seeded`)
    }
  }

  console.log('✅ agreement seed complete')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
