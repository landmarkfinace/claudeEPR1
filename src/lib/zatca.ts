// ─────────────────────────────────────────────────────────────────────────────
// ZATCA e-Invoicing library (server-side only)
// Saudi Arabia's Fatara (فواتيرا) compliance in two phases:
//
//   PHASE 1 (Generation) — mandatory QR on every invoice:
//     TLV (Tag-Length-Value) encoded base64 payload with the 5 mandatory tags:
//       1 seller name · 2 seller VAT number · 3 timestamp (ISO-8601)
//       4 invoice total (VAT inclusive) · 5 VAT total
//
//   PHASE 2 (Integration) — cryptographic stamping + reporting:
//     6 invoice XML hash (SHA-256, base64) · 7 ECDSA signature (base64)
//     8 ECDSA public key (base64, raw 64-byte x‖y point)
//     plus the UBL 2.1 XML document, an invoice UUID, and the PIH chain
//     (Previous Invoice Hash) that links each invoice to the previous one.
//
// Key management: an EC P-256 keypair is generated on first use and stored
// in the Setting table (zatca_private_key / zatca_public_key PEM strings).
// Formal certification still requires onboarding on the Fatoora portal
// (CSID issuance) — this implementation produces the exact data structure
// the portal expects, so the onboarding step is a configuration concern,
// not a code change.
// ─────────────────────────────────────────────────────────────────────────────
import {
  createHash,
  createSign,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  randomUUID,
} from 'node:crypto'
import QRCode from 'qrcode'
import { db } from '@/lib/db'
import { round2 } from '@/lib/format'

/** KSA-mandated initial PIH for the FIRST invoice of a chain (base64 of SHA-256 of "0"). */
export const ZATCA_INITIAL_PIH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

// ── TLV encoding ────────────────────────────────────────────────────────────

/** [tag (1 byte)][length (2 bytes, big-endian)][UTF-8 value] → Buffer */
export function tlvEncode(entries: { tag: number; value: string }[]): Buffer {
  const parts: Buffer[] = []
  for (const { tag, value } of entries) {
    const valueBytes = Buffer.from(value, 'utf8')
    const head = Buffer.alloc(3)
    head.writeUInt8(tag & 0xff, 0)
    head.writeUInt16BE(valueBytes.length, 1)
    parts.push(head, valueBytes)
  }
  return Buffer.concat(parts)
}

// ── Settings access ─────────────────────────────────────────────────────────

export type ZatcaSellerInfo = {
  companyName: string
  companyNameAr: string
  address: string
  addressAr: string
  vatNumber: string
  crNumber: string
  currency: string
  bankName: string
  bankIban: string
}

/** Read the seller-related Setting rows (with the same defaults the API uses). */
export async function readSellerInfo(): Promise<ZatcaSellerInfo> {
  const rows = await db.setting.findMany()
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return {
    companyName: map.companyName || 'Landmark Inter Gulf',
    companyNameAr: map.companyNameAr || 'لاندمارك انتر جلف',
    address: map.address || '',
    addressAr: map.addressAr || '',
    vatNumber: (map.vatNumber || '').trim(),
    crNumber: (map.crNumber || '').trim(),
    currency: map.currency || 'SAR',
    bankName: map.bankName || '',
    bankIban: map.bankIban || '',
  }
}

// ── ECDSA keypair (auto-generated once, stored in Setting) ──────────────────

type ZatcaKeys = { privatePem: string; publicPem: string }

async function getZatcaKeys(): Promise<ZatcaKeys> {
  const rows = await db.setting.findMany({
    where: { key: { in: ['zatca_private_key', 'zatca_public_key'] } },
  })
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value

  if (map.zatca_private_key && map.zatca_public_key) {
    return { privatePem: map.zatca_private_key, publicPem: map.zatca_public_key }
  }

  // First use — generate an EC P-256 keypair (the curve ZATCA mandates)
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const privatePem = privateKey.export({ type: 'sec1', format: 'pem' }).toString()
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  await db.$transaction([
    db.setting.upsert({
      where: { key: 'zatca_private_key' },
      update: { value: privatePem },
      create: { key: 'zatca_private_key', value: privatePem },
    }),
    db.setting.upsert({
      where: { key: 'zatca_public_key' },
      update: { value: publicPem },
      create: { key: 'zatca_public_key', value: publicPem },
    }),
  ])
  return { privatePem, publicPem }
}

/**
 * QR tag 8 value: base64 of the RAW 64-byte EC point (x‖y), 0x04 prefix
 * stripped — exactly the form ZATCA specifies. Derived from the SPKI PEM.
 */
function ecPublicKeyBase64(publicPem: string): string {
  const jwk = createPublicKey(publicPem).export({ format: 'jwk' }) as {
    x?: string
    y?: string
  }
  const x = Buffer.from(jwk.x ?? '', 'base64url')
  const y = Buffer.from(jwk.y ?? '', 'base64url')
  return Buffer.concat([x, y]).toString('base64')
}

/** Sign the invoice hash with ECDSA/SHA-256 → base64 (DER encoded, as node emits). */
function signHash(privatePem: string, data: Buffer): string {
  const signer = createSign('SHA256')
  signer.update(data)
  return signer.sign(createPrivateKey(privatePem)).toString('base64')
}

// ── UBL 2.1 XML generation ──────────────────────────────────────────────────

export type ZatcaInvoiceLine = {
  sr: number
  description: string
  unit: string | null
  quantity: number
  unitPrice: number
  lineTotal: number
}

export type ZatcaInvoiceData = {
  invoiceNumber: string
  uuid: string
  issueDate: Date
  dueDate: Date | null
  invoiceType: string // standard | simplified
  currency: string
  subtotal: number
  vatRate: number
  vatAmount: number
  total: number
  paidAmount: number
  notes: string | null
  clientName: string
  clientNameAr: string | null
  clientVatNumber: string | null
  clientAddress: string | null
  clientCity: string | null
  clientCrNumber: string | null
  items: ZatcaInvoiceLine[]
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Build a UBL 2.1 Invoice XML in the ZATCA reporting structure
 * (ProfileID reporting:1.0, ICV counter, PIH attachment, seller/buyer
 * parties with VAT numbers, TaxTotal, LegalMonetaryTotal, invoice lines).
 * The hashed document intentionally omits the UBLExtensions/Signature block,
 * matching how Fatoora computes the invoice hash.
 */
export function buildInvoiceXml(
  inv: ZatcaInvoiceData,
  seller: ZatcaSellerInfo,
  previousHash: string,
  icv: number,
): string {
  const date = inv.issueDate.toISOString().slice(0, 10)
  const time = inv.issueDate.toISOString().slice(11, 19) + 'Z'
  // 0100000 = standard (B2B) tax invoice · 0200000 = simplified (B2C)
  const typeCode = inv.invoiceType === 'simplified' ? '0200000' : '0100000'

  const lines = inv.items
    .map(
      (it) => `  <cac:InvoiceLine>
    <cbc:ID>${it.sr}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${xmlEscape(it.unit || 'EA')}">${it.quantity}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(inv.currency)}">${round2(it.lineTotal).toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${xmlEscape(it.description)}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${round2(inv.vatRate * 100).toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="${xmlEscape(inv.currency)}">${round2(it.unitPrice).toFixed(2)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>`,
    )
    .join('\n')

  const buyerVatBlock =
    inv.clientVatNumber || inv.invoiceType !== 'simplified'
      ? `
    <cac:PartyTaxScheme>
      <cbc:CompanyID schemeID="VAT">${xmlEscape(inv.clientVatNumber || '')}</cbc:CompanyID>
      <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
    </cac:PartyTaxScheme>`
      : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
  <cbc:ID>${xmlEscape(inv.invoiceNumber)}</cbc:ID>
  <cbc:UUID>${xmlEscape(inv.uuid)}</cbc:UUID>
  <cbc:IssueDate>${date}</cbc:IssueDate>
  <cbc:IssueTime>${time}</cbc:IssueTime>
  <cbc:InvoiceTypeCode name="${typeCode}">${typeCode}</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>${xmlEscape(inv.currency)}</cbc:DocumentCurrencyCode>
  <cac:AdditionalDocumentReference>
    <cbc:ID>ICV</cbc:ID>
    <cbc:UUID>${icv}</cbc:UUID>
  </cac:AdditionalDocumentReference>
  <cac:AdditionalDocumentReference>
    <cbc:ID>PIH</cbc:ID>
    <cac:Attachment>
      <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${previousHash}</cbc:EmbeddedDocumentBinaryObject>
    </cac:Attachment>
  </cac:AdditionalDocumentReference>
  <cac:AccountingSupplierParty>
    <cac:Party>
      ${seller.crNumber ? `<cac:PartyIdentification><cbc:ID schemeID="CR">${xmlEscape(seller.crNumber)}</cbc:ID></cac:PartyIdentification>` : ''}
      <cac:PostalAddress>
        <cbc:StreetName>${xmlEscape(seller.address)}</cbc:StreetName>
        <cbc:CityName>Jubail</cbc:CityName>
        <cac:Country><cbc:IdentificationCode>SA</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID schemeID="VAT">${xmlEscape(seller.vatNumber)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(seller.companyName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>${buyerVatBlock}
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${xmlEscape(inv.clientName)}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  ${
    seller.bankIban
      ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>${xmlEscape(seller.bankIban)}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>`
      : ''
  }
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.vatAmount).toFixed(2)}</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.subtotal).toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.vatAmount).toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${round2(inv.vatRate * 100).toFixed(2)}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.subtotal).toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.subtotal).toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.total).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PrepaidAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.paidAmount).toFixed(2)}</cbc:PrepaidAmount>
    <cbc:PayableAmount currencyID="${xmlEscape(inv.currency)}">${round2(inv.total).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${lines}
</Invoice>`
}

/** ZATCA invoice hash: base64 of the SHA-256 digest of the invoice XML (UTF-8). */
export function hashInvoiceXml(xml: string): string {
  return createHash('sha256').update(xml, 'utf8').digest('base64')
}

// ── Full stamp: what /api/invoices/[id]/zatca returns ───────────────────────

export type ZatcaStamp = {
  uuid: string
  invoiceHash: string
  previousHash: string
  signature: string
  qrPayload: string
  qrDataUrl: string
  publicKeyBase64: string
  icv: number
  sellerVatNumber: string
  warnings: string[]
}

export type ZatcaStampSource = {
  id: string
  createdAt: Date
  invoiceNumber: string
  /** If already stamped and unchanged → these are reused from the DB. */
  storedUuid: string | null
  storedHash: string | null
  storedPreviousHash: string | null
  storedSignature: string | null
}

/**
 * Stamp an invoice (or reuse its stored stamp) and build the full Phase-1+2
 * QR payload. Pure computation + DB persistence is left to the caller.
 */
export async function buildZatcaStamp(
  source: ZatcaStampSource,
  buildData: () => ZatcaInvoiceData,
  persist: (fields: {
    uuid: string
    invoiceHash: string
    previousHash: string
    signature: string
  }) => Promise<void>,
): Promise<ZatcaStamp> {
  const seller = await readSellerInfo()
  const warnings: string[] = []
  if (!seller.vatNumber) {
    warnings.push(
      'Seller VAT number is not set in Settings — the QR tag 2 will be empty. Add it under Settings → Company & Tax.',
    )
  }

  const keys = await getZatcaKeys()
  const publicKeyBase64 = ecPublicKeyBase64(keys.publicPem)

  let uuid = source.storedUuid
  let invoiceHash = source.storedHash
  let previousHash = source.storedPreviousHash
  let signature = source.storedSignature

  if (!uuid || !invoiceHash || !signature || !previousHash) {
    // ---- first stamp (or repairing an incomplete one) ----
    uuid = source.storedUuid ?? randomUUID()
    const data = buildData()

    // PIH chain: hash of the most recently stamped invoice (any status),
    // or the KSA initial PIH constant for the first invoice ever stamped.
    const prev = await db.invoice.findFirst({
      where: { id: { not: source.id }, invoiceHash: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { invoiceHash: true },
    })
    previousHash = prev?.invoiceHash ?? ZATCA_INITIAL_PIH

    const icv = await db.invoice.count({ where: { invoiceHash: { not: null } } })
    const xml = buildInvoiceXml(data, seller, previousHash, icv + 1)
    invoiceHash = hashInvoiceXml(xml)
    signature = signHash(keys.privatePem, Buffer.from(invoiceHash, 'base64'))

    await persist({ uuid, invoiceHash, previousHash, signature })
  }

  const data = buildData()
  // QR timestamp must reflect the invoice issue moment (tag 3)
  const qrPayload = tlvEncode([
    { tag: 1, value: seller.companyName },
    { tag: 2, value: seller.vatNumber },
    { tag: 3, value: data.issueDate.toISOString() },
    { tag: 4, value: round2(data.total).toFixed(2) },
    { tag: 5, value: round2(data.vatAmount).toFixed(2) },
    { tag: 6, value: invoiceHash },
    { tag: 7, value: signature },
    { tag: 8, value: publicKeyBase64 },
  ]).toString('base64')

  const qrDataUrl = await QRCode.toDataURL(qrPayload, {
    margin: 0,
    width: 480,
    errorCorrectionLevel: 'M',
  })

  return {
    uuid,
    invoiceHash,
    previousHash,
    signature,
    qrPayload,
    qrDataUrl,
    publicKeyBase64,
    icv: 0,
    sellerVatNumber: seller.vatNumber,
    warnings,
  }
}
