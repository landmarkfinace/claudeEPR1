// ─────────────────────────────────────────────────────────────────────────────
// BILINGUAL AGREEMENT TEMPLATE — EXACT port of the uploaded
// agreement-template.html (EN left column LTR | AR right column RTL, one
// table row per section so both languages stay aligned).
//
// The layout CSS and the render logic are byte-faithful to the uploaded file.
// Only the documented ERP-integration adjustments below change WHERE rules
// apply, never what they compute inside the sheet:
//   1. `:root` template variables → scoped onto `.sheet` (the app itself uses
//      `--muted`, so a global :root would leak app-wide).
//   2. `* { box-sizing }` → `.sheet, .sheet *` (same effect inside the sheet,
//      zero effect on the surrounding app).
//   3. `html, body` rules → `.agr-desk` backdrop (preview) + a `.sheet` base
//      shim (font-family / color / line-height: normal) that mirrors the
//      standalone document's body inheritance — so the sheet computes
//      IDENTICALLY in the app preview, window.print() and the headless render
//      daemon (which additionally loads the app's compiled CSS).
// The `.toolbar` screen rules are dropped (the ERP renders no toolbar); the
// `@media print .toolbar` line is kept verbatim. Everything else — including
// the whole `@media print` block with `@page { size: A4; margin: 12mm 12mm
// 14mm }` — is verbatim from the file.
// ─────────────────────────────────────────────────────────────────────────────
import { AGREEMENT_FONT_FACES_CSS } from './agreement-fonts'

// Price words live in the small pure module (re-exported for consumers):
export { DEFAULT_PRICE, priceTextFor, priceWordsEn, priceWordsAr } from './agreement-price'

// ── Data shape (the template's `agreement` object, typed) ──────────────────

export type TemplateParty = {
  name: { en: string; ar: string }
  crNo: string
  address: { en: string; ar: string }
  tel: string
  fax: string
  signatory: { name: { en: string; ar: string }; title: { en: string; ar: string } }
  signatureImg: string // data URL, "" = none
  stampImg: string // data URL, "" = dashed stamp box
}

export type TemplateAgreement = {
  agreementNo: string
  date: string // ISO yyyy-mm-dd
  showLetterheadSpace: boolean
  title: { en: string; ar: string }
  firstParty: TemplateParty
  secondParty: TemplateParty
  intro: { en: string; ar: string }
  periodFrom: string // ISO yyyy-mm-dd
  periodTo: string // ISO yyyy-mm-dd
  contractPrice: { en: string; ar: string }
  clauses: { en: string; ar: string }[]
}

export function emptyParty(): TemplateParty {
  return {
    name: { en: '', ar: '' },
    crNo: '',
    address: { en: '', ar: '' },
    tel: '',
    fax: '',
    signatory: { name: { en: '', ar: '' }, title: { en: '', ar: '' } },
    signatureImg: '',
    stampImg: '',
  }
}

// ── Sheet CSS — the uploaded template's stylesheet (see header note) ───────

export const SHEET_CSS = `
/* scoped :root vars + standalone body inheritance shim (integration 1 + 3) */
.sheet {
  --ink: #1a1a1a;
  --muted: #555;
  --rule: #b9b9b9;
  --paper: #ffffff;
  --desk: #e9eaec;
  --en: "Noto Sans", Arial, Helvetica, sans-serif;
  --ar: "Noto Naskh Arabic", "Amiri", "Traditional Arabic", Arial, sans-serif;
  font-family: var(--en);
  color: var(--ink);
  line-height: normal;
}
.sheet, .sheet * { box-sizing: border-box; }
.agr-desk { margin: 0; background: var(--desk); color: var(--ink); font-family: var(--en); padding: 24px 12px; }

/* A4 sheet */
.sheet { width: 210mm; min-height: 297mm; margin: 0 auto; background: var(--paper); padding: 18mm 16mm 16mm; box-shadow: 0 1px 4px rgba(0,0,0,.18); }
/* Space reserved for company letterhead (showLetterheadSpace=false to remove) */
.letterhead-space { height: 30mm; border-bottom: 1px dashed var(--rule); margin-bottom: 6mm;
  display: flex; align-items: center; justify-content: center; color: #999; font-size: 11px; }

table.agr { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12.5px; line-height: 1.55; }
table.agr td { vertical-align: top; padding: 4px 0; }
table.agr td.en { width: 50%; padding-right: 5mm; text-align: justify; }
table.agr td.ar { width: 50%; padding-left: 5mm; direction: rtl; text-align: justify; font-family: var(--ar); font-size: 14px; line-height: 1.7; }
table.agr tr { page-break-inside: avoid; break-inside: avoid; }

.meta td { padding-bottom: 8px; }
.title td { font-size: 17px; font-weight: 700; padding: 10px 0 14px; }
.title td.ar { font-size: 19px; }
.party-head td { font-weight: 700; font-size: 13.5px; padding-top: 10px; }
.party-head td.ar { font-size: 15px; }
.party-name td { font-weight: 700; }
.small { color: var(--muted); }
.intro td { padding-top: 10px; padding-bottom: 10px; }
.clause td { padding: 5px 0; }
.num { font-weight: 700; }
.ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }

/* Signature block */
.sig-wrap { margin-top: 10mm; }
.sig-party { border-top: 1px solid var(--rule); padding-top: 6px; margin-top: 8mm; break-inside: avoid; page-break-inside: avoid; }
.sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
.sig-row .ar { direction: rtl; font-family: var(--ar); font-size: 14px; }
.sig-row .en { font-size: 12.5px; }
.sig-line { display: flex; align-items: flex-end; gap: 6px; margin-top: 4px; min-height: 22px; }
.sig-line .lbl { white-space: nowrap; }
.sig-line .val { flex: 1; border-bottom: 1px dotted #888; min-height: 20px; padding: 0 4px; }
.sig-line .val.blank { border-bottom: 1px solid #333; }
.sig-images { display: flex; gap: 10mm; margin-top: 4mm; min-height: 22mm; align-items: center; justify-content: center; }
.sig-images img { max-height: 22mm; max-width: 45mm; object-fit: contain; }
.stamp-box { width: 32mm; height: 22mm; border: 1px dashed var(--rule); color: #aaa; font-size: 10px;
  display: flex; align-items: center; justify-content: center; text-align: center; }

.doc-footer { margin-top: 10mm; display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); }

@media print {
  @page { size: A4; margin: 12mm 12mm 14mm; }
  html, body { background: #fff; padding: 0; }
  .agr-desk { background: #fff; padding: 0; }
  .toolbar { display: none; }
  .sheet { width: auto; min-height: 0; padding: 0; box-shadow: none; }
}
@media (max-width: 820px) {
  .sheet { width: 100%; padding: 8mm 6mm; }
  .toolbar { max-width: 100%; }
}
`

/** The full style block every agreement surface mounts: webfonts + sheet CSS. */
export function sheetStyleCss(): string {
  return `${AGREEMENT_FONT_FACES_CSS}\n${SHEET_CSS}`
}

// ── RENDERER — verbatim port of the uploaded template's <script> ───────────

const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTHS_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر']

function esc(s: unknown): string {
  return String(s ?? '').replace(
    /[&<>"]/g,
    (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c] as string)
  )
}
function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m, d }
}
function dateEn(iso: string): string {
  if (!iso) return ''
  const p = parts(iso)
  return `${MONTHS_EN[p.m - 1]} ${String(p.d).padStart(2, '0')}, ${p.y}`
}
function dateAr(iso: string): string {
  if (!iso) return ''
  const p = parts(iso)
  return `${String(p.d).padStart(2, '0')} ${MONTHS_AR[p.m - 1]} ${p.y}`
}
function num(s: string): string {
  return `<span class="ltr">${esc(s)}</span>`
}

function row(cls: string, en: string, ar: string): string {
  return `<tr class="${cls}"><td class="en">${en}</td><td class="ar">${ar}</td></tr>`
}

function partyRows(labelEn: string, labelAr: string, p: TemplateParty): string {
  let h = row('party-head', labelEn, labelAr)
  h += row('party-name', esc(p.name.en), esc(p.name.ar))
  if (p.crNo) h += row('', `CR No: ${num(p.crNo)}`, `س.ت: ${num(p.crNo)}`)
  if (p.address.en || p.address.ar) h += row('', esc(p.address.en), esc(p.address.ar))
  const telEn = [p.tel && `Tel: ${num(p.tel)}`, p.fax && `Fax: ${num(p.fax)}`].filter(Boolean).join('&nbsp;&nbsp; ')
  const telAr = [p.tel && `هاتف: ${num(p.tel)}`, p.fax && `فاكس: ${num(p.fax)}`].filter(Boolean).join('&nbsp;&nbsp; ')
  if (telEn) h += row('', telEn, telAr)
  return h
}

function sigBlock(labelEn: string, labelAr: string, p: TemplateParty): string {
  const s = p.signatory
  const line = (lblEn: string, valEn: string, lblAr: string, valAr: string, blank?: boolean) => `
    <div class="sig-row">
      <div class="en"><div class="sig-line"><span class="lbl">${lblEn}</span><span class="val ${blank ? 'blank' : ''}">${esc(valEn)}</span></div></div>
      <div class="ar"><div class="sig-line"><span class="lbl">${lblAr}</span><span class="val ${blank ? 'blank' : ''}">${esc(valAr)}</span></div></div>
    </div>`
  const sigImg = p.signatureImg ? `<img src="${p.signatureImg}" alt="Signature">` : ''
  const stamp = p.stampImg
    ? `<img src="${p.stampImg}" alt="Company stamp">`
    : `<div class="stamp-box">Company stamp<br>ختم الشركة</div>`
  return `
  <div class="sig-party">
    <div class="sig-row">
      <div class="en"><strong>${labelEn}</strong><br><strong>${esc(p.name.en)}</strong></div>
      <div class="ar"><strong>${labelAr}</strong><br><strong>${esc(p.name.ar)}</strong></div>
    </div>
    ${line('Name :', s.name.en, 'الاسم :', s.name.ar)}
    ${line('Title :', s.title.en, 'المنصب :', s.title.ar)}
    ${line('Signature :', '', 'التوقيع :', '', true)}
    <div class="sig-images">${sigImg}${stamp}</div>
  </div>`
}

/**
 * The template's render() — returns exactly the HTML it sets into #sheet
 * (letterhead space + table + signature wrap + doc footer).
 */
export function renderSheetHtml(a: TemplateAgreement): string {
  const periodEn = `${dateEn(a.periodFrom)} to ${dateEn(a.periodTo)}`
  const periodAr = `من ${dateAr(a.periodFrom)} إلى ${dateAr(a.periodTo)}`
  const fill = (t: string, lang: 'en' | 'ar') =>
    esc(t)
      .replace('{PERIOD}', lang === 'en' ? periodEn : periodAr)
      .replace('{PRICE}', esc(a.contractPrice[lang]))

  let h = ''
  if (a.showLetterheadSpace) h += `<div class="letterhead-space">Company letterhead area</div>`
  h += `<table class="agr">`
  h += row(
    'meta',
    `Date: ${dateEn(a.date)}<br><span class="small">Agreement No: ${num(a.agreementNo)}</span>`,
    `التاريخ: ${dateAr(a.date)}<br><span class="small">رقم العقد: ${num(a.agreementNo)}</span>`
  )
  h += row('title', esc(a.title.en), esc(a.title.ar))
  h += partyRows('First Party', 'الطرف الأول', a.firstParty)
  h += partyRows('Second Party', 'الطرف الثاني', a.secondParty)
  h += row('intro', esc(a.intro.en), esc(a.intro.ar))
  a.clauses.forEach((c, i) => {
    h += row(
      'clause',
      `<span class="num">${i + 1})</span> ${fill(c.en, 'en')}`,
      `<span class="num">${i + 1})</span> ${fill(c.ar, 'ar')}`
    )
  })
  h += `</table>`
  h += `<div class="sig-wrap">${sigBlock('First Party', 'الطرف الأول', a.firstParty)}${sigBlock('Second Party', 'الطرف الثاني', a.secondParty)}</div>`
  h += `<div class="doc-footer"><span>${esc(a.agreementNo)}</span><span>This agreement is made in two languages; both texts are equally valid.</span></div>`
  return h
}

/**
 * Serializable fragment for the render daemon (server PDF route).
 * Wrapped in `.print-area` — the app's compiled print stylesheet hides
 * everything outside .print-area subtrees in print media (same contract as
 * every other module's fragment).
 */
export function buildDaemonFragment(a: TemplateAgreement): string {
  return `<style>${sheetStyleCss()}</style><div class="print-area"><div class="sheet">${renderSheetHtml(a)}</div></div>`
}

// ── Our-company party from Settings (auto-fill) ─────────────────────────────

/** Structural input for toTemplateAgreement (satisfied by lib/types AgreementRow). */
export type ToTemplateInput = {
  agreementNo: string
  date: string
  showLetterheadSpace: boolean
  titleEn: string
  titleAr: string
  firstParty: TemplateParty
  secondParty: TemplateParty
  introEn: string
  introAr: string
  periodFrom: string
  periodTo: string
  priceEn: string
  priceAr: string
  clauses?: { textEn: string; textAr: string }[]
}

/** AgreementRow-like → the print template's data object (PDF + print dialog). */
export function toTemplateAgreement(r: ToTemplateInput): TemplateAgreement {
  return {
    agreementNo: r.agreementNo,
    date: r.date,
    showLetterheadSpace: r.showLetterheadSpace,
    title: { en: r.titleEn, ar: r.titleAr },
    firstParty: r.firstParty,
    secondParty: r.secondParty,
    intro: { en: r.introEn, ar: r.introAr },
    periodFrom: r.periodFrom,
    periodTo: r.periodTo,
    contractPrice: { en: r.priceEn, ar: r.priceAr },
    clauses: (r.clauses ?? []).map((c) => ({ en: c.textEn, ar: c.textAr })),
  }
}

/** The subset of Settings the agreement auto-fill reads. */
export type CompanySettingsLike = {
  companyName?: string
  companyNameAr?: string
  crNumber?: string
  address?: string
  addressAr?: string
  phone?: string
  fax?: string
  authorizedSignatory?: string
  authorizedSignatoryAr?: string
  signatoryTitle?: string
  signatoryTitleAr?: string
  companySignature?: string
  companyStamp?: string
}

/** Build OUR party block from Company Settings (missing keys stay empty). */
export function ourPartyFromSettings(s: CompanySettingsLike): TemplateParty {
  return {
    name: { en: s.companyName ?? '', ar: s.companyNameAr ?? '' },
    crNo: s.crNumber ?? '',
    address: { en: s.address ?? '', ar: s.addressAr ?? '' },
    tel: s.phone ?? '',
    fax: s.fax ?? '',
    signatory: {
      name: { en: s.authorizedSignatory ?? '', ar: s.authorizedSignatoryAr ?? '' },
      title: { en: s.signatoryTitle ?? '', ar: s.signatoryTitleAr ?? '' },
    },
    signatureImg: s.companySignature ?? '',
    stampImg: s.companyStamp ?? '',
  }
}
