// ZATCA code lists shared by the server and the UI (no server imports here).

/** VAT exemption / zero-rating reason codes (ZATCA XML Implementation Standard). */
export const VAT_EXEMPTION_CODES: { category: 'E' | 'Z' | 'O'; code: string; label: string }[] = [
  { category: 'E', code: 'VATEX-SA-29', label: 'Financial services (Art. 29 of the VAT Regulations)' },
  { category: 'E', code: 'VATEX-SA-29-7', label: 'Life insurance services (Art. 29)' },
  { category: 'E', code: 'VATEX-SA-30', label: 'Real estate transactions (Art. 30)' },
  { category: 'Z', code: 'VATEX-SA-32', label: 'Export of goods' },
  { category: 'Z', code: 'VATEX-SA-33', label: 'Export of services' },
  { category: 'Z', code: 'VATEX-SA-34-1', label: 'International transport of goods' },
  { category: 'Z', code: 'VATEX-SA-34-2', label: 'International transport of passengers' },
  { category: 'Z', code: 'VATEX-SA-34-3', label: 'Services directly connected to international transport' },
  { category: 'Z', code: 'VATEX-SA-34-4', label: 'Supply of a qualifying means of transport' },
  { category: 'Z', code: 'VATEX-SA-34-5', label: 'Services relating to goods or passenger transportation' },
  { category: 'Z', code: 'VATEX-SA-35', label: 'Medicines and medical equipment' },
  { category: 'Z', code: 'VATEX-SA-36', label: 'Qualifying metals' },
  { category: 'Z', code: 'VATEX-SA-EDU', label: 'Private education to citizens' },
  { category: 'Z', code: 'VATEX-SA-HEA', label: 'Private healthcare to citizens' },
  { category: 'Z', code: 'VATEX-SA-MLTRY', label: 'Supply of qualified military goods' },
  { category: 'O', code: 'VATEX-SA-OOS', label: 'Not subject to VAT (out of scope)' },
]

export const TAX_CATEGORY_LABELS: Record<string, string> = {
  S: 'Standard rate',
  Z: 'Zero-rated (0%)',
  E: 'Exempt',
  O: 'Out of scope',
}

/** UNTDID 4461 payment means codes ZATCA accepts. */
export const PAYMENT_MEANS: { code: string; label: string }[] = [
  { code: '30', label: 'Credit transfer (bank)' },
  { code: '42', label: 'Payment to bank account' },
  { code: '10', label: 'Cash' },
  { code: '48', label: 'Bank card' },
  { code: '1', label: 'Not defined' },
]
