export const walletProviderOptions = [
  { value: 'vodafone_cash', label: 'فودافون كاش' },
  { value: 'fawry', label: 'فوري' },
  { value: 'etisalat_cash', label: 'e& cash (اتصالات)' },
  { value: 'orange_cash', label: 'أورنج كاش' },
  { value: 'we_pay', label: 'WE Pay' },
] as const

const legacyInstaPay = { value: 'instapay', label: 'إنستا باي · حساب مسجل سابقًا' } as const
export const walletProviderFilters = [...walletProviderOptions, legacyInstaPay]
export const walletManagementTitle = 'إدارة المحافظ والتحويلات'

export function walletProviderFilterValue(provider: string | null) {
  return walletProviderFilters.find(option => option.value === provider)?.value
}

export function walletProviderPreset(provider: unknown) {
  return walletProviderFilters.find(option => option.value === provider)
}

export function walletProviderLabel(provider: unknown) {
  return walletProviderPreset(walletProviderGroup(provider))?.label ?? (typeof provider === 'string' && provider ? provider : '—')
}
import { walletProviderAliases } from '../../shared/payment-channel'


export function walletProviderGroup(provider: unknown) {
  if (typeof provider !== 'string') return
  const normalized = provider.trim().toLowerCase()
  return walletProviderFilters.find(option =>
    (walletProviderAliases[option.value] as readonly string[]).includes(normalized))?.value
}
