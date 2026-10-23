// Agreement print template "OFFICIAL FORM" — reference design
// Agreement_Template_2_OfficialForm (HTML + PNG provided by the boss).
//
//   • double-bordered official title box (navy outer, gold inner keyline)
//   • form tables with full grids:
//       – meta row: Agreement No. | Date (EN+AR)
//       – FIRST PARTY / SECOND PARTY sections (navy header bars): Company,
//         C.R. No., Address EN (+tel/fax) with mirrored Arabic key column
//       – preamble table (EN left | AR right, justified)
//       – TERMS & CONDITIONS table: EN left | No. column (EN digit over
//         Arabic-Indic digit) | AR right
//   • language clause (italic EN / AR)
//   • signature table: Name / Title / big Signature & Stamp cells
//     (pinned to the BOTTOM of the last page above the footer, together
//     with at least the last article)
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
  EN_SERIF,
  FOOTER_LINE_MM,
  GOLD,
  HR,
  INK,
  INK_SOFT,
  KEYGRAY,
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
import { AgrClauseText } from './agreement-print-bilingual-cards'

// ── Text metrics for this layout (CALIBRATED with print-render headroom) ────
// table: EN cell ≈ 76mm, No. cell 9mm, AR cell ≈ 76mm. NOTE: the number
// cell (EN digit over Arabic-Indic digit) imposes a ≈11mm row FLOOR.
const EN_SPEC: AgrTextSpec = { charsPerLine: 42, lineMm: 4.8 }
const AR_SPEC: AgrTextSpec = { charsPerLine: 40, lineMm: 6.0 }
const EN_SPEC_WIDE: AgrTextSpec = { charsPerLine: 46, lineMm: 4.8 }
const AR_SPEC_WIDE: AgrTextSpec = { charsPerLine: 44, lineMm: 6.0 }
const ART_PAD_MM = 3.0 // cell padding + row border
const ART_FLOOR_MM = 11.0 // the two-line number cell floor (measured 10.72)
const PRE_PAD_MM = 4.2

const CELL_BORDER = '#AEB8C7'

/** Party section height estimate (wrapped lines counted, calibrated against
 *  the live rows: Gusan section 30mm, Landmark section 55mm). */
function partySectionMm(p: TemplateParty): number {
  const line = 4.6
  let mm = 7.0 // navy header bar
  // company row: EN + AR side by side → the taller side
  mm += Math.max(estLines(p.name.en, 38), p.name.ar ? estLines(p.name.ar, 34) : 1) * line
  if (p.crNo) mm += line
  if (p.address.en || p.address.ar || p.tel || p.fax) {
    const addrEn =
      p.address.en +
      (p.tel ? ` Tel ${p.tel}` : '') +
      (p.fax ? ` Fax ${p.fax}` : '')
    mm += Math.max(estLines(addrEn, 44), p.address.ar ? estLines(p.address.ar, 40) : 1) * line
  }
  return (mm + 1.5) * 1.1
}

// ── Page-1 fixed blocks ─────────────────────────────────────────────────────

function OfficialTitleBox({ titleEn, titleAr }: { titleEn: string; titleAr: string }) {
  return (
    <div className="relative text-center" style={{ border: `1.5px solid ${NAVY}`, padding: '1.8mm 0' }}>
      <span aria-hidden className="absolute" style={{ inset: '1mm', border: `0.5px solid ${GOLD}` }} />
      <div style={{ fontFamily: EN_SERIF, fontSize: '13pt', fontWeight: 700, color: NAVY, letterSpacing: '1.5pt' }}>
        {titleEn}
      </div>
      {titleAr ? (
        <div lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, fontSize: '11.5pt', fontWeight: 700, color: DARK_GOLD, marginTop: '0.4mm' }}>
          {titleAr}
        </div>
      ) : null}
    </div>
  )
}

function Th({
  children,
  ar,
  left,
  colSpan,
}: {
  children: React.ReactNode
  ar?: boolean
  left?: boolean
  colSpan?: number
}) {
  return (
    <th
      colSpan={colSpan}
      style={{
        background: NAVY,
        color: ar ? LIGHT_GOLD : '#fff',
        fontSize: '7.4pt',
        fontWeight: 700,
        letterSpacing: '0.4pt',
        padding: '1mm 2.2mm',
        textAlign: left ? 'left' : ar ? 'right' : 'center',
        fontFamily: ar ? AR_FONT : EN_FONT,
        ...(ar ? ({ direction: 'rtl' } as React.CSSProperties) : {}),
      }}
    >
      {children}
    </th>
  )
}

function Kd({ children, ar }: { children: React.ReactNode; ar?: boolean }) {
  return (
    <td
      style={{
        width: ar ? '20mm' : '22mm',
        background: KEYGRAY,
        color: INK_SOFT,
        fontSize: '7pt',
        lineHeight: 1.3,
        padding: '0.9mm 2.2mm',
        verticalAlign: 'top',
        fontFamily: ar ? AR_FONT : EN_FONT,
        ...(ar ? ({ direction: 'rtl', textAlign: 'right' } as React.CSSProperties) : {}),
      }}
    >
      {children}
    </td>
  )
}

/** Value cell for the party tables (module scope — never re-created per render). */
function PartyValue({
  children,
  ar,
  mono,
}: {
  children: React.ReactNode
  ar?: boolean
  mono?: boolean
}) {
  return (
    <td
      style={{
        fontWeight: 600,
        fontSize: '7.9pt',
        padding: '0.9mm 2.2mm',
        verticalAlign: 'top',
        color: INK,
        fontFamily: ar ? AR_FONT : mono ? MONO : EN_FONT,
        ...(ar ? ({ direction: 'rtl', textAlign: 'right' } as React.CSSProperties) : {}),
      }}
    >
      {children}
    </td>
  )
}

function PartySection({ labelEn, labelAr, p }: { labelEn: string; labelAr: string; p: TemplateParty }) {
  return (
    <>
      <tr>
        <Th colSpan={2}>{labelEn}</Th>
        <Th colSpan={2} ar>
          {labelAr}
        </Th>
      </tr>
      <tr>
        <Kd>Company</Kd>
        <PartyValue>{p.name.en}</PartyValue>
        <PartyValue ar>{p.name.ar}</PartyValue>
        <Kd ar>الشركة</Kd>
      </tr>
      {p.crNo ? (
        <tr>
          <Kd>C.R. No.</Kd>
          <PartyValue mono>{p.crNo}</PartyValue>
          <PartyValue ar mono>
            {p.crNo}
          </PartyValue>
          <Kd ar>س.ت</Kd>
        </tr>
      ) : null}
      {p.address.en || p.address.ar || p.tel || p.fax ? (
        <tr>
          <Kd>Address</Kd>
          <PartyValue>
            {p.address.en}
            {p.tel || p.fax ? (
              <>
                {p.address.en ? <br /> : null}
                {p.tel ? <>Tel {p.tel}</> : null}
                {p.tel && p.fax ? ' · ' : null}
                {p.fax ? <>Fax {p.fax}</> : null}
              </>
            ) : null}
          </PartyValue>
          <PartyValue ar>{p.address.ar}</PartyValue>
          <Kd ar>العنوان</Kd>
        </tr>
      ) : null}
    </>
  )
}

// ── Signature table (reference .sg) ─────────────────────────────────────────
/** Label / value cell for the signature table (module scope). */
function SgCell({
  children,
  lab,
  ar,
}: {
  children: React.ReactNode
  lab?: boolean
  ar?: boolean
}) {
  return (
    <td
      style={{
        border: `1px solid ${CELL_BORDER}`,
        height: lab ? undefined : '6mm',
        fontSize: '7.4pt',
        padding: '0.9mm 2.2mm',
        verticalAlign: 'top',
        color: lab ? INK_SOFT : INK,
        fontFamily: ar ? AR_FONT : EN_FONT,
        ...(lab ? { width: '18mm', background: KEYGRAY } : {}),
        ...(ar && lab ? ({ direction: 'rtl', textAlign: 'right' } as React.CSSProperties) : {}),
      }}
    >
      {children}
    </td>
  )
}

/** Big "Signature & Company Stamp" cell — the saved stamp image when set. */
function SgStampCell({ p }: { p: TemplateParty }) {
  return (
    <td
      style={{
        border: `1px solid ${CELL_BORDER}`,
        height: '16mm',
        textAlign: 'center',
        verticalAlign: 'bottom',
        padding: '0.9mm 2.2mm',
        fontSize: '6.2pt',
        color: '#B9A27A',
        fontFamily: EN_FONT,
      }}
    >
      {p.stampImg ? (
        <img src={p.stampImg} alt="" style={{ maxHeight: '13mm', maxWidth: '30mm', objectFit: 'contain' }} />
      ) : (
        <>
          Signature &amp; Company Stamp
          <br />
          <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
            التوقيع وختم الشركة
          </span>
        </>
      )}
    </td>
  )
}

function SignatureTable({ first, second }: { first: TemplateParty; second: TemplateParty }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '2.6mm', fontFamily: EN_FONT }}>
      <tbody>
        <tr>
          <Th colSpan={3}>FIRST PARTY · الطرف الأول</Th>
          <Th colSpan={3}>SECOND PARTY · الطرف الثاني</Th>
        </tr>
        <tr>
          <SgCell lab>Name</SgCell>
          <SgCell>
            {first.signatory.name.en}
            {first.signatory.name.ar ? (
              <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                {' '}
                {first.signatory.name.ar}
              </span>
            ) : null}
          </SgCell>
          <SgCell lab ar>الاسم</SgCell>
          <SgCell lab>Name</SgCell>
          <SgCell>
            {second.signatory.name.en}
            {second.signatory.name.ar ? (
              <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                {' '}
                {second.signatory.name.ar}
              </span>
            ) : null}
          </SgCell>
          <SgCell lab ar>الاسم</SgCell>
        </tr>
        <tr>
          <SgCell lab>Title</SgCell>
          <SgCell>
            {first.signatory.title.en}
            {first.signatory.title.ar ? (
              <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                {' '}
                {first.signatory.title.ar}
              </span>
            ) : null}
          </SgCell>
          <SgCell lab ar>المنصب</SgCell>
          <SgCell lab>Title</SgCell>
          <SgCell>
            {second.signatory.title.en}
            {second.signatory.title.ar ? (
              <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                {' '}
                {second.signatory.title.ar}
              </span>
            ) : null}
          </SgCell>
          <SgCell lab ar>المنصب</SgCell>
        </tr>
        <tr>
          <SgCell lab>
            Signature
            <br />
            &amp; Stamp
          </SgCell>
          <SgStampCell p={first} />
          <SgCell lab ar>
            التوقيع
            <br />
            والختم
          </SgCell>
          <SgCell lab>
            Signature
            <br />
            &amp; Stamp
          </SgCell>
          <SgStampCell p={second} />
          <SgCell lab ar>
            التوقيع
            <br />
            والختم
          </SgCell>
        </tr>
      </tbody>
    </table>
  )
}

// ── Document ────────────────────────────────────────────────────────────────
export function AgreementOfficialFormDocument({
  agreement,
  letterhead,
}: {
  agreement: TemplateAgreement
  letterhead: LetterheadConfig
}) {
  const geo = agrGeometryFor(letterhead)
  const arts = agrFillClauses(agreement)

  const titleMm = 20
  const metaMm = 14.5
  const partiesMm =
    3 + partySectionMm(agreement.firstParty) + partySectionMm(agreement.secondParty)
  const preambleMm = estBiMm(agreement.intro.en, agreement.intro.ar, EN_SPEC_WIDE, AR_SPEC_WIDE) + PRE_PAD_MM + 3
  const termsHeaderMm = 7
  const page1Fixed = titleMm + metaMm + partiesMm + preambleMm + termsHeaderMm
  const contHeaderMm = 8
  const langClauseMm = 7.5
  const sigTableMm = 46
  const tailMm = langClauseMm + sigTableMm + 3 + FOOTER_LINE_MM

  const artsMm = arts.map((a) =>
    Math.max(estArticleMm(a, EN_SPEC, AR_SPEC, ART_PAD_MM), ART_FLOOR_MM)
  )
  const SAFETY_MM = 5 // print-render wrap variance buffer
  const availFirst = PAGE_H_MM - geo.topMm - geo.bottomMm - page1Fixed - FOOTER_LINE_MM - SAFETY_MM
  const availRest = PAGE_H_MM - geo.topMm - geo.bottomMm - contHeaderMm - FOOTER_LINE_MM - SAFETY_MM
  const planned = planAgrPages({ availFirst, availRest, artsMm, tailMm })
  const pages = planned.pages
  const totalPages = planned.totalPages

  const tdStyle = (ar?: boolean): React.CSSProperties => ({
    border: `1px solid ${CELL_BORDER}`,
    textAlign: 'justify',
    fontSize: ar ? '8.3pt' : '8pt',
    lineHeight: ar ? 1.7 : 1.4,
    padding: '0.9mm 2.2mm',
    verticalAlign: 'top',
    color: INK,
    fontFamily: ar ? AR_FONT : EN_FONT,
    ...(ar ? ({ direction: 'rtl' } as React.CSSProperties) : {}),
  })

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
                  <OfficialTitleBox titleEn={agreement.title.en} titleAr={agreement.title.ar} />
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '2mm', fontFamily: EN_FONT }}>
                    <tbody>
                      <tr>
                        <Kd>
                          Agreement No.
                          <br />
                          <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                            رقم العقد
                          </span>
                        </Kd>
                        <td
                          colSpan={2}
                          style={{
                            fontWeight: 600,
                            fontSize: '7.9pt',
                            padding: '0.9mm 2.2mm',
                            fontFamily: MONO,
                            color: INK,
                            border: `1px solid ${CELL_BORDER}`,
                          }}
                        >
                          {agreement.agreementNo}
                        </td>
                        <Kd>
                          Date
                          <br />
                          <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                            التاريخ
                          </span>
                        </Kd>
                        <td style={{ ...tdStyle(), textAlign: 'left', fontWeight: 600 }}>
                          {agrDateEn(agreement.date)} ·{' '}
                          <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT }}>
                            {agrDateAr(agreement.date)}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '2mm', fontFamily: EN_FONT }}>
                    <tbody>
                      <PartySection labelEn="FIRST PARTY" labelAr="الطرف الأول" p={agreement.firstParty} />
                      <PartySection labelEn="SECOND PARTY" labelAr="الطرف الثاني" p={agreement.secondParty} />
                    </tbody>
                  </table>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '2mm' }}>
                    <tbody>
                      <tr>
                        <td style={tdStyle()}>
                          <AgrClauseText text={agreement.intro.en} />
                        </td>
                        <td style={tdStyle(true)}>
                          <AgrClauseText text={agreement.intro.ar} ar />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </>
              ) : (
                <AgrContinuationHeader
                  titleEn={agreement.title.en}
                  titleAr={agreement.title.ar}
                  agreementNo={agreement.agreementNo}
                />
              )}

              {/* TERMS & CONDITIONS table — one row per article, never split */}
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: pageIdx === 0 ? 0 : '2mm' }}>
                <tbody>
                  {pageIdx === 0 || plan.arts.length > 0 ? (
                    <tr>
                      <Th left>TERMS &amp; CONDITIONS</Th>
                      <Th>No.</Th>
                      <Th ar>الشروط والأحكام</Th>
                    </tr>
                  ) : null}
                  {plan.arts.map((artIdx) => {
                    const a = arts[artIdx]
                    const n = artIdx + 1
                    return (
                      <tr key={artIdx} data-agr-art={artIdx + 1}>
                        <td style={tdStyle()}>
                          <AgrClauseText text={a.en} />
                        </td>
                        <td
                          style={{
                            border: `1px solid ${CELL_BORDER}`,
                            width: '9mm',
                            textAlign: 'center',
                            verticalAlign: 'middle',
                            background: '#FAF7F1',
                            color: DARK_GOLD,
                            fontWeight: 700,
                            fontFamily: MONO,
                            fontSize: '8.5pt',
                            padding: '1mm',
                          }}
                        >
                          {n}
                          <small
                            lang="ar"
                            dir="rtl"
                            style={{ display: 'block', fontFamily: AR_FONT, fontSize: '7.5pt', fontWeight: 700 }}
                          >
                            {arabicDigits(n)}
                          </small>
                        </td>
                        <td style={tdStyle(true)}>
                          <AgrClauseText text={a.ar} ar />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* tail — LAST PAGE ONLY */}
              {plan.hasTail ? (
                <>
                  <div
                    className="grid grid-cols-2 gap-[5mm]"
                    style={{ fontSize: '7.2pt', color: INK_SOFT, marginTop: '1.4mm', fontFamily: EN_FONT }}
                  >
                    <span style={{ fontStyle: 'italic' }}>{AGR_LANGUAGE_CLAUSE.en}</span>
                    <span lang="ar" dir="rtl" style={{ fontFamily: AR_FONT, textAlign: 'right' }}>
                      {AGR_LANGUAGE_CLAUSE.ar}
                    </span>
                  </div>
                  <div style={{ flex: 1 }} />
                  <div data-agr-signatures>
                    <SignatureTable first={agreement.firstParty} second={agreement.secondParty} />
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
