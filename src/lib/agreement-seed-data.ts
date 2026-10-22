// Agreement seed data — shared by runSeed (fresh databases, wipe + create)
// and scripts/agreement-seed.ts (live database, idempotent upserts).
// The "Sub-Contract Agreement" template + reference agreement use the EXACT
// sample data from the uploaded agreement-template.html, so the seeded PDF
// matches the attached template pixel-for-pixel.
import type { TemplateParty } from './agreement-template'
import { priceTextFor } from './agreement-price'

// ---------------------------------------------------------------------------
// "Sub-Contract Agreement" template — title + intro + the 5 sample clauses
// ---------------------------------------------------------------------------

export const SUBCONTRACT_TEMPLATE = {
  name: 'Sub-Contract Agreement',
  titleEn: 'Sub-Contract Agreement',
  titleAr: 'عقد مقاولة من الباطن',
  introEn:
    'The First Party and the Second Party have agreed that the Second Party shall provide the First Party with industrial service and supply of equipment at Amiral Project Package # 4 – onshore project at Saudi Aramco, according to the following terms and conditions:',
  introAr:
    'وافق الطرف الأول والطرف الثاني على تزويد الطرف الأول بالخدمة الصناعية وتوريد المعدات في حزمة مشروع أميرال رقم 4 – المشروع البري في أرامكو السعودية، وفقاً للشروط والأحكام التالية:',
  clauses: [
    {
      textEn: 'Second Party shall provide industrial service and supply of equipment to the First Party.',
      textAr: 'يلتزم الطرف الثاني بتوفير الخدمات الصناعية وتوريد المعدات للطرف الأول.',
    },
    {
      textEn: 'First Party shall be responsible for the ID cards, vehicle stickers and gate passes for the Second Party. The Second Party shall provide all documents required for issuing the permits.',
      textAr: 'يكون الطرف الأول مسؤولاً عن إصدار البطاقات والملصقات وتصاريح دخول البوابة للسيارات، وعلى الطرف الثاني توفير كافة المستندات المطلوبة لإصدار التصاريح.',
    },
    { textEn: 'Contract Price: {PRICE}', textAr: 'قيمة العقد: {PRICE}' },
    { textEn: 'Contract Period: {PERIOD}', textAr: 'مدة العقد: {PERIOD}' },
    {
      textEn: 'First Party and Second Party hereby agree that all other terms and conditions shall be followed as per the purchase order.',
      textAr: 'وافق الطرف الأول والطرف الثاني على أن تبقى جميع البنود والشروط الأخرى حسب أمر الشراء.',
    },
  ],
}

// ---------------------------------------------------------------------------
// Reference agreement — the EXACT `agreement` object from the uploaded file
// (AGR-2025-0001, Gusan ↔ Green Forest, price as per the PO)
// ---------------------------------------------------------------------------

const GUSAN: TemplateParty = {
  name: { en: 'Gusan Construction Arabia Co., Ltd', ar: 'شركة كوسان كونستركشن العربية المحدودة' },
  crNo: '2051041222',
  address: { en: 'P.O. Box 4679, Al Khobar 31952, KSA', ar: 'ص.ب 4679، الخبر 31952، المملكة العربية السعودية' },
  tel: '013 833 5923',
  fax: '013 833 5828',
  signatory: { name: { en: '', ar: '' }, title: { en: '', ar: '' } },
  signatureImg: '',
  stampImg: '',
}

const GREEN_FOREST: TemplateParty = {
  name: { en: 'Green Forest Company Limited.', ar: 'شركة الغابة الخضراء المحدودة' },
  crNo: '2055141340',
  address: { en: '', ar: '' },
  tel: '',
  fax: '',
  signatory: {
    name: { en: 'Kazi Nazmul Kazi Kamal', ar: 'قاضي نظمول قاضي كمال' },
    title: { en: 'Chief Executive Officer (CEO)', ar: 'الرئيس التنفيذي' },
  },
  signatureImg: '',
  stampImg: '',
}

export type AgreementSeedRow = {
  agreementNo: string
  date: string // ISO
  titleEn: string
  titleAr: string
  ourCompanyIs: 'first' | 'second'
  firstParty: TemplateParty
  secondParty: TemplateParty
  otherPartyNameEn: string
  otherPartyNameAr: string
  introEn: string
  introAr: string
  periodFrom: string
  periodTo: string
  priceMode: 'po' | 'amount'
  priceAmount: number | null
  priceEn: string
  priceAr: string
  showLetterheadSpace: boolean
  status: 'draft' | 'signed'
  clauses: { textEn: string; textAr: string }[]
}

export function buildSampleAgreement(): AgreementSeedRow {
  return {
    agreementNo: 'AGR-2025-0001',
    date: '2025-01-04',
    titleEn: SUBCONTRACT_TEMPLATE.titleEn,
    titleAr: SUBCONTRACT_TEMPLATE.titleAr,
    ourCompanyIs: 'first',
    firstParty: GUSAN,
    secondParty: GREEN_FOREST,
    otherPartyNameEn: GREEN_FOREST.name.en,
    otherPartyNameAr: GREEN_FOREST.name.ar,
    introEn: SUBCONTRACT_TEMPLATE.introEn,
    introAr: SUBCONTRACT_TEMPLATE.introAr,
    periodFrom: '2025-01-04',
    periodTo: '2027-01-03',
    priceMode: 'po',
    priceAmount: null,
    priceEn: 'As per the PO',
    priceAr: 'حسب أمر الشراء',
    showLetterheadSpace: true,
    status: 'signed',
    clauses: SUBCONTRACT_TEMPLATE.clauses,
  }
}

// ---------------------------------------------------------------------------
// QA agreement — amount mode (SAR 257,738 auto-written EN+AR), OUR company is
// the First Party (auto-filled from Settings), already EXPIRED (derived) so
// the list and its filters demo every state. Uses the {PRICE}/{PERIOD} tokens.
// ---------------------------------------------------------------------------

export function buildQaAgreement(our: TemplateParty): AgreementSeedRow {
  const amount = 257738
  const price = priceTextFor('amount', amount)
  const other: TemplateParty = {
    name: { en: 'Gulf Manpower Solutions', ar: 'شركة حلول القوى العاملة الخليجية' },
    crNo: '2055141341',
    address: { en: 'Prince Saud Al Faisal Street, Al Khobar 31952, KSA', ar: 'شارع الأمير سعود الفيصل، الخبر 31952، المملكة العربية السعودية' },
    tel: '013 832 4400',
    fax: '013 832 4401',
    signatory: {
      name: { en: 'Kazi Nazmul Kazi Kamal', ar: 'قاضي نظمول قاضي كمال' },
      title: { en: 'Chief Executive Officer (CEO)', ar: 'الرئيس التنفيذي' },
    },
    signatureImg: '',
    stampImg: '',
  }
  return {
    agreementNo: 'AGR-2025-0002',
    date: '2026-01-05',
    titleEn: 'Manpower Supply Agreement',
    titleAr: 'اتفاقية توريد العمالة',
    ourCompanyIs: 'first',
    firstParty: our,
    secondParty: other,
    otherPartyNameEn: other.name.en,
    otherPartyNameAr: other.name.ar,
    introEn:
      'The First Party and the Second Party have agreed that the Second Party shall supply skilled manpower to the First Party for the site works at Riyadh — Package B, according to the following terms and conditions:',
    introAr:
      'وافق الطرف الأول والطرف الثاني على تزويد الطرف الأول بالعمالة الماهرة لأعمال الموقع في الرياض – الحزمة ب، وفقاً للشروط والأحكام التالية:',
    periodFrom: '2026-01-05',
    periodTo: '2026-10-01', // already past → status shows Expired (derived)
    priceMode: 'amount',
    priceAmount: amount,
    priceEn: price.en,
    priceAr: price.ar,
    showLetterheadSpace: true,
    status: 'signed',
    clauses: [
      {
        textEn: 'Second Party shall supply skilled manpower as per the approved name lists.',
        textAr: 'يلتزم الطرف الثاني بتوريد العمالة الماهرة حسب قوائم الأسماء المعتمدة.',
      },
      { textEn: 'Contract Price: {PRICE}', textAr: 'قيمة العقد: {PRICE}' },
      { textEn: 'Contract Period: {PERIOD}', textAr: 'مدة العقد: {PERIOD}' },
      {
        textEn: 'All other terms and conditions shall be followed as per the master purchase order.',
        textAr: 'تبقى جميع البنود والشروط الأخرى حسب أمر الشراء الرئيسي.',
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Saved parties (the "Select saved party" dropdown) — the two sample companies
// ---------------------------------------------------------------------------

export const SEED_SAVED_PARTIES: Array<Omit<TemplateParty, 'signatureImg' | 'stampImg'>> = [
  {
    name: GUSAN.name,
    crNo: GUSAN.crNo,
    address: GUSAN.address,
    tel: GUSAN.tel,
    fax: GUSAN.fax,
    signatory: { name: { en: 'Ali Al-Dosari', ar: 'علي الدوسري' }, title: { en: 'General Manager', ar: 'المدير العام' } },
  },
  {
    name: GREEN_FOREST.name,
    crNo: GREEN_FOREST.crNo,
    address: { en: 'Dammam Road, Al Khobar 31952, KSA', ar: 'طريق الدمام، الخبر 31952، المملكة العربية السعودية' },
    tel: '013 833 5923',
    fax: '013 833 5828',
    signatory: GREEN_FOREST.signatory,
  },
]

// ---------------------------------------------------------------------------
// Settings keys added by this feature — upserted only when MISSING (live DB
// seed never overwrites values the boss already set).
// ---------------------------------------------------------------------------

export const AGREEMENT_SEED_SETTINGS: Record<string, string> = {
  fax: '+966 13 847 2201',
  authorizedSignatoryAr: 'قاضي نظمول قاضي كمال',
  signatoryTitleAr: 'الرئيس التنفيذي',
}
