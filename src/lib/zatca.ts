// ─────────────────────────────────────────────────────────────────────────────
// ZATCA e-Invoicing (Fatoora) — server-side infrastructure.
//
// Implements what the ZATCA "E-Invoicing Detailed Technical Guidelines",
// "Security Features Implementation Standards" and the Fatoora Developer
// Portal API describe:
//
//   • Company-level phase (Settings): Phase 1 "Generation" or Phase 2
//     "Integration". The phase is decided by ZATCA per taxpayer (wave
//     notification) — it is NOT chosen per invoice.
//   • TLV QR encoding — 1-byte tag, 1-byte length, value (tags 1-5 Phase 1,
//     tags 1-9 Phase 2).
//   • EGS onboarding: secp256k1 key pair → PKCS#10 CSR with the ZATCA subject
//     alternative name fields → Compliance CSID (OTP from the Fatoora portal)
//     → compliance checks → Production CSID.
//   • Gateway client (Accept-Version V2, Basic auth = CSID token : secret)
//     for compliance checks, reporting (simplified) and clearance (standard).
//   • "local" environment: no gateway at all — a self-signed TEST certificate
//     lets the full Phase 2 flow (hash, signature, XML, QR) be tried offline.
//     Nothing produced in local mode is valid for ZATCA.
// ─────────────────────────────────────────────────────────────────────────────
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  generateKeyPairSync,
  randomBytes,
  X509Certificate,
} from 'node:crypto'
import { db } from '@/lib/db'
import { der, certificateSignatureBytes } from '@/lib/zatca-asn1'

/** KSA-mandated PIH for the FIRST invoice of a chain (base64 of SHA-256 hex digest of "0"). */
export const ZATCA_INITIAL_PIH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='

// ── TLV (QR) ────────────────────────────────────────────────────────────────

/**
 * ZATCA TLV: [tag 1 byte][length 1 byte][value]. Values are UTF-8 strings
 * (tags 1-7) or raw bytes (tag 8 public key DER, tag 9 certificate signature).
 */
export function tlvEncode(entries: { tag: number; value: string | Buffer }[]): Buffer {
  const parts: Buffer[] = []
  for (const { tag, value } of entries) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8')
    if (bytes.length > 255) {
      throw new Error(`QR tag ${tag} is too long (${bytes.length} bytes, ZATCA maximum is 255)`)
    }
    parts.push(Buffer.from([tag & 0xff, bytes.length]), bytes)
  }
  return Buffer.concat(parts)
}

/** Decode a base64 TLV payload (used to read the QR out of a cleared invoice). */
export function tlvDecode(base64: string): { tag: number; value: Buffer }[] {
  const buf = Buffer.from(base64, 'base64')
  const out: { tag: number; value: Buffer }[] = []
  let i = 0
  while (i + 2 <= buf.length) {
    const tag = buf[i]
    const len = buf[i + 1]
    out.push({ tag, value: buf.subarray(i + 2, i + 2 + len) })
    i += 2 + len
  }
  return out
}

// ── Settings helpers ────────────────────────────────────────────────────────

async function readSettingMap(keys?: string[]): Promise<Record<string, string>> {
  const rows = await db.setting.findMany(keys ? { where: { key: { in: keys } } } : undefined)
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value
  return map
}

/** Upsert (value) or remove (null) one Setting row. */
export async function writeZatcaSetting(key: string, value: string | null): Promise<void> {
  if (value === null) {
    await db.setting.deleteMany({ where: { key } })
    return
  }
  await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
}

// ── Seller identity (Settings → Company + ZATCA national address) ───────────

export type ZatcaSellerAddress = {
  street: string
  buildingNo: string
  additionalNo: string
  district: string
  city: string
  postalCode: string
}

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
  national: ZatcaSellerAddress
}

export const SELLER_ADDRESS_KEYS: Record<keyof ZatcaSellerAddress, string> = {
  street: 'zatca_seller_street',
  buildingNo: 'zatca_seller_building',
  additionalNo: 'zatca_seller_additional',
  district: 'zatca_seller_district',
  city: 'zatca_seller_city',
  postalCode: 'zatca_seller_postal',
}

export async function readSellerInfo(): Promise<ZatcaSellerInfo> {
  const map = await readSettingMap()
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
    national: {
      street: (map[SELLER_ADDRESS_KEYS.street] ?? '').trim(),
      buildingNo: (map[SELLER_ADDRESS_KEYS.buildingNo] ?? '').trim(),
      additionalNo: (map[SELLER_ADDRESS_KEYS.additionalNo] ?? '').trim(),
      district: (map[SELLER_ADDRESS_KEYS.district] ?? '').trim(),
      city: (map[SELLER_ADDRESS_KEYS.city] ?? '').trim(),
      postalCode: (map[SELLER_ADDRESS_KEYS.postalCode] ?? '').trim(),
    },
  }
}

/** KSA VAT number: 15 digits, starts with 3 and ends with 3 (BR-KSA-39 / 40). */
export function isValidKsaVat(v: string | null | undefined): boolean {
  return /^3\d{13}3$/.test((v ?? '').trim())
}

// ── Environment / phase profile ─────────────────────────────────────────────

/**
 * local       — no gateway; self-signed TEST certificate (offline trial only)
 * sandbox     — ZATCA Developer Portal (free testing, no real effect)
 * simulation  — ZATCA Simulation portal (pre-go-live trial with real VAT no.)
 * production  — ZATCA Core (legally binding)
 */
export type ZatcaEnv = 'local' | 'sandbox' | 'simulation' | 'production'
export type ZatcaMode = 'phase1' | 'phase2'

export const ZATCA_ENV_BASES: Record<Exclude<ZatcaEnv, 'local'>, string> = {
  sandbox: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  production: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
}

/** Certificate template name carried in the CSR (extension 1.3.6.1.4.1.311.20.2). */
const CERT_TEMPLATE: Record<Exclude<ZatcaEnv, 'local'>, string> = {
  sandbox: 'TSTZATCA-Code-Signing',
  simulation: 'PREZATCA-Code-Signing',
  production: 'ZATCA-Code-Signing',
}

export type ZatcaLastTest = {
  at: string
  ok: boolean
  mode: ZatcaEnv
  httpStatus?: number
  error?: string
  latencyMs: number
}

export type ZatcaComplianceCheck = {
  name: string
  ok: boolean
  status?: string
  messages?: string[]
}

/** Profile returned to clients — secrets and keys are NEVER included. */
export type ZatcaProfile = {
  mode: ZatcaMode
  env: ZatcaEnv
  apiBase: string
  egsSerial: string
  egsName: string
  branchName: string
  industry: string
  invoiceTypes: '1100' | '0100' | '1000'
  sellerAddress: ZatcaSellerAddress
  keysReady: boolean
  csrReady: boolean
  csrEnv: ZatcaEnv | null
  complianceCsid: boolean
  complianceChecks: ZatcaComplianceCheck[]
  productionCsid: boolean
  productionCsidExpiry: string | null
  /** Can Phase 2 documents be signed right now (and with what)? */
  signingReady: boolean
  signingWith: 'production' | 'compliance' | 'local-test' | null
  lastTest: ZatcaLastTest | null
}

const LEGACY_ENV: Record<string, ZatcaEnv> = {
  simulation: 'local', // the old "simulation" never called ZATCA — it was local validation
  preprod: 'sandbox',
  production: 'production',
}

function parseEnv(map: Record<string, string>): ZatcaEnv {
  const v = map.zatca_environment
  if (v === 'local' || v === 'sandbox' || v === 'simulation' || v === 'production') return v
  return LEGACY_ENV[map.zatca_env ?? ''] ?? 'local'
}

function parseJson<T>(v: string | undefined, fallback: T): T {
  if (!v) return fallback
  try {
    return JSON.parse(v) as T
  } catch {
    return fallback
  }
}

export async function readZatcaProfile(): Promise<ZatcaProfile> {
  const map = await readSettingMap()
  const env = parseEnv(map)
  const keysReady = Boolean(map.zatca_private_key) && isSecp256k1(map.zatca_private_key)
  const productionCsid = Boolean(map.zatca_pcsid_token && map.zatca_pcsid_secret)
  const complianceCsid = Boolean(map.zatca_ccsid_token && map.zatca_ccsid_secret)
  const signingWith: ZatcaProfile['signingWith'] =
    env === 'local'
      ? keysReady
        ? 'local-test'
        : null
      : productionCsid && map.zatca_pcsid_env === env
        ? 'production'
        : complianceCsid && map.zatca_ccsid_env === env && env !== 'production'
          ? 'compliance'
          : null
  const types = map.zatca_invoice_types
  return {
    mode: map.zatca_mode === 'phase2' ? 'phase2' : 'phase1',
    env,
    apiBase: env === 'local' ? '' : ZATCA_ENV_BASES[env],
    egsSerial: (map.zatca_egs_serial ?? '').trim(),
    egsName: (map.zatca_egs_name ?? '').trim(),
    branchName: (map.zatca_branch_name ?? '').trim(),
    industry: (map.zatca_branch_industry ?? '').trim(),
    invoiceTypes: types === '0100' || types === '1000' ? types : '1100',
    sellerAddress: (await readSellerInfo()).national,
    keysReady,
    csrReady: Boolean(map.zatca_csr),
    csrEnv: (map.zatca_csr_env as ZatcaEnv) || null,
    complianceCsid: complianceCsid && map.zatca_ccsid_env === env,
    complianceChecks: parseJson<ZatcaComplianceCheck[]>(map.zatca_compliance_checks, []),
    productionCsid: productionCsid && map.zatca_pcsid_env === env,
    productionCsidExpiry: map.zatca_pcsid_expiry || null,
    signingReady: signingWith !== null,
    signingWith,
    lastTest: parseJson<ZatcaLastTest | null>(map.zatca_last_test, null),
  }
}

export async function saveZatcaLastTest(test: ZatcaLastTest): Promise<void> {
  await writeZatcaSetting('zatca_last_test', JSON.stringify(test))
}

// ── Keys (secp256k1 — the curve ZATCA mandates) ─────────────────────────────

function isSecp256k1(pem: string | undefined): boolean {
  if (!pem) return false
  try {
    const k = createPrivateKey(pem)
    return k.asymmetricKeyDetails?.namedCurve === 'secp256k1'
  } catch {
    return false
  }
}

export type ZatcaKeys = { privatePem: string; publicPem: string }

/**
 * The EGS key pair. Generated once; an older non-secp256k1 key (the previous
 * version used P-256, which ZATCA rejects) is replaced automatically.
 */
export async function getZatcaKeys(): Promise<ZatcaKeys> {
  const map = await readSettingMap(['zatca_private_key', 'zatca_public_key'])
  if (isSecp256k1(map.zatca_private_key) && map.zatca_public_key) {
    return { privatePem: map.zatca_private_key, publicPem: map.zatca_public_key }
  }
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' })
  const privatePem = privateKey.export({ type: 'sec1', format: 'pem' }).toString()
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  await writeZatcaSetting('zatca_private_key', privatePem)
  await writeZatcaSetting('zatca_public_key', publicPem)
  // anything tied to the previous key is now invalid
  for (const k of ['zatca_csr', 'zatca_csr_env', 'zatca_local_cert']) await writeZatcaSetting(k, null)
  return { privatePem, publicPem }
}

export async function hasZatcaKeys(): Promise<boolean> {
  const map = await readSettingMap(['zatca_private_key'])
  return isSecp256k1(map.zatca_private_key)
}

/** ECDSA (secp256k1) over SHA-256 of `data` → base64 DER signature. */
export function signHash(privatePem: string, data: Buffer): string {
  const signer = createSign('SHA256')
  signer.update(data)
  return signer.sign(createPrivateKey(privatePem)).toString('base64')
}

// ── Certificates ────────────────────────────────────────────────────────────

export type ZatcaCertInfo = {
  /** base64 DER body exactly as embedded in ds:X509Certificate */
  base64: string
  /** ZATCA cert digest: base64( hex( SHA-256( base64 body string ) ) ) */
  digest: string
  /** issuer in "CN=…, DC=…" order (reverse of the RDN sequence) */
  issuer: string
  /** serial number in decimal */
  serial: string
  /** SubjectPublicKeyInfo DER (QR tag 8) */
  publicKeyDer: Buffer
  /** certificate signature value (QR tag 9) */
  signature: Buffer
  validTo: string
}

export function certInfoFromBase64(base64Body: string): ZatcaCertInfo {
  const body = base64Body.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const derBytes = Buffer.from(body, 'base64')
  const x509 = new X509Certificate(derBytes)
  return {
    base64: body,
    digest: Buffer.from(createHash('sha256').update(body).digest('hex')).toString('base64'),
    issuer: x509.issuer.split('\n').reverse().join(', '),
    serial: BigInt(`0x${x509.serialNumber}`).toString(10),
    publicKeyDer: x509.publicKey.export({ type: 'spki', format: 'der' }) as Buffer,
    signature: certificateSignatureBytes(derBytes),
    validTo: x509.validTo,
  }
}

/** binarySecurityToken (base64 of the base64 certificate body) → certificate body. */
export function certBodyFromToken(token: string): string {
  return Buffer.from(token, 'base64').toString('utf8').trim()
}

// ── X.500 names, CSR and the local TEST certificate ─────────────────────────

const OID = {
  C: '2.5.4.6',
  O: '2.5.4.10',
  OU: '2.5.4.11',
  CN: '2.5.4.3',
  SN: '2.5.4.4', // "SN" in the ZATCA config = EGS serial (1-…|2-…|3-…)
  UID: '0.9.2342.19200300.100.1.1', // VAT number
  title: '2.5.4.12', // invoice types e.g. 1100
  registeredAddress: '2.5.4.26',
  businessCategory: '2.5.4.15',
  ecPublicKey: '1.2.840.10045.2.1',
  ecdsaSha256: '1.2.840.10045.4.3.2',
  extensionRequest: '1.2.840.113549.1.9.14',
  subjectAltName: '2.5.29.17',
  certTemplateName: '1.3.6.1.4.1.311.20.2',
}

function rdn(oid: string, value: string, printable = false): Buffer {
  return der.set(der.seq(der.oid(oid), printable ? der.printable(value) : der.utf8(value)))
}

export type EgsIdentity = {
  egsSerial: string
  egsName: string
  branchName: string
  industry: string
  invoiceTypes: string
  vatNumber: string
  taxpayerName: string
  location: string
}

/** PKCS#10 CSR exactly as ZATCA specifies (SAN dirName with SN/UID/title/registeredAddress/businessCategory). */
export function buildCsrPem(keys: ZatcaKeys, egs: EgsIdentity, env: Exclude<ZatcaEnv, 'local'>): string {
  const subject = der.seq(
    rdn(OID.C, 'SA', true),
    rdn(OID.OU, egs.branchName),
    rdn(OID.O, egs.taxpayerName),
    rdn(OID.CN, egs.egsName)
  )
  const dirName = der.seq(
    rdn(OID.SN, egs.egsSerial),
    rdn(OID.UID, egs.vatNumber),
    rdn(OID.title, egs.invoiceTypes),
    rdn(OID.registeredAddress, egs.location),
    rdn(OID.businessCategory, egs.industry)
  )
  const san = der.seq(der.ctx(4, dirName)) // GeneralNames { directoryName [4] }
  const extensions = der.seq(
    der.seq(der.oid(OID.certTemplateName), der.octet(der.printable(CERT_TEMPLATE[env]))),
    der.seq(der.oid(OID.subjectAltName), der.octet(san))
  )
  const attributes = der.ctx(0, der.seq(der.oid(OID.extensionRequest), der.set(extensions)))
  const spki = createPublicKey(keys.publicPem).export({ type: 'spki', format: 'der' }) as Buffer
  const info = der.seq(der.int(0), subject, spki, attributes)
  const signer = createSign('SHA256')
  signer.update(info)
  const sig = signer.sign(createPrivateKey(keys.privatePem))
  const csrDer = der.seq(info, der.seq(der.oid(OID.ecdsaSha256)), der.bitString(sig))
  const b64 = csrDer.toString('base64').replace(/(.{64})/g, '$1\n').trim()
  return `-----BEGIN CERTIFICATE REQUEST-----\n${b64}\n-----END CERTIFICATE REQUEST-----\n`
}

function utcTime(d: Date): Buffer {
  const s = d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'
  return Buffer.concat([Buffer.from([0x17, s.length]), Buffer.from(s, 'ascii')])
}

/** Self-signed TEST certificate for the "local" environment (never valid for ZATCA). */
function buildLocalTestCertBase64(keys: ZatcaKeys, egs: EgsIdentity): string {
  const serial = randomBytes(8)
  serial[0] &= 0x7f
  const name = der.seq(rdn(OID.C, 'SA', true), rdn(OID.O, egs.taxpayerName || 'Test'), rdn(OID.CN, 'LOCAL TEST ONLY - NOT ZATCA'))
  const now = new Date()
  const until = new Date(now.getTime() + 5 * 365 * 86_400_000)
  const spki = createPublicKey(keys.publicPem).export({ type: 'spki', format: 'der' }) as Buffer
  const tbs = der.seq(
    der.ctx(0, der.int(2)),
    Buffer.concat([Buffer.from([0x02, serial.length]), serial]),
    der.seq(der.oid(OID.ecdsaSha256)),
    name,
    der.seq(utcTime(now), utcTime(until)),
    name,
    spki
  )
  const signer = createSign('SHA256')
  signer.update(tbs)
  const sig = signer.sign(createPrivateKey(keys.privatePem))
  return der.seq(tbs, der.seq(der.oid(OID.ecdsaSha256)), der.bitString(sig)).toString('base64')
}

export async function readEgsIdentity(): Promise<EgsIdentity> {
  const profile = await readZatcaProfile()
  const seller = await readSellerInfo()
  const a = seller.national
  return {
    egsSerial: profile.egsSerial,
    egsName: profile.egsName || 'EGS-ERP-1',
    branchName: profile.branchName || 'Main Branch',
    industry: profile.industry || 'Manpower Supply',
    invoiceTypes: profile.invoiceTypes,
    vatNumber: seller.vatNumber,
    taxpayerName: seller.companyName,
    location: [a.buildingNo, a.street, a.district, a.city].filter(Boolean).join(' ') || seller.address || 'Saudi Arabia',
  }
}

// ── Signing material for Phase 2 documents ──────────────────────────────────

export type ZatcaSigner = {
  keys: ZatcaKeys
  cert: ZatcaCertInfo
  kind: 'production' | 'compliance' | 'local-test'
  env: ZatcaEnv
}

/**
 * The key + certificate Phase 2 documents are signed with, or a clear error
 * telling the user which onboarding step is missing.
 */
export async function getZatcaSigner(): Promise<ZatcaSigner> {
  const profile = await readZatcaProfile()
  const keys = await getZatcaKeys()
  const map = await readSettingMap()
  if (profile.env === 'local') {
    let body = map.zatca_local_cert
    if (!body) {
      body = buildLocalTestCertBase64(keys, await readEgsIdentity())
      await writeZatcaSetting('zatca_local_cert', body)
    }
    return { keys, cert: certInfoFromBase64(body), kind: 'local-test', env: 'local' }
  }
  if (profile.productionCsid) {
    return { keys, cert: certInfoFromBase64(certBodyFromToken(map.zatca_pcsid_token)), kind: 'production', env: profile.env }
  }
  if (profile.complianceCsid && profile.env !== 'production') {
    return { keys, cert: certInfoFromBase64(certBodyFromToken(map.zatca_ccsid_token)), kind: 'compliance', env: profile.env }
  }
  throw new ZatcaSetupError(
    'ZATCA onboarding is not finished for this environment — complete Settings → ZATCA → Onboarding (OTP → compliance checks → production CSID) first.'
  )
}

export class ZatcaSetupError extends Error {}

// ── Gateway client ──────────────────────────────────────────────────────────

export type GatewayResult = {
  httpStatus: number
  body: Record<string, unknown>
  latencyMs: number
}

function basicAuth(token: string, secret: string): string {
  return 'Basic ' + Buffer.from(`${token}:${secret}`).toString('base64')
}

export async function zatcaRequest(
  env: Exclude<ZatcaEnv, 'local'>,
  path: string,
  init: { body: unknown; headers?: Record<string, string>; auth?: { token: string; secret: string } }
): Promise<GatewayResult> {
  const started = Date.now()
  const res = await fetch(`${ZATCA_ENV_BASES[env]}${path}`, {
    method: 'POST',
    headers: {
      'Accept-Version': 'V2',
      'Accept-Language': 'en',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.auth ? { Authorization: basicAuth(init.auth.token, init.auth.secret) } : {}),
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(init.body),
    signal: AbortSignal.timeout(30000),
    cache: 'no-store',
  })
  const text = await res.text()
  let body: Record<string, unknown>
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    body = { raw: text.slice(0, 1000) }
  }
  return { httpStatus: res.status, body, latencyMs: Date.now() - started }
}

/** Credentials for invoice submission in the current environment. */
export async function readSubmissionAuth(): Promise<{
  env: Exclude<ZatcaEnv, 'local'>
  token: string
  secret: string
  kind: 'production' | 'compliance'
} | null> {
  const profile = await readZatcaProfile()
  if (profile.env === 'local') return null
  const map = await readSettingMap()
  if (profile.productionCsid) {
    return { env: profile.env, token: map.zatca_pcsid_token, secret: map.zatca_pcsid_secret, kind: 'production' }
  }
  if (profile.complianceCsid && profile.env !== 'production') {
    return { env: profile.env, token: map.zatca_ccsid_token, secret: map.zatca_ccsid_secret, kind: 'compliance' }
  }
  return null
}

/** Read a raw setting (server-side only). */
export async function readZatcaSecret(key: string): Promise<string> {
  const map = await readSettingMap([key])
  return map[key] ?? ''
}

/** Kept for older imports — returns the production token if present. */
export async function readZatcaCsidToken(): Promise<string> {
  return readZatcaSecret('zatca_pcsid_token')
}

/** Flatten ZATCA validationResults into readable lines. */
export function zatcaMessages(body: Record<string, unknown>): { errors: string[]; warnings: string[] } {
  const vr = (body.validationResults ?? {}) as {
    errorMessages?: { code?: string; message?: string }[]
    warningMessages?: { code?: string; message?: string }[]
  }
  const fmt = (m: { code?: string; message?: string }) => [m.code, m.message].filter(Boolean).join(': ')
  const errors = (vr.errorMessages ?? []).map(fmt)
  const warnings = (vr.warningMessages ?? []).map(fmt)
  if (errors.length === 0 && Array.isArray((body as { errors?: unknown[] }).errors)) {
    for (const e of (body as { errors: unknown[] }).errors) errors.push(typeof e === 'string' ? e : JSON.stringify(e))
  }
  if (errors.length === 0 && typeof body.message === 'string') errors.push(body.message)
  return { errors, warnings }
}
