import { createHash } from 'node:crypto'

// Tables preserve individual ledger rows. Views add the balances a restored store will actually read.
const domains = {
  products: ['stock', 'inventory_value_minor'],
  inventory_movements: ['delta'],
  invoices: ['total_minor', 'paid_minor', 'outstanding_minor'],
  invoice_items: ['quantity', 'unit_price_minor', 'unit_discount_minor'],
  invoice_payments: ['amount_minor'],
  invoice_refunds: ['returned_minor'],
  installments: ['principal_minor', 'paid_minor', 'net_principal_minor'],
  installment_payments: ['amount_minor'],
  personal_debts: ['principal_minor', 'paid_minor'],
  personal_debt_payments: ['amount_minor'],
  purchases: ['total_minor', 'net_total_minor', 'paid_minor', 'supplier_credit_minor'],
  purchase_order_items: ['quantity', 'unit_cost_minor', 'landed_unit_minor'],
  purchase_stock_receipts: [],
  purchase_stock_receipt_items: ['quantity'],
  purchase_stock_reversals: [],
  supplier_balances: ['balance_minor'],
  supplier_payments: ['amount_minor'],
  supplier_receipts: ['amount_minor'],
  supplier_receipt_allocations: ['amount_minor'],
  supplier_stock_returns: ['credit_minor'],
  supplier_stock_return_items: ['quantity'],
  supplier_stock_return_devices: [],
  wallets: ['balance_minor'],
  wallet_transactions: ['delta_minor', 'cash_delta_minor'],
  wallet_cash_entries: ['delta_minor'],
  wallet_debts: ['principal_minor', 'paid_minor'],
  wallet_debt_payments: ['amount_minor'],
  wallet_financial_totals: [],
  wallet_reconciliations: ['expected_minor', 'observed_minor'],
  damaged_stock: ['quantity'],
  damaged_stock_corrections: ['quantity'],
  damaged_stock_reversals: [],
  maintenance_requests: ['price_minor', 'paid_minor'],
  maintenance_payments: ['amount_minor'],
  retail_shift_positions: ['expected_minor', 'observed_minor'],
  retail_tender_ledger: ['amount_minor', 'delta_minor'],
  retail_tender_matches: [],
  retail_cash_movements: ['amount_minor', 'delta_minor'],
  retail_service_cash: ['delta_minor'],
  retail_safe_position: ['opening_minor', 'expected_minor'],
  retail_safe_ledger: ['delta_minor'],
  retail_safe_counts: ['expected_minor', 'observed_minor'],
  retail_returns: ['total_minor', 'returned_minor', 'debt_reduction_minor'],
  retail_return_items: ['quantity'],
  retail_return_devices: [],
  retail_exchanges: [],
  retail_stocktake_records: ['expected_quantity', 'observed_quantity'],
  retail_devices: [],
  retail_device_sales: ['unit_cost_minor'],
  retail_device_events: [],
  retail_device_warranties: [],
  retail_quarantine_resolutions: [],
  retail_quantity_movement_costs: ['cost_delta_minor'],
  retail_quantity_return_costs: ['cost_minor'],
  retail_quantity_opening_valuations: ['value_minor'],
}

function identifier(name) {
  return `"${name.replaceAll('"', '""')}"`
}

async function summarizeDomain(db, name, aggregateColumns) {
  const columns = (await db.prepare('SELECT name, pk, hidden FROM pragma_table_xinfo(?) ORDER BY cid').bind(name).all()).results
    .filter(column => column.hidden !== 1)
  const metrics = aggregateColumns.filter(column => columns.some(field => field.name === column))
  const primaryKey = columns.filter(column => column.pk).sort((a, b) => a.pk - b.pk)
  // Hex keeps text and binary lossless, including embedded NUL; use decimal strings for 64-bit integers.
  const fields = columns.map(({ name }, index) => {
    const column = identifier(name)
    return `CASE typeof(${column}) WHEN 'null' THEN NULL WHEN 'text' THEN 't' || hex(${column})
      WHEN 'blob' THEN 'b' || hex(${column}) ELSE substr(typeof(${column}), 1, 1) || CAST(${column} AS TEXT) END AS v${index}`
  })
  const order = primaryKey.length ? primaryKey.map(({ name }) => identifier(name)).join(', ') : fields.map((_, index) => `v${index}`).join(', ')
  const statement = db.prepare(`SELECT ${fields.join(', ')} FROM ${identifier(name)} ORDER BY ${order} LIMIT ? OFFSET ?`)
  const metricIndexes = metrics.map(column => columns.findIndex(field => field.name === column))
  const totals = metrics.map(() => 0n)
  const hash = createHash('sha256')
  const limit = 500
  let count = 0
  for (;;) {
    const { results } = await statement.bind(limit, count).all()
    for (const row of results) {
      const values = columns.map((_, index) => row[`v${index}`])
      hash.update(JSON.stringify(values) + '\n')
      metricIndexes.forEach((index, metric) => {
        const value = values[index]
        if (value === null) return
        if (typeof value !== 'string' || !/^i-?\d+$/.test(value)) throw new Error(`Non-integer total in ${name}.${metrics[metric]}.`)
        totals[metric] += BigInt(value.slice(1))
      })
    }
    count += results.length
    if (results.length < limit) break
  }
  return { rows: count, sha256: hash.digest('hex'), totals: Object.fromEntries(metrics.map((name, index) => [name, String(totals[index])])) }
}

export async function summarizeRetailBackup(db, availableObjects) {
  const summary = {}
  for (const [name, columns] of Object.entries(domains)) {
    if (availableObjects.has(name)) summary[name] = await summarizeDomain(db, name, columns)
  }
  return summary
}
