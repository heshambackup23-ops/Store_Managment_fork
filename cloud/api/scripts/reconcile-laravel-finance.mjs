import { readFile } from 'node:fs/promises'
import { day, id, integer, invoiceItems, minor, readExport, rowMap, sourceTables } from './laravel-finance-export.mjs'

const output = { mode: 'source-preflight', domains: {}, differences: [] }

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

function sum(rows, value) {
  return Array.from(rows.values()).reduce((total, row) => total + value(row), 0n)
}

function add(totals, key, amount) {
  totals.set(key, (totals.get(key) ?? 0n) + amount)
}

function balances(row, totalField, paidField, remainingField) {
  const total = minor(row[totalField])
  const paid = minor(row[paidField])
  const due = total - paid
  expect(due >= 0n, 'paid amount exceeds total')
  if (remainingField) expect(minor(row[remainingField]) === due, 'stored remaining does not equal total minus paid')
  return { total, paid, due }
}

function run(name, tables, required, check) {
  const missing = required.filter((table) => !Object.hasOwn(tables, table))
  if (missing.length) {
    output.domains[name] = { status: 'not_evaluated', missing_tables: missing }
    return
  }
  try {
    output.domains[name] = { status: 'reconciled', ...check() }
  } catch (error) {
    output.domains[name] = { status: 'mismatch' }
    output.differences.push({ domain: name, reason: error.message })
  }
}

try {
  if (process.argv.length !== 3) throw new Error('usage: node scripts/reconcile-laravel-finance.mjs EXPORT')
  const source = readExport(await readFile(process.argv[2], 'utf8'))
  const tables = source.tables
  output.cutoff_at = source.cutoff_at
  output.table_counts = Object.fromEntries(sourceTables.filter((name) => tables[name]).map((name) => [name, tables[name].length]))

  run('invoices', tables, ['invoices', 'products', 'installments', 'sales', 'sales_items', 'payments', 'debts'], () => {
    const products = rowMap(tables.products, 'products')
    const invoices = rowMap(tables.invoices, 'invoices', (row) => {
      day(row.invoice_date)
      const balance = balances(row, 'total_amount', 'paid_amount')
      const { items } = invoiceItems(row, products)
      const status = row.status === 'refunded' || row.status === (balance.due === 0n ? 'paid' : 'unpaid')
      expect(status, 'invoice status does not agree with monetary balance')
      return { ...balance, refunded: row.status === 'refunded', items: items.length }
    })
    const installments = rowMap(tables.installments, 'installments')
    const linked = new Set(Array.from(installments.values()).filter((row) => row.invoice_id != null).map((row) => id(row.invoice_id)))
    for (const value of linked) expect(invoices.has(value), `linked invoice ID ${value} missing`)
    return {
      invoice_count: invoices.size,
      invoice_line_count: Array.from(invoices.values()).reduce((total, row) => total + row.items, 0),
      gross_minor: sum(invoices, (row) => row.total),
      stored_paid_minor: sum(invoices, (row) => row.paid),
      active_due_minor: sum(invoices, (row) => row.refunded ? 0n : row.due),
      refunded_invoices: Array.from(invoices.values()).filter((row) => row.refunded).length,
      linked_installment_invoices: linked.size,
      legacy_sales_rows_to_review: tables.sales.length + tables.sales_items.length + tables.payments.length + tables.debts.length,
      cash_history: 'source_invoices_store_cumulative_paid_only',
    }
  })

  run('legacy_sales', tables, ['sales', 'sales_items', 'payments', 'debts', 'customers', 'products'], () => {
    const customers = rowMap(tables.customers, 'customers')
    const products = rowMap(tables.products, 'products')
    const sales = rowMap(tables.sales, 'sales', (row) => {
      expect(customers.has(id(row.customer_id)) && products.has(id(row.product_id)), 'customer or product missing')
      return integer(row.total)
    })
    for (const [table, field] of [['sales_items', 'price'], ['payments', 'amount'], ['debts', 'remaining']]) {
      rowMap(tables[table], table, (row) => {
        expect(sales.has(id(row.sale_id)), 'sale relationship missing')
        if (row.product_id != null) expect(products.has(id(row.product_id)), 'product relationship missing')
        if (row.customer_id != null) expect(customers.has(id(row.customer_id)), 'customer relationship missing')
        integer(row[field])
      })
    }
    return { sales: sales.size, source_integer_total: sum(sales, (value) => BigInt(value)),
      money_unit: 'unconfirmed', migration_status: sales.size ? 'needs_overlap_and_unit_review' : 'empty' }
  })

  run('installments', tables, ['installments', 'invoices'], () => {
    const invoices = rowMap(tables.invoices, 'invoices')
    const linked = new Set()
    const installments = rowMap(tables.installments, 'installments', (row) => {
      const balance = balances(row, 'product_price', 'paid_amount', 'remaining')
      if (row.invoice_id != null) {
        const key = id(row.invoice_id)
        expect(!linked.has(key) && invoices.has(key), 'missing invoice or duplicate installment link')
        linked.add(key)
        const invoice = invoices.get(key)
        if (invoice.status !== 'refunded') {
          expect(balance.total === minor(invoice.total_amount) && balance.paid === minor(invoice.paid_amount),
            'linked invoice total or paid amount differs')
        }
      }
      return { ...balance, linked: row.invoice_id != null }
    })
    return { count: installments.size, linked: linked.size,
      standalone_due_minor: sum(installments, (row) => row.linked ? 0n : row.due),
      total_principal_minor: sum(installments, (row) => row.total) }
  })

  run('personal_debts', tables, ['personal_debts', 'personal_debt_payments'], () => {
    const debts = rowMap(tables.personal_debts, 'personal_debts', (row) => balances(row, 'total_amount', 'paid_amount', 'remaining'))
    const paid = new Map()
    rowMap(tables.personal_debt_payments, 'personal_debt_payments', (row) => {
      const key = id(row.personal_debt_id)
      expect(debts.has(key), 'missing debt relationship')
      day(row.paid_on)
      add(paid, key, minor(row.amount))
    })
    for (const [key, row] of debts) expect((paid.get(key) ?? 0n) === row.paid, `debt ID ${key} differs from payment ledger`)
    return { count: debts.size, paid_minor: sum(debts, (row) => row.paid), due_minor: sum(debts, (row) => row.due) }
  })

  run('suppliers', tables, ['suppliers', 'purchases', 'supplier_payments'], () => {
    const suppliers = rowMap(tables.suppliers, 'suppliers', (row) => ({
      opening: minor(row.opening_balance), balance: minor(row.balance),
    }))
    const purchasesTotal = new Map()
    const purchases = rowMap(tables.purchases, 'purchases', (row) => {
      const supplier = id(row.supplier_id)
      expect(suppliers.has(supplier), 'missing supplier relationship')
      const balance = balances(row, 'total_amount', 'paid_amount', 'remaining')
      day(row.purchase_date)
      add(purchasesTotal, supplier, balance.total)
      return { supplier, ...balance }
    })
    const paymentsTotal = new Map()
    const payments = rowMap(tables.supplier_payments, 'supplier_payments', (row) => {
      const supplier = id(row.supplier_id)
      expect(suppliers.has(supplier), 'missing supplier relationship')
      if (row.purchase_id != null) expect(purchases.get(id(row.purchase_id))?.supplier === supplier, 'receipt links another supplier or missing purchase')
      const amount = minor(row.amount)
      day(row.payment_date)
      add(paymentsTotal, supplier, amount)
      return amount
    })
    for (const [key, row] of suppliers) {
      expect(row.opening + (purchasesTotal.get(key) ?? 0n) - (paymentsTotal.get(key) ?? 0n) === row.balance,
        `supplier ID ${key} does not balance against opening + purchases - receipts`)
    }
    return { suppliers: suppliers.size, purchases: purchases.size, receipts: payments.size,
      due_minor: sum(suppliers, (row) => row.balance), receipts_minor: sum(payments, (value) => value),
      allocation: 'raw_receipt_purchase_id_can_identify_only_first_fifo_purchase' }
  })

  run('wallets', tables, ['wallets', 'wallet_transactions', 'wallet_cash_adjustments', 'wallet_expenses'], () => {
    const wallets = rowMap(tables.wallets, 'wallets', (row) => ({ opening: minor(row.opening_balance), balance: minor(row.balance) }))
    const deltas = new Map()
    const movements = rowMap(tables.wallet_transactions, 'wallet_transactions', (row) => {
      const wallet = id(row.wallet_id)
      expect(wallets.has(wallet), 'missing wallet relationship')
      const delta = minor(row.wallet_delta, true)
      add(deltas, wallet, delta)
      const margin = minor(row.profit, true)
      if (['send', 'receive'].includes(row.type)) expect(margin === minor(row.commission) - minor(row.fee), 'transfer margin differs from commission minus fee')
      return { wallet, delta, margin, cash: minor(row.cash_delta, true), receivable: minor(row.receivable),
        reverses: row.reverses_id == null ? null : id(row.reverses_id), settles: row.settles_id == null ? null : id(row.settles_id),
        type: row.type, status: row.status }
    })
    const reversed = new Set()
    for (const [key, row] of movements) {
      if (row.reverses !== null) {
        const previous = movements.get(row.reverses)
        expect(row.reverses !== key && !reversed.has(row.reverses) && previous?.wallet === row.wallet
          && previous.delta === -row.delta, `wallet reversal ID ${key} does not reconcile`)
        reversed.add(row.reverses)
      }
      if (row.settles !== null) expect(row.settles !== key && movements.get(row.settles)?.wallet === row.wallet, `wallet settlement ID ${key} relationship missing`)
    }
    for (const [key, row] of wallets) expect(row.opening + (deltas.get(key) ?? 0n) === row.balance, `wallet ID ${key} does not balance against opening + wallet deltas`)
    const adjustments = rowMap(tables.wallet_cash_adjustments, 'wallet_cash_adjustments', (row) => ({ kind: row.kind, amount: minor(row.amount, true) }))
    const expenses = rowMap(tables.wallet_expenses, 'wallet_expenses', (row) => row.voided_at == null ? minor(row.amount) : 0n)
    const expenseTotal = sum(expenses, (amount) => amount)
    const drawer = sum(movements, (row) => row.cash) + sum(adjustments, (row) => row.amount) - expenseTotal
    const margin = sum(movements, (row) => ['send', 'receive'].includes(row.type) && row.status === 'completed' ? row.margin : 0n)
    const withdrawn = -sum(adjustments, (row) => row.kind === 'profit_withdraw' ? row.amount : 0n)
      - sum(movements, (row) => row.type === 'profit_withdrawal' ? row.delta : 0n)
    return { wallets: wallets.size, movements: movements.size, provider_minor: sum(wallets, (row) => row.balance),
      drawer_minor: drawer, expenses_minor: expenseTotal, profit_available_minor: margin - expenseTotal - withdrawn,
      receivables_minor: sum(movements, (row) => row.status === 'completed' ? row.receivable : 0n) }
  })

  run('damage', tables, ['damaged_items', 'products'], () => {
    const products = rowMap(tables.products, 'products')
    const records = rowMap(tables.damaged_items, 'damaged_items', (row) => {
      if (row.product_id != null) expect(products.has(id(row.product_id)), 'missing product relationship')
      const qty = integer(row.quantity, 1)
      const amount = minor(row.total_value)
      expect(amount === BigInt(qty) * minor(row.unit_value), 'damage valuation does not equal quantity × unit value')
      return { qty, amount, voided: row.status === 'voided' }
    })
    return { records: records.size, net_units: sum(records, (row) => row.voided ? 0n : BigInt(row.qty)),
      net_value_minor: sum(records, (row) => row.voided ? 0n : row.amount) }
  })

  run('maintenance', tables, ['maintenances'], () => {
    const records = rowMap(tables.maintenances, 'maintenances', (row) => {
      day(row.requested_date)
      if (row.completed_date != null) expect(day(row.completed_date) >= row.requested_date, 'completion precedes request date')
      return row
    })
    return { records: records.size, rows_with_images: Array.from(records.values()).filter((row) => row.image_path).length,
      money: 'source_schema_has_no_amount_or_payment_ledger' }
  })

  console.log(JSON.stringify(output, (_, value) => typeof value === 'bigint' ? String(value) : value, 2))
  if (output.differences.length) process.exitCode = 1
} catch (error) {
  console.error(`Finance reconciliation failed: ${error.message}`)
  process.exitCode = 1
}
