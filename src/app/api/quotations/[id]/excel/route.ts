// Excel export — GET /api/quotations/[id]/excel.
// Streams a professionally laid-out .xlsx of the full quotation document
// (company header, quote meta, client block, items with per-line discounts,
// totals + VAT, amount in words, notes & terms) built with SheetJS.
// Requires quotations.view. Money cells are real numbers with
// #,##0.00 formatting so Excel can compute on them.
import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { db } from '@/lib/db'
import { amountInWords } from '@/lib/amount-words'
import { parseTerms } from '@/lib/quotation-terms'
import { formatDate, round2 } from '@/lib/format'
import { serverError, notFound, requirePermission, isResponse } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const auth = await requirePermission('quotations.view')
    if (isResponse(auth)) return auth
    const { id } = await params

    const quotation = await db.quotation.findUnique({
      where: { id },
      include: {
        items: true,
        assets: true,
        client: {
          select: {
            name: true,
            contactPerson: true,
            phone: true,
            email: true,
            address: true,
            city: true,
            crNumber: true,
            vatNumber: true,
          },
        },
      },
    })
    if (!quotation) return notFound('Quotation not found')

    const settingRows = await db.setting.findMany()
    const settings: Record<string, string> = {}
    for (const r of settingRows) settings[r.key] = r.value
    const currency = settings.currency || 'SAR'
    const companyName = settings.companyName || 'Landmark Inter Gulf'

    const items = [...quotation.items].sort((a, b) => a.sr - b.sr)
    const netTotal = round2(quotation.subtotal - quotation.discount)
    const vatPercent = Math.round(quotation.vatRate * 100)

    // ── Build the sheet as an array-of-arrays, then merge title cells ──
    const aoa: (string | number | null)[][] = []

    // Company header
    aoa.push([companyName])
    aoa.push([settings.address ?? ''])
    aoa.push(
      [
        settings.phone ? `Tel: ${settings.phone}` : null,
        settings.email ? `Email: ${settings.email}` : null,
        settings.website ?? null,
      ]
    )
    aoa.push(
      [
        settings.vatNumber ? `VAT No: ${settings.vatNumber}` : null,
        settings.crNumber ? `CR No: ${settings.crNumber}` : null,
      ]
    )
    aoa.push([null])

    // Document title
    aoa.push(['QUOTATION'])
    aoa.push([`Quote No: ${quotation.quoteNumber}`])
    aoa.push([
      `Issue Date: ${formatDate(quotation.issueDate)}`,
      quotation.validityDate ? `Valid Until: ${formatDate(quotation.validityDate)}` : null,
      quotation.referenceNo ? `Ref No: ${quotation.referenceNo}` : null,
    ])
    aoa.push([`Status: ${quotation.status.toUpperCase()}`])
    aoa.push([null])

    // Client block
    aoa.push(['QUOTATION FOR'])
    aoa.push([quotation.clientName])
    if (quotation.client) {
      const c = quotation.client
      if (c.contactPerson) aoa.push([`Attn: ${c.contactPerson}`])
      if (c.phone || c.email) aoa.push([c.phone ?? '', c.email ?? ''])
      if (c.address || c.city) aoa.push([[c.address, c.city].filter(Boolean).join(', ')])
      if (c.crNumber || c.vatNumber)
        aoa.push([c.crNumber ? `CR No: ${c.crNumber}` : '', c.vatNumber ? `VAT No: ${c.vatNumber}` : ''])
    }
    if (quotation.subject) {
      aoa.push([`Subject: ${quotation.subject}`])
    }
    if (quotation.projectName || quotation.projectLocation || quotation.contractPeriod || quotation.mobilization) {
      aoa.push(['PROJECT DETAILS'])
      if (quotation.projectName) aoa.push([`Project: ${quotation.projectName}`])
      if (quotation.projectLocation) aoa.push([`Location: ${quotation.projectLocation}`])
      if (quotation.contractPeriod) aoa.push([`Contract Period: ${quotation.contractPeriod}`])
      if (quotation.mobilization) aoa.push([`Mobilization: ${quotation.mobilization}`])
    }
    aoa.push([null])

    // Items table — one simple manpower layout for every quotation:
    // Sr | Trade | No. of Workers | Rate (SAR) | Amount (SAR)
    // Amount = No. of Workers × Rate (SAR). No hourly/monthly basis.
    const headerRowIndex = aoa.length
    aoa.push(['Sr', 'Trade', 'No. of Workers', 'Rate (SAR)', 'Amount (SAR)'])
    for (const it of items) {
      aoa.push([
        it.sr,
        it.subText ? `${it.description} (${it.subText})` : it.description,
        round2(it.quantity),
        round2(it.unitPrice),
        round2(it.lineTotal),
      ])
    }
    const totalWorkers = round2(items.reduce((s, it) => s + it.quantity, 0))
    aoa.push(['', 'Total', totalWorkers, '', round2(quotation.subtotal)])
    aoa.push([null])

    // Totals — label/value columns follow the item table width
    const totalStart = aoa.length
    const labelCol = 2
    const valCol = 4
    const totalRow = (label: string, value: number): Array<string | number> => {
      const row: Array<string | number> = []
      for (let c = 0; c < valCol; c++) row.push(c === labelCol ? label : '')
      row.push(value)
      return row
    }
    aoa.push(totalRow('Subtotal', quotation.subtotal))
    if (quotation.discount > 0) aoa.push(totalRow('Discount', -quotation.discount))
    aoa.push(totalRow('Net Amount', netTotal))
    aoa.push(totalRow(`VAT (${vatPercent}%)`, quotation.vatAmount))
    aoa.push(totalRow('TOTAL', quotation.total))
    if (quotation.contractMonths && quotation.contractMonths > 0) {
      aoa.push(totalRow(`Contract Value (${quotation.contractMonths} Months) incl. VAT`, round2(quotation.total * quotation.contractMonths)))
    }
    aoa.push([`Amount in words: ${amountInWords(quotation.total, currency)}`])
    aoa.push([null])

    // Notes & terms
    if (quotation.notes) {
      aoa.push(['NOTES'])
      for (const line of quotation.notes.split('\n')) aoa.push([line])
      aoa.push([null])
    }
    if (quotation.terms) {
      aoa.push(['TERMS & CONDITIONS'])
      const termItems = parseTerms(quotation.terms)
      if (termItems.length > 0) {
        for (const t of termItems) aoa.push([t.title ? `${t.title}: ${t.text}` : t.text])
      } else {
        for (const line of quotation.terms.split('\n')) aoa.push([line])
      }
      aoa.push([null])
    }
    if (quotation.inclusions || quotation.exclusions) {
      if (quotation.inclusions) {
        aoa.push(['INCLUDED'])
        for (const line of quotation.inclusions.split('\n')) aoa.push([line])
        aoa.push([null])
      }
      if (quotation.exclusions) {
        aoa.push(['EXCLUDED'])
        for (const line of quotation.exclusions.split('\n')) aoa.push([line])
        aoa.push([null])
      }
    }

    aoa.push([`Prepared by: ${quotation.createdByName ?? ''}`])
    aoa.push(['This is a computer-generated quotation.'])

    const sheet = XLSX.utils.aoa_to_sheet(aoa)
    const merges: XLSX.Range[] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 5, c: 0 }, e: { r: 5, c: 6 } },
      { s: { r: totalStart + 5, c: 0 }, e: { r: totalStart + 5, c: 6 } },
    ]
    sheet['!merges'] = merges
    sheet['!cols'] = [
      { wch: 5 }, // Sr
      { wch: 52 }, // Trade
      { wch: 14 }, // No. of Workers
      { wch: 16 }, // Rate (SAR)
      { wch: 16 }, // Amount (SAR)
    ]

    // Number formatting for money/qty columns on item rows
    const numFrom = 2
    const numTo = 4
    for (let r = headerRowIndex + 1; r < headerRowIndex + 1 + items.length; r++) {
      for (let c = numFrom; c <= numTo; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })]
        if (cell && cell.t === 'n') cell.z = '#,##0.00'
      }
    }
    for (const r of [totalStart, totalStart + 1, totalStart + 2, totalStart + 3, totalStart + 4]) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: valCol })]
      if (cell && cell.t === 'n') cell.z = '#,##0.00'
    }

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, sheet, 'Quotation')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${quotation.quoteNumber}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[api/quotations/[id]/excel GET]', err)
    return serverError()
  }
}
