// GET /api/backup — full data export as a JSON download (admin-only).
// Settings-permission gated. Passwords and sessions are NEVER included.
//
// Coverage: EVERY business table (documents, name lists, advances, VAT bills,
// letterhead, AI chats/usage) so a restore after data loss is complete.
// Quotations, e-invoices, supplier POs, agreements, name lists, advances,
// VAT bills, client salary workers, letterhead, default terms, glossary,
// translation memory and AI history used to be silently MISSING — that gap
// turned "Download Backup" into a false sense of safety.
//
// Secrets are NEVER included (even for legit admins): crypto keys, API keys
// and ZATCA credentials are re-entered after a restore instead of traveling
// inside a file any signed-in user can download.
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  requirePermission,
  isResponse,
  logActivity,
} from '@/lib/api-helpers'

export const dynamic = 'force-dynamic'

/**
 * Setting keys that must NEVER leave the server inside a backup file.
 * Crypto key material, plaintext API keys and ZATCA gateway credentials.
 * (The rest of the Setting table — profile, bank details, letterhead
 * images, signature/stamp, prayer times — is ordinary business data the
 * backup exists to protect.)
 */
const SECRET_SETTING_KEYS = new Set([
  'aiCryptoSecret', // AES master key that decrypts the AI provider key
  'translate_api_key', // plaintext translation API key
  'zatca_private_key', // ZATCA signing private key (PEM)
  'zatca_public_key', // paired public key — re-derived on re-onboarding
  'zatca_pcsid_token', // production CSID bearer token
  'zatca_pcsid_secret', // production CSID secret
  'zatca_ccsid_token', // compliance CSID bearer token
  'zatca_ccsid_secret', // compliance CSID secret
  'zatca_local_cert', // locally-generated cert material from onboarding
])

export async function GET(req: NextRequest) {
  try {
    const auth = await requirePermission('settings.edit')
    if (isResponse(auth)) return auth

    const [
      settings,
      roles,
      users,
      clients,
      projects,
      staffCategories,
      staff,
      projectStaff,
      attendance,
      payrolls,
      transactionCategories,
      transactions,
      activityLog,
      quotations,
      quotationItems,
      quotationAssets,
      suppliers,
      supplierPos,
      supplierPoItems,
      eInvoices,
      eInvoiceItems,
      eInvoicePayments,
      agreements,
      agreementClauses,
      agreementParties,
      agreementTemplates,
      agreementTemplateClauses,
      nameListEntries,
      nameListSubjects,
      nameLists,
      nameListWorkers,
      workerAdvances,
      payrollAdvanceDeductions,
      vatExpenseBills,
      clientSalaryWorkers,
      companyLetterheads,
      defaultTerms,
      glossaryTerms,
      translationMemories,
      aiChats,
      aiChatMessages,
      // sanitized: apiKeyEnc ciphertext never travels in the file
      aiSettings,
      aiUsageLogs,
    ] = await Promise.all([
      db.setting.findMany(),
      db.role.findMany(),
      // sanitized: no password hashes, no session tokens
      db.user.findMany({
        select: {
          id: true, name: true, email: true, avatar: true, isActive: true,
          roleId: true, createdAt: true, updatedAt: true,
        },
      }),
      db.client.findMany(),
      db.project.findMany(),
      db.staffCategory.findMany(),
      db.staff.findMany(),
      db.projectStaff.findMany(),
      db.attendance.findMany(),
      db.payroll.findMany(),
      db.transactionCategory.findMany(),
      db.transaction.findMany(),
      db.activityLog.findMany(),
      // documents
      db.quotation.findMany(),
      db.quotationItem.findMany(),
      db.quotationAsset.findMany(),
      db.supplier.findMany(),
      db.supplierPo.findMany(),
      db.supplierPoItem.findMany(),
      db.eInvoice.findMany(),
      db.eInvoiceItem.findMany(),
      db.eInvoicePayment.findMany(),
      db.agreement.findMany(),
      db.agreementClause.findMany(),
      db.agreementParty.findMany(),
      db.agreementTemplate.findMany(),
      db.agreementTemplateClause.findMany(),
      // name lists (worker system + company directory)
      db.nameListEntry.findMany(),
      db.nameListSubject.findMany(),
      db.nameList.findMany(),
      db.nameListWorker.findMany(),
      // advances + payroll deduction links
      db.workerAdvance.findMany(),
      db.payrollAdvanceDeduction.findMany(),
      // VAT bills + client salary summary workers
      db.vatExpenseBill.findMany(),
      db.clientSalaryWorker.findMany(),
      // letterhead + shared text blocks
      db.companyLetterhead.findMany(),
      db.defaultTerms.findMany(),
      db.glossaryTerm.findMany(),
      db.translationMemory.findMany(),
      // AI assistant history + config (key stripped) + usage
      db.aiChat.findMany(),
      db.aiChatMessage.findMany(),
      db.aiSettings.findMany({
        select: {
          id: true, provider: true, model: true, baseUrl: true,
          maxTokens: true, monthlyLimitSar: true,
          inCostPer1k: true, outCostPer1k: true, updatedAt: true,
        },
      }),
      db.aiUsageLog.findMany(),
    ])

    // strip secret rows (crypto keys / API keys / ZATCA credentials)
    const safeSettings = settings.filter((s) => !SECRET_SETTING_KEYS.has(s.key))

    const backup = {
      meta: {
        app: 'Landmark Inter Gulf — Workforce, Payroll & Accounts',
        format: 'lig-backup/1',
        generatedAt: new Date().toISOString(),
        counts: {
          settings: safeSettings.length,
          roles: roles.length,
          users: users.length,
          clients: clients.length,
          projects: projects.length,
          staffCategories: staffCategories.length,
          staff: staff.length,
          projectStaff: projectStaff.length,
          attendance: attendance.length,
          payrolls: payrolls.length,
          transactionCategories: transactionCategories.length,
          transactions: transactions.length,
          activityLog: activityLog.length,
          quotations: quotations.length,
          quotationItems: quotationItems.length,
          quotationAssets: quotationAssets.length,
          suppliers: suppliers.length,
          supplierPos: supplierPos.length,
          supplierPoItems: supplierPoItems.length,
          eInvoices: eInvoices.length,
          eInvoiceItems: eInvoiceItems.length,
          eInvoicePayments: eInvoicePayments.length,
          agreements: agreements.length,
          agreementClauses: agreementClauses.length,
          agreementParties: agreementParties.length,
          agreementTemplates: agreementTemplates.length,
          agreementTemplateClauses: agreementTemplateClauses.length,
          nameListEntries: nameListEntries.length,
          nameListSubjects: nameListSubjects.length,
          nameLists: nameLists.length,
          nameListWorkers: nameListWorkers.length,
          workerAdvances: workerAdvances.length,
          payrollAdvanceDeductions: payrollAdvanceDeductions.length,
          vatExpenseBills: vatExpenseBills.length,
          clientSalaryWorkers: clientSalaryWorkers.length,
          companyLetterheads: companyLetterheads.length,
          defaultTerms: defaultTerms.length,
          glossaryTerms: glossaryTerms.length,
          translationMemories: translationMemories.length,
          aiChats: aiChats.length,
          aiChatMessages: aiChatMessages.length,
          aiSettings: aiSettings.length,
          aiUsageLogs: aiUsageLogs.length,
        },
      },
      settings: safeSettings,
      roles,
      users,
      clients,
      projects,
      staffCategories,
      staff,
      projectStaff,
      attendance,
      payrolls,
      transactionCategories,
      transactions,
      activityLog,
      quotations,
      quotationItems,
      quotationAssets,
      suppliers,
      supplierPos,
      supplierPoItems,
      eInvoices,
      eInvoiceItems,
      eInvoicePayments,
      agreements,
      agreementClauses,
      agreementParties,
      agreementTemplates,
      agreementTemplateClauses,
      nameListEntries,
      nameListSubjects,
      nameLists,
      nameListWorkers,
      workerAdvances,
      payrollAdvanceDeductions,
      vatExpenseBills,
      clientSalaryWorkers,
      companyLetterheads,
      defaultTerms,
      glossaryTerms,
      translationMemories,
      aiChats,
      aiChatMessages,
      aiSettings,
      aiUsageLogs,
    }

    await logActivity({
      user: auth,
      action: 'export',
      module: 'settings',
      description: 'Downloaded full data backup (JSON)',
    })

    const date = new Date().toISOString().slice(0, 10)
    return new NextResponse(JSON.stringify(backup, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="lig-backup-${date}.json"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[api/backup GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
