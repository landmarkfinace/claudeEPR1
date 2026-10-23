// Agreement print template "BILINGUAL CARDS" — reference design
// Agreement_Template_1_SubContract (HTML + PNG provided by the boss).
//
//   • centered serif EN title + AR title over a gold rule with a ◆ centre
//   • cream meta strip: Agreement No. · رقم العقد  |  Date · التاريخ (EN+AR)
//   • party CARDS with navy top borders and gold headers: name EN + AR,
//     C.R. no., address EN + AR, tel · fax (empty optional lines hide)
//   • bilingual preamble row (EN left | hairline | AR right)
//   • TERMS & CONDITIONS header; article rows: navy circle numbers (EN left,
//     Arabic-Indic ١ ٢ ٣ right), justified EN + AR, dotted separators
//   • language clause (italic EN / AR)
//   • navy signature cards with gold stamp circles, pinned to the BOTTOM of
//     the last page above the footer (with at least the last article)
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
  CREAM,
  CREAM_BORDER,
  DARK_GOLD,
  EN_FONT,
  EN_SERIF,
  FOOTER_LINE_MM,
  GOLD,
  HR,
  INK,
  INK_SOFT,
  MONO,
  NAVY,
  LIGHT_GOLD,
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
  splitBoldLabel,
  type AgrTextSpec,
} from './agreement-print-shared'

// ── Text metrics for this layout (CALIBRATED against real rendered heights
// with +15% print-render headroom — the daemon's page.pdf() pass can wrap
// Arabic text to one extra line vs screen media, so estimates must stay
// comfortably ABOVE real heights; over-estimating only moves a row to the
// next page, under-estimating clips) ────────────────────────────────────────
const EN_SPEC: AgrTextSpec = { charsPerLine: 42, lineMm: 4.8 } // 8.5pt justified col ≈ 78mm
const AR_SPEC: AgrTextSpec = { charsPerLine: 38, lineMm: 6.0 } // 8.7pt Naskh justified col ≈ 76mm
const EN_SPEC_WIDE: AgrTextSpec = { charsPerLine: 50, lineMm: 4.8 } // preamble (no number circle)
const AR_SPEC_WIDE: AgrTextSpec = { charsPerLine: 45, lineMm: 6.0 }
const ART_PAD_MM = 3.0 // row padding + dotted separator
const PRE_PAD_MM = 5.4 // preamble borders + padding

/** Party card height estimate from its content (wrapped lines counted, empty
 *  optional lines hide; calibrated against the live rows: Gusan 35mm,
 *  Landmark 46mm — the long Landmark address wraps to 3 lines). */
function partyCardMm(p: TemplateParty): number {
  const line = 4.4
  let mm = 5.0 // card padding + top border + header row
  mm += estLines(p.name.en, 32) * line
  if (p.name.ar) mm += estLines(p.name.ar, 28) * line
  if (p.crNo) mm += line
  if (p.address.en) mm += estLines(p.address.en, 54) * line
  if (p.address.ar) mm += estLines(p.address.ar, 48) * line
  if (p.tel || p.fax) mm += line
  return mm * 1.12
}

/** Bold-prefixed clause text — stored text unchanged, style only. */
export function AgrClauseText({ text, ar }: { text: string; ar?: boolean }) {
  const split = splitBoldLabel(text)
  if (!split) return <>{text}</>
  return (
    <>
      <b>{split.bold}</b> {split.rest}
    </>
  )
}

// ── Page-1 fixed blocks ─────────────────────────────────────────────────────

function TitleBlock({ titleEn, titleAr }: { titleEn: string; titleAr: string }) {
  return (
    <div
      className="relative text-center"
      style={{ paddingBottom: '2mm', borderBottom: `1.2px solid ${GOLD}` }}
    >
      <div style={{ fontFamily: EN_SERIF, fontSize: '13pt', fontWeight: 700, color: NAVY, letterSpacing: '0.6pt' }}>
        {titleEn}
      </div>
      {titleAr ? (
        <div lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, fontSize: '11pt', fontWeight: 700, color: NAVY, marginTop: '0.6mm' }}>
          {titleAr}
        </div>
      ) : null}
      <span
        aria-hidden
        className="absolute"
        style={{ left: '50%', bottom: '-2mm', transform: 'translateX(-50%)', background: '#fff', color: GOLD, fontSize: '7pt', padding: '0 1.5mm' }}
      >
        ◆
      </span>
    </div>
  )
}

function MetaStrip({ agreementNo, date }: { agreementNo: string; date: React.ReactNode }) {
  return (
    <div
      className="grid grid-cols-2"
      style={{ marginTop: '3mm', background: CREAM, border: `1px solid ${CREAM_BORDER}`, borderRadius: '1.5mm', fontFamily: EN_FONT }}
    >
      <div className="flex items-center justify-between" style={{ padding: '1.3mm 3.5mm', fontSize: '8pt' }}>
        <span style={{ color: INK_SOFT, fontSize: '7.3pt' }}>
          Agreement No. ·{' '}
          <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
            رقم العقد
          </span>
        </span>
        <b className="tabular-nums" style={{ color: NAVY, fontFamily: MONO }}>
          {agreementNo}
        </b>
      </div>
      <div className="flex items-center justify-between" style={{ padding: '1.3mm 3.5mm', fontSize: '8pt', borderLeft: `1px solid ${CREAM_BORDER}` }}>
        <span style={{ color: INK_SOFT, fontSize: '7.3pt' }}>
          Date ·{' '}
          <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
            التاريخ
          </span>
        </span>
        <b style={{ color: NAVY }}>{date}</b>
      </div>
    </div>
  )
}

function PartyCard({ labelEn, labelAr, p }: { labelEn: string; labelAr: string; p: TemplateParty }) {
  return (
    <div style={{ border: `1px solid ${HR}`, borderTop: `2.5px solid ${NAVY}`, borderRadius: '0 0 1.5mm 1.5mm', padding: '1.8mm 3.5mm', fontFamily: EN_FONT }}>
      <div className="flex items-center justify-between" style={{ fontSize: '7.3pt', fontWeight: 700, color: DARK_GOLD, letterSpacing: '0.6pt' }}>
        <span>{labelEn}</span>
        <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, letterSpacing: 0, fontSize: '8pt' }}>
          {labelAr}
        </span>
      </div>
      <div style={{ fontSize: '9.3pt', fontWeight: 700, color: NAVY, marginTop: '1mm', lineHeight: 1.3 }}>{p.name.en}</div>
      {p.name.ar ? (
        <div lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, fontSize: '9pt', fontWeight: 700, color: NAVY, textAlign: 'right', lineHeight: 1.4 }}>
          {p.name.ar}
        </div>
      ) : null}
      {p.crNo ? (
        <div style={{ fontSize: '7.4pt', color: INK, marginTop: '0.4mm', lineHeight: 1.4 }}>
          <span style={{ color: INK_SOFT }}>
            C.R. No. ·{' '}
            <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
              س.ت
            </span>
            :
          </span>{' '}
          <b className="tabular-nums" style={{ fontFamily: MONO }}>
            {p.crNo}
          </b>
        </div>
      ) : null}
      {p.address.en ? (
        <div style={{ fontSize: '7.4pt', color: INK, marginTop: '0.4mm', lineHeight: 1.4 }}>{p.address.en}</div>
      ) : null}
      {p.address.ar ? (
        <div lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, fontSize: '7.4pt', color: INK, textAlign: 'right', marginTop: '0.4mm', lineHeight: 1.5 }}>
          {p.address.ar}
        </div>
      ) : null}
      {p.tel || p.fax ? (
        <div style={{ fontSize: '7.4pt', color: INK, marginTop: '0.4mm', lineHeight: 1.4 }}>
          {p.tel ? (
            <>
              Tel: <b className="tabular-nums" style={{ fontFamily: MONO }}>{p.tel}</b>
            </>
          ) : null}
          {p.tel && p.fax ? ' · ' : null}
          {p.fax ? (
            <>
              Fax: <b className="tabular-nums" style={{ fontFamily: MONO }}>{p.fax}</b>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** Bilingual row: EN left | hairline | AR right (reference .bi). */
function BiRow({ en, ar }: { en: React.ReactNode; ar: React.ReactNode }) {
  return (
    <div className="grid items-start" style={{ gridTemplateColumns: '1fr 1px 1fr', gap: '5mm' }}>
      <div style={{ textAlign: 'justify', fontFamily: EN_FONT, fontSize: '8.5pt', lineHeight: 1.5, color: INK }}>{en}</div>
      <div style={{ background: HR }} />
      <div lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, fontSize: '8.7pt', textAlign: 'justify', lineHeight: 1.75, color: INK }}>
        {ar}
      </div>
    </div>
  )
}

// ── Signature card (reference .sc) ──────────────────────────────────────────
function SignatureCard({
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
      className="grid items-end"
      style={{ gridTemplateColumns: '12mm 1fr 11mm', fontSize: '7.2pt', marginTop: '1.4mm', fontFamily: EN_FONT, color: INK_SOFT }}
    >
      <span>{lbl}</span>
      <span
        style={{
          borderBottom: sign ? `1px solid ${NAVY}` : '1px dotted #9AA3B5',
          minHeight: sign ? '7.5mm' : '4.6mm',
          padding: '0 1mm 0.4mm',
          fontSize: '7.4pt',
          lineHeight: 1.3,
          fontWeight: 600,
          color: INK,
          textAlign: 'center',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
        }}
      >
        {value}
      </span>
      <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, textAlign: 'right' }}>
        {lblAr}
      </span>
    </div>
  )
  return (
    <div style={{ border: `1px solid ${HR}`, borderRadius: '1.5mm', overflow: 'hidden', fontFamily: EN_FONT }}>
      <div
        className="flex items-center justify-between"
        style={{ background: NAVY, color: '#fff', padding: '1.2mm 3.5mm', fontSize: '7.6pt', fontWeight: 700, letterSpacing: '0.5pt' }}
      >
        <span>{labelEn}</span>
        <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, color: LIGHT_GOLD, letterSpacing: 0 }}>
          {labelAr}
        </span>
      </div>
      <div
        className="flex items-start justify-between gap-[2mm]"
        style={{ padding: '1.2mm 3.5mm 0', fontSize: '7.4pt', fontWeight: 700, color: NAVY }}
      >
        <span className="min-w-0 truncate">{p.name.en}</span>
        {p.name.ar ? (
          <span lang="ar" dir="rtl" className="min-w-0 truncate" style={{ fontFamily: AR_FONT, fontSize: '7.8pt' }}>
            {p.name.ar}
          </span>
        ) : null}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1fr 20mm', gap: '2.5mm', padding: '0.6mm 3.5mm 2mm' }}>
        <div className="min-w-0">
          {field(
            'Name',
            'الاسم',
            <>
              {p.signatory.name.en}
              {p.signatory.name.ar ? (
                <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, marginLeft: '2mm' }}>
                  {p.signatory.name.ar}
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
                <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, marginLeft: '2mm' }}>
                  {p.signatory.title.ar}
                </span>
              ) : null}
            </>
          )}
          {field(
            'Sign',
            'التوقيع',
            p.signatureImg ? (
              <img src={p.signatureImg} alt="" style={{ maxHeight: '7mm', maxWidth: '100%', objectFit: 'contain' }} />
            ) : null,
            true
          )}
        </div>
        <div
          className="flex flex-col items-center justify-center self-center overflow-hidden text-center"
          style={{
            width: '18mm',
            height: '18mm',
            border: `1.2px dashed ${GOLD}`,
            borderRadius: '50%',
            fontSize: '6.2pt',
            color: DARK_GOLD,
            fontFamily: EN_FONT,
          }}
        >
          {p.stampImg ? (
            <img src={p.stampImg} alt="" style={{ maxWidth: '16mm', maxHeight: '16mm', objectFit: 'contain' }} />
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
export function AgreementBilingualCardsDocument({
  agreement,
  letterhead,
}: {
  agreement: TemplateAgreement
  letterhead: LetterheadConfig
}) {
  const geo = agrGeometryFor(letterhead)
  const arts = agrFillClauses(agreement)

  // fixed block heights (mm) — page 1 (calibrated)
  const titleMm = 19.5
  const metaMm = 11.5
  const partiesMm = Math.max(partyCardMm(agreement.firstParty), partyCardMm(agreement.secondParty)) + 3
  const preambleMm = estBiMm(agreement.intro.en, agreement.intro.ar, EN_SPEC_WIDE, AR_SPEC_WIDE) + PRE_PAD_MM + 3
  const termsHeaderMm = 7.5
  const page1Fixed = titleMm + metaMm + partiesMm + preambleMm + termsHeaderMm
  const contHeaderMm = 8
  const langClauseMm = 8
  const sigCardsMm = 45
  const tailMm = langClauseMm + 2.5 + sigCardsMm + 3 /* above footer */ + FOOTER_LINE_MM

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
            <div
              className="absolute inset-x-0 top-0 z-10 flex h-full flex-col [&>*]:shrink-0"
              style={{
                paddingTop: `${geo.topMm}mm`,
                paddingBottom: `${geo.bottomMm + 1}mm`,
                paddingLeft: '14mm',
                paddingRight: '14mm',
              }}
            >
              {pageIdx === 0 ? (
                <>
                  <TitleBlock titleEn={agreement.title.en} titleAr={agreement.title.ar} />
                  <MetaStrip
                    agreementNo={agreement.agreementNo}
                    date={
                      <>
                        {agrDateEn(agreement.date)} ·{' '}
                        <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                          {agrDateAr(agreement.date)}
                        </span>
                      </>
                    }
                  />
                  <div className="grid grid-cols-2 gap-[4mm]" style={{ marginTop: '3mm' }}>
                    <PartyCard labelEn="FIRST PARTY" labelAr="الطرف الأول" p={agreement.firstParty} />
                    <PartyCard labelEn="SECOND PARTY" labelAr="الطرف الثاني" p={agreement.secondParty} />
                  </div>
                  <div style={{ marginTop: '3mm', padding: '2mm 0', borderTop: `1px solid ${HR}`, borderBottom: `1px solid ${HR}` }}>
                    <BiRow
                      en={<AgrClauseText text={agreement.intro.en} />}
                      ar={<AgrClauseText text={agreement.intro.ar} ar />}
                    />
                  </div>
                  <div
                    className="flex items-center justify-between"
                    style={{ fontSize: '7.3pt', fontWeight: 700, color: DARK_GOLD, letterSpacing: '0.8pt', margin: '2mm 0 1mm', fontFamily: EN_FONT }}
                  >
                    <span>TERMS &amp; CONDITIONS</span>
                    <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, letterSpacing: 0, fontSize: '8pt' }}>
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

              {/* articles — a row is never split across pages */}
              {plan.arts.map((artIdx) => {
                const a = arts[artIdx]
                const n = artIdx + 1
                return (
                  <div
                    key={artIdx}
                    data-agr-art={artIdx + 1}
                    className="grid items-start"
                    style={{ gridTemplateColumns: '1fr 1px 1fr', gap: '5mm', padding: '1.1mm 0', borderBottom: '1px dotted #D9DEE6' }}
                  >
                    <div className="grid" style={{ gridTemplateColumns: '7mm 1fr' }}>
                      <span
                        className="flex items-center justify-center"
                        style={{
                          width: '5.2mm',
                          height: '5.2mm',
                          borderRadius: '50%',
                          background: NAVY,
                          color: LIGHT_GOLD,
                          fontSize: '6.8pt',
                          fontWeight: 700,
                          marginTop: '0.4mm',
                          fontFamily: EN_FONT,
                        }}
                      >
                        {n}
                      </span>
                      <div style={{ textAlign: 'justify', fontFamily: EN_FONT, fontSize: '8.5pt', lineHeight: 1.5 }}>
                        <AgrClauseText text={a.en} />
                      </div>
                    </div>
                    <div style={{ background: HR }} />
                    <div lang="ar" dir="rtl" className="grid" style={{ gridTemplateColumns: '1fr 7mm' }}>
                      <div style={{ fontFamily: AR_FONT, fontSize: '8.7pt', textAlign: 'justify', lineHeight: 1.75, paddingLeft: '1.5mm' }}>
                        <AgrClauseText text={a.ar} ar />
                      </div>
                      <span
                        className="flex items-center justify-center justify-self-end"
                        style={{
                          width: '5.2mm',
                          height: '5.2mm',
                          borderRadius: '50%',
                          background: NAVY,
                          color: LIGHT_GOLD,
                          fontSize: '6.8pt',
                          fontWeight: 700,
                          marginTop: '0.4mm',
                          fontFamily: AR_FONT,
                        }}
                      >
                        {arabicDigits(n)}
                      </span>
                    </div>
                  </div>
                )
              })}

              {/* tail — LAST PAGE ONLY: language clause + pinned signature cards */}
              {plan.hasTail ? (
                <>
                  <div
                    className="grid grid-cols-2 gap-[5mm]"
                    style={{ marginTop: '2mm', fontSize: '7.6pt', color: INK_SOFT, fontFamily: EN_FONT }}
                  >
                    <span style={{ fontStyle: 'italic' }}>{AGR_LANGUAGE_CLAUSE.en}</span>
                    <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, textAlign: 'right' }}>
                      {AGR_LANGUAGE_CLAUSE.ar}
                    </span>
                  </div>
                  <div style={{ flex: 1 }} />
                  <div data-agr-signatures className="grid grid-cols-2 gap-[5mm]">
                    <SignatureCard labelEn="FIRST PARTY" labelAr="الطرف الأول" p={agreement.firstParty} />
                    <SignatureCard labelEn="SECOND PARTY" labelAr="الطرف الثاني" p={agreement.secondParty} />
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
