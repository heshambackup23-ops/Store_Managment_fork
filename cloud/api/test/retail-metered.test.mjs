import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

test('metered stock reconciles fractional receipts, sale, and cumulative refund cents', async t => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-01-01', d1Databases: ['DB'] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const execute = sql => db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    await execute(readFileSync(new URL(name, migrations), 'utf8'));
  }
  await execute(`
    INSERT INTO users(id, name, email, password_hash, role_id) VALUES
      (1, 'Fixture operator', 'meter-operator@example.invalid', 'unused', 1);
  `);
  const token = randomBytes(32).toString('base64url');
  await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), 1, Math.floor(Date.now() / 1000) + 300).run();

  async function call(path, input, { status = input ? 201 : 200, method = input ? 'POST' : 'GET', key = randomUUID(), code } = {}) {
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: input ? JSON.stringify(input) : undefined,
    });
    const payload = await response.json();
    assert.equal(response.status, status, path + ' ' + JSON.stringify(payload));
    if (code) assert.equal(payload.code, code);
    return payload.data;
  }


  const cable = await call('/products', {
    name: 'Fractional cable', measurement_unit: 'meter', barcode: 'TEST-CABLE-METER', price_minor: 101, low_stock_threshold: 1.5,
  });
  assert.equal(cable.quantity_scale, 1000);
  assert.equal(cable.low_stock_threshold, 1500);
  await call('/products/' + cable.id, { measurement_unit: 'piece' }, { method: 'PATCH', status: 409, code: 'RETAIL_METER_PRODUCT' });
  const piece = await call('/products', { name: 'Accessory by piece', price_minor: 200 });
  await call('/inventory/adjustments', { product_id: piece.id, delta: 1.5, note: 'Reject split piece' }, { status: 422, code: 'RETAIL_MEASUREMENT' });
  await call('/inventory/adjustments', { product_id: cable.id, delta: 0.0001, note: 'Reject submillimeter' }, { status: 422, code: 'RETAIL_MEASUREMENT' });

  const cash = amount_minor => ({ method: 'cash', amount_minor });
  const shift = await call('/retail/shifts', { register_name: 'Meter fixture', opening_minor: 1000 });
  const supplier = await call('/suppliers', { name: 'Meter fixture supplier' });
  const line = { product_id: cable.id };
  const purchase = await call('/purchases', { supplier_id: supplier.id, description: 'Meter fixture purchase',
    purchase_date: shift.business_day, total_minor: 178, items: [{ ...line, quantity: 2.5, unit_cost_minor: 71, landed_unit_minor: 1 }] });
  const receiptPath = '/purchases/' + purchase.id + '/receipts';
  const receive = (reference, quantity) => call(receiptPath, { reference, items: [{ ...line, quantity }] });
  await receive('CUT-A', 0.75);
  await receive('CUT-B', 1.75);
  assert.equal((await call('/products/' + cable.id)).stock, 2500);
  const costPath = '/retail/quantity-costs/' + cable.id;
  assert.equal((await call(costPath)).inventory_value_minor, 181);
  assert.equal((await call(receiptPath))[0].items[0].quantity_scale, 1000);

  assert.deepEqual(await call('/cashier/products?q=TEST-CABLE-METER'), []);
  assert.equal((await call('/cashier/products?q=TEST-CABLE-METER&measurement=1'))[0].id, cable.id);
  const sold = await call('/retail/checkout', { items: [{ ...line, quantity: 1.5 }], paid_minor: 152, expected_total_minor: 152,
    shift_id: shift.id, payments: [cash(152)] });
  const invoicePath = '/invoices/' + sold.id;
  const invoice = await call(invoicePath);
  assert.equal(invoice.items[0].quantity, 1500);
  assert.equal(invoice.items[0].line_total_minor, 152);
  assert.equal(invoice.items[0].line_gross_minor, 152);
  assert.equal((await call(costPath)).stock, 1000);

  const returnPath = invoicePath + '/returns';
  const refund = (quantity, amount) => call(returnPath, {
    reason: 'Fractional return', expected_returned_minor: amount,
    items: [{ ...line, quantity, disposition: 'resale' }], shift_id: shift.id, payments: [cash(amount)],
  });
  assert.equal((await refund(0.5, 51)).returned_minor, 51);
  assert.equal((await refund(0.5, 50)).returned_minor, 50);
  const margin = (await call('/reports/retail-margin?from=' + shift.business_day + '&to=' + shift.business_day)).items[0];
  assert.equal(margin.net_length_mm, 500);
  assert.equal(margin.net_sales_minor, 51);
  assert.equal(margin.verified_sales_minor, 51);
  assert.equal((await refund(0.5, 51)).returned_minor, 51);
  assert.equal((await call(invoicePath)).status, 'refunded');
  assert.equal((await call(costPath)).stock, 2500);
  assert.equal((await call(costPath)).inventory_value_minor, 181);

  const supplierReturnPath = '/purchases/' + purchase.id + '/returns';
  for (let i = 0; i < 2; i++) await call(supplierReturnPath, { reason: 'Supplier cut returned', items: [{ ...line, quantity: 0.5 }] });
  const supplierReturns = await call(supplierReturnPath);
  assert.deepEqual(supplierReturns.map(row => row.credit_minor), [35, 36]);
  assert.equal((await call('/products/' + cable.id)).stock, 1500);
  const inventory = await call('/reports/inventory-valuation');
  assert.equal(inventory.totals.length_mm, 1500);
  assert.equal(inventory.totals.quantity_units, 0);

  const damage = await call('/damaged', { ...line, quantity: 0.125, unit_value_minor: 71, reason: 'Frayed cable end' });
  const damaged = await call('/damaged/' + damage.id);
  assert.equal(damaged.quantity, 125);
  assert.equal(damaged.total_value_minor, 9);
  assert.equal(damaged.quantity_scale, 1000);
  assert.equal(damaged.branch_id, 1);
  await call('/damaged/' + damage.id + '/correct', { quantity: 0.100, reason: 'Rechecked damaged length' });
  assert.equal((await call('/products/' + cable.id)).stock, 1400);
  const damageReport = await call('/reports/damaged?from=' + shift.business_day + '&to=' + shift.business_day);
  assert.equal(damageReport.length_mm, 100);
  assert.equal(damageReport.units, 0);
  await call('/damaged/' + damage.id + '/reverse', { reason: 'Reinspection confirmed usable' });
  assert.equal((await call('/products/' + cable.id)).stock, 1500);
});
