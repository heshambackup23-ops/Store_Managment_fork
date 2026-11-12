import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

async function worker(t) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
  });
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-01-01',
    d1Databases: { DB: 'business-test-d1' },
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const migrations = new URL('../migrations/', import.meta.url);
  for (const filename of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    const commands = unstable_splitSqlQuery(readFileSync(new URL(filename, migrations), 'utf8'));
    await db.batch(commands.map(command => db.prepare(command)));
  }
  await db.batch([
    db.prepare("INSERT INTO roles(id, name) VALUES (2, 'reader')"),
    db.prepare("INSERT INTO role_permissions(role_id, permission) VALUES (2, 'inventory.view')"),
    db.prepare(`INSERT INTO users(id, name, email, password_hash, role_id) VALUES
      (1, 'Demo admin', 'admin@example.invalid', 'unused', 1),
      (2, 'Demo reader', 'reader@example.invalid', 'unused', 2)`),
    db.prepare("INSERT INTO products(id, name, price_minor, cost_minor, barcode) VALUES (1, 'منتج تجريبي', 2500, 1250, 'DEMO-100')"),
    db.prepare("INSERT INTO customers(id, name) VALUES (1, 'عميل تجريبي')"),
  ]);
  const tokens = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
  await db.batch(tokens.map((token, index) =>
    db.prepare('INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(createHash('sha256').update(token).digest('base64url'), index + 1, Math.floor(Date.now() / 1000) + 300)
  ));

  return async (path, { method = 'GET', body, key = randomUUID(), identity = 0 } = {}) => {
    const headers = {};
    if (tokens[identity]) headers.Authorization = 'Bearer ' + tokens[identity];
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Idempotency-Key'] = key;
    }
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, json: await response.json() };
  };
}

function assertStatus(result, expected) {
  assert.equal(result.status, expected, JSON.stringify(result.json));
  return result.json.data;
}

test('Worker and local D1 enforce financial rules through the mounted API', async t => {
  const request = await worker(t);
  const post = (path, body, options = {}) => request(path, { method: 'POST', body, ...options });
  assertStatus(await request('/invoices', { identity: 2 }), 401);
  assertStatus(await post('/inventory/adjustments', { product_id: 1, delta: 1, note: 'demo' }, { identity: 1 }), 403);

  let invoiceId;
  await t.test('competing sale, safe replay, competing payment and one refund', async () => {
    const stockKey = randomUUID();
    const adjustment = { product_id: 1, delta: 1, note: 'demo' };
    const first = assertStatus(await post('/inventory/adjustments', adjustment, { key: stockKey }), 201);
    assert.deepEqual(assertStatus(await post('/inventory/adjustments', adjustment, { key: stockKey }), 201), first);
    assertStatus(await post('/inventory/adjustments', { ...adjustment, delta: 2 }, { key: stockKey }), 409);

    const sale = { customer_id: 1, items: [{ product_id: 1, quantity: 1 }], paid_minor: 500, expected_total_minor: 2500 };
    assertStatus(await post('/invoices', { ...sale, expected_total_minor: 1 }), 409);
    const sales = await Promise.all([post('/invoices', sale), post('/invoices', sale)]);
    assert.deepEqual(sales.map(item => item.status).sort(), [201, 409], JSON.stringify(sales));
    invoiceId = sales.find(item => item.status === 201).json.data.id;
    const invoice = assertStatus(await request('/invoices/' + invoiceId), 200);
    assert.equal(invoice.total_minor, 2500);
    assert.equal(invoice.paid_minor, 500);
    assert.equal(invoice.items[0].unit_price_minor, 2500);

    const pay = () => post('/invoices/' + invoiceId + '/payments', { amount_minor: 1500 });
    const payments = await Promise.all([pay(), pay()]);
    assert.deepEqual(payments.map(item => item.status).sort(), [201, 409], JSON.stringify(payments));
    assert.equal(assertStatus(await request('/invoices/' + invoiceId), 200).paid_minor, 2000);

    const refund = () => post('/invoices/' + invoiceId + '/refund', { reason: 'demo refund' });
    const refunds = await Promise.all([refund(), refund()]);
    assert.deepEqual(refunds.map(item => item.status).sort(), [201, 409], JSON.stringify(refunds));
    const restored = assertStatus(await request('/invoices/' + invoiceId), 200);
    assert.equal(restored.status, 'refunded');
    assert.equal(restored.refund.returned_minor, 2000);
    const salesReport = assertStatus(await request('/reports/sales'), 200);
    assert.equal(salesReport.days[0].net_minor, 0);
    assert.equal(salesReport.days[0].cash_received_minor, 2000);
    assert.equal(salesReport.days[0].cash_returned_minor, 2000);
  });

  await t.test('linked installment payment changes both ledgers once', async () => {
    const sale = { customer_id: 1, items: [{ product_id: 1, quantity: 1 }], paid_minor: 500 };
    const invoice = assertStatus(await post('/invoices', sale), 201);
    const installment = assertStatus(await post('/installments', {
      customer_id: 1, invoice_id: invoice.id, principal_minor: 2000, due_date: '2030-01-01',
    }), 201);
    assertStatus(await post('/invoices/' + invoice.id + '/payments', { amount_minor: 1 }), 409);
    assertStatus(await post('/installments/' + installment.id + '/payments', { amount_minor: 2000 }), 201);
    assert.equal(assertStatus(await request('/invoices/' + invoice.id), 200).paid_minor, 2500);
    assert.equal(assertStatus(await request('/installments/' + installment.id), 200).status, 'paid');

    const path = '/invoices/' + invoice.id + '/reissue';
    const replacement = { ...sale, paid_minor: 2500, reason: 'demo correction' };
    assertStatus(await post(path, { ...replacement, items: [{ product_id: 1, quantity: 2 }] }), 409);
    assert.equal(assertStatus(await request('/invoices/' + invoice.id), 200).status, 'paid');
    const reissued = assertStatus(await post(path, replacement), 201);
    assert.equal(assertStatus(await request('/invoices/' + reissued.id), 200).replaces_invoice_id, invoice.id);
    const original = assertStatus(await request('/invoices/' + invoice.id), 200);
    assert.equal(original.replacement_invoice_id, reissued.id);
    assert.equal(original.status, 'refunded');
    assert.equal(assertStatus(await request('/installments/' + installment.id), 200).status, 'voided');
    assert.equal(assertStatus(await request('/invoices?q=عميل'), 200).length, 3);
  });

  await t.test('competing wallet withdrawals, deferred cash settlement and cash expense reversal', async () => {
    const wallet = assertStatus(await post('/wallets', { name: 'Demo Wallet', opening_minor: 1200 }), 201);
    const send = { kind: 'send', amount_minor: 800, commission_minor: 40, fee_minor: 50 };
    const withdraw = () => post('/wallets/' + wallet.id + '/transactions', send);
    const concurrent = await Promise.all([withdraw(), withdraw()]);
    assert.deepEqual(concurrent.map(item => item.status).sort(), [201, 409], JSON.stringify(concurrent));
    const sendId = concurrent.find(item => item.status === 201).json.data.id;
    const transactions = assertStatus(await request('/wallet-transactions?wallet_id=' + wallet.id), 200);
    assert.equal(transactions[0].delta_minor, -850);
    assert.equal(transactions[0].cash_delta_minor, 840);
    assertStatus(await post('/wallet-transactions/' + sendId + '/reverse', { reason: 'demo reversal' }), 201);

    const deferred = assertStatus(await post('/wallets/' + wallet.id + '/transactions', {
      ...send, deferred: { customer_id: 1, principal_minor: 840 },
    }), 201);
    const settle = () => post('/wallet-debts/' + deferred.id + '/payments', { amount_minor: 600 });
    const settlements = await Promise.all([settle(), settle()]);
    assert.deepEqual(settlements.map(item => item.status).sort(), [201, 409], JSON.stringify(settlements));
    assertStatus(await post('/wallet-debts/' + deferred.id + '/payments', { amount_minor: 240 }), 201);
    assert.equal(assertStatus(await request('/wallet-debts/' + deferred.id), 200).status, 'paid');
    const expense = assertStatus(await post('/wallet-cash', { kind: 'expense', amount_minor: 100, category: 'demo', note: 'demo expense' }), 201);
    assertStatus(await post('/wallet-cash/' + expense.id + '/reverse', { reason: 'demo reversal' }), 201);
    const report = assertStatus(await request('/reports/wallets'), 200);
    assert.equal(report.provider_balance_minor, 350);
    assert.equal(report.drawer_minor, 840);
    assert.equal(report.drawer_expense_minor, 0);
  });

  await t.test('supplier, personal debt, damage and maintenance are wired through D1', async () => {
    const supplier = assertStatus(await post('/suppliers', { name: 'Demo Supplier' }), 201);
    const purchase = assertStatus(await post('/purchases', {
      supplier_id: supplier.id, description: 'demo purchase', total_minor: 1000, purchase_date: '2026-01-01',
    }), 201);
    assertStatus(await post('/purchases/' + purchase.id + '/payments', { amount_minor: 400, note: 'demo' }), 201);
    assert.equal(assertStatus(await request('/purchases/' + purchase.id), 200).paid_minor, 400);

    const debt = assertStatus(await post('/debts', { person_name: 'Demo Creditor', direction: 'payable', principal_minor: 1000 }), 201);
    assertStatus(await post('/debts/' + debt.id + '/payments', { amount_minor: 1000 }), 201);
    assert.equal(assertStatus(await request('/debts/' + debt.id), 200).status, 'paid');

    assertStatus(await post('/inventory/adjustments', { product_id: 1, delta: 1, note: 'demo' }), 201);
    const damage = assertStatus(await post('/damaged', { product_id: 1, quantity: 1, reason: 'demo damage' }), 201);
    assertStatus(await post('/damaged/' + damage.id + '/reverse', { reason: 'demo reversal' }), 201);

    const ticket = { customer_id: 1, customer_name: 'Demo Customer', item: 'Demo Device', problem: 'demo repair', price_minor: 1000 };
    const maintenance = assertStatus(await post('/maintenance', ticket), 201);
    const path = '/maintenance/' + maintenance.id;
    const change = status => request(path, { method: 'PATCH', body: { ...ticket, status } });
    assertStatus(await change('delivered'), 409);
    assertStatus(await change('in_progress'), 200);
    assertStatus(await change('completed'), 200);
    assertStatus(await change('delivered'), 409);
    assertStatus(await post(path + '/payments', { amount_minor: 1000 }), 201);
    assert.equal(assertStatus(await change('delivered'), 200).status, 'delivered');
  });

  await t.test('legacy Kotlin checkout uses decimal wire fields and stable replay', async () => {
    const exact = await request('/cashier/products?q=DEMO-100');
    assert.equal(exact.json.exact, true);
    assert.equal(assertStatus(exact, 200)[0].price, '25.00');
    const items = [{ product_id: 1, quantity: 1 }];
    assertStatus(await post('/cashier/checkout', { items, received: '5.00' }), 409);
    const sale = { customer: 'Kotlin Demo', items, received: '١٠٫٥٠' };
    const key = randomUUID();
    const result = assertStatus(await post('/cashier/checkout', sale, { key }), 201);
    assert.deepEqual(result, {
      invoice_id: result.invoice_id, invoice_number: String(result.invoice_id),
      total: '25.00', paid: '10.50', remaining: '14.50', change: '0.00',
    });
    assertStatus(await post('/invoices/' + result.invoice_id + '/payments', { amount_minor: 1450 }), 201);
    assert.deepEqual(assertStatus(await post('/cashier/checkout', sale, { key }), 201), result);
    assertStatus(await post('/inventory/adjustments', { product_id: 1, delta: 1, note: 'demo' }), 201);
    const cash = assertStatus(await post('/cashier/checkout', { items, received: '30' }), 201);
    assert.equal(cash.change, '5.00');
  });
});
