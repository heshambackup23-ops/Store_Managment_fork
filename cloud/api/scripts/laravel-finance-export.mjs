export const format = 'hilal-mysql-finance-v1'
export const amountLimit = 900000000000000n
export const maxId = Number.MAX_SAFE_INTEGER - 1
export const sourceTables = [
  'customers', 'products', 'invoices', 'installments', 'sales', 'sales_items', 'payments', 'debts',
  'personal_debts', 'personal_debt_payments', 'suppliers', 'purchases', 'supplier_payments',
  'wallets', 'wallet_transactions', 'wallet_cash_adjustments', 'wallet_expenses', 'maintenances', 'damaged_items',
]

export function integer(value, minimum = 0, maximum = maxId) {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(numeric) || numeric < minimum || numeric > maximum) throw new Error('invalid integer')
  return numeric
}

export function id(value) {
  return integer(value, 1)
}

export function minor(value, allowNegative = false) {
  const match = typeof value === 'string' && /^(-?)(\d{1,13})(?:\.(\d{1,2}))?$/.exec(value)
  if (!match || (!allowNegative && match[1])) throw new Error('money must be a DECIMAL string at scale 2')
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))
  if (amount > amountLimit) throw new Error('amount outside destination range')
  return match[1] ? -amount : amount
}

export function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('invalid date')
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) throw new Error('invalid calendar date')
  return value
}

export function dateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('timestamp requires an explicit offset')
  }
  day(value.slice(0, 10))
  const parsed = new Date(value)
  if (!Number.isFinite(+parsed)) throw new Error('invalid timestamp')
  return parsed.toISOString()
}

export function text(value, max, required = false) {
  if (value == null && !required) return ''
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) {
    throw new Error('invalid text')
  }
  return value
}

export function literal(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'number' || typeof value === 'bigint') return String(value)
  return "'" + value.replaceAll("'", "''") + "'"
}

export function readExport(raw) {
  const input = JSON.parse(raw)
  if (input?.format !== format || !input.tables || typeof input.tables !== 'object' || Array.isArray(input.tables)) {
    throw new Error('expected hilal-mysql-finance-v1 with a tables object')
  }
  const cutoff = dateTime(input.cutoff_at)
  for (const [name, rows] of Object.entries(input.tables)) {
    if (!sourceTables.includes(name) || !Array.isArray(rows)) throw new Error('unexpected finance table or invalid row collection')
  }
  if (input.invoice_customer_ids !== undefined && (
    !input.invoice_customer_ids || typeof input.invoice_customer_ids !== 'object' || Array.isArray(input.invoice_customer_ids)
  )) throw new Error('invoice_customer_ids must be a mapping object')
  return { ...input, cutoff_at: cutoff }
}

export function rowsOf(tables, name, required = false) {
  const rows = tables[name]
  if (!rows && required) throw new Error(`export must include table ${name}, even if empty`)
  return rows ?? []
}

export function rowMap(rows, table, convert = (row) => row) {
  const records = new Map()
  for (const [index, row] of rows.entries()) {
    try {
      const key = id(row?.id)
      if (records.has(key)) throw new Error('duplicate ID')
      records.set(key, convert(row, key))
    } catch (error) {
      throw new Error(`${table} row ${index + 1}: ${error.message}`)
    }
  }
  return records
}

export function invoiceItems(row, products) {
  const data = typeof row.items === 'string' ? JSON.parse(row.items) : row.items
  if (data != null && (!Array.isArray(data) || data.length === 0 || data.length > 1000)) throw new Error('invalid invoice items')
  const fallback = data == null
  const raw = data ?? [{ product_id: row.product_id, quantity: row.quantity, price: row.product_price }]
  const items = new Map()
  for (const line of raw) {
    const product = id(line?.product_id)
    const catalog = products.get(product)
    if (!catalog) throw new Error(`product ID ${product} missing from cutoff snapshot`)
    const quantity = integer(line.quantity, 1, 1000000)
    const price = minor(line.price)
    const total = price * BigInt(quantity)
    if (line.line_total != null && minor(line.line_total) !== total) throw new Error('line_total differs from price × quantity')
    const name = text(fallback ? catalog.name : line.name, 255, true)
    const existing = items.get(product)
    if (existing && (existing.price !== price || existing.name !== name)) {
      throw new Error(`duplicate product ID ${product} has conflicting historical price or name`)
    }
    if (existing) existing.quantity = integer(existing.quantity + quantity, 1, 1000000)
    else items.set(product, { product, name, quantity, price })
  }
  const result = Array.from(items.values()).sort((left, right) => left.product - right.product)
  const units = result.reduce((total, line) => total + line.quantity, 0)
  const subtotal = result.reduce((total, line) => total + line.price * BigInt(line.quantity), 0n)
  if (units !== integer(row.quantity, 1) || subtotal !== minor(row.total_amount)) throw new Error('invoice header totals do not match its lines')
  return { items: result, fallback }
}
