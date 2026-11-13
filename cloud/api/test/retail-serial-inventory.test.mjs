import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

test('serialized opening and stocktake approvals preserve prior receipts and apply audited differences', async t => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-01-01', d1Databases: ['DB'] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const execute = sql => db.batch(unstable_splitSqlQuery(sql).map(command => db.prepare(command)));
  const migrations = new URL('../migrations/', import.meta.url);
  const names = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
  const migrate = name => execute(readFileSync(new URL(name, migrations), 'utf8'));
  for (const name of names.filter(name => name < '0038')) await migrate(name);
  await execute(`
    INSERT INTO roles(id,name) VALUES (2,'Manager'),(3,'Stock counter');
    INSERT INTO role_permissions(role_id,permission) VALUES
      (2,'inventory.stocktake.count'),(2,'inventory.stocktake.approve'),(2,'products.cost.manage'),(2,'inventory.manage'),(2,'inventory.view'),
      (3,'inventory.stocktake.count'),(3,'inventory.view');
    INSERT INTO users(id,name,email,password_hash,role_id) VALUES
      (1,'Owner','owner@example.invalid','unused',1),(2,'Manager','manager@example.invalid','unused',2),
      (3,'Counter','counter@example.invalid','unused',3);
    INSERT INTO products(id,name,price_minor,stock,tracking,inventory_value_minor) VALUES
      (1,'Old electric unit',8000,3,'quantity',6000),(2,'Serialized electric unit',8000,0,'serial',NULL),
      (3,'Original receipt product',4000,0,'serial',NULL),(4,'Opening from physical count',3000,0,'serial',NULL);
    INSERT INTO categories(id,name) VALUES (1,'Electrical');
    UPDATE products SET category_id = 1 WHERE id IN (1,2);
    INSERT INTO products(id,name,price_minor,stock) VALUES (5,'Missing cost accessory',3000,4);
    INSERT INTO suppliers(id,name) VALUES (1,'Fixture vendor');
    INSERT INTO purchases(id,supplier_id,description,total_minor,purchase_date,actor_id) VALUES (1,1,'Earlier receipt',3000,'2026-01-01',1);
    INSERT INTO purchase_stock_receipts(id,purchase_id,reference,received_on,actor_id) VALUES (900,1,'HISTORICAL','2026-01-01',1);
    INSERT INTO purchase_stock_receipt_items(receipt_id,product_id,product_name,quantity,devices_json)
      VALUES (900,3,'Original receipt product',1,'[{"serial_number":"LEGACY-1"}]');
    INSERT INTO invoices(id,total_minor,paid_minor,actor_id,invoice_date) VALUES (901,4000,4000,1,'2026-01-02');
    INSERT INTO invoice_items(invoice_id,product_id,product_name,quantity,unit_price_minor,unit_cost_minor,device_ids_json)
      VALUES(901,3,'Original receipt product',1,4000,3000,'[1]');
  `);
  for (const name of names.filter(name => name >= '0038')) await migrate(name);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  assert.deepEqual(await db.prepare('SELECT device_id, invoice_id FROM retail_device_sales').first(), { device_id: 1, invoice_id: 901 });
  assert.deepEqual(await db.prepare('SELECT receipt_id, status FROM retail_devices WHERE id = 1').first(), { receipt_id: 900, status: 'sold' });

  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('base64url'));
  await db.batch(tokens.map((token, i) => db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), i + 1, Math.floor(Date.now() / 1000) + 300)));
  async function call(path, input, user = 1, key = randomUUID()) {
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + tokens[user - 1], 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: input ? JSON.stringify(input) : undefined,
    });
    return { status: response.status, json: await response.json() };
  }
  function check({ status, json }, expected, code) {
    assert.equal(status, expected, JSON.stringify(json));
    if (code) assert.equal(json.code, code);
    return json.data;
  }
  const route = '/retail/serial-stocktakes';
  async function position(id) {
    const { stock, movement_id, review_id } = check(await call(`${route}/positions/${id}`), 200);
    return { stock, movement_id, review_id };
  }
  const device = (serial_number, unit_cost_minor = 2000) => ({ serial_number, unit_cost_minor });
  const opening = { kind: 'opening', product_id: 2, position: await position(2), source_reference: 'Certified opening balance',
    reason: 'Legacy SKU reclassification', source: { product_id: 1, position: await position(1) },
    additions: [device('CUTOVER-1'), device('CUTOVER-2')] };
  check(await call(route, opening, 3), 403);
  const proposal = check(await call(route, opening), 201);
  check(await call(`${route}/${proposal.id}/approve`, { reason: 'Self approval' }), 409, 'RETAIL_STOCKTAKE_SEPARATION');
  const approvalKey = randomUUID();
  for (let i = 0; i < 2; i++) {
    const approved = check(await call(`${route}/${proposal.id}/approve`, { reason: 'Opening balance approved' }, 2, approvalKey), 201);
    assert.equal(approved.status, 'approved');
  }
  assert.deepEqual((await db.prepare('SELECT id, stock, inventory_value_minor FROM products WHERE id IN (1,2) ORDER BY id').all()).results,
    [{ id: 1, stock: 1, inventory_value_minor: 2000 }, { id: 2, stock: 2, inventory_value_minor: null }]);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM purchases').first('n'), 1);
  const opened = check(await call('/retail/devices?product_id=2&status=available'), 200);
  assert.equal(opened.length, 2);
  const first = opened.find(row => row.serial_number === 'CUTOVER-1');
  const second = opened.find(row => row.serial_number === 'CUTOVER-2');
  assert.ok(!Object.hasOwn(first, 'intake_cost_minor'));
  const noCost = check(await call('/retail/devices/' + first.id, undefined, 3), 200);
  assert.equal(noCost.receipt_id, null);
  assert.equal(noCost.intake_source_reference, 'Certified opening balance');
  assert.ok(!Object.hasOwn(noCost, 'intake_cost_minor'));
  assert.equal(check(await call('/retail/devices/' + first.id), 200).intake_cost_minor, 2000);

  const count = { kind: 'count', product_id: 2, position: await position(2), source_reference: 'Physical count',
    reason: 'Verify shelf', scanned: ['CUTOVER-1'] };
  check(await call(route, { ...count, scanned: ['CUTOVER-1','cutover-1'] }, 3), 409, 'RETAIL_SERIAL_SCAN_INVALID');
  check(await call(route, { ...count, scanned: ['UNKNOWN'] }, 3), 409, 'RETAIL_SERIAL_SCAN_INVALID');
  const counted = check(await call(route, count, 3), 201);
  assert.deepEqual(counted.observations.map(({ disposition, serial_number }) => [disposition, serial_number]), [
    ['missing', 'CUTOVER-2'], ['present', 'CUTOVER-1'],
  ]);
  const stale = check(await call(route, count, 3), 201);
  check(await call(`${route}/${counted.id}/approve`, { reason: 'Supervisor verified missing' }, 2), 201);
  check(await call(`${route}/${stale.id}/approve`, { reason: 'Stale old count' }, 2), 409, 'RETAIL_SERIAL_STALE');
  assert.equal((await position(2)).stock, 1);
  const firstValuation = check(await call('/reports/inventory-valuation?category_id=1'), 200);
  assert.equal(firstValuation.totals.missing_devices, 1);
  assert.equal(firstValuation.totals.quantity_value, '2000');
  assert.equal(firstValuation.totals.available_device_value, '2000');
  assert.equal(await db.prepare('SELECT status FROM retail_devices WHERE id = ?').bind(second.id).first('status'), 'stocktake_missing');
  check(await call('/retail/checkout', { items: [{ product_id: 2, quantity: 1, device_ids: [second.id] }], paid_minor: 8000 }), 409, 'RETAIL_DEVICE_UNAVAILABLE');
  const recovered = check(await call(route, { ...count, position: await position(2), scanned: ['CUTOVER-1','CUTOVER-2'] }, 3), 201);
  check(await call(`${route}/${recovered.id}/approve`, { reason: 'Found missing unit' }, 2), 201);
  assert.equal((await position(2)).stock, 2);
  const invoice = check(await call('/retail/checkout', { items: [{ product_id: 2, quantity: 1, device_ids: [second.id] }], paid_minor: 8000 }), 201);
  assert.equal(await db.prepare('SELECT unit_cost_minor FROM retail_device_sales WHERE invoice_id = ? AND device_id = ?').bind(invoice.id, second.id).first('unit_cost_minor'), 2000);

  const openingOnly = check(await call(route, { kind: 'opening', product_id: 4, position: await position(4), source_reference: 'Signed physical count',
    reason: 'Opening inventory without legacy purchase receipt', additions: [device('PHYSICAL-1')] }), 201);
  check(await call(`${route}/${openingOnly.id}/approve`, { reason: 'Approved supporting document' }, 2), 201);
  assert.equal((await position(4)).stock, 1);
  const returned = check(await call('/invoices/' + invoice.id + '/returns', {
    reason: 'Inspect returned unit', items: [{ product_id: 2, quantity: 1, device_ids: [second.id], disposition: 'quarantine' }],
  }), 201);
  assert.ok(returned.id);
  const valuation = check(await call('/reports/inventory-valuation'), 200);
  assert.equal(valuation.totals.quantity_units, 5);
  assert.equal(valuation.totals.unvalued_quantity_units, 4);
  assert.equal(valuation.totals.quantity_value, '2000');
  assert.equal(valuation.totals.available_device_value, '4000');
  assert.equal(valuation.totals.held_devices, 1);
  assert.equal(valuation.totals.held_device_value, '2000');
  assert.equal(valuation.totals.missing_devices, 0);
  check(await call('/reports/inventory-valuation', undefined, 3), 403);
  assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM purchases').first('n'), 1);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});
