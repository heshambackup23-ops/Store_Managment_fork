import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'
import { restoreLaravelBackup } from '../scripts/restore-laravel-backup.mjs'
import { makeLegacyWorkbook, makeLegacyZip } from './helpers/legacy-workbook.mjs'

const date = '2026-10-02 13:30:00'
const day = '2026-10-02'
const cutoff = '2026-10-31T20:00:00+02:00'
const item = { product_id: 8, name: 'اسم الصنف وقت البيع', price: '12.35', quantity: 2, line_total: '24.70' }
const pageSheets = {
  catalog: {
    categories: [['id', 'name', 'created_at'], ['7', 'أدوات', date]],
    products: [['id', 'name', 'price', 'category_id', 'stock', 'barcode'], ['8', 'دفتر', '18.45', '7', '4', '00000008']],
  },
  customers: {
    customers: [['id', 'name', 'phone'], ['9', 'عميل تجريبي', '01000000007']],
  },
  sales: {
    sales: [['id']],
    sales_items: [['id']],
    payments: [['id']],
  },
  invoices: {
    invoices: [
      ['id', 'invoice_number', 'customer', 'product_id', 'quantity', 'invoice_date', 'status', 'total_amount', 'paid_amount', 'items', 'created_at', 'updated_at'],
      ['10', 'INV-0010', 'عميل تجريبي', '8', '2', day, 'unpaid', '24.70', '4.70', JSON.stringify([item]), date, date],
    ],
  },
  maintenance: {
    maintenances: [
      ['id', 'name', 'owner', 'phone', 'status', 'description', 'image_path', 'requested_date', 'completed_date', 'created_at', 'updated_at'],
      ['15', 'جهاز', 'عميل تجريبي', '01234567890', 'مكتمل', 'إصلاح منفذ', 'storage/fixture.webp', day, day, date, date],
    ],
  },
  installments: {
    installments: [
      ['id', 'invoice_id', 'customer_id', 'product_name', 'product_price', 'paid_amount', 'remaining', 'next_payment_date', 'payment_date', 'created_at', 'updated_at'],
      ['11', '10', '9', item.name, '24.70', '4.70', '20.00', '2026-11-02', day, date, date],
    ],
    debts: [['id']],
    personal_debts: [
      ['id', 'creditor', 'total_amount', 'paid_amount', 'remaining', 'status', 'created_at', 'updated_at'],
      ['12', 'دائن تجريبي', '27.03', '3.01', '24.02', 'open', date, date],
    ],
    personal_debt_payments: [
      ['id', 'personal_debt_id', 'amount', 'paid_on', 'created_at', 'created_by'],
      ['13', '12', '3.01', '2026-10-01', date, '45'],
    ],
  },
}

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hilal-legacy-restore-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('canonical backup ZIP restores Arabic names, exact money and stock to a fresh local D1 target', async (t) => {
  const dir = await temporary(t)
  const archive = join(dir, 'source.zip')
  const destination = join(dir, 'proof.generated.sql')
  await writeFile(archive, makeLegacyZip(pageSheets, cutoff))
  const result = await restoreLaravelBackup(archive, { sourceTimeZone: 'Africa/Cairo', emitD1Sql: destination })
  assert.equal(result.status, 'verified')
  assert.equal(result.cutoff_at, '2026-10-31T18:00:00.000Z')
  assert.deepEqual(result.restored_counts, {
    categories: 1, products: 1, customers: 1, personal_debts: 1, personal_debt_payments: 1, invoices: 1, installments: 1, maintenances: 1, damaged_items: 0,
  })
  assert.equal(result.checks.invoices.outstanding_minor, '2000')
  assert.equal(result.checks['personal-debts'].remaining_minor, '2402')
  assert.equal(result.checks.maintenance.attachments_requiring_separate_import, 1)

  const miniflare = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default {fetch() { return new Response("local"); }}',
    compatibilityDate: '2026-01-01', d1Databases: ['DB'],
  }))
  t.after(() => miniflare.dispose())
  const db = await miniflare.getD1Database('DB')
  const apply = (sql) => db.batch(unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)))
  const folder = new URL('../migrations/', import.meta.url)
  for (const migration of (await readdir(folder)).filter((file) => file.endsWith('.sql')).sort()) {
    await apply(await readFile(new URL(migration, folder), 'utf8'))
  }
  await db.prepare("INSERT INTO users (id,name,email,password_hash,role_id) VALUES (1,'Fixture','local@example.invalid','unusable',1)").run()
  const sql = await readFile(destination, 'utf8')
  await apply(sql)
  const totals = await db.prepare(`SELECT
    (SELECT stock FROM products WHERE id = 8) AS stock,
    (SELECT barcode FROM products WHERE id = 8) AS barcode,
    (SELECT paid_minor FROM invoices WHERE id = 10) AS invoice_paid,
    (SELECT historical_paid_minor FROM installments WHERE id = 11) AS installment_paid,
    (SELECT paid_minor FROM personal_debts WHERE id = 12) AS debt_paid,
    (SELECT legacy_paid_on FROM personal_debt_payments WHERE id = 13) AS debt_paid_on,
    (SELECT legacy_created_by FROM personal_debt_payments WHERE id = 13) AS source_actor,
    (SELECT product_name FROM invoice_items WHERE invoice_id = 10) AS legacy_item_name,
    (SELECT count(*) FROM invoice_payments) AS fabricated_payments,
    (SELECT status FROM maintenance_requests WHERE id = 15) AS maintenance_status,
    (SELECT count(*) FROM maintenance_payments) AS maintenance_payments`).first()
  assert.deepEqual(totals, {
    stock: 4, barcode: '00000008', invoice_paid: 470, installment_paid: 470, debt_paid: 301,
    debt_paid_on: '2026-10-01', source_actor: 45, legacy_item_name: item.name, fabricated_payments: 0,
    maintenance_status: 'completed', maintenance_payments: 0,
  })
  await assert.rejects(apply(sql), /CHECK constraint failed/)
  assert.equal(await db.prepare('SELECT stock FROM products WHERE id = 8').first('stock'), 4)
})

test('bare table XLSX restores catalog into a new SQLite file, and refuses to overwrite', async (t) => {
  const dir = await temporary(t)
  const workbook = join(dir, 'catalog.xlsx')
  const destination = join(dir, 'isolated.sqlite')
  await writeFile(workbook, makeLegacyWorkbook({ ...pageSheets.catalog, ...pageSheets.customers }))
  const result = await restoreLaravelBackup(workbook, { sourceTimeZone: 'Africa/Cairo', output: destination })
  assert.equal(result.source_kind, 'workbook')
  const db = new DatabaseSync(destination, { readOnly: true })
  try {
    assert.equal(db.prepare('SELECT price_minor FROM products WHERE id = 8').get().price_minor, 1845)
    assert.equal(db.prepare('SELECT created_at FROM categories WHERE id = 7').get().created_at, '2026-10-02T10:30:00.000Z')
    await assert.rejects(restoreLaravelBackup(workbook, { sourceTimeZone: 'Africa/Cairo', output: destination }), { code: 'EEXIST' })
    assert.equal(db.prepare('SELECT count(*) AS rows FROM products').get().rows, 1)
  } finally {
    db.close()
  }
})

test('unmapped historical modules and local-time ambiguities do not produce a target', async (t) => {
  const dir = await temporary(t)
  const input = join(dir, 'snapshot.json')
  const destination = join(dir, 'blocked.sqlite')
  const snapshot = {
    format: 'hilal-laravel-snapshot-v1', cutoff_at: cutoff, source_time_zone: 'Africa/Cairo',
    excluded_table_counts: { personal_access_tokens: 2 }, tables: { products: [], app_notifications: [{ id: 10 }] },
  }
  await writeFile(input, JSON.stringify(snapshot))
  const result = await restoreLaravelBackup(input, { output: destination })
  assert.deepEqual(result.blocked_counts, { app_notifications: 1 })
  assert.deepEqual(result.excluded_system_counts, { personal_access_tokens: 2 })
  await assert.rejects(stat(destination), { code: 'ENOENT' })

  snapshot.tables = { categories: [{ id: 1, name: 'حالة', created_at: '2026-10-29 23:30:00' }] }
  await writeFile(input, JSON.stringify(snapshot))
  await assert.rejects(restoreLaravelBackup(input, { output: destination }), /ambiguous or invalid/)
  await assert.rejects(stat(destination), { code: 'ENOENT' })
})

test('standalone installments preserve the cutoff balance and only post later payments', async (t) => {
  const dir = await temporary(t)
  const input = join(dir, 'standalone.xlsx')
  const output = join(dir, 'standalone.sqlite')
  await writeFile(input, makeLegacyWorkbook({
    ...pageSheets.customers,
    installments: [
      ['id', 'invoice_id', 'customer', 'product_name', 'product_price', 'quantity', 'paid_amount', 'remaining', 'next_payment_date', 'payment_date', 'created_at', 'updated_at', 'status'],
      ['14', '__STORE_BACKUP_NULL_V2__', 'عميل تجريبي', 'خدمة', '60.00', '1', '17.25', '42.75', '2026-10-29', day, date, date, 'متأخر'],
    ],
  }))
  const result = await restoreLaravelBackup(input, { cutoffAt: cutoff, sourceTimeZone: 'Africa/Cairo', output })
  assert.equal(result.checks.standalone_installments.remaining_minor, '4275')
  const db = new DatabaseSync(output)
  try {
    assert.deepEqual({ ...db.prepare('SELECT paid_minor, historical_paid_minor, marked_overdue FROM installments WHERE id = 14').get() },
      { paid_minor: 1725, historical_paid_minor: 1725, marked_overdue: 1 })
    assert.equal(db.prepare('SELECT count(*) AS records FROM installment_payments').get().records, 0)
    db.exec('INSERT INTO installment_payments (id, installment_id, amount_minor, actor_id) VALUES (20, 14, 100, 1)')
    assert.deepEqual({ ...db.prepare('SELECT paid_minor, historical_paid_minor FROM installments WHERE id = 14').get() },
      { paid_minor: 1825, historical_paid_minor: 1725 })
  } finally {
    db.close()
  }
})
