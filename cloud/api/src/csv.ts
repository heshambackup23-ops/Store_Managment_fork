export function csvCell(value: string | number | null) {
  if (typeof value === 'number') return String(value)
  const field = value ?? ''
  const safe = /^(?:[\s\uFEFF]*[=+@＝＋－＠-]|[\t\r\n])/u.test(field) ? "'" + field : field
  return `"${safe.replaceAll('"', '""')}"`
}
