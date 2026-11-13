export const quantityScale = (scale: unknown) => Number(scale) === 1000 ? 1000 : 1
export const quantityStep = (scale: unknown) => 1 / quantityScale(scale)
export const displayQuantity = (value: unknown, scale: unknown) => Number(value ?? 0) / quantityScale(scale)
export const measurementLabel = (scale: unknown) => quantityScale(scale) === 1000 ? 'متر' : 'قطعة'

const quantityFormat = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 3 })
export function formatQuantity(stock: unknown, scale: unknown) {
  return quantityFormat.format(displayQuantity(stock, scale)) + ' ' + measurementLabel(scale)
}

export function stockQuantity(value: number, scale: unknown) {
  return Math.round(value * quantityScale(scale))
}

export function validQuantity(value: number, scale: unknown) {
  const stored = stockQuantity(value, scale)
  return Number.isSafeInteger(stored) && stored > 0 && stored <= 1_000_000 && displayQuantity(stored, scale) === value
}

export function lineMinor(rate: number, quantity: number, scale: unknown) {
  const factor = quantityScale(scale)
  return Number((BigInt(rate) * BigInt(quantity) + BigInt(Math.floor(factor / 2))) / BigInt(factor))
}
