export const walletProviderOptions = [
  { value: 'vodafone_cash', label: 'فودافون كاش' },
  { value: 'etisalat_cash', label: 'e& cash (اتصالات)' },
  { value: 'orange_cash', label: 'أورنج كاش' },
  { value: 'we_pay', label: 'WE Pay' },
  { value: 'instapay', label: 'إنستا باي (تحويل بنكي لحظي)' },
]

export function walletProviderPreset(provider: unknown) {
  return walletProviderOptions.find(option => option.value === provider)
}

export function walletProviderLabel(provider: unknown) {
  return walletProviderPreset(provider)?.label ?? (typeof provider === 'string' && provider ? provider : '—')
}
