import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const fixture = new URL('../fixtures/mysql-finance.synthetic.json', import.meta.url)
const migrations = new URL('../migrations/', import.meta.url)
const reconcile = 'reconcile-laravel-finance.mjs'
const importer = 'import-laravel-invoices.mjs'

function run(script, input, args = []) {
  return spawnSync(process.execPath,
    [fileURLToPath(new URL('../scripts/' + script, import.meta.url)), input, ...args], { encoding: 'utf8' })
}

async function temp(t) {
  const folder = await mkdtemp(join(tmpdir(), 'hilal-finance-test-'))
  t.after(async () => {
    for (const file of await readdir(folder)) await unlink(join(folder, file))
    await rmdir(folder)
  })
  return folder
}

async function createDb(stock = 7) {
  const db = new DatabaseSync(':memory:')
  for (const name of (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()) {
    db.exec(await readFile(new URL(name, migrations), 'utf8'))
  }
  db.exec(`
    INSERT INTO users (id,name,email,password_hash,role_id) VALUES (1,'Fixture','fixture@example.invalid','unused',1);
    INSERT INTO customers (id,name) VALUES (41,'Fixture customer');
    INSERT INTO products (id,name,price_minor,stock) VALUES (42,'Product',7777,${stock}),(43,'Second product',9999,0);
  `)
  return db
}

function atomic(db, sql) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(sql)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

test('finance preflight validates separate source totals and detects mismatch', async (t) => {
  const result = run(reconcile, fileURLToPath(fixture))
  assert.equal(result.status, 0, result.stderr)
  const { domains, differences } = JSON.parse(result.stdout)
  assert.equal(Object.keys(domains).length, 8)
  assert.equal(domains.invoices.stored_paid_minor, '1220')
  assert.equal(domains.installments.standalone_due_minor, '1500')
  assert.equal(domains.suppliers.due_minor, '4225')
  assert.equal(domains.wallets.drawer_minor, '2850')
  assert.deepEqual(differences, [])

  const input = JSON.parse(await readFile(fixture, 'utf8'))
  input.tables.wallets[0].balance = '77.01'
  input.tables.installments[1].paid_amount = '3.71'
  const invalid = join(await temp(t), 'mismatch.json')
  await writeFile(invalid, JSON.stringify(input))
  const mismatch = run(reconcile, invalid)
  assert.equal(mismatch.status, 1)
  assert.deepEqual(JSON.parse(mismatch.stdout).differences.map(({ domain }) => domain), ['installments', 'wallets'])
})

test('invoice SQL preserves prices, current stock, linked balances, and post-cutoff accounting', async (t) => {
  const folder = await temp(t)
  const output = join(folder, 'history.generated.sql')
  const result = run(importer, fileURLToPath(fixture), ['--emit-sql', output])
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.historical_paid_minor, '1220')
  assert.equal(report.outstanding_minor, '1610')
  assert.equal(report.linked_installments, 1)
  assert.equal(report.standalone_installments_excluded, 1)
  assert.equal(report.verified_idempotent_replay, true)
  const sql = await readFile(output, 'utf8')
  const db = await createDb()
  t.after(() => db.close())
  atomic(db, sql)
  atomic(db, sql)
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 42').get().stock, 7)
  assert.equal(db.prepare('SELECT unit_price_minor FROM invoice_items WHERE invoice_id = 201').get().unit_price_minor, 990)
  assert.equal(db.prepare('SELECT legacy_invoice_number FROM invoices WHERE id = 201').get().legacy_invoice_number, 'INV-TEST-201')
  assert.equal(db.prepare('SELECT count(*) AS count FROM invoice_payments').get().count, 0)
  assert.throws(() => db.exec("UPDATE invoices SET legacy_invoice_number = 'forged' WHERE id = 201"), /IMMUTABLE_LEDGER/)
  assert.throws(() => db.exec("INSERT INTO invoice_payments VALUES (320,201,100,'payment',1,CURRENT_TIMESTAMP)"), /USE_INSTALLMENT_PAYMENT/)
  db.exec(`
    INSERT INTO installment_payments(id,installment_id,amount_minor,actor_id) VALUES (321,302,250,1);
    INSERT INTO invoice_refunds(id,invoice_id,total_minor,returned_minor,reason,actor_id)
      VALUES (322,201,1980,620,'Current refund fixture',1);
  `)
  assert.equal(db.prepare('SELECT historical_paid_minor FROM invoices WHERE id = 201').get().historical_paid_minor, 370)
  assert.equal(db.prepare('SELECT paid_minor FROM installments WHERE id = 302').get().paid_minor, 620)
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 42').get().stock, 9)
  assert.equal(db.prepare("SELECT count(*) AS count FROM inventory_movements WHERE source_type = 'refund'").get().count, 1)
  atomic(db, sql)
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 42').get().stock, 9)
  assert.equal(db.prepare("SELECT status FROM invoices WHERE id = 201").get().status, 'refunded')
  db.exec(`
    INSERT INTO business_operations (actor_id,request_key,operation,fingerprint) VALUES (1,'ordinary','checkout','new');
    INSERT INTO invoices (id,total_minor,paid_minor,actor_id) VALUES (999,500,500,1);
    INSERT INTO invoice_items VALUES (999,42,'Current name',1,500,0);
  `)
  assert.ok(db.prepare("SELECT id FROM business_operations WHERE request_key = 'ordinary'").get().id > 302)
  assert.equal(db.prepare('SELECT stock FROM products WHERE id = 42').get().stock, 8)
})

test('invoice import refuses stock drift, conflicting destination sales and unverifiable history', async (t) => {
  const folder = await temp(t)
  const output = join(folder, 'history.generated.sql')
  assert.equal(run(importer, fileURLToPath(fixture), ['--emit-sql', output]).status, 0)
  const sql = await readFile(output, 'utf8')
  const wrongStock = await createDb(6)
  t.after(() => wrongStock.close())
  assert.throws(() => atomic(wrongStock, sql), /NOT NULL constraint failed/)
  assert.equal(wrongStock.prepare('SELECT count(*) AS count FROM historical_invoice_imports').get().count, 0)
  const existing = await createDb()
  t.after(() => existing.close())
  existing.exec('INSERT INTO invoices (id,total_minor,paid_minor,actor_id) VALUES (999,100,100,1)')
  assert.throws(() => atomic(existing, sql), /NOT NULL constraint failed/)
  assert.equal(existing.prepare('SELECT count(*) AS count FROM invoices').get().count, 1)
  const input = JSON.parse(await readFile(fixture, 'utf8'))
  input.tables.invoices[0].status = 'refunded'
  const invalid = join(folder, 'refunded.json')
  await writeFile(invalid, JSON.stringify(input))
  const result = run(importer, invalid)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /historical refund needs independently dated evidence/)
})
