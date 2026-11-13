import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

test('Hilal one-shop operating day reconciles stock, supplier, drawer, wallet and bank', async t => {
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
    INSERT INTO roles(id, name) VALUES (2, 'Independent operator');
    INSERT INTO role_permissions(role_id, permission) VALUES
      (2, 'inventory.view'), (2, 'suppliers.manage'), (2, 'retail.devices.disposition.approve'), (2, 'retail.shifts.approve');
    INSERT INTO users(id, name, email, password_hash, role_id) VALUES
      (1, 'Fixture cashier', 'day-cashier@example.invalid', 'unused', 1),
      (2, 'Fixture supervisor', 'day-supervisor@example.invalid', 'unused', 2);
  `);
  const tokens = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
  await db.batch(tokens.map((token, index) => db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), index + 1, Math.floor(Date.now() / 1000) + 300)));

  async function call(path, input, { status = input ? 201 : 200, user = 1, method = input ? 'POST' : 'GET', key = randomUUID(), code } = {}) {
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method, headers: { Authorization: 'Bearer ' + tokens[user - 1], 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: input ? JSON.stringify(input) : undefined,
    });
    const payload = response.headers.get('content-type')?.includes('text/csv') ? await response.text() : await response.json();
    assert.equal(response.status, status, path + ' ' + JSON.stringify(payload));
    if (code) assert.equal(payload.code, code);
    return typeof payload === 'string' ? payload : payload.data;
  }

  const cash = amount_minor => ({ method: 'cash', amount_minor });
  const card = (amount_minor, reference) => ({ method: 'card', amount_minor, reference });
  const shift = await call('/retail/shifts', { register_name: 'Fixture front desk', opening_minor: 50_000 });
  const shiftPath = `/retail/shifts/${shift.id}`;
  const day = shift.business_day;
  await call('/retail/settings', { require_shift: true }, { method: 'PATCH', status: 200 });
  await call('/retail/safe/open', { opening_minor: 50_000, reason: 'Fixture opening safe count' });

  const supplier = await call('/suppliers', { name: 'Fixture mobile and electrical supplier' });
  const phone = await call('/products', { name: 'Fixture phone', tracking: 'imei', warranty_months: 12, price_minor: 100_000 });
  const accessory = await call('/products', { name: 'Fixture phone case', compatible_models: 'Fixture Model A',
    units_per_pack: 4, pack_barcode: 'DAY-FIXTURE-CASE-PACK', price_minor: 10_000 });
  assert.equal((await call('/products?q=Model%20A'))[0].id, accessory.id);
  const phoneLine = { product_id: phone.id, quantity: 1 };
  const caseLine = { product_id: accessory.id, quantity: 1 };
  const purchase = await call('/purchases', { supplier_id: supplier.id, description: 'Fixture priced delivery', total_minor: 80_000,
    purchase_date: day, due_date: day, items: [{ ...phoneLine, unit_cost_minor: 60_000 }, { ...caseLine, quantity: 4, unit_cost_minor: 5_000 }] });
  const purchasePath = '/purchases/' + purchase.id;
  const deviceCode = { serial_number: 'DAY-FIXTURE-IMEI', imei1: '490154203237518' };
  assert.deepEqual((await call(purchasePath + '/receipts/validate-devices', { devices: [deviceCode] }, { status: 200 })).duplicate_positions, []);
  await call(purchasePath + '/receipts', { reference: 'DAY-DELIVERY', items: [{ ...phoneLine, devices: [deviceCode] }, { ...caseLine, quantity: 4 }] });
  const [device] = await call('/retail/devices?q=' + deviceCode.imei1);
  assert.equal(device.status, 'available');
  assert.deepEqual((await call(purchasePath + '/receipts/validate-devices', { devices: [deviceCode] }, { status: 200 })).duplicate_positions, [0]);

  const sellPhone = { ...phoneLine, device_ids: [device.id] };
  const sale = { items: [sellPhone, caseLine], paid_minor: 110_000, expected_total_minor: 110_000,
    shift_id: shift.id, payments: [cash(70_000), card(40_000, 'DAY-CARD-SALE')] };
  const key = randomUUID();
  const invoice = await call('/retail/checkout', sale, { key });
  assert.equal((await call('/retail/checkout', sale, { key })).id, invoice.id);
  assert.deepEqual([(await call('/retail/devices/' + device.id)).status, (await call('/products/' + accessory.id)).stock], ['sold', 3]);
  const returned = await call(`/invoices/${invoice.id}/returns`, { items: [{ ...sellPhone, disposition: 'quarantine' }],
    reason: 'Fixture failed inspection', expected_returned_minor: 100_000, shift_id: shift.id,
    payments: [cash(70_000), card(30_000, 'DAY-CARD-RETURN')] });
  assert.equal(returned.returned_minor, 100_000);
  assert.equal((await call('/retail/devices/' + device.id)).status, 'quarantined');
  assert.equal((await call('/invoices/' + invoice.id)).total_minor, 10_000);

  await call(purchasePath + '/payments', { amount_minor: 20_000, shift_id: shift.id, payments: [cash(20_000)] });
  const disposition = await call(`/retail/devices/${device.id}/dispositions`, { disposition: 'supplier', reason: 'Fixture supplier accepted return',
    supplier_reference: 'DAY-CREDIT', return_id: returned.id });
  const reviewPath = `/retail/devices/${device.id}/dispositions/${disposition.id}/review`;
  const review = { decision: 'approve', reason: 'Independently checked the vendor credit' };
  await call(reviewPath, review, { status: 403, code: 'RETAIL_DISPOSITION_SEPARATION' });
  await call(reviewPath, review, { user: 2 });
  const supplierPosition = await call(purchasePath);
  assert.equal(supplierPosition.supplier_credit_minor, 60_000);
  assert.equal(supplierPosition.net_total_minor - supplierPosition.paid_minor, 0);
  assert.equal((await call('/retail/devices/' + device.id)).status, 'returned_to_supplier');
  assert.equal((await call('/products/' + phone.id)).stock, 0);

  const wallet = await call('/wallets', { name: 'Fixture Vodafone Cash', provider: 'vodafone_cash', opening_minor: 50_000 });
  await call(`/wallets/${wallet.id}/transactions`, { kind: 'receive', amount_minor: 2_000, fee_minor: 0, commission_minor: 0,
    shared_shift_id: shift.id, provider_reference: 'DAY-WALLET' });
  const [walletPosition] = await call('/wallets');
  assert.equal(walletPosition.balance_minor, 52_000);
  await call(shiftPath + '/cash-movements', { kind: 'safe_deposit', amount_minor: 5_000, reason: 'Fixture deposit to safe' });
  const count = await call('/retail/safe/count', { observed_minor: 55_000, expected_minor: 55_000 });
  assert.equal(count.difference_minor, 0);
  const drawer = await call(shiftPath);
  assert.equal(drawer.expected_minor, 23_000);
  assert.deepEqual(drawer.totals.slice(0, 2).map(row => [row.method, row.received_minor, row.paid_out_minor]),
    [['cash', 70_000, 90_000], ['card', 40_000, 30_000]]);

  const settlementsPath = '/reports/tender-settlements';
  const pending = await call(`${settlementsPath}?method=card&status=pending&shift_id=${shift.id}&from=${day}&to=${day}`);
  assert.equal(pending.items.length, 2);
  const items = pending.items.map(({ operation_id, source, position }) => ({ operation_id, source, position }));
  const settlement = await call(settlementsPath + '/batches', { items, method: 'card', fee_minor: 300, observed_minor: 9700,
    statement_date: day, statement_reference: 'DAY-BANK-PAYOUT' });
  const matched = await call(`${settlementsPath}?method=card&status=matched&shift_id=${shift.id}&from=${day}&to=${day}`);
  assert.ok(matched.items.length === 2 && matched.items.every(row => row.settlement_id === settlement.id));
  const closed = await call(shiftPath + '/close', { observed_minor: 23_000, expected_minor: 23_000 });
  assert.deepEqual([closed.status, closed.difference_minor], ['closed', 0]);

  const valuation = await call('/reports/inventory-valuation');
  assert.equal(valuation.totals.quantity_units, 3);
  assert.equal(valuation.totals.quantity_value, '15000');
  assert.equal(valuation.totals.held_devices, 0);
  const csv = await call(`/retail/accountant.csv?from=${day}&to=${day}`);
  assert.match(csv, /supplier_credit[^\n]*-600\.00/);
  assert.match(csv, /settlement_fee[^\n]*-3\.00/);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});
