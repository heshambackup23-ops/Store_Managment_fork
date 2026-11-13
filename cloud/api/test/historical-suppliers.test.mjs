import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { supplierHistorySql, verifySupplierHistory } from '../scripts/restore-laravel-suppliers.mjs'

function created(date) {
  const timestamp = `2026-10-${date}T10:00:00Z`
  return { created_at: timestamp, updated_at: timestamp }
}

function fixture() {
  return {
    suppliers: [
      { id: 501, name: 'مورد تاريخي', opening_balance: '10.00', balance: '4.25', ...created('01') },
      { id: 511, name: 'مورد بدفعة أولية', opening_balance: '0.00', balance: '7.25', ...created('01') },
    ],
    purchases: [
      { id: 502, supplier_id: 501, invoice_number: 'PUR-502', purchase_date: '2026-10-03', payment_type: 'credit',
        total_amount: '20.25', paid_amount: '20.25', remaining: '0.00', status: 'paid', ...created('03') },
      { id: 504, supplier_id: 501, invoice_number: 'PUR-504', purchase_date: '2026-10-04', payment_type: 'credit',
        total_amount: '40.00', paid_amount: '40.00', remaining: '0.00', status: 'paid', ...created('04') },
      { id: 506, supplier_id: 501, invoice_number: 'PUR-506', purchase_date: '2026-10-07', payment_type: 'cash',
        total_amount: '8.50', paid_amount: '8.50', remaining: '0.00', status: 'paid', ...created('07') },
      { id: 512, supplier_id: 511, invoice_number: 'PUR-512', purchase_date: '2026-10-02', payment_type: 'credit',
        total_amount: '11.00', paid_amount: '3.75', remaining: '7.25', status: 'partial', ...created('02') },
    ],
    supplier_payments: [
      { id: 503, supplier_id: 501, purchase_id: 502, receipt_number: 'PAY-503',
        amount: '28.00', payment_date: '2026-10-05', notes: 'دفعة تمتد على فاتورتين', ...created('05') },
      { id: 505, supplier_id: 501, purchase_id: 504, receipt_number: 'PAY-505',
        amount: '38.00', payment_date: '2026-10-06', ...created('06') },
      { id: 507, supplier_id: 501, purchase_id: 506, receipt_number: 'PAY-507',
        amount: '8.50', payment_date: '2026-10-07', notes: 'سداد فاتورة كاش PUR-506', ...created('07') },
    ],
  }
}

async function createDb(t) {
  const db = new DatabaseSync(':memory:')
  t.after(() => db.close())
  const migrations = new URL('../migrations/', import.meta.url)
  for (const file of (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(await readFile(new URL(file, migrations), 'utf8'))
  }
  db.exec("INSERT INTO users(id, name, email, password_hash, role_id) VALUES (1,'Operator','test@example.invalid','unused',1)")
  return db
}

test('restores supplier FIFO spanning two invoices, opening applications and a cash receipt', async (t) => {
  const db = await createDb(t)
  const source = fixture()
  const { sql, checks } = supplierHistorySql(source, 1)
  db.exec(sql)
  assert.deepEqual(verifySupplierHistory(db, source, 1), { suppliers: 2, purchases: 4, supplier_payments: 3 })
  assert.deepEqual(checks, {
    suppliers: 2, purchases: 4, receipts: 3, opening_minor: '1000', balance_minor: '1150',
    purchase_total_minor: '7975', purchase_paid_minor: '7250', receipts_minor: '7450',
    purchase_initial_paid_without_receipt_minor: '375', opening_applied_minor: '575', fifo_allocations: 3,
  })
  assert.deepEqual(db.prepare('SELECT receipt_id, purchase_id, amount_minor FROM supplier_receipt_allocations ORDER BY receipt_id,purchase_id')
    .all().map(({ receipt_id, purchase_id, amount_minor }) => [receipt_id, purchase_id, amount_minor]), [
    [503, 502, 2025], [503, 504, 775], [505, 504, 3225],
  ])
  assert.equal(db.prepare('SELECT opening_applied_minor FROM supplier_receipts WHERE id=505').get().opening_applied_minor, 575)
  assert.equal(db.prepare('SELECT legacy_receipt_number FROM supplier_payments WHERE id=507').get().legacy_receipt_number, 'PAY-507')
  assert.equal(db.prepare('SELECT legacy_initial_paid_minor FROM purchases WHERE id=512').get().legacy_initial_paid_minor, 375)
  assert.equal(db.prepare('SELECT count(*) AS n FROM inventory_movements').get().n, 0)
  const next = db.prepare(`INSERT INTO business_operations(actor_id, request_key, operation, fingerprint)
    VALUES (1,'next-test','supplier.receipt','fixture') RETURNING id`).get().id
  assert.ok(next > 512)
  db.prepare(`INSERT INTO supplier_receipts(id,supplier_id,amount_minor,opening_applied_minor,payment_date,actor_id)
    VALUES (?,501,425,425,'2026-11-13',1)`).run(next)
  assert.equal(db.prepare('SELECT balance_minor FROM supplier_balances WHERE id=501').get().balance_minor, 0)
  assert.throws(() => verifySupplierHistory(db, source, 1), /supplier balances/)
})

test('blocks missing sheets, cross-supplier links and ambiguous FIFO histories', () => {
  const missing = fixture()
  delete missing.purchases
  assert.throws(() => supplierHistorySql(missing, 1), /sheets, even when empty/)

  const crossing = fixture()
  crossing.supplier_payments[0].purchase_id = 512
  assert.throws(() => supplierHistorySql(crossing, 1), /another supplier/)

  const unordered = fixture()
  Object.assign(unordered.purchases[1], created('05'))
  assert.throws(() => supplierHistorySql(unordered, 1), /share a creation timestamp/)

  const ambiguous = fixture()
  ambiguous.suppliers[0].balance = '0.00'
  assert.throws(() => supplierHistorySql(ambiguous, 1), /overlap FIFO across purchases/)

  const incorrectLink = fixture()
  incorrectLink.supplier_payments[0].purchase_id = 504
  assert.throws(() => supplierHistorySql(incorrectLink, 1), /first reconstructed FIFO purchase/)
})
