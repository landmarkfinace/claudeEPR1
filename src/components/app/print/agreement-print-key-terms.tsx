// Agreement print template "KEY TERMS" — reference design
// Agreement_Template_3_KeyTerms (HTML + PNG provided by the boss).
//
//   • gold spine on the left edge of every page (1.2mm + 5mm inset)
//   • big header stack: "AGREEMENT" overline + large EN title (left) ·
//     "اتفاقية" overline + AR title (right)
//   • navy KEY TERMS box (4 cells): Agreement No. · Date · Contract Period ·
//     Contract Price — ALL from the STRUCTURED fields (periodFrom/periodTo,
//     priceMode/priceEn/priceAr), never parsed from article text
//   • party blocks (gold small headers, name EN + AR, C.R. · address · tel
//     in one muted block — empty optional parts hide)
//   • bilingual preamble; TERMS & CONDITIONS title bar with navy underline
//   • article rows: big gold mono EN numerals 01 02 03 (left) · EN text ·
//     AR text · big gold Arabic-Indic numerals ١ ٢ ٣ (right)
//   • language clause; signature sections with stamp circles pinned to the
//     BOTTOM of the last page above the footer (with at least the last
//     article)
//
// DATA GUARANTEE: reads the SAME agreement data as Classic — every word of
// the preamble and articles (EN + AR) prints EXACTLY as stored; bold
// "Label:" prefixes are render-time styling only; {PRICE}/{PERIOD} resolve
// from the STRUCTURED fields exactly like Classic. Letterhead artwork +
// geometry come from Settings; without artwork the reserved bands stay
// EMPTY (never placeholder text).
import type { LetterheadConfig } from '@/lib/types'
import type { TemplateAgreement, TemplateParty } from '@/lib/agreement-template'
import {
  AgreementFontsStyle,
  AgrContinuationHeader,
  AgrPageFooter,
  AgrTplPage,
  AGR_LANGUAGE_CLAUSE,
  AR_FONT,
  DARK_GOLD,
  EN_FONT,
  FOOTER_LINE_MM,
  GOLD,
  HR,
  INK,
  INK_SOFT,
  LIGHT_GOLD,
  MONO,
  NAVY,
  PAGE_H_MM,
  agrDateAr,
  agrDateEn,
  agrFillClauses,
  agrGeometryFor,
  arabicDigits,
  estArticleMm,
  estBiMm,
  estLines,
  planAgrPages,
  type AgrTextSpec,
} from './agreement-print-shared'
import { AgrClauseText } from './agreement-print-bilingual-cards'

// ── Text metrics for this layout (CALIBRATED with print-render headroom) ────
// content ≈ 210 - 13(spine+inset) - 14(right) = 183mm; .it cols 9mm 1fr 1fr
// 9mm + 2×3mm gaps → each text col ≈ (183 - 18 - 6) / 2 ≈ 79mm
const EN_SPEC: AgrTextSpec = { charsPerLine: 42, lineMm: 4.8 }
const AR_SPEC: AgrTextSpec = { charsPerLine: 39, lineMm: 6.0 }
const EN_SPEC_WIDE: AgrTextSpec = { charsPerLine: 48, lineMm: 4.8 } // preamble (no number cols)
const AR_SPEC_WIDE: AgrTextSpec = { charsPerLine: 44, lineMm: 6.0 }
const ART_PAD_MM = 3.8 // row padding + separator

/** Party block height estimate (wrapped lines counted, calibrated against the
 *  live rows: Gusan 29mm, Landmark 41mm — the long address wraps). */
function partyBlockMm(p: TemplateParty): number {
  const line = 4.4
  let mm = 4.0 // header row
  mm += estLines(p.name.en, 32) * line
  if (p.name.ar) mm += estLines(p.name.ar, 28) * line
  const info = [
    p.crNo ? `C.R. ${p.crNo}` : '',
    p.address.en,
    p.tel ? `Tel: ${p.tel}` : '',
    p.fax ? `Fax: ${p.fax}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const infoAr = p.address.ar ?? ''
  mm += Math.max(info ? estLines(info, 62) : 0, infoAr ? estLines(infoAr, 55) : 0) * line
  return (mm + 3.4) * 1.1
}

/** Navy KEY TERMS box height — the TALLEST of the 4 cells governs (the price
 *  cell carries the long amount-words string on amount-mode agreements). */
function keyTermsBoxMm(a: TemplateAgreement): number {
  const cell = (valueEn: string, hasArSub: boolean) =>
    3.4 /* label */ +
    estLines(valueEn, 24) * 4.6 /* value (8.2pt, wraps in the narrow cells) */ +
    (hasArSub ? 4.8 : 0) +
    4.8 /* cell padding */
  const tallest = Math.max(
    cell(`${a.agreementNo}`, true),
    cell(`${agrDateEn(a.date)}`, false),
    cell(`${agrDateEn(a.periodFrom)} – ${agrDateEn(a.periodTo)}`, false),
    cell(a.contractPrice.en, Boolean(a.contractPrice.ar))
  )
  return tallest * 1.12 + 1 // measured 17mm short-values / 36mm amount-mode
}

// ── Page-1 fixed blocks ─────────────────────────────────────────────────────

function KeyTermsBox({ agreement }: { agreement: TemplateAgreement }) {
  const cell = (
    label: string,
    labelAr: string,
    value: React.ReactNode,
    arSub?: string
  ) => (
    <div style={{ padding: '2.2mm 3mm' }}>
      <small style={{ display: 'block', fontSize: '6.4pt', color: LIGHT_GOLD, fontWeight: 700, letterSpacing: '0.5pt', fontFamily: EN_FONT }}>
        {label} · <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>{labelAr}</span>
      </small>
      <b style={{ display: 'block', fontSize: '8.2pt', marginTop: '0.5mm', lineHeight: 1.3, color: '#fff', fontFamily: EN_FONT }}>
        {value}
      </b>
      {arSub ? (
        <span lang="ar" dir="rtl" style={{ display: 'block', fontSize: '7.6pt', color: '#C9D3E3', textAlign: 'right', marginTop: '0.3mm', fontFamily: AR_FONT }}>
          {arSub}
        </span>
      ) : null}
    </div>
  )
  const divider = (i: number) =>
    i > 0 ? { borderLeft: '1px solid rgba(255,255,255,.15)' } : undefined
  return (
    <div
      className="grid overflow-hidden"
      style={{ marginTop: '3mm', background: NAVY, color: '#fff', borderRadius: '2mm', gridTemplateColumns: '1.15fr 1fr 1.25fr 1.15fr', fontFamily: EN_FONT }}
    >
      <div style={divider(1)}>
        {cell('AGREEMENT NO.', 'رقم العقد', <span className="tabular-nums" style={{ fontFamily: MONO }}>{agreement.agreementNo}</span>, agrDateAr(agreement.date))}
      </div>
      <div style={divider(2)}>{cell('DATE', 'التاريخ', agrDateEn(agreement.date))}</div>
      <div style={divider(3)}>
        {cell('CONTRACT PERIOD', 'مدة العقد', `${agrDateEn(agreement.periodFrom)} – ${agrDateEn(agreement.periodTo)}`)}
      </div>
      <div style={divider(4)}>{cell('CONTRACT PRICE', 'قيمة العقد', agreement.contractPrice.en, agreement.contractPrice.ar)}</div>
    </div>
  )
}

function PartyBlock({ labelEn, labelAr, p }: { labelEn: string; labelAr: string; p: TemplateParty }) {
  const info = [
    p.crNo ? (
      <>
        C.R. <b className="tabular-nums" style={{ fontFamily: MONO, color: INK }}>{p.crNo}</b>
      </>
    ) : null,
    p.address.en || null,
    p.tel ? (<>Tel: <b className="tabular-nums" style={{ fontFamily: MONO, color: INK }}>{p.tel}</b></>) : null,
    p.fax ? (<>Fax: <b className="tabular-nums" style={{ fontFamily: MONO, color: INK }}>{p.fax}</b></>) : null,
  ].filter(Boolean)
  return (
    <div style={{ fontFamily: EN_FONT }}>
      <div className="flex items-center justify-between" style={{ fontSize: '6.8pt', fontWeight: 700, color: DARK_GOLD, letterSpacing: '0.8pt' }}>
        <span>{labelEn}</span>
        <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, letterSpacing: 0, fontSize: '7.6pt' }}>
          {labelAr}
        </span>
      </div>
      <div style={{ fontSize: '9pt', fontWeight: 700, color: NAVY, marginTop: '0.6mm' }}>{p.name.en}</div>
      {p.name.ar ? (
        <div lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, fontSize: '8.6pt', fontWeight: 700, color: NAVY, textAlign: 'right' }}>
          {p.name.ar}
        </div>
      ) : null}
      {info.length > 0 || p.address.ar ? (
        <div style={{ fontSize: '7.4pt', color: INK_SOFT, lineHeight: 1.45, marginTop: '0.5mm' }}>
          {info.length > 0 ? <div>{info.reduce<React.ReactNode>((acc, x, i) => (i === 0 ? [x] : [acc, ' · ', x]), null)}</div> : null}
          {p.address.ar ? (
            <div lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, textAlign: 'right' }}>
              {p.address.ar}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ── Signature section (reference .s) ────────────────────────────────────────
function SignatureSection({
  labelEn,
  labelAr,
  p,
}: {
  labelEn: string
  labelAr: string
  p: TemplateParty
}) {
  const field = (lbl: string, lblAr: string, value: React.ReactNode, sign?: boolean) => (
    <div
      className="flex items-end justify-between"
      style={{
        fontSize: '7.2pt',
        color: INK_SOFT,
        marginTop: '1.4mm',
        borderBottom: sign ? `1px solid ${NAVY}` : '1px dotted #9AA3B5',
        paddingBottom: '0.4mm',
        minHeight: sign ? '10mm' : '5mm',
        fontFamily: EN_FONT,
      }}
    >
      <span>{lbl}</span>
      <span style={{ fontWeight: 600, fontSize: '7.4pt', color: INK }}>{value}</span>
      <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
        {lblAr}
      </span>
    </div>
  )
  return (
    <div style={{ fontFamily: EN_FONT }}>
      <div className="flex items-center justify-between" style={{ fontSize: '7pt', fontWeight: 700, color: DARK_GOLD, letterSpacing: '0.6pt' }}>
        <span>{labelEn}</span>
        <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, letterSpacing: 0 }}>
          {labelAr}
        </span>
      </div>
      <div style={{ fontSize: '7.8pt', fontWeight: 700, color: NAVY, marginTop: '0.4mm' }}>
        {p.name.en}
        {p.name.ar ? (
          <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
            {' '}
            · {p.name.ar}
          </span>
        ) : null}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 20mm', gap: '3mm', alignItems: 'end', marginTop: '0.6mm' }}>
        <div className="min-w-0">
          {field(
            'Name',
            'الاسم',
            <>
              {p.signatory.name.en}
              {p.signatory.name.ar ? (
                <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                  {' '}
                  · {p.signatory.name.ar}
                </span>
              ) : null}
            </>
          )}
          {field(
            'Title',
            'المنصب',
            <>
              {p.signatory.title.en}
              {p.signatory.title.ar ? (
                <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                  {' '}
                  · {p.signatory.title.ar}
                </span>
              ) : null}
            </>
          )}
          {field(
            'Signature',
            'التوقيع',
            p.signatureImg ? (
              <img src={p.signatureImg} alt="" style={{ maxHeight: '8mm', maxWidth: '100%', objectFit: 'contain' }} />
            ) : null,
            true
          )}
        </div>
        <div
          className="flex flex-col items-center justify-center self-center overflow-hidden text-center"
          style={{
            width: '20mm',
            height: '20mm',
            border: `1.2px dashed ${GOLD}`,
            borderRadius: '50%',
            fontSize: '6pt',
            color: DARK_GOLD,
            fontFamily: EN_FONT,
          }}
        >
          {p.stampImg ? (
            <img src={p.stampImg} alt="" style={{ maxWidth: '18mm', maxHeight: '18mm', objectFit: 'contain' }} />
          ) : (
            <>
              <span>Company</span>
              <span>Stamp</span>
              <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                ختم الشركة
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Document ────────────────────────────────────────────────────────────────
export function AgreementKeyTermsDocument({
  agreement,
  letterhead,
}: {
  agreement: TemplateAgreement
  letterhead: LetterheadConfig
}) {
  const geo = agrGeometryFor(letterhead)
  const arts = agrFillClauses(agreement)

  const headerMm = 18
  const keyTermsMm = keyTermsBoxMm(agreement)
  const partiesMm = Math.max(partyBlockMm(agreement.firstParty), partyBlockMm(agreement.secondParty)) + 5.4
  const preambleMm = estBiMm(agreement.intro.en, agreement.intro.ar, EN_SPEC_WIDE, AR_SPEC_WIDE) + 3.6
  const termsBarMm = 9
  const page1Fixed = headerMm + keyTermsMm + partiesMm + preambleMm + termsBarMm
  const contHeaderMm = 8
  const langClauseMm = 8
  const sigSectionsMm = 46
  const tailMm = langClauseMm + sigSectionsMm + 3 + FOOTER_LINE_MM

  const artsMm = arts.map((a) => estArticleMm(a, EN_SPEC, AR_SPEC, ART_PAD_MM))
  const SAFETY_MM = 5 // print-render wrap variance buffer
  const availFirst = PAGE_H_MM - geo.topMm - geo.bottomMm - page1Fixed - FOOTER_LINE_MM - SAFETY_MM
  const availRest = PAGE_H_MM - geo.topMm - geo.bottomMm - contHeaderMm - FOOTER_LINE_MM - SAFETY_MM
  const planned = planAgrPages({ availFirst, availRest, artsMm, tailMm })
  const pages = planned.pages
  const totalPages = planned.totalPages

  return (
    <>
      <AgreementFontsStyle />
      {pages.map((plan, pageIdx) => {
        const isLast = pageIdx === totalPages - 1
        return (
          <AgrTplPage key={pageIdx} letterhead={letterhead} isLast={isLast}>
            {/* gold spine — every page */}
            <span aria-hidden className="absolute bottom-0 left-0 top-0 z-10" style={{ width: '1.2mm', background: GOLD }} />
            <div
              className="absolute inset-x-0 top-0 z-10 flex h-full flex-col [&>*]:shrink-0"
              style={{
                paddingTop: `${geo.topMm}mm`,
                paddingBottom: `${geo.bottomMm + 1}mm`,
                paddingLeft: '13mm',
                paddingRight: '14mm',
              }}
            >
              {pageIdx === 0 ? (
                <>
                  <div className="flex items-end justify-between gap-[6mm]">
                    <div style={{ fontFamily: EN_FONT }}>
                      <small style={{ display: 'block', fontSize: '7pt', color: DARK_GOLD, letterSpacing: '1.4pt', fontWeight: 700, marginBottom: '1mm' }}>
                        AGREEMENT
                      </small>
                      <div style={{ fontSize: '16pt', fontWeight: 700, color: NAVY, lineHeight: 1.05 }}>{agreement.title.en}</div>
                    </div>
                    {agreement.title.ar ? (
                      <div lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, textAlign: 'right' }}>
                        <small style={{ display: 'block', fontSize: '7.5pt', color: DARK_GOLD, marginBottom: '1mm', fontWeight: 700 }}>اتفاقية</small>
                        <div style={{ fontSize: '13pt', fontWeight: 700, color: NAVY, lineHeight: 1.25 }}>{agreement.title.ar}</div>
                      </div>
                    ) : null}
                  </div>
                  <KeyTermsBox agreement={agreement} />
                  <div className="grid grid-cols-2 gap-[6mm]" style={{ marginTop: '3mm', paddingBottom: '2.4mm', borderBottom: `1px solid ${HR}` }}>
                    <PartyBlock labelEn="FIRST PARTY" labelAr="الطرف الأول" p={agreement.firstParty} />
                    <PartyBlock labelEn="SECOND PARTY" labelAr="الطرف الثاني" p={agreement.secondParty} />
                  </div>
                  <div className="grid grid-cols-2 gap-[6mm]" style={{ marginTop: '2.6mm' }}>
                    <div style={{ textAlign: 'justify', fontFamily: EN_FONT, fontSize: '8.5pt', lineHeight: 1.5, color: INK }}>
                      <AgrClauseText text={agreement.intro.en} />
                    </div>
                    <div lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, fontSize: '8.8pt', textAlign: 'justify', lineHeight: 1.75, color: INK }}>
                      <AgrClauseText text={agreement.intro.ar} ar />
                    </div>
                  </div>
                  <div
                    className="flex items-center justify-between"
                    style={{ fontSize: '7.2pt', fontWeight: 700, color: NAVY, letterSpacing: '1pt', padding: '0 0 1mm', borderBottom: `1.4px solid ${NAVY}`, marginTop: '2.8mm', fontFamily: EN_FONT }}
                  >
                    <span>TERMS &amp; CONDITIONS</span>
                    <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, letterSpacing: 0, color: DARK_GOLD }}>
                      الشروط والأحكام
                    </span>
                  </div>
                </>
              ) : (
                <AgrContinuationHeader
                  titleEn={agreement.title.en}
                  titleAr={agreement.title.ar}
                  agreementNo={agreement.agreementNo}
                />
              )}

              {/* articles — big gold numerals both sides, never split */}
              {plan.arts.map((artIdx) => {
                const a = arts[artIdx]
                const n = artIdx + 1
                return (
                  <div
                    key={artIdx}
                    data-agr-art={artIdx + 1}
                    className="grid items-start"
                    style={{ gridTemplateColumns: '9mm 1fr 1fr 9mm', gap: '3mm', padding: '1.3mm 0', borderBottom: `1px solid ${HR}` }}
                  >
                    <span className="tabular-nums" style={{ fontFamily: MONO, fontSize: '12pt', fontWeight: 700, color: LIGHT_GOLD, lineHeight: 1.1 }}>
                      {String(n).padStart(2, '0')}
                    </span>
                    <div style={{ textAlign: 'justify', fontFamily: EN_FONT, fontSize: '8.5pt', lineHeight: 1.5, color: INK }}>
                      <AgrClauseText text={a.en} />
                    </div>
                    <div lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, fontSize: '8.7pt', textAlign: 'justify', lineHeight: 1.75, color: INK }}>
                      <AgrClauseText text={a.ar} ar />
                    </div>
                    <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, fontSize: '12pt', fontWeight: 700, color: LIGHT_GOLD, textAlign: 'right', lineHeight: 1.1 }}>
                      {arabicDigits(n)}
                    </span>
                  </div>
                )
              })}

              {/* tail — LAST PAGE ONLY */}
              {plan.hasTail ? (
                <>
                  <div
                    className="grid grid-cols-2 gap-[6mm]"
                    style={{ marginTop: '1.8mm', fontSize: '7.4pt', color: INK_SOFT, fontFamily: EN_FONT }}
                  >
                    <span style={{ fontStyle: 'italic' }}>{AGR_LANGUAGE_CLAUSE.en}</span>
                    <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, textAlign: 'right' }}>
                      {AGR_LANGUAGE_CLAUSE.ar}
                    </span>
                  </div>
                  <div style={{ flex: 1 }} />
                  <div data-agr-signatures className="grid grid-cols-2 gap-[8mm]">
                    <SignatureSection labelEn="FIRST PARTY" labelAr="الطرف الأول" p={agreement.firstParty} />
                    <SignatureSection labelEn="SECOND PARTY" labelAr="الطرف الثاني" p={agreement.secondParty} />
                  </div>
                </>
              ) : null}

              <div style={{ height: '3mm' }} />
              <AgrPageFooter agreementNo={agreement.agreementNo} pageIdx={pageIdx} totalPages={totalPages} />
            </div>
          </AgrTplPage>
        )
      })}
    </>
  )
}
