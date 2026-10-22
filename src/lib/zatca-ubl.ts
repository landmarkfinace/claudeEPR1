// ─────────────────────────────────────────────────────────────────────────────
// ZATCA UBL 2.1 e-invoice XML — builder, invoice hash, XAdES signature, QR.
//
// Follows the ZATCA "XML Implementation Standard" (KSA UBL profile) and the
// "Security Features Implementation Standards":
//   • root <Invoice> for invoices AND notes; InvoiceTypeCode 388 / 381 / 383
//     with name="0100000" (standard B2B) or "0200000" (simplified B2C)
//   • ProfileID reporting:1.0, UUID, ICV (KSA-16), PIH (KSA-13), QR (KSA-14),
//     cac:Signature, element order per the UBL 2.1 XSD
//   • invoice hash = SHA-256 over the C14N11 canonical form of the document
//     with ext:UBLExtensions, cac:Signature and the QR reference removed
//   • XAdES-BES enveloped signature inside ext:UBLExtensions
//   • QR TLV tags 1-9 (8 = public key DER, 9 = certificate signature)
//
// The XML is written so that the text we hash IS its canonical form: no
// XML declaration inside the hashed part, no self-closing elements, sorted
// namespace declarations, C14N character escaping and LF line endings.
// Removing the three excluded elements therefore only means leaving their
// slots empty — exactly what the XPath transforms + C14N produce.
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto'
import { round2 } from '@/lib/format'
import { tlvEncode, signHash, type ZatcaSigner, type ZatcaSellerInfo } from '@/lib/zatca'

// ── Escaping (C14N rules) ───────────────────────────────────────────────────

const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g

export function xmlText(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(INVALID_XML, '')
    .replace(/\r\n?/g, '\n')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function xmlAttr(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;')
}

const money = (n: number) => round2(n).toFixed(2)
/** quantities: up to 6 decimals, no trailing zeros */
const qty = (n: number) => String(Math.round(n * 1e6) / 1e6)

// ── Input model ─────────────────────────────────────────────────────────────

export type UblDocType = 'invoice' | 'credit_note' | 'debit_note'
export type UblKind = 'standard' | 'simplified'
export type UblTaxCategory = 'S' | 'Z' | 'E' | 'O'

export type UblLine = {
  id: number
  name: string
  quantity: number
  unitCode: string
  unitPrice: number
  discount: number
  lineExtension: number // qty × price − discount
  vatPercent: number
  vatAmount: number
  taxCategory: UblTaxCategory
}

export type UblBuyer = {
  name: string
  vatNumber: string | null
  crNumber: string | null
  street: string | null
  buildingNo: string | null
  district: string | null
  city: string | null
  postalCode: string | null
  country: string
}

export type UblDocument = {
  docType: UblDocType
  kind: UblKind
  number: string
  uuid: string
  issueDate: string // YYYY-MM-DD (KSA)
  issueTime: string // HH:mm:ss (KSA)
  supplyDate: string | null
  dueDate: string | null
  currency: string
  icv: number
  pih: string
  billingReference: string | null // original invoice number (notes)
  noteReason: string | null
  paymentMeansCode: string
  iban: string | null
  poRef: string | null
  contractRef: string | null
  seller: ZatcaSellerInfo
  buyer: UblBuyer
  lines: UblLine[]
  taxSubtotals: {
    category: UblTaxCategory
    percent: number
    taxable: number
    vat: number
    exemptionCode: string | null
    exemptionReason: string | null
  }[]
  lineExtensionTotal: number
  taxExclusiveTotal: number
  vatTotal: number
  taxInclusiveTotal: number
  payableAmount: number
}

const TYPE_CODE: Record<UblDocType, string> = { invoice: '388', credit_note: '381', debit_note: '383' }

/** UN/ECE Rec 20 unit codes for the units the ERP uses. */
export function unitCodeFor(unit: string | null | undefined): string {
  const u = (unit ?? '').trim().toLowerCase()
  if (/^(hr|hrs|hour|hours|h)$/.test(u)) return 'HUR'
  if (/^(day|days|d)$/.test(u)) return 'DAY'
  if (/^(month|months|mon|mo)$/.test(u)) return 'MON'
  if (/^(week|weeks|wk)$/.test(u)) return 'WEE'
  if (/^(trip|trips)$/.test(u)) return 'C62'
  return 'PCE'
}

// ── Builder ─────────────────────────────────────────────────────────────────

type Slots = { extensions: string; qr: string; signature: string }

function partyAddress(
  indent: string,
  a: { street: string | null; buildingNo: string | null; additionalNo?: string | null; district: string | null; city: string | null; postalCode: string | null; country: string }
): string {
  const i = indent
  const rows: string[] = []
  if (a.street) rows.push(`${i}    <cbc:StreetName>${xmlText(a.street)}</cbc:StreetName>`)
  if (a.buildingNo) rows.push(`${i}    <cbc:BuildingNumber>${xmlText(a.buildingNo)}</cbc:BuildingNumber>`)
  if (a.additionalNo) rows.push(`${i}    <cbc:PlotIdentification>${xmlText(a.additionalNo)}</cbc:PlotIdentification>`)
  if (a.district) rows.push(`${i}    <cbc:CitySubdivisionName>${xmlText(a.district)}</cbc:CitySubdivisionName>`)
  if (a.city) rows.push(`${i}    <cbc:CityName>${xmlText(a.city)}</cbc:CityName>`)
  if (a.postalCode) rows.push(`${i}    <cbc:PostalZone>${xmlText(a.postalCode)}</cbc:PostalZone>`)
  rows.push(`${i}    <cac:Country>`)
  rows.push(`${i}        <cbc:IdentificationCode>${xmlText(a.country || 'SA')}</cbc:IdentificationCode>`)
  rows.push(`${i}    </cac:Country>`)
  return `${i}<cac:PostalAddress>\n${rows.join('\n')}\n${i}</cac:PostalAddress>`
}

function taxCategoryXml(indent: string, tag: 'TaxCategory' | 'ClassifiedTaxCategory', cat: string, percent: number, exCode?: string | null, exReason?: string | null): string {
  const i = indent
  return [
    `${i}<cac:${tag}>`,
    `${i}    <cbc:ID>${cat}</cbc:ID>`,
    `${i}    <cbc:Percent>${money(percent)}</cbc:Percent>`,
    ...(exCode ? [`${i}    <cbc:TaxExemptionReasonCode>${xmlText(exCode)}</cbc:TaxExemptionReasonCode>`] : []),
    ...(exReason ? [`${i}    <cbc:TaxExemptionReason>${xmlText(exReason)}</cbc:TaxExemptionReason>`] : []),
    `${i}    <cac:TaxScheme>`,
    `${i}        <cbc:ID>VAT</cbc:ID>`,
    `${i}    </cac:TaxScheme>`,
    `${i}</cac:${tag}>`,
  ].join('\n')
}

function buildXml(d: UblDocument, slots: Slots): string {
  const cur = xmlAttr(d.currency)
  const typeName = d.kind === 'simplified' ? '0200000' : '0100000'
  const s = d.seller
  const b = d.buyer
  const out: string[] = []
  out.push(
    `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">`
  )
  out.push(`    ${slots.extensions}`)
  out.push(`    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>`)
  out.push(`    <cbc:ID>${xmlText(d.number)}</cbc:ID>`)
  out.push(`    <cbc:UUID>${xmlText(d.uuid)}</cbc:UUID>`)
  out.push(`    <cbc:IssueDate>${d.issueDate}</cbc:IssueDate>`)
  out.push(`    <cbc:IssueTime>${d.issueTime}</cbc:IssueTime>`)
  if (d.dueDate) out.push(`    <cbc:DueDate>${d.dueDate}</cbc:DueDate>`)
  out.push(`    <cbc:InvoiceTypeCode name="${typeName}">${TYPE_CODE[d.docType]}</cbc:InvoiceTypeCode>`)
  out.push(`    <cbc:DocumentCurrencyCode>${xmlText(d.currency)}</cbc:DocumentCurrencyCode>`)
  out.push(`    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>`)
  if (d.poRef) {
    out.push(`    <cac:OrderReference>`)
    out.push(`        <cbc:ID>${xmlText(d.poRef)}</cbc:ID>`)
    out.push(`    </cac:OrderReference>`)
  }
  if (d.billingReference) {
    out.push(`    <cac:BillingReference>`)
    out.push(`        <cac:InvoiceDocumentReference>`)
    out.push(`            <cbc:ID>${xmlText(d.billingReference)}</cbc:ID>`)
    out.push(`        </cac:InvoiceDocumentReference>`)
    out.push(`    </cac:BillingReference>`)
  }
  if (d.contractRef) {
    out.push(`    <cac:ContractDocumentReference>`)
    out.push(`        <cbc:ID>${xmlText(d.contractRef)}</cbc:ID>`)
    out.push(`    </cac:ContractDocumentReference>`)
  }
  out.push(`    <cac:AdditionalDocumentReference>`)
  out.push(`        <cbc:ID>ICV</cbc:ID>`)
  out.push(`        <cbc:UUID>${d.icv}</cbc:UUID>`)
  out.push(`    </cac:AdditionalDocumentReference>`)
  out.push(`    <cac:AdditionalDocumentReference>`)
  out.push(`        <cbc:ID>PIH</cbc:ID>`)
  out.push(`        <cac:Attachment>`)
  out.push(`            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${xmlText(d.pih)}</cbc:EmbeddedDocumentBinaryObject>`)
  out.push(`        </cac:Attachment>`)
  out.push(`    </cac:AdditionalDocumentReference>`)
  out.push(`    ${slots.qr}`)
  out.push(`    ${slots.signature}`)

  // Seller
  out.push(`    <cac:AccountingSupplierParty>`)
  out.push(`        <cac:Party>`)
  if (s.crNumber) {
    out.push(`            <cac:PartyIdentification>`)
    out.push(`                <cbc:ID schemeID="CRN">${xmlText(s.crNumber)}</cbc:ID>`)
    out.push(`            </cac:PartyIdentification>`)
  }
  out.push(
    partyAddress('            ', {
      street: s.national.street,
      buildingNo: s.national.buildingNo,
      additionalNo: s.national.additionalNo,
      district: s.national.district,
      city: s.national.city,
      postalCode: s.national.postalCode,
      country: 'SA',
    })
  )
  out.push(`            <cac:PartyTaxScheme>`)
  out.push(`                <cbc:CompanyID>${xmlText(s.vatNumber)}</cbc:CompanyID>`)
  out.push(`                <cac:TaxScheme>`)
  out.push(`                    <cbc:ID>VAT</cbc:ID>`)
  out.push(`                </cac:TaxScheme>`)
  out.push(`            </cac:PartyTaxScheme>`)
  out.push(`            <cac:PartyLegalEntity>`)
  out.push(`                <cbc:RegistrationName>${xmlText(s.companyName)}</cbc:RegistrationName>`)
  out.push(`            </cac:PartyLegalEntity>`)
  out.push(`        </cac:Party>`)
  out.push(`    </cac:AccountingSupplierParty>`)

  // Buyer
  out.push(`    <cac:AccountingCustomerParty>`)
  out.push(`        <cac:Party>`)
  if (!b.vatNumber && b.crNumber) {
    // BR-KSA-14: a buyer without VAT number is identified by another ID (CRN)
    out.push(`            <cac:PartyIdentification>`)
    out.push(`                <cbc:ID schemeID="CRN">${xmlText(b.crNumber)}</cbc:ID>`)
    out.push(`            </cac:PartyIdentification>`)
  }
  if (b.street || b.city || d.kind === 'standard') {
    out.push(partyAddress('            ', b))
  }
  if (b.vatNumber) {
    out.push(`            <cac:PartyTaxScheme>`)
    out.push(`                <cbc:CompanyID>${xmlText(b.vatNumber)}</cbc:CompanyID>`)
    out.push(`                <cac:TaxScheme>`)
    out.push(`                    <cbc:ID>VAT</cbc:ID>`)
    out.push(`                </cac:TaxScheme>`)
    out.push(`            </cac:PartyTaxScheme>`)
  }
  if (b.name) {
    out.push(`            <cac:PartyLegalEntity>`)
    out.push(`                <cbc:RegistrationName>${xmlText(b.name)}</cbc:RegistrationName>`)
    out.push(`            </cac:PartyLegalEntity>`)
  }
  out.push(`        </cac:Party>`)
  out.push(`    </cac:AccountingCustomerParty>`)

  if (d.supplyDate) {
    out.push(`    <cac:Delivery>`)
    out.push(`        <cbc:ActualDeliveryDate>${d.supplyDate}</cbc:ActualDeliveryDate>`)
    out.push(`    </cac:Delivery>`)
  }

  out.push(`    <cac:PaymentMeans>`)
  out.push(`        <cbc:PaymentMeansCode>${xmlText(d.paymentMeansCode || '1')}</cbc:PaymentMeansCode>`)
  if (d.noteReason) out.push(`        <cbc:InstructionNote>${xmlText(d.noteReason)}</cbc:InstructionNote>`)
  if (d.iban && (d.paymentMeansCode === '30' || d.paymentMeansCode === '42')) {
    out.push(`        <cac:PayeeFinancialAccount>`)
    out.push(`            <cbc:ID>${xmlText(d.iban)}</cbc:ID>`)
    out.push(`        </cac:PayeeFinancialAccount>`)
  }
  out.push(`    </cac:PaymentMeans>`)

  // Tax totals: first in tax currency (SAR) amount only, then with breakdown
  out.push(`    <cac:TaxTotal>`)
  out.push(`        <cbc:TaxAmount currencyID="SAR">${money(d.vatTotal)}</cbc:TaxAmount>`)
  out.push(`    </cac:TaxTotal>`)
  out.push(`    <cac:TaxTotal>`)
  out.push(`        <cbc:TaxAmount currencyID="${cur}">${money(d.vatTotal)}</cbc:TaxAmount>`)
  for (const st of d.taxSubtotals) {
    out.push(`        <cac:TaxSubtotal>`)
    out.push(`            <cbc:TaxableAmount currencyID="${cur}">${money(st.taxable)}</cbc:TaxableAmount>`)
    out.push(`            <cbc:TaxAmount currencyID="${cur}">${money(st.vat)}</cbc:TaxAmount>`)
    out.push(taxCategoryXml('            ', 'TaxCategory', st.category, st.percent, st.exemptionCode, st.exemptionReason))
    out.push(`        </cac:TaxSubtotal>`)
  }
  out.push(`    </cac:TaxTotal>`)

  out.push(`    <cac:LegalMonetaryTotal>`)
  out.push(`        <cbc:LineExtensionAmount currencyID="${cur}">${money(d.lineExtensionTotal)}</cbc:LineExtensionAmount>`)
  out.push(`        <cbc:TaxExclusiveAmount currencyID="${cur}">${money(d.taxExclusiveTotal)}</cbc:TaxExclusiveAmount>`)
  out.push(`        <cbc:TaxInclusiveAmount currencyID="${cur}">${money(d.taxInclusiveTotal)}</cbc:TaxInclusiveAmount>`)
  out.push(`        <cbc:AllowanceTotalAmount currencyID="${cur}">0.00</cbc:AllowanceTotalAmount>`)
  out.push(`        <cbc:PrepaidAmount currencyID="${cur}">0.00</cbc:PrepaidAmount>`)
  out.push(`        <cbc:PayableAmount currencyID="${cur}">${money(d.payableAmount)}</cbc:PayableAmount>`)
  out.push(`    </cac:LegalMonetaryTotal>`)

  for (const l of d.lines) {
    out.push(`    <cac:InvoiceLine>`)
    out.push(`        <cbc:ID>${l.id}</cbc:ID>`)
    out.push(`        <cbc:InvoicedQuantity unitCode="${xmlAttr(l.unitCode)}">${qty(l.quantity)}</cbc:InvoicedQuantity>`)
    out.push(`        <cbc:LineExtensionAmount currencyID="${cur}">${money(l.lineExtension)}</cbc:LineExtensionAmount>`)
    if (l.discount > 0) {
      out.push(`        <cac:AllowanceCharge>`)
      out.push(`            <cbc:ChargeIndicator>false</cbc:ChargeIndicator>`)
      out.push(`            <cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode>`)
      out.push(`            <cbc:AllowanceChargeReason>Discount</cbc:AllowanceChargeReason>`)
      out.push(`            <cbc:Amount currencyID="${cur}">${money(l.discount)}</cbc:Amount>`)
      out.push(`        </cac:AllowanceCharge>`)
    }
    out.push(`        <cac:TaxTotal>`)
    out.push(`            <cbc:TaxAmount currencyID="${cur}">${money(l.vatAmount)}</cbc:TaxAmount>`)
    out.push(`            <cbc:RoundingAmount currencyID="${cur}">${money(l.lineExtension + l.vatAmount)}</cbc:RoundingAmount>`)
    out.push(`        </cac:TaxTotal>`)
    out.push(`        <cac:Item>`)
    out.push(`            <cbc:Name>${xmlText(l.name)}</cbc:Name>`)
    out.push(taxCategoryXml('            ', 'ClassifiedTaxCategory', l.taxCategory, l.vatPercent))
    out.push(`        </cac:Item>`)
    out.push(`        <cac:Price>`)
    out.push(`            <cbc:PriceAmount currencyID="${cur}">${money(l.unitPrice)}</cbc:PriceAmount>`)
    out.push(`        </cac:Price>`)
    out.push(`    </cac:InvoiceLine>`)
  }
  out.push(`</Invoice>`)
  return out.join('\n')
}

// ── Hash ────────────────────────────────────────────────────────────────────

/**
 * ZATCA invoice hash (KSA-13 / PIH of the next document): base64 SHA-256 of
 * the canonical document without UBLExtensions, cac:Signature and the QR
 * reference. Because buildXml emits canonical text, the hashed form is the
 * document with those three slots left empty.
 */
export function invoiceHashOf(d: UblDocument): string {
  const pure = buildXml(d, { extensions: '', qr: '', signature: '' })
  return createHash('sha256').update(pure, 'utf8').digest('base64')
}

// ── QR ──────────────────────────────────────────────────────────────────────

export function phase2QrPayload(
  d: UblDocument,
  invoiceHash: string,
  signatureB64: string,
  signer: ZatcaSigner
): string {
  const entries: { tag: number; value: string | Buffer }[] = [
    { tag: 1, value: d.seller.companyName },
    { tag: 2, value: d.seller.vatNumber },
    { tag: 3, value: `${d.issueDate}T${d.issueTime}` },
    { tag: 4, value: money(d.taxInclusiveTotal) },
    { tag: 5, value: money(d.vatTotal) },
    { tag: 6, value: invoiceHash },
    { tag: 7, value: signatureB64 },
    { tag: 8, value: signer.cert.publicKeyDer },
  ]
  // Tag 9 (ZATCA's signature on the stamp certificate) — simplified invoices only
  if (d.kind === 'simplified') entries.push({ tag: 9, value: signer.cert.signature })
  return tlvEncode(entries).toString('base64')
}

// ── Signature (XAdES) ───────────────────────────────────────────────────────

function signedPropertiesForDigest(p: { time: string; certDigest: string; issuer: string; serial: string }): string {
  const sp = '                                    '
  return `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">
${sp}<xades:SignedSignatureProperties>
${sp}    <xades:SigningTime>${p.time}</xades:SigningTime>
${sp}    <xades:SigningCertificate>
${sp}        <xades:Cert>
${sp}            <xades:CertDigest>
${sp}                <ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
${sp}                <ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${p.certDigest}</ds:DigestValue>
${sp}            </xades:CertDigest>
${sp}            <xades:IssuerSerial>
${sp}                <ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${xmlText(p.issuer)}</ds:X509IssuerName>
${sp}                <ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">${p.serial}</ds:X509SerialNumber>
${sp}            </xades:IssuerSerial>
${sp}        </xades:Cert>
${sp}    </xades:SigningCertificate>
${sp}</xades:SignedSignatureProperties>
                                </xades:SignedProperties>`
}

function signedPropertiesInDocument(p: { time: string; certDigest: string; issuer: string; serial: string }): string {
  const sp = '                                    '
  return `<xades:SignedProperties Id="xadesSignedProperties">
${sp}<xades:SignedSignatureProperties>
${sp}    <xades:SigningTime>${p.time}</xades:SigningTime>
${sp}    <xades:SigningCertificate>
${sp}        <xades:Cert>
${sp}            <xades:CertDigest>
${sp}                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>
${sp}                <ds:DigestValue>${p.certDigest}</ds:DigestValue>
${sp}            </xades:CertDigest>
${sp}            <xades:IssuerSerial>
${sp}                <ds:X509IssuerName>${xmlText(p.issuer)}</ds:X509IssuerName>
${sp}                <ds:X509SerialNumber>${p.serial}</ds:X509SerialNumber>
${sp}            </xades:IssuerSerial>
${sp}        </xades:Cert>
${sp}    </xades:SigningCertificate>
${sp}</xades:SignedSignatureProperties>
                                </xades:SignedProperties>`
}

function ublExtensions(p: {
  invoiceHash: string
  signedPropsDigest: string
  signature: string
  certBase64: string
  signedProps: string
}): string {
  return `<ext:UBLExtensions>
        <ext:UBLExtension>
            <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
            <ext:ExtensionContent>
                <sig:UBLDocumentSignatures xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2" xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2">
                    <sac:SignatureInformation>
                        <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
                        <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
                        <ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="signature">
                            <ds:SignedInfo>
                                <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:CanonicalizationMethod>
                                <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"></ds:SignatureMethod>
                                <ds:Reference Id="invoiceSignedData" URI="">
                                    <ds:Transforms>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                            <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>
                                        </ds:Transform>
                                        <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"></ds:Transform>
                                    </ds:Transforms>
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>
                                    <ds:DigestValue>${p.invoiceHash}</ds:DigestValue>
                                </ds:Reference>
                                <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">
                                    <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"></ds:DigestMethod>
                                    <ds:DigestValue>${p.signedPropsDigest}</ds:DigestValue>
                                </ds:Reference>
                            </ds:SignedInfo>
                            <ds:SignatureValue>${p.signature}</ds:SignatureValue>
                            <ds:KeyInfo>
                                <ds:X509Data>
                                    <ds:X509Certificate>${p.certBase64}</ds:X509Certificate>
                                </ds:X509Data>
                            </ds:KeyInfo>
                            <ds:Object>
                                <xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="signature">
                                ${p.signedProps}
                                </xades:QualifyingProperties>
                            </ds:Object>
                        </ds:Signature>
                    </sac:SignatureInformation>
                </sig:UBLDocumentSignatures>
            </ext:ExtensionContent>
        </ext:UBLExtension>
    </ext:UBLExtensions>`
}

export type SignedUbl = {
  xml: string
  invoiceHash: string
  signature: string
  qrPayload: string
}

/** Build, hash, sign and assemble the final Phase 2 XML (with QR + XAdES). */
export function signUbl(d: UblDocument, signer: ZatcaSigner, signingTime = new Date()): SignedUbl {
  const invoiceHash = invoiceHashOf(d)
  const signature = signHash(signer.keys.privatePem, Buffer.from(invoiceHash, 'base64'))
  const qrPayload = phase2QrPayload(d, invoiceHash, signature, signer)
  const props = {
    time: signingTime.toISOString().slice(0, 19) + 'Z',
    certDigest: signer.cert.digest,
    issuer: signer.cert.issuer,
    serial: signer.cert.serial,
  }
  const signedPropsDigest = Buffer.from(
    createHash('sha256').update(signedPropertiesForDigest(props), 'utf8').digest('hex')
  ).toString('base64')
  const extensions = ublExtensions({
    invoiceHash,
    signedPropsDigest,
    signature,
    certBase64: signer.cert.base64,
    signedProps: signedPropertiesInDocument(props),
  })
  const qr = `<cac:AdditionalDocumentReference>
        <cbc:ID>QR</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${qrPayload}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>`
  const sig = `<cac:Signature>
        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
    </cac:Signature>`
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${buildXml(d, { extensions, qr, signature: sig })}\n`
  return { xml, invoiceHash, signature, qrPayload }
}

/** Read the QR payload out of an XML document (e.g. the cleared invoice ZATCA returns). */
export function qrFromXml(xml: string): string | null {
  const m = xml.match(
    /<cbc:ID>QR<\/cbc:ID>\s*<cac:Attachment>\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)<\/cbc:EmbeddedDocumentBinaryObject>/
  )
  return m ? m[1].trim() : null
}
