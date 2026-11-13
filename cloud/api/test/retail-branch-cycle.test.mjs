import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

test('branch sale, fractional restock, transfer, physical count and shift closure conserve stock', async t => {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: outputFiles[0].text,
    compatibilityDate: '2026-01-01', d1Databases: ['DB'] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const sql = source => db.batch(unstable_splitSqlQuery(source).map(statement => db.prepare(statement)));
  const migrations = new URL('../migrations/', import.meta.url);
  const names = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
  for (const name of names) {
    if (name.startsWith('0045_')) await sql("INSERT INTO products(id,name,stock,price_minor) VALUES(888,'Existing HQ opening',7,1000);");
    await sql(readFileSync(new URL(name, migrations), 'utf8'));
  }
  await sql(`INSERT INTO roles(id,name) VALUES(2,'Counter'),(3,'Sales only');
    INSERT INTO role_permissions(role_id,permission) VALUES(2,'inventory.stocktake.approve'),(2,'products.view'),(3,'invoices.create');
    INSERT INTO users(id,name,email,password_hash,role_id) VALUES
      (1,'Branch cashier','cashier@example.invalid','unused',1),(2,'Branch reviewer','reviewer@example.invalid','unused',2),
      (3,'Sales only','sales@example.invalid','unused',3);`);
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('base64url'));
  await db.batch(tokens.map((token, i) => db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), i + 1, Math.floor(Date.now() / 1000) + 180)));
  async function call(path, body, { status = body ? 201 : 200, user = 1, key = randomUUID(), code } = {}) {
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + tokens[user - 1],
        'Content-Type': 'application/json', 'Idempotency-Key': key }, body: body && JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, status, path + ' ' + JSON.stringify(payload));
    if (code) assert.equal(payload.code, code);
    return payload.data;
  }
  const secondary = await call('/retail/branches', { code: 'BR-TEST', name: 'Fixture second shop' });
  const branch = secondary.id;
  const stock = async (id, branchId) => (await call(`/retail/branches/${branchId}/stock?product_id=${id}`))[0].stock;
  assert.deepEqual([await stock(888, 1), await stock(888, branch)], [7, 0]);
  await call('/retail/branches', undefined, { user: 2, status: 403, code: 'forbidden' });
  const cable = await call('/products', { name: 'Fixture cable', barcode: 'TEST-CABLE', price_minor: 1599, measurement_unit: 'meter' });
  const adapter = await call('/products', { name: 'Fixture device', price_minor: 23000, tracking: 'serial' });
  const fixture = (product_id, quantity) => ({ product_id, quantity });
  const supplier = await call('/suppliers', { name: 'Fixture wholesaler' });
  const purchase = await call('/purchases', { supplier_id: supplier.id, description: 'Fixture branch stock', total_minor: 12000,
    purchase_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()),
    items: [{ ...fixture(cable.id, 12.5), unit_cost_minor: 800 }, { ...fixture(adapter.id, 1), unit_cost_minor: 2000 }] });
  const receipt = '/purchases/' + purchase.id + '/receipts';
  await call(receipt, { reference: 'BRANCH-RECEIPT', items: [fixture(cable.id, 12.5),
    { ...fixture(adapter.id, 1), devices: [{ serial_number: 'TEST-BRANCH-SERIAL' }] }] });
  assert.equal((await call('/retail/branches/1/stock?q=TEST-CABLE'))[0].id, cable.id);
  assert.equal((await call('/retail/branches/1/stock?product_id=' + cable.id + '&q=Fixture'))[0].id, cable.id);
  const [device] = await call('/retail/devices?q=TEST-BRANCH-SERIAL');
  const scan = (branchId, code, options = {}) => call('/retail/devices/pos-scan?' + new URLSearchParams({ branch_id: branchId, code }),
    undefined, { user: 3, ...options });
  assert.deepEqual(await scan(1, 'test-branch-serial'), { id: device.id, product_id: adapter.id });
  assert.equal(await scan(branch, 'TEST-BRANCH-SERIAL'), null);
  assert.equal(await scan(1, 'TEST-BRANCH'), null);
  await scan(1, 'TEST-BRANCH-SERIAL', { user: 2, status: 403, code: 'forbidden' });
  await call('/retail/devices?q=TEST-BRANCH-SERIAL', undefined, { user: 3, status: 403, code: 'forbidden' });
  const shift = await call('/retail/shifts', { branch_id: branch, register_name: 'Branch fixture register', opening_minor: 2000 });
  assert.equal(shift.branch_id, branch);
  const sale = (branch_id, items, paid_minor) => ({ branch_id, items, paid_minor, expected_total_minor: paid_minor,
    shift_id: shift.id, payments: [{ method: 'cash', amount_minor: paid_minor }] });
  await call('/retail/checkout', sale(branch, [fixture(cable.id, 1)], 1599), { status: 409, code: 'RETAIL_BRANCH_STOCK' });
  await call('/retail/checkout', sale(1, [fixture(cable.id, 1)], 1599), { status: 409, code: 'RETAIL_BRANCH_SHIFT' });
  const relocate = (product_id, quantity, device_ids = []) => ({ from_branch_id: 1, to_branch_id: branch, product_id, quantity,
    device_ids, reason: 'Fixture allocation' });
  const transfer = '/retail/branch-transfers';
  const key = randomUUID();
  const moved = await call(transfer, relocate(cable.id, 5.375), { key });
  assert.equal((await call(transfer, relocate(cable.id, 5.375), { key })).id, moved.id);
  await call(transfer, relocate(adapter.id, 1), { status: 409, code: 'RETAIL_BRANCH_DEVICE' });
  await call(transfer, relocate(adapter.id, 1, [device.id]));
  assert.equal(await stock(adapter.id, 1), 0);
  assert.equal((await call('/retail/devices/' + device.id)).branch_id, branch);
  assert.equal(await scan(1, 'TEST-BRANCH-SERIAL'), null);
  assert.deepEqual(await scan(branch, 'TEST-BRANCH-SERIAL'), { id: device.id, product_id: adapter.id });
  assert.deepEqual([await stock(cable.id, 1), await stock(cable.id, branch)], [7125, 5375]);
  const sales = [fixture(cable.id, 2.125), { ...fixture(adapter.id, 1), device_ids: [device.id] }];
  const checkoutKey = randomUUID();
  const basket = sale(branch, sales, 26398);
  const invoice = await call('/invoices', basket, { key: checkoutKey });
  assert.deepEqual(await call('/invoices', basket, { key: checkoutKey }), invoice);
  assert.equal(await scan(branch, 'TEST-BRANCH-SERIAL'), null);
  assert.equal(await stock(cable.id, branch), 3250);
  const returned = await call(`/invoices/${invoice.id}/returns`, { items: [{ ...fixture(cable.id, 0.625), disposition: 'resale' }],
    reason: 'Fixture unused cut', expected_returned_minor: 999, shift_id: shift.id, payments: [{ method: 'cash', amount_minor: 999 }] });
  assert.equal(returned.returned_minor, 999);
  assert.deepEqual([await stock(cable.id, 1), await stock(cable.id, branch)], [7125, 3875]);
  const count = { product_id: cable.id, branch_id: branch, observed_quantity: 3.75 };
  const stale = await call('/retail/stocktakes', count);
  await call(transfer, relocate(cable.id, 0.125));
  await call('/retail/stocktakes/' + stale.id + '/approve', { reason: 'Must refresh' }, { user: 2, status: 409, code: 'RETAIL_STOCKTAKE_STALE' });
  const confirmed = await call('/retail/stocktakes', { ...count, observed_quantity: 4.125 });
  assert.equal(confirmed.expected_quantity, 4000);
  await call('/retail/stocktakes/' + confirmed.id + '/approve', { reason: 'Independently measured' }, { user: 2 });
  assert.deepEqual([await stock(cable.id, 1), await stock(cable.id, branch), (await call('/products/' + cable.id)).stock], [7000, 4125, 11125]);
  const extraDevice = await call('/products', { name: 'Branch stocktake fixture', price_minor: 1500, tracking: 'serial' });
  const serialPosition = await call(`/retail/serial-stocktakes/positions/${extraDevice.id}?branch_id=${branch}`);
  const { stock: serialStock, movement_id, review_id, transfer_id } = serialPosition;
  const serialReview = await call('/retail/serial-stocktakes', {
    kind: 'opening', product_id: extraDevice.id, branch_id: branch,
    position: { stock: serialStock, movement_id, review_id, transfer_id }, source_reference: 'Fixture-serial-count',
    reason: 'Independent physical opening', additions: [{ serial_number: 'BRANCH-COUNT-1', unit_cost_minor: 500 }],
  });
  await db.prepare("INSERT INTO role_permissions(role_id,permission) VALUES (2,'inventory.manage'),(2,'products.cost.manage')").run();
  await call('/retail/serial-stocktakes/' + serialReview.id + '/approve', { reason: 'Serial verified independently' }, { user: 2 });
  assert.deepEqual([await stock(extraDevice.id, 1), await stock(extraDevice.id, branch)], [0, 1]);
  const closed = await call('/retail/shifts/' + shift.id + '/close', { observed_minor: 27399, expected_minor: 27399 });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.difference_minor, 0);
  const mismatch = await db.prepare(`SELECT COUNT(*) AS value FROM products p WHERE p.stock <>
    COALESCE((SELECT SUM(s.stock) FROM retail_branch_stock s WHERE s.product_id=p.id),0)`).first('value');
  assert.equal(mismatch, 0);
});
