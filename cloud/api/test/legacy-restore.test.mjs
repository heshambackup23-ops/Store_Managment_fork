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
      ['id', 'personal_debt_id', 'amount', 'paid_on', 'created_at'],
      ['13', '12', '3.01', day, date],
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
    categories: 1, products: 1, customers: 1, personal_debts: 1, personal_debt_payments: 1, invoices: 1, installments: 1,
  })
  assert.equal(result.checks.invoices.outstanding_minor, '2000')
  assert.equal(result.checks['personal-debts'].remaining_minor, '2402')

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
    (SELECT product_name FROM invoice_items WHERE invoice_id = 10) AS legacy_item_name,
    (SELECT count(*) FROM invoice_payments) AS fabricated_payments`).first()
  assert.deepEqual(totals, {
    stock: 4, barcode: '00000008', invoice_paid: 470, installment_paid: 470, debt_paid: 301,
    legacy_item_name: item.name, fabricated_payments: 0,
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
    excluded_table_counts: { personal_access_tokens: 2 }, tables: { products: [], wallets: [{ id: 10 }] },
  }
  await writeFile(input, JSON.stringify(snapshot))
  const result = await restoreLaravelBackup(input, { output: destination })
  assert.deepEqual(result.blocked_counts, { wallets: 1 })
  assert.deepEqual(result.excluded_system_counts, { personal_access_tokens: 2 })
  await assert.rejects(stat(destination), { code: 'ENOENT' })

  snapshot.tables = { categories: [{ id: 1, name: 'حالة', created_at: '2026-10-29 23:30:00' }] }
  await writeFile(input, JSON.stringify(snapshot))
  await assert.rejects(restoreLaravelBackup(input, { output: destination }), /ambiguous or invalid/)
  await assert.rejects(stat(destination), { code: 'ENOENT' })
})
