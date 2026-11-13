import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

test('used purchase safeguards and assigned installation carry through to stock, drawer and warranty', async t => {
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
    INSERT INTO roles(id, name) VALUES (2, 'Fixture technician'), (3, 'Fixture inventory reader');
    INSERT INTO role_permissions(role_id, permission) VALUES
      (2, 'retail.installations.view'), (2, 'retail.installations.perform'), (3, 'inventory.view');
    INSERT INTO users(id, name, email, password_hash, role_id) VALUES
      (1, 'Fixture admin', 'used-admin@example.invalid', 'unused', 1),
      (2, 'Fixture technician', 'used-tech@example.invalid', 'unused', 2),
      (3, 'Fixture viewer', 'used-viewer@example.invalid', 'unused', 3);
  `);
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('base64url'));
  await db.batch(tokens.map((token, index) => db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), index + 1, Math.floor(Date.now() / 1000) + 300)));

  async function call(path, input, { status = input ? 201 : 200, user = 1, key = randomUUID(), code } = {}) {
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method: input ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + tokens[user - 1], 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: input ? JSON.stringify(input) : undefined,
    });
    const payload = response.headers.get('content-type')?.includes('text/csv') ? await response.text() : await response.json();
    assert.equal(response.status, status, path + ' ' + JSON.stringify(payload));
    if (code) assert.equal(payload.code, code);
    return typeof payload === 'string' ? payload : payload.data;
  }

  const usedPhones = '/retail/used-phones';
  const installations = '/retail/installations';
  const stock = async id => (await call('/products/' + id)).stock;
  const shift = await call('/retail/shifts', { register_name: 'Used phone drawer', opening_minor: 20_000 });
  const product = await call('/products', { name: 'Used fixture phone', tracking: 'imei', price_minor: 10_000,
    warranty_months: 3, warranty_basis: 'installation', warranty_guarantor: 'Fixture store' });
  const found = await call(usedPhones + '/products?q=Used');
  assert.equal(found[0].id, product.id);
  const inspection = {
    product_id: product.id, device: { imei1: '490154203237518', serial_number: 'USED-FIXTURE-ONE' },
    ownership_reference: 'FIXTURE-OWNERSHIP-A', grade: 'good', battery_percent: 89, accessories: 'USB cable',
    defects: 'One cosmetic scratch', functional: true, reset_verified: true, lock_cleared: true,
  };
  const payment = { acquisition_cost_minor: 6000, shift_id: shift.id, payment_method: 'cash' };
  const failed = await call(usedPhones, { ...inspection, lock_cleared: false });
  await call(usedPhones + '/' + failed.id + '/acquire', payment, { status: 409, code: 'RETAIL_USED_PHONE_INSPECTION' });
  assert.equal(await stock(product.id), 0);
  const passed = await call(usedPhones, inspection);
  await call(usedPhones + '/' + passed.id + '/acquire', payment, { status: 403, user: 3 });
  assert.equal((await call('/retail/shifts/' + shift.id)).expected_minor, 20_000);
  const oversized = { ...payment, acquisition_cost_minor: 21_000 };
  await call(usedPhones + '/' + passed.id + '/acquire', oversized, { status: 409, code: 'RETAIL_CASH_MOVEMENT_BALANCE' });
  assert.equal(await stock(product.id), 0);

  const key = randomUUID();
  const acquire = await call(usedPhones + '/' + passed.id + '/acquire', payment, { key });
  assert.deepEqual(await call(usedPhones + '/' + passed.id + '/acquire', payment, { key }), acquire);
  assert.equal((await call('/retail/shifts/' + shift.id)).expected_minor, 14_000);
  assert.equal(await stock(product.id), 1);
  const readRows = await call(usedPhones, undefined, { user: 3 });
  assert.equal(readRows[0].device_status, 'available');
  assert.equal('acquisition_cost_minor' in readRows[0], false);
  assert.equal('ownership_reference' in readRows[0], false);

  const additional = await call(usedPhones, { ...inspection, device: { imei1: '356938035643809', serial_number: 'USED-FIXTURE-TWO' },
    ownership_reference: 'FIXTURE-OWNERSHIP-B' });
  const bankPayment = { acquisition_cost_minor: 5000, payment_method: 'bank_transfer', payment_reference: 'FIXTURE-USED-TRANSFER' };
  const second = await call(usedPhones + '/' + additional.id + '/acquire', bankPayment);
  assert.equal(await stock(product.id), 2);
  assert.equal((await call('/retail/shifts/' + shift.id)).expected_minor, 14_000);
  const picked = (await call('/retail/devices?status=available&product_id=' + product.id)).find(row => row.id === acquire.device_id);
  assert.deepEqual([picked.used_grade, picked.used_battery_percent, picked.used_defects], ['good', 89, 'One cosmetic scratch']);
  assert.equal('intake_cost_minor' in picked, false);
  const duplicate = await call(usedPhones, { ...inspection, ownership_reference: 'FIXTURE-OWNERSHIP-DUPLICATE' });
  await call(usedPhones + '/' + duplicate.id + '/acquire', payment, { status: 409, code: 'RETAIL_DEVICE_IDENTITY_DUPLICATE' });

  const sell = async device => call('/retail/checkout', {
    items: [{ product_id: product.id, quantity: 1, device_ids: [device.device_id] }], paid_minor: 10_000,
    expected_total_minor: 10_000, shift_id: shift.id, payments: [{ method: 'cash', amount_minor: 10_000 }],
  });
  const invoice = await sell(acquire);
  const secondInvoice = await sell(second);
  const devicePath = '/retail/devices/' + acquire.device_id;
  const current = (await call(devicePath)).sales[0];
  assert.equal(current.unit_cost_minor, 6000);
  assert.equal(current.warranty_status, 'pending');
  assert.equal((await call(installations + '/sales?q=' + invoice.id))[0].id, acquire.device_id);
  assert.deepEqual((await call(installations + '/technicians')).map(row => row.id), [1, 2]);

  const date = shift.business_day;
  const schedule = { invoice_id: invoice.id, device_id: acquire.device_id, service_address: 'Fixture address only',
    scheduled_on: date, scheduled_time: '10:00', assignee_id: 2 };
  await call(installations, { ...schedule, assignee_id: 3 }, { status: 409, code: 'RETAIL_INSTALLATION_ASSIGNEE' });
  const job = await call(installations, schedule);
  const jobPath = installations + '/' + job.id;
  assert.equal(job.status, 'assigned');
  assert.equal((await call(jobPath, undefined, { user: 2 })).id, job.id);
  await call(jobPath, undefined, { user: 3, status: 403 });
  assert.deepEqual((await call(installations + '?due=today', undefined, { user: 2 })).map(row => row.id), [job.id]);
  assert.deepEqual((await call(installations + '?due=overdue')).map(row => row.id), []);
  await call(installations + '?due=today', undefined, { user: 3, status: 403 });
  const otherJob = { ...schedule, invoice_id: secondInvoice.id, device_id: second.device_id };
  await call(installations, otherJob, { status: 409, code: 'RETAIL_INSTALLATION_CONFLICT' });
  const another = await call(installations, { ...otherJob, scheduled_time: '11:00' });
  await call(installations + '/' + another.id + '/cancel', { note: 'Fixture appointment canceled' });

  const complete = { occurred_on: date, proof_reference: 'FIXTURE-INSTALL-PROOF' };
  await call(jobPath + '/complete', complete, { user: 2, status: 409, code: 'RETAIL_INSTALLATION_DELIVERY' });
  await call(jobPath + '/complete', complete, { status: 409, code: 'RETAIL_INSTALLATION_STATE' });
  await call(devicePath + '/events', { kind: 'installed', ...complete }, { status: 409, code: 'RETAIL_INSTALLATION_USE_JOB' });
  const rescheduled = await call(jobPath + '/reschedule', { scheduled_on: date, scheduled_time: '12:30', assignee_id: 2 });
  assert.equal(rescheduled.scheduled_time, '12:30');
  const delivered = await call(jobPath + '/deliver', { ...complete, proof_reference: 'FIXTURE-DELIVERY' }, { user: 2 });
  assert.equal(delivered.delivered_on, date);
  await call(jobPath + '/deliver', { ...complete, proof_reference: 'FIXTURE-DELIVERY-REPEAT' }, {
    user: 2, status: 409, code: 'RETAIL_INSTALLATION_DELIVERY_EXISTS',
  });
  const completed = await call(jobPath + '/complete', complete, { user: 2 });
  assert.deepEqual([completed.status, completed.proof_reference, completed.history.length], ['completed', complete.proof_reference, 2]);
  assert.deepEqual((await call(installations + '?due=today')).map(row => row.id), []);
  const warranty = (await call(devicePath)).sales[0];
  assert.deepEqual([warranty.warranty_status, warranty.warranty_starts_on, warranty.warranty_proof_reference], ['active', date, complete.proof_reference]);
  assert.equal(await stock(product.id), 0);
  assert.equal((await call('/retail/shifts/' + shift.id)).expected_minor, 34_000);
  const csv = await call('/retail/accountant.csv?from=' + date + '&to=' + date);
  assert.ok(csv.includes(`"inventory_acquisition",${acquire.id},"used_phone_purchase","cash",-60.00`));
  assert.ok(csv.includes(`"inventory_acquisition",${second.id},"used_phone_purchase","bank_transfer",-50.00`));
  assert.ok(!csv.includes(`"manual_drawer",${acquire.id},`));
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});
