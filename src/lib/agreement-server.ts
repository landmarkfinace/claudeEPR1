// Shared server-side helpers for the Agreements API (zod body schema,
// clause normalization, saved-party handling, status derivation, include +
// row mapping). Server-only — imported by /api/agreements*, the PDF route
// and the seed scripts (via the same schema through prisma seed helpers).
import 'server-only'
import { Agreement, Prisma, PrismaClient } from '@prisma/client'
import { z } from 'zod'
import { parseDate } from '@/lib/api-helpers'
import { validateImageDataUrl } from '@/lib/image-data-url'
import type { AgreementRow, AgreementPartyRow } from '@/lib/types'
import {
  emptyParty,
  type TemplateParty,
} from './agreement-template'

// ---------------------------------------------------------------------------
// Body schema
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().max(max)

/** data-URL image slot: "" or a valid PNG/JPEG data URL (≤ 2 MB decoded). */
const imgSlot = z
  .string()
  .max(3_000_000)
  .refine((v) => v === '' || validateImageDataUrl(v)?.dataUrl != null, {
    message: 'Image must be a PNG or JPEG data URL of at most 2 MB',
  })

const partySchema = z.object({
  name: z.object({ en: text(240).trim(), ar: text(240).trim() }),
  crNo: text(40).trim(),
  address: z.object({ en: text(500).trim(), ar: text(500).trim() }),
  tel: text(60).trim(),
  fax: text(60).trim(),
  signatory: z.object({
    name: z.object({ en: text(160).trim(), ar: text(160).trim() }),
    title: z.object({ en: text(160).trim(), ar: text(160).trim() }),
  }),
  signatureImg: imgSlot,
  stampImg: imgSlot,
})

export const agreementBodySchema = z.object({
  agreementNo: z
    .string()
    .trim()
    .regex(/^AGR-\d{4}-\d{1,4}$/, 'Agreement No must look like AGR-2026-0001'),
  date: z.string().min(1, 'Agreement date is required'),
  titleEn: z.string().trim().min(1, 'Title (English) is required').max(300),
  titleAr: text(300).trim(),
  ourCompanyIs: z.enum(['first', 'second']),
  firstParty: partySchema,
  secondParty: partySchema,
  /** Saved-party record used for the other party (null = typed in fresh). */
  otherPartyId: z.string().trim().nullable().optional(),
  /** "Save this party for future agreements" */
  saveOtherParty: z.boolean().optional(),
  introEn: text(4000),
  introAr: text(4000),
  periodFrom: z.string().min(1, 'Period From is required'),
  periodTo: z.string().min(1, 'Period To is required'),
  priceMode: z.enum(['po', 'amount']),
  priceAmount: z.coerce.number().min(0).max(1_000_000_000).nullable().optional(),
  priceEn: z.string().trim().min(1, 'Contract price (English) is required').max(400),
  priceAr: z.string().trim().min(1, 'Contract price (Arabic) is required').max(400),
  showLetterheadSpace: z.boolean(),
  /** draft | signed — 'expired' is always derived, never stored */
  status: z.enum(['draft', 'signed']),
  clauses: z
    .array(
      z.object({
        textEn: text(4000).trim(),
        textAr: text(4000).trim(),
      })
    )
    .max(60, 'Too many clauses (max 60)'),
})

export type AgreementBody = z.infer<typeof agreementBodySchema>

// ---------------------------------------------------------------------------
// Normalization + validation
// ---------------------------------------------------------------------------

/** Ordered clauses with deterministic `order` (1-based). */
export function normalizeClauses(body: AgreementBody): { order: number; textEn: string; textAr: string }[] {
  return (body.clauses ?? [])
    .filter((c) => c.textEn.trim() || c.textAr.trim())
    .map((c, idx) => ({ order: idx + 1, textEn: c.textEn.trim(), textAr: c.textAr.trim() }))
}

/** Field-level checks that deserve friendly error messages (run post-zod). */
export function validateAgreementBody(
  body: AgreementBody,
  periodFrom: Date,
  periodTo: Date
): string | null {
  if (periodTo.getTime() < periodFrom.getTime()) return 'Period To cannot be before Period From.'
  if (body.priceMode === 'amount' && (body.priceAmount == null || !Number.isFinite(body.priceAmount))) {
    return 'Enter the contract price amount, or switch the price to "As per PO".'
  }
  return null
}

/** Which party is ours / the other one, per the role toggle. */
export function splitParties(
  body: AgreementBody
): { ourParty: TemplateParty; otherParty: TemplateParty } {
  return body.ourCompanyIs === 'first'
    ? { ourParty: body.firstParty, otherParty: body.secondParty }
    : { ourParty: body.secondParty, otherParty: body.firstParty }
}

/** Upsert an AgreementParty row from the OTHER party block (saved parties). */
export async function upsertSavedParty(
  tx: Prisma.TransactionClient | PrismaClient,
  party: TemplateParty,
  existingId: string | null | undefined,
  now: Date
): Promise<AgreementPartyRow> {
  const data = {
    nameEn: party.name.en.trim(),
    nameAr: party.name.ar.trim(),
    crNo: party.crNo.trim() || null,
    addressEn: party.address.en.trim() || null,
    addressAr: party.address.ar.trim() || null,
    tel: party.tel.trim() || null,
    fax: party.fax.trim() || null,
    signatoryNameEn: party.signatory.name.en.trim() || null,
    signatoryNameAr: party.signatory.name.ar.trim() || null,
    signatoryTitleEn: party.signatory.title.en.trim() || null,
    signatoryTitleAr: party.signatory.title.ar.trim() || null,
  }
  if (existingId) {
    const updated = await tx.agreementParty
      .update({ where: { id: existingId }, data })
      .catch(() => null)
    if (updated) return updated
  }
  const existingByName = await tx.agreementParty.findFirst({
    where: { nameEn: data.nameEn },
  })
  if (existingByName) {
    return (await tx.agreementParty.update({ where: { id: existingByName.id }, data }))!
  }
  return tx.agreementParty.create({
    data: { ...data, createdAt: now, updatedAt: now } as never,
  })
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/** Next AGR-YYYY-NNNN for the given year (call inside the tx). */
export async function nextAgreementNo(
  tx: Prisma.TransactionClient,
  year: number
): Promise<string> {
  const prefix = `AGR-${year}-`
  const rows = await tx.agreement.findMany({
    where: { agreementNo: { startsWith: prefix } },
    select: { agreementNo: true },
  })
  let max = 0
  for (const r of rows) {
    const n = parseInt(r.agreementNo.slice(prefix.length), 10)
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}

// ---------------------------------------------------------------------------
// Status derivation + include + row mapping
// ---------------------------------------------------------------------------

/** Effective display status — 'expired' is derived, never stored. */
export function effectiveStatus(
  stored: 'draft' | 'signed',
  periodTo: Date,
  now = new Date()
): 'draft' | 'signed' | 'expired' {
  if (stored !== 'signed') return stored
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return periodTo.getTime() < todayStart.getTime() ? 'expired' : 'signed'
}

/** Date → 'yyyy-mm-dd' using LOCAL calendar parts (round-trips parseDate). */
export function isoDateOnly(d: Date | null | undefined): string {
  if (!d || isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseParty(json: string): TemplateParty {
  if (!json) return emptyParty()
  try {
    const v = JSON.parse(json) as Partial<TemplateParty>
    return {
      name: { en: v.name?.en ?? '', ar: v.name?.ar ?? '' },
      crNo: v.crNo ?? '',
      address: { en: v.address?.en ?? '', ar: v.address?.ar ?? '' },
      tel: v.tel ?? '',
      fax: v.fax ?? '',
      signatory: {
        name: { en: v.signatory?.name?.en ?? '', ar: v.signatory?.name?.ar ?? '' },
        title: { en: v.signatory?.title?.en ?? '', ar: v.signatory?.title?.ar ?? '' },
      },
      signatureImg: v.signatureImg ?? '',
      stampImg: v.stampImg ?? '',
    }
  } catch {
    return emptyParty()
  }
}

/** Children eager-load with deterministic order. */
export const agreementFullInclude = {
  clauses: { orderBy: { order: 'asc' as const } },
} satisfies Prisma.AgreementInclude

export type AgreementFull = Prisma.AgreementGetPayload<{ include: typeof agreementFullInclude }>
export type AgreementLean = Agreement

/** Prisma row → API AgreementRow (clauses included when eager-loaded). */
export function mapAgreement(a: AgreementFull | AgreementLean): AgreementRow {
  const firstParty = parseParty(a.firstPartyJson)
  const secondParty = parseParty(a.secondPartyJson)
  const other = a.ourCompanyIs === 'first' ? secondParty : firstParty
  const base: AgreementRow = {
    id: a.id,
    agreementNo: a.agreementNo,
    date: isoDateOnly(a.date),
    titleEn: a.titleEn,
    titleAr: a.titleAr,
    ourCompanyIs: a.ourCompanyIs === 'second' ? 'second' : 'first',
    firstParty,
    secondParty,
    otherPartyId: a.otherPartyId,
    otherPartyNameEn: a.otherPartyNameEn || other.name.en,
    otherPartyNameAr: a.otherPartyNameAr || other.name.ar,
    introEn: a.introEn,
    introAr: a.introAr,
    periodFrom: isoDateOnly(a.periodFrom),
    periodTo: isoDateOnly(a.periodTo),
    priceMode: a.priceMode === 'amount' ? 'amount' : 'po',
    priceAmount: a.priceAmount ?? null,
    priceEn: a.priceEn,
    priceAr: a.priceAr,
    showLetterheadSpace: a.showLetterheadSpace,
    status: effectiveStatus(a.status === 'signed' ? 'signed' : 'draft', a.periodTo),
    lastEditedBy: a.lastEditedBy,
    lastEditedAt: a.lastEditedAt ? a.lastEditedAt.toISOString() : null,
    createdByName: a.createdByName,
    createdAt: a.createdAt.toISOString(),
  }
  if ('clauses' in a && a.clauses) {
    base.clauses = a.clauses.map((c) => ({
      id: c.id,
      order: c.order,
      textEn: c.textEn,
      textAr: c.textAr,
    }))
  }
  return base
}
