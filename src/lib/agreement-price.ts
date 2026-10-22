// Contract price words — small pure module (no font/CSS imports) so the seed
// data and the template lib can both use it without pulling the embedded
// webfonts into every consumer.
import { amountInWords } from './amount-words'
import { amountToWordsArabic } from './arabic-words'

/** "As per the PO" wording used whenever the price is not an amount. */
export const DEFAULT_PRICE: { en: string; ar: string } = {
  en: 'As per the PO',
  ar: 'حسب أمر الشراء',
}

/** "SAR 150,000.00 (One Hundred Fifty Thousand Saudi Riyals Only)" */
export function priceWordsEn(amount: number): string {
  const fig = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const words = amountInWords(amount, 'SAR').replace(/^SAR\s*/, '')
  return `SAR ${fig} (${words})`
}

/** "150,000.00 ريال سعودي (مائة وخمسون ألف ريال سعودي فقط لا غير)" */
export function priceWordsAr(amount: number): string {
  const fig = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${fig} ريال سعودي (${amountToWordsArabic(amount)})`
}

/** Price text for the selected mode — "As per the PO" or figure + words EN/AR. */
export function priceTextFor(mode: 'po' | 'amount', amount: number | null | undefined): { en: string; ar: string } {
  if (mode !== 'amount' || amount == null || !Number.isFinite(amount)) return { ...DEFAULT_PRICE }
  return { en: priceWordsEn(amount), ar: priceWordsAr(amount) }
}
