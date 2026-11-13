import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'
import { day, dateTime, id, integer, invoiceItems, literal, minor, readExport, rowMap, rowsOf, text } from './laravel-finance-export.mjs'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    'actor-id': { type: 'string', default: '1' },
    'emit-sql': { type: 'string' },
  },
})

function refundEvidence(input, invoices) {
  const evidence = input.invoice_refund_evidence ?? {}
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    throw new Error('invoice_refund_evidence must be an object keyed by invoice ID')
  }
  const refunds = new Map()
  const references = new Set()
  for (const [sourceId, row] of Object.entries(evidence)) {
    const key = id(sourceId)
    if (String(key) !== sourceId || invoices.get(key)?.status !== 'refunded') {
      throw new Error('invoice_refund_evidence references a non-refunded or unknown invoice')
    }
    if (!row || typeof row !== 'object' || Array.isArray(row) || row.stock_restored !== true) {
      throw new Error(`Historical refund ID ${key} needs evidence that stock was restored before cutoff`)
    }
    const reference = text(row.reference, 120, true).trim()
    if (references.has(reference)) throw new Error('historical refund references must be unique')
    references.add(reference)
    refunds.set(key, {
      reference,
      created_at: dateTime(row.refunded_at),
      returned_minor: minor(row.returned_amount),
      reason: text(row.reason, 500, true).trim(),
    })
  }
  return refunds
}

function buildImport(input, actor) {
  const tables = input.tables
  const products = rowMap(rowsOf(tables, 'products', true), 'products', (row) => ({
    name: text(row.name, 255, true), stock: integer(row.stock, 0, 1000000000),
  }))
  const customers = rowMap(rowsOf(tables, 'customers', true), 'customers', (row) => text(row.name, 255, true))
  const linked = new Map()
  for (const [key, row] of rowMap(rowsOf(tables, 'installments', true), 'installments')) {
    if (row.invoice_id == null) continue
    const invoice = id(row.invoice_id)
    if (linked.has(invoice)) throw new Error(`multiple installments linked to invoice ID ${invoice}`)
    linked.set(invoice, { key, row })
  }
  for (const table of ['sales', 'sales_items', 'payments', 'debts']) {
    if (rowsOf(tables, table, true).length) throw new Error(`review populated ${table} before importing invoices to avoid counting sales twice`)
  }
  const customerMap = new Map(Object.entries(input.invoice_customer_ids ?? {}).map(([key, value]) => [id(key), value == null ? null : id(value)]))
  const sourceInvoices = rowsOf(tables, 'invoices', true)
  const refunds = refundEvidence(input, rowMap(sourceInvoices, 'invoices'))
  const invoices = rowMap(sourceInvoices, 'invoices', (row, key) => {
    const refund = refunds.get(key)
    if (row.status === 'refunded' && !refund) throw new Error('historical refund needs independently dated evidence and reconciliation')
    if (!customerMap.has(key)) throw new Error('missing explicit invoice_customer_ids entry')
    const customer = customerMap.get(key)
    if (customer !== null && !customers.has(customer)) throw new Error('mapped customer is absent from the cutoff snapshot')
    const paid = minor(row.paid_amount)
    const total = minor(row.total_amount)
    if (paid > total || (paid < total && customer === null)) throw new Error('paid amount or balance customer does not reconcile')
    if (!refund && row.status !== (paid === total ? 'paid' : 'unpaid')) throw new Error('invoice status differs from its balance')
    const created = dateTime(row.created_at)
    const updated = dateTime(row.updated_at)
    if (updated > input.cutoff_at || created > updated) throw new Error('timestamp is inconsistent with the snapshot cutoff')
    const posting = day(row.invoice_date)
    if (posting > input.cutoff_at.slice(0, 10)) throw new Error('invoice date is after cutoff')
    if (refund && (refund.created_at < created || refund.created_at > updated || refund.returned_minor !== paid)) {
      throw new Error('historical refund evidence disagrees with source timestamps or paid amount')
    }
    return {
      id: key, customer_id: customer, total_minor: total, paid_minor: paid,
      actor_id: actor, created_at: created, updated_at: updated, invoice_date: posting,
      notes: text(row.notes, 12000), legacy_invoice_number: text(row.invoice_number, 255, true),
      legacy_customer_name: text(row.customer, 255, true), historical_paid_minor: paid,
      ...invoiceItems(row, products),
    }
  })
  if (!invoices.size || customerMap.size !== invoices.size) throw new Error('invoice_customer_ids must cover exactly the imported invoice IDs')
  const installments = new Map()
  for (const [invoiceId, { key, row }] of linked) {
    const invoice = invoices.get(invoiceId)
    if (!invoice || !invoice.customer_id || (row.customer_id != null && id(row.customer_id) !== invoice.customer_id)) {
      throw new Error(`customer or invoice mismatch for linked installment ID ${key}`)
    }
    const total = minor(row.product_price)
    const paid = minor(row.paid_amount)
    const due = minor(row.remaining)
    const refund = refunds.get(invoiceId)
    const closedByRefund = refund && row.status === 'مسترد' && due === 0n
    if (total < 1n || total !== invoice.total_minor || paid !== invoice.paid_minor
      || (refund ? !closedByRefund : total - paid !== due)) {
      throw new Error(`linked installment ID ${key} does not match original invoice balance`)
    }
    const created = dateTime(row.created_at)
    const updated = dateTime(row.updated_at)
    if (updated > input.cutoff_at || created > updated || (refund && (refund.created_at < created || refund.created_at > updated))) {
      throw new Error(`invalid timestamps for linked installment ID ${key}`)
    }
    const dueDate = row.next_payment_date == null && due === 0n ? invoice.invoice_date : day(row.next_payment_date)
    const paymentDate = row.payment_date == null ? null : day(row.payment_date)
    const items = invoice.items.map(({ product, name, quantity, price }) => ({
      product_id: product, name, quantity, unit_price_minor: Number(price), line_total_minor: Number(price) * quantity,
    }))
    installments.set(key, {
      id: key, invoice_id: invoiceId, customer_id: invoice.customer_id, principal_minor: total, paid_minor: paid,
      historical_paid_minor: paid, due_date: dueDate, payment_date: paymentDate,
      note: text(row.notes, 12000), product_name: text(row.product_name, 12000, true),
      items_json: JSON.stringify(items), actor_id: actor, created_at: created, updated_at: updated,
    })
  }
  const ids = [...invoices.keys()].sort((left, right) => left - right)
  let max = ids.at(-1)
  for (const key of installments.keys()) max = Math.max(max, key)
  const sort = [...invoices.values()].sort((left, right) => left.id - right.id)
  const installmentRows = [...installments.values()].sort((left, right) => left.id - right.id)
  const references = new Set(sort.flatMap((invoice) => invoice.items.map((line) => line.product)))
  const productSnapshot = Array.from(references).sort((left, right) => left - right).map((key) => [key, products.get(key).stock])
  const orderedRefunds = [...refunds.entries()].sort(([left], [right]) => left - right)
  const canonical = JSON.stringify({
    cutoff: input.cutoff_at, invoices: sort, installments: installmentRows, productSnapshot,
    ...(orderedRefunds.length ? { refunds: orderedRefunds } : {}),
  },
    (_, value) => typeof value === 'bigint' ? String(value) : value)
  const fingerprint = createHash('sha256').update(canonical).digest('hex')
  const batch = literal(fingerprint)
  const whenSame = `historical_invoice_imports.fingerprint IS excluded.fingerprint
    AND historical_invoice_imports.cutoff_at IS excluded.cutoff_at AND historical_invoice_imports.actor_id IS excluded.actor_id
    AND historical_invoice_imports.invoice_count IS excluded.invoice_count`
  const commands = [
    `INSERT INTO historical_invoice_imports (id, fingerprint, cutoff_at, invoice_count, actor_id)
      VALUES (1, CASE WHEN EXISTS (SELECT 1 FROM historical_invoice_imports WHERE id = 1)
        OR (NOT EXISTS (SELECT 1 FROM invoices) AND NOT EXISTS (SELECT 1 FROM installments))
        THEN ${batch} ELSE NULL END, ${literal(input.cutoff_at)}, ${invoices.size}, ${actor})
      ON CONFLICT(id) DO UPDATE SET fingerprint = CASE WHEN ${whenSame} THEN historical_invoice_imports.fingerprint ELSE NULL END;`,
  ]
  for (const [product, quantity] of productSnapshot) {
    commands.push(`UPDATE historical_invoice_imports SET fingerprint = NULL WHERE fingerprint = ${batch}
      AND NOT EXISTS (SELECT 1 FROM invoices WHERE legacy_import_fingerprint = ${batch})
      AND NOT EXISTS (SELECT 1 FROM products WHERE id = ${product} AND stock = ${quantity});`)
  }
  for (const invoice of sort) {
    const { items, fallback, ...header } = invoice
    const entry = { ...header, legacy_import_fingerprint: fingerprint }
    commands.push(`INSERT INTO invoices (${Object.keys(entry).join(', ')})
      SELECT ${Object.values(entry).map(literal).join(', ')}
      WHERE NOT EXISTS (SELECT 1 FROM invoices WHERE id = ${invoice.id} AND legacy_import_fingerprint = ${batch});`)
    for (const line of items) {
      commands.push(`INSERT INTO invoice_items
        (invoice_id, product_id, product_name, quantity, unit_price_minor, unit_cost_minor)
        SELECT ${invoice.id}, ${line.product}, ${literal(line.name)}, ${line.quantity}, ${line.price}, 0
        WHERE NOT EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = ${invoice.id}
          AND product_id = ${line.product} AND product_name = ${literal(line.name)}
          AND quantity = ${line.quantity} AND unit_price_minor = ${line.price} AND unit_cost_minor = 0);`)
    }
  }
  for (const row of installmentRows) {
    commands.push(`INSERT INTO installments (${Object.keys(row).join(', ')})
      SELECT ${Object.values(row).map(literal).join(', ')}
      WHERE NOT EXISTS (SELECT 1 FROM installments WHERE id = ${row.id}
        AND invoice_id = ${row.invoice_id} AND historical_paid_minor = ${row.historical_paid_minor});`)
  }
  for (const [key, refund] of orderedRefunds) {
    const invoice = invoices.get(key)
    commands.push(`INSERT INTO invoice_refunds(id,invoice_id,total_minor,returned_minor,reason,actor_id,created_at,legacy_refund_reference)
      SELECT ${[key, key, invoice.total_minor, refund.returned_minor, refund.reason, actor, refund.created_at, refund.reference].map(literal).join(', ')}
      WHERE NOT EXISTS (SELECT 1 FROM invoice_refunds WHERE invoice_id = ${key}
        AND legacy_refund_reference = ${literal(refund.reference)});`)
  }
  commands.push(`INSERT INTO business_operations (id, actor_id, request_key, operation, fingerprint)
    SELECT ${max}, ${actor}, ${literal('historical-invoice:' + fingerprint)}, 'import.reserve', ${batch}
    WHERE NOT EXISTS (SELECT 1 FROM business_operations WHERE id >= ${max});`)
  return { fingerprint, invoices, installments, refunds, products, customers, productSnapshot, sql: commands.join('\n') + '\n' }
}

function assertReconciled(db, plan) {
  const rows = db.prepare('SELECT id, total_minor, paid_minor, historical_paid_minor, legacy_invoice_number, refunded_at FROM invoices').all()
  if (rows.length !== plan.invoices.size || rows.some((row) => {
    const source = plan.invoices.get(row.id)
    return !source || BigInt(row.total_minor) !== source.total_minor || BigInt(row.paid_minor) !== source.paid_minor
      || row.historical_paid_minor !== row.paid_minor || row.legacy_invoice_number !== source.legacy_invoice_number
      || row.refunded_at !== (plan.refunds.get(row.id)?.created_at ?? null)
  })) throw new Error('invoice headers did not reconcile')
  const counts = db.prepare(`SELECT (SELECT count(*) FROM invoice_items) AS items,
    (SELECT count(*) FROM invoice_payments) AS dated_payments,
    (SELECT count(*) FROM inventory_movements WHERE source_type IN ('invoice', 'refund')) AS stock_replays`).get()
  const expectedItems = [...plan.invoices.values()].reduce((sum, invoice) => sum + invoice.items.length, 0)
  if (counts.items !== expectedItems || counts.dated_payments || counts.stock_replays || db.prepare('PRAGMA foreign_key_check').all().length) {
    throw new Error('invoice children or foreign keys did not reconcile')
  }
  const actualItems = db.prepare('SELECT product_id, product_name, quantity, unit_price_minor, unit_cost_minor FROM invoice_items WHERE invoice_id = ? ORDER BY product_id')
  for (const invoice of plan.invoices.values()) {
    const actual = actualItems.all(invoice.id)
    if (actual.length !== invoice.items.length || actual.some((row, index) => {
      const source = invoice.items[index]
      return row.product_id !== source.product || row.product_name !== source.name || row.quantity !== source.quantity
        || BigInt(row.unit_price_minor) !== source.price || row.unit_cost_minor !== 0
    })) throw new Error('historical invoice prices or item snapshots did not reconcile')
  }
  const installmentRows = db.prepare('SELECT id, invoice_id, principal_minor, paid_minor, historical_paid_minor, voided_at FROM installments').all()
  if (installmentRows.length !== plan.installments.size || installmentRows.some((row) => {
    const source = plan.installments.get(row.id)
    return !source || row.invoice_id !== source.invoice_id || BigInt(row.principal_minor) !== source.principal_minor
      || BigInt(row.paid_minor) !== source.paid_minor || row.historical_paid_minor !== row.paid_minor
      || row.voided_at !== (plan.refunds.get(row.invoice_id)?.created_at ?? null)
  })) throw new Error('linked installment balances did not reconcile')
  const refunds = db.prepare('SELECT invoice_id, returned_minor, created_at, legacy_refund_reference FROM invoice_refunds').all()
  if (refunds.length !== plan.refunds.size || refunds.some((row) => {
    const expected = plan.refunds.get(row.invoice_id)
    return !expected || row.legacy_refund_reference !== expected.reference || row.created_at !== expected.created_at
      || BigInt(row.returned_minor) !== expected.returned_minor
  })) throw new Error('historical refunds did not reconcile')
  const stock = db.prepare('SELECT stock FROM products WHERE id = ?')
  if (plan.productSnapshot.some(([product, quantity]) => stock.get(product).stock !== quantity)) {
    throw new Error('stock changed during invoice history import')
  }
}

try {
  if (positionals.length !== 1) throw new Error('usage: node scripts/import-laravel-invoices.mjs EXPORT [--actor-id 1] [--emit-sql PATH.generated.sql]')
  const output = values['emit-sql']
  if (output && !output.endsWith('.generated.sql')) throw new Error('output path must end with .generated.sql')
  const actor = id(values['actor-id'])
  const input = readExport(await readFile(positionals[0], 'utf8'))
  const plan = buildImport(input, actor)
  const db = new DatabaseSync(':memory:')
  try {
    const migrations = new URL('../migrations/', import.meta.url)
    for (const name of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
      db.exec(await readFile(new URL(name, migrations), 'utf8'))
    }
    db.prepare("INSERT INTO users (id, name, email, password_hash, role_id) VALUES (?,'Fixture operator','invoice-import@example.invalid','unused',1)").run(actor)
    for (const [key, row] of plan.products) {
      db.prepare('INSERT INTO products(id,name,price_minor,stock) VALUES (?,?,0,?)').run(key, row.name, row.stock)
    }
    for (const [key, name] of plan.customers) db.prepare('INSERT INTO customers(id,name) VALUES (?,?)').run(key, name)
    db.exec('BEGIN IMMEDIATE')
    db.exec(plan.sql)
    assertReconciled(db, plan)
    db.exec(plan.sql)
    assertReconciled(db, plan)
    db.exec('COMMIT')
  } finally {
    db.close()
  }
  if (output) await writeFile(output, plan.sql, { flag: 'wx', mode: 0o600 })
  const invoices = Array.from(plan.invoices.values())
  console.log(JSON.stringify({
    mode: output ? 'sql-generated' : 'dry-run',
    fingerprint: plan.fingerprint, cutoff_at: input.cutoff_at,
    invoices: invoices.length, products_checked: plan.productSnapshot.length,
    linked_installments: plan.installments.size,
    standalone_installments_excluded: input.tables.installments.filter((row) => row.invoice_id == null).length,
    legacy_single_item_names_from_cutoff_catalog: invoices.filter((invoice) => invoice.fallback).length,
    total_minor: String(invoices.reduce((sum, invoice) => sum + invoice.total_minor, 0n)),
    historical_paid_minor: String(invoices.reduce((sum, invoice) => sum + invoice.paid_minor, 0n)),
    refunded_invoices: plan.refunds.size,
    documented_cash_returned_minor: String([...plan.refunds.values()].reduce((sum, refund) => sum + refund.returned_minor, 0n)),
    outstanding_minor: String(invoices.reduce((sum, invoice) => (
      plan.refunds.has(invoice.id) ? sum : sum + invoice.total_minor - invoice.paid_minor
    ), 0n)),
    verified_idempotent_replay: true,
  }, null, 2))
} catch (error) {
  console.error(`Historical invoice import failed: ${error.message}`)
  process.exitCode = 1
}
