import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
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
    db.prepare("INSERT INTO roles(id, name) VALUES (4, 'wallet reader')"),
    db.prepare("INSERT INTO role_permissions(role_id, permission) VALUES (4, 'wallets.view')"),
    db.prepare(`INSERT INTO users(id, name, email, password_hash, role_id) VALUES
      (1, 'Demo admin', 'admin@example.invalid', 'unused', 1),
      (2, 'Demo reader', 'reader@example.invalid', 'unused', 2),
      (4, 'Demo wallet reader', 'wallet-reader@example.invalid', 'unused', 4)`),
    db.prepare("INSERT INTO products(id, name, price_minor, cost_minor, barcode) VALUES (1, 'منتج تجريبي', 2500, 1250, 'DEMO-100')"),
    db.prepare("INSERT INTO customers(id, name) VALUES (1, 'عميل تجريبي')"),
  ]);
  const tokens = new Map([0, 1, 3].map(identity => [identity, randomBytes(32).toString('base64url')]));
  await db.batch([...tokens].map(([identity, token]) =>
    db.prepare('INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(createHash('sha256').update(token).digest('base64url'), identity + 1, Math.floor(Date.now() / 1000) + 300)
  ));

  return async (path, { method = 'GET', body, image, key = randomUUID(), identity = 0, android = false, cookie = false } = {}) => {
    const headers = {};
    const token = tokens.get(identity);
    if (token && cookie) headers.Cookie = 'henra_store_session=' + token;
    if (token && !cookie) headers.Authorization = 'Bearer ' + token;
    if (android) headers['X-Store-Client'] = 'android';
    if (image) headers['Content-Type'] = 'image/png';
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Idempotency-Key'] = key;
    }
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method, headers, body: image ?? (body ? JSON.stringify(body) : undefined),
    });
    const contentType = response.headers.get('Content-Type');
    return { status: response.status, contentType, headers: response.headers,
      json: contentType?.includes('application/json') ? await response.json() : null,
      image: contentType?.startsWith('image/') ? new Uint8Array(await response.arrayBuffer()) : null,
      csv: contentType?.startsWith('text/csv') ? new Uint8Array(await response.arrayBuffer()) : null };
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

    const mobile = assertStatus(await request('/invoices/' + invoiceId, { android: true }), 200);
    assert.equal(mobile.invoice_number, String(invoiceId));
    assert.equal(mobile.status, 'partial');
    assert.equal(mobile.total_amount, '25.00');
    assert.equal(mobile.remaining_amount, '20.00');
    assert.equal(mobile.items[0].line_total, '25.00');
    const mobileList = await request('/invoices?q=' + invoiceId, { android: true });
    assert.equal(assertStatus(mobileList, 200).length, 1);
    assert.equal(mobileList.json.meta.current_page, 1);
    assertStatus(await request('/invoices/' + invoiceId, { android: true, identity: 1 }), 403);
    assert.equal(assertStatus(await request('/sales', { android: true }), 200)[0].sold_quantity, 1);

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

  await t.test('supplier receipts allocate oldest purchase first, then opening balance', async () => {
    const supplier = assertStatus(await post('/suppliers', {
      name: 'Demo Credit Supplier', email: 'vendor@example.invalid', opening_minor: 400,
    }), 201);
    const createPurchase = (purchase_date, payment_type, paid_minor) => post('/purchases', {
      supplier_id: supplier.id, description: 'purchase fixture', total_minor: 1000, purchase_date, payment_type, paid_minor,
    });
    const newer = assertStatus(await createPurchase('2026-03-01', 'credit', 200), 201);
    const older = assertStatus(await createPurchase('2026-02-01', 'credit'), 201);
    const cash = assertStatus(await createPurchase('2026-04-01', 'cash'), 201);
    assert.equal(assertStatus(await request('/purchases/' + cash.id), 200).paid_minor, 1000);
    assertStatus(await post('/suppliers/' + supplier.id + '/payments', { amount_minor: 1200, payment_date: '2026-04-10' }), 201);
    assert.equal(assertStatus(await request('/purchases/' + older.id), 200).paid_minor, 1000);
    assert.equal(assertStatus(await request('/purchases/' + newer.id), 200).paid_minor, 400);
    const settle = () => post('/suppliers/' + supplier.id + '/payments', { amount_minor: 1000, payment_date: '2026-04-11' });
    const competing = await Promise.all([settle(), settle()]);
    assert.deepEqual(competing.map(item => item.status).sort(), [201, 409], JSON.stringify(competing));
    const detail = assertStatus(await request('/suppliers/' + supplier.id), 200);
    assert.equal(detail.opening_paid_minor, 400);
    assert.equal(detail.balance_minor, 0);
    assert.equal(detail.payments[0].opening_applied_minor, 400);
    assertStatus(await request('/suppliers/' + supplier.id, {
      method: 'PATCH', body: { name: detail.name, active: true, opening_minor: 399 },
    }), 409);
  });

  await t.test('independent installment/debt void and maintenance archive preserve prior payments', async () => {
    const unpaid = { customer_id: 1, principal_minor: 300, due_date: '2030-01-01' };
    const installment = assertStatus(await post('/installments', unpaid), 201);
    assertStatus(await post('/installments/' + installment.id + '/void', { reason: 'cancel demo' }), 201);
    assertStatus(await post('/installments/' + installment.id + '/payments', { amount_minor: 100 }), 409);
    assert.equal(assertStatus(await request('/installments/' + installment.id), 200).status, 'voided');
    const paidInstallment = assertStatus(await post('/installments', { ...unpaid, paid_minor: 100 }), 201);
    assert.equal(assertStatus(await request('/installments/' + paidInstallment.id), 200).paid_minor, 100);
    assertStatus(await post('/installments/' + paidInstallment.id + '/void', { reason: 'cancel demo' }), 409);

    const debt = assertStatus(await post('/debts', { person_name: 'Void fixture', principal_minor: 1000, description: 'demo' }), 201);
    assertStatus(await post('/debts/' + debt.id + '/void', { reason: 'demo' }), 201);
    assertStatus(await post('/debts/' + debt.id + '/payments', { amount_minor: 100 }), 409);
    assert.equal(assertStatus(await request('/debts/' + debt.id), 200).status, 'voided');
    const initial = assertStatus(await post('/debts', { person_name: 'Paid fixture', principal_minor: 1000, paid_minor: 100 }), 201);
    assertStatus(await post('/debts/' + initial.id + '/void', { reason: 'demo' }), 409);

    const repair = assertStatus(await post('/maintenance', {
      customer_name: 'Archival fixture', item: 'Phone', problem: 'test', price_minor: 100,
    }), 201);
    assertStatus(await request('/maintenance/' + repair.id, { method: 'DELETE' }), 200);
    assertStatus(await post('/maintenance/' + repair.id + '/payments', { amount_minor: 100 }), 409);
    assert.equal(assertStatus(await request('/maintenance?q=Archival'), 200).length, 0);
  });

  await t.test('damage correction applies only the difference and keeps a historical record', async () => {
    assertStatus(await post('/inventory/adjustments', { product_id: 1, delta: 4, note: 'demo' }), 201);
    const damage = assertStatus(await post('/damaged', { product_id: 1, quantity: 1, reason: 'demo damage' }), 201);
    const path = '/damaged/' + damage.id;
    assert.equal(assertStatus(await request(path), 200).unit_value_minor, 2500);
    assertStatus(await post(path + '/correct', { quantity: 5, reason: 'quantity too high' }), 409);
    assertStatus(await post(path + '/correct', { quantity: 3, reason: 'corrected', unit_value_minor: 2000, damaged_on: '2026-04-01' }), 201);
    const corrected = assertStatus(await request(path), 200);
    assert.equal(corrected.total_value_minor, 6000);
    assert.equal(corrected.corrections[0].previous_quantity, 1);
    const reportPath = '/reports/damaged?from=2026-04-01&to=2026-04-01';
    assert.equal(assertStatus(await request(reportPath), 200).total_value_minor, 6000);
    assertStatus(await post(path + '/reverse', { reason: 'demo' }), 201);
    assert.equal(assertStatus(await request(reportPath), 200).voided_entries, 1);
    assertStatus(await post(path + '/correct', { quantity: 1, reason: 'demo' }), 409);
    assert.equal(assertStatus(await request('/products/1'), 200).stock, 4);
  });

  await t.test('withdrawals cannot overdraw the same profits and wallet transfer keeps counterparty', async () => {
    const wallet = assertStatus(await post('/wallets', { name: 'Profit fixture', opening_minor: 1000, transaction_limit_minor: 500 }), 201);
    const walletPath = '/wallets/' + wallet.id + '/transactions';
    const transfer = assertStatus(await post(walletPath, {
      kind: 'send', amount_minor: 500, commission_minor: 200, counterparty: '01000000000',
    }), 201);
    assert.equal(assertStatus(await request('/wallet-transactions?wallet_id=' + wallet.id), 200)[0].counterparty, '01000000000');
    assertStatus(await post('/wallet-transactions/' + transfer.id + '/reverse', { reason: 'counterparty test' }), 201);
    assert.equal(assertStatus(await request('/wallet-transactions?wallet_id=' + wallet.id), 200)[0].counterparty, '01000000000');
    assertStatus(await post(walletPath, { kind: 'send', amount_minor: 500, commission_minor: 200 }), 201);
    const withdraw = wallet_id => post('/wallet-profit-withdrawals', { amount_minor: 150, wallet_id });
    const competing = await Promise.all([withdraw(wallet.id), withdraw(null)]);
    assert.deepEqual(competing.map(item => item.status).sort(), [201, 409], JSON.stringify(competing));
    const report = assertStatus(await request('/reports/wallets'), 200);
    assert.equal(report.profit_withdrawn_minor, 150);
    assert.equal(report.profit_available_minor, 40);
    assertStatus(await post('/wallet-profit-withdrawals', { amount_minor: 40, wallet_id: wallet.id }), 201);
    const withdrawal = assertStatus(await request('/wallet-profit-withdrawals'), 200)[0];
    assertStatus(await post('/wallet-transactions/' + withdrawal.id + '/reverse', { reason: 'demo' }), 409);
  });

  await t.test('wallet settings persist across clients and adjustments bypass the cashier limit', async () => {
    const profile = {
      name: 'Wallet pricing fixture', provider: 'vodafone_cash', phone: 'QA-' + '0'.repeat(61),
      transaction_limit_minor: 90, daily_send_limit_minor: 150,
    };
    const wallet = assertStatus(await post('/wallets', {
      ...profile, opening_minor: 1000, holder_name: 'صاحب حساب تجريبي', notes: 'حساب اختبار', warn_at_percent: 50,
      default_commission_bps: 1250, default_commission_min_minor: 7,
      default_fee_bps: 1000, default_fee_min_minor: 3, default_fee_max_minor: 4,
    }), 201);
    const path = '/wallets/' + wallet.id;
    const ledger = '/wallet-transactions?wallet_id=' + wallet.id;
    const patch = body => request(path, { method: 'PATCH', body: { ...profile, active: true, ...body } });
    const retained = assertStatus(await patch({}), 200);
    assert.equal(retained.phone, profile.phone);
    assert.equal(retained.holder_name, 'صاحب حساب تجريبي');
    assert.equal(retained.notes, 'حساب اختبار');
    assert.equal(retained.warn_at_percent, 50);
    const cleared = assertStatus(await patch({ holder_name: '', notes: '' }), 200);
    assert.equal(cleared.holder_name, '');
    assert.equal(cleared.notes, '');
    assertStatus(await post(path + '/transactions', {
      kind: 'send', amount_minor: 84, deferred: { customer_id: 1 },
    }), 201);
    const transfer = assertStatus(await request(ledger), 200)[0];
    assert.equal(transfer.commission_minor, 11);
    assert.equal(transfer.fee_minor, 4);
    assert.equal(transfer.delta_minor, -88);
    assert.equal(assertStatus(await request('/wallet-debts/' + transfer.wallet_debt_id), 200).principal_minor, 95);
    const androidWallets = assertStatus(await request('/wallets', { android: true }), 200).wallets;
    const androidWallet = androidWallets.find(row => row.id === wallet.id);
    assert.equal(androidWallet.provider, 'vodafone_cash');
    assert.equal(androidWallet.warn_at_percent, 50);
    assert.equal(androidWallet.limits.find(row => row.label === 'الإرسال اليومي').level, 'warning');
    assertStatus(await post(path + '/transactions', {
      kind: 'receive', amount_minor: 84, commission_minor: 0, fee_minor: 0,
    }), 201);
    assert.equal(assertStatus(await request(ledger), 200)[0].fee_minor, 0);
    const adjustment = assertStatus(await post(path + '/adjustments', { delta_minor: -200, reason: 'reconcile demo' }), 201);
    assert.equal(assertStatus(await request(ledger), 200)[0].adjustment_id, adjustment.id);
    assertStatus(await post(path + '/adjustments', { delta_minor: -1000, reason: 'insufficient' }), 409);
    assertStatus(await post(path + '/active', { active: false }), 200);
    assertStatus(await post(path + '/transactions', { kind: 'receive', amount_minor: 84 }), 409);
  });

  await t.test('private image routes enforce access, type, bytes, and remove metadata', async () => {
    const pixels = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0YsAAAAASUVORK5CYII=', 'base64');
    const damage = assertStatus(await post('/damaged', { product_id: 1, quantity: 1, reason: 'image fixture' }), 201);
    const maintenance = assertStatus(await post('/maintenance', {
      customer_name: 'Image fixture', item: 'Phone', problem: 'image test',
    }), 201);
    for (const path of ['/damaged/' + damage.id, '/maintenance/' + maintenance.id]) {
      const image = path + '/image';
      assertStatus(await request(image, { method: 'PUT', image: Uint8Array.of(1, 2, 3) }), 415);
      assertStatus(await request(image, { method: 'PUT', image: pixels }), 200);
      assert.equal(assertStatus(await request(path), 200).has_image, 1);
      const downloaded = await request(image);
      assert.equal(downloaded.contentType, 'image/png');
      assert.deepEqual(downloaded.image, new Uint8Array(pixels));
      assertStatus(await request(image, { identity: 1 }), 403);
      assertStatus(await request(image, { method: 'DELETE' }), 200);
      assert.equal(assertStatus(await request(path), 200).has_image, 0);
    }
  });

  await t.test('document dates and notes stay separate from invoice ledger dates', async () => {
    const sale = assertStatus(await post('/invoices', {
      items: [{ product_id: 1, quantity: 1 }], paid_minor: 2500, invoice_date: '2020-02-20', notes: 'ملاحظة تجريبية',
    }), 201);
    const invoice = assertStatus(await request('/invoices/' + sale.id), 200);
    assert.equal(invoice.invoice_date, '2020-02-20');
    assert.equal(invoice.notes, 'ملاحظة تجريبية');
    assert.notEqual(invoice.created_at.slice(0, 10), invoice.invoice_date);
    assert.equal(assertStatus(await request('/invoices?from=2020-02-20&to=2020-02-20'), 200).length, 1);
    assert.equal(assertStatus(await request('/reports/sales?from=2020-02-20&to=2020-02-20'), 200).days.length, 0);
  });

  await t.test('standalone installments preserve item snapshots and cannot force paid status', async () => {
    const stock = assertStatus(await request('/products/1'), 200).stock;
    const installment = assertStatus(await post('/installments', {
      customer_id: 1, items: [{ product_id: 1, quantity: 3 }], paid_minor: 1000,
      due_date: '2030-02-20', payment_date: '2026-02-20',
    }), 201);
    const path = '/installments/' + installment.id;
    const original = assertStatus(await request(path), 200);
    assert.equal(original.principal_minor, 7500);
    assert.equal(original.items[0].quantity, 3);
    assert.equal(original.items[0].line_total_minor, 7500);
    assert.equal(original.payment_date, '2026-02-20');
    assert.equal(assertStatus(await request('/products/1'), 200).stock, stock);
    assertStatus(await post(path + '/status', { status: 'overdue' }), 200);
    assert.equal(assertStatus(await request(path), 200).status, 'overdue');
    assertStatus(await post(path + '/status', { status: 'paid' }), 404);
    assertStatus(await request(path, {
      method: 'PATCH', body: { due_date: '2030-02-20', principal_minor: 2000 },
    }), 404);
    assertStatus(await request(path, {
      method: 'PATCH', body: { due_date: '2030-02-20', product_name: 'Manual fixture', principal_minor: 2000 },
    }), 200);
    const edited = assertStatus(await request(path), 200);
    assert.equal(edited.product_name, 'Manual fixture');
    assert.deepEqual(edited.items, []);
    assert.equal(edited.principal_minor, 2000);
    assertStatus(await post(path + '/payments', { amount_minor: 1000 }), 201);
    assert.equal(assertStatus(await request(path), 200).status, 'paid');
  });

  await t.test('supplier stock receipts are explicit, idempotent and reverse atomically', async () => {
    const supplier = assertStatus(await post('/suppliers', { name: 'Receiving fixture' }), 201);
    const purchase = assertStatus(await post('/purchases', {
      supplier_id: supplier.id, description: 'historical purchase', total_minor: 2000, purchase_date: '2026-03-01',
    }), 201);
    const path = '/purchases/' + purchase.id + '/receipts';
    const stock = async () => assertStatus(await request('/products/1'), 200).stock;
    const openingStock = await stock();
    assert.deepEqual(assertStatus(await request(path), 200), []);
    const receipt = { reference: 'RC-001', items: [{ product_id: 1, quantity: 3 }], received_on: '2026-03-02' };
    assertStatus(await post(path, receipt, { identity: 1 }), 403);
    assertStatus(await post(path, { ...receipt, items: [...receipt.items, { product_id: 999, quantity: 2 }] }), 409);
    assert.equal(await stock(), openingStock);
    assert.deepEqual(assertStatus(await request(path), 200), []);
    const key = randomUUID();
    const sameKey = await Promise.all([post(path, receipt, { key }), post(path, receipt, { key })]);
    const record = assertStatus(sameKey[0], 201);
    assert.deepEqual(assertStatus(sameKey[1], 201), record);
    assert.equal(await stock(), openingStock + 3);
    const list = assertStatus(await request(path), 200);
    assert.equal(list[0].items[0].product_barcode, 'DEMO-100');
    assertStatus(await post(path, { ...receipt, reference: 'rc-001' }), 409);
    const reverse = path + '/' + record.id + '/reverse';
    assertStatus(await post('/inventory/adjustments', { product_id: 1, delta: -(openingStock + 1), note: 'simulate stock movement' }), 201);
    assert.equal(await stock(), 2);
    assertStatus(await post(reverse, { reason: 'cannot remove sold or removed units' }), 409);
    assert.equal(assertStatus(await request(path), 200)[0].reversed_by, null);
    assertStatus(await post('/inventory/adjustments', { product_id: 1, delta: 1, note: 'replace one unit' }), 201);
    const reversals = await Promise.all([post(reverse, { reason: 'supplier return' }), post(reverse, { reason: 'supplier return' })]);
    assert.deepEqual(reversals.map(result => result.status).sort(), [201, 409], JSON.stringify(reversals));
    assert.equal(await stock(), 0);
    assert.equal(assertStatus(await request(path), 200)[0].reversal_reason, 'supplier return');
    assert.equal(assertStatus(await request('/purchases/' + purchase.id), 200).paid_minor, 0);
    const movements = assertStatus(await request('/inventory/movements?product_id=1'), 200);
    assert.ok(movements.some(row => row.purchase_stock_receipt_id === record.id && row.delta === 3));
    assert.ok(movements.some(row => row.purchase_stock_reversal_id && row.delta === -3));
  });

  await t.test('wallet periods exclude reversed trades and expose cash activity and admin audit', async () => {
    const baseline = assertStatus(await request('/reports/wallets/period'), 200);
    const wallet = assertStatus(await post('/wallets', { name: 'Wallet reporting fixture', opening_minor: 1200 }), 201);
    const path = '/wallets/' + wallet.id + '/transactions';
    const reversed = assertStatus(await post(path, { kind: 'send', amount_minor: 100, commission_minor: 40, fee_minor: 5 }), 201);
    assertStatus(await post('/wallet-transactions/' + reversed.id + '/reverse', { reason: 'reversal fixture' }), 201);
    const deferred = assertStatus(await post(path, {
      kind: 'send', amount_minor: 300, commission_minor: 40, fee_minor: 5, deferred: { customer_id: 1 },
    }), 201);
    assertStatus(await post('/wallet-debts/' + deferred.id + '/payments', { amount_minor: 100 }), 201);
    assertStatus(await post('/wallet-cash', { kind: 'expense', amount_minor: 20, category: 'fixture', note: 'report fixture' }), 201);
    const report = assertStatus(await request('/reports/wallets/period?mode=daily&date=' + baseline.from), 200);
    assert.equal(report.timezone, 'Africa/Cairo');
    assert.equal(report.totals.expense_minor - baseline.totals.expense_minor, 20);
    assert.equal(report.totals.net_minor - baseline.totals.net_minor, 15);
    assert.equal(report.totals.cash_movement_minor - baseline.totals.cash_movement_minor, 80);
    assert.equal(report.totals.cash_collections_minor - baseline.totals.cash_collections_minor, 100);
    assert.equal(report.totals.new_deferred_minor - baseline.totals.new_deferred_minor, 340);
    const entry = report.wallets.find(row => row.wallet_id === wallet.id);
    assert.equal(entry.transactions, 1);
    assert.equal(entry.sent_minor, 300);
    const monthly = assertStatus(await request('/reports/wallets/period?mode=monthly&month=' + baseline.from.slice(0, 7)), 200);
    assert.equal(monthly.from, baseline.from.slice(0, 7) + '-01');
    assert.equal(monthly.days.find(row => row.day === baseline.from).net_minor, report.totals.net_minor);
    assertStatus(await request('/reports/wallets/period', { identity: 1 }), 403);
    assertStatus(await request('/wallet-audit', { identity: 1 }), 403);
    const log = assertStatus(await request('/wallet-audit?action=wallet.transaction&q=' + deferred.id), 200);
    assert.equal(log[0].entity_id, deferred.id);
    assert.equal(log[0].actor_name, 'Demo admin');
  });

  await t.test('wallet CSV downloads through cookie auth with the ledger filters and exact EGP values', async () => {
    const name = 'محفظة اختبار CSV';
    const wallet = assertStatus(await post('/wallets', { name, opening_minor: 900_000_000_000_000 }), 201);
    const path = '/wallets/' + wallet.id + '/transactions';
    const original = assertStatus(await post(path, { kind: 'send', amount_minor: 125 }), 201);
    assertStatus(await post('/wallet-transactions/' + original.id + '/reverse', { reason: 'test reversal' }), 201);
    const reference = '0001234567890123456';
    const note = '=HYPERLINK("test","نص")\nقيد اختباري';
    const transfer = assertStatus(await post(path, {
      kind: 'send', amount_minor: 899_999_999_999_993, commission_minor: 3, fee_minor: 6,
      counterparty: '+000123', note, provider_reference: reference,
    }), 201);
    const walletQuery = 'wallet_id=' + wallet.id;
    const list = '/wallet-transactions?';
    const csv = '/wallet-transactions.csv?';
    const [row] = assertStatus(await request(list + walletQuery + '&q=' + reference.slice(0, 9)), 200);
    assert.equal(row.id, transfer.id);
    assert.equal(row.provider_reference, reference);

    const filter = new URLSearchParams({ wallet_id: wallet.id, kind: 'send', status: 'effective',
      from: row.business_day, to: row.business_day, q: reference.slice(0, 9) });
    const result = await request(csv + filter, { cookie: true });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(result.contentType, 'text/csv; charset=utf-8');
    assert.equal(result.headers.get('Content-Disposition'), 'attachment; filename="hilal-wallet-ledger.csv"');
    assert.match(result.headers.get('Cache-Control'), /no-store/);
    assert.deepEqual([...result.csv.subarray(0, 3)], [239, 187, 191]);
    assert.deepEqual(parse(result.csv, { bom: true, columns: true }), [{
      id: String(transfer.id), wallet_name: name, business_day: row.business_day, kind: 'send',
      reversal_of: '', reversed_by: '', amount_egp: '8999999999999.93', delta_egp: '-8999999999999.99',
      cash_delta_egp: '8999999999999.96', commission_egp: '0.03', fee_egp: '0.06',
      counterparty: "'+000123", note: "'" + note, provider_reference: "'" + reference,
    }]);
    assert.deepEqual(assertStatus(await request(list + filter + '&export=1'), 200), [row]);

    const reversed = await request(csv + walletQuery + '&kind=send&status=reversed');
    assert.equal(reversed.status, 200);
    assert.deepEqual(parse(reversed.csv, { bom: true, columns: true }).map(entry => entry.id), [String(original.id)]);
    const empty = await request(csv + walletQuery + '&kind=receive');
    assert.equal(empty.status, 200);
    assert.deepEqual(parse(empty.csv, { bom: true, columns: true }), []);
    assertStatus(await request(csv + 'from=2026-02-02&to=2026-02-01'), 422);

    const viewer = { identity: 3, cookie: true };
    assert.equal(assertStatus(await request(list + filter, viewer), 200)[0].cash_delta_minor, null);
    assertStatus(await request(list + filter + '&export=1', viewer), 403);
    assertStatus(await request(csv + filter, viewer), 403);
    assertStatus(await request(csv + filter, { identity: 1 }), 403);
    assertStatus(await request(csv + filter, { identity: 2 }), 401);
  });
});

test('a provider receipt is unique per wallet and a retry does not post twice', async t => {
  const request = await worker(t);
  const post = (path, body, options = {}) => request(path, { method: 'POST', body, ...options });
  const first = assertStatus(await post('/wallets', { name: 'Receipt fixture A', opening_minor: 20000 }), 201);
  const second = assertStatus(await post('/wallets', { name: 'Receipt fixture B', opening_minor: 20000 }), 201);
  const route = id => '/wallets/' + id + '/transactions';
  const receipt = { kind: 'send', amount_minor: 1000, provider_reference: ' 0001-Ab9 ' };
  const key = randomUUID();
  const saved = assertStatus(await post(route(first.id), receipt, { key }), 201);
  assert.deepEqual(assertStatus(await post(route(first.id), { ...receipt, provider_reference: '0001-Ab9' }, { key }), 201), saved);
  const duplicate = await post(route(first.id), { ...receipt, provider_reference: '0001-aB9' });
  assertStatus(duplicate, 409);
  assert.equal(duplicate.json.code, 'WALLET_PROVIDER_REFERENCE_DUPLICATE');
  assertStatus(await post(route(first.id), { ...receipt, provider_reference: 'Ab\n9' }), 422);
  assertStatus(await post(route(first.id), { ...receipt, kind: 'expense', note: 'reference only on transfers' }), 422);
  assert.equal(assertStatus(await request('/wallets'), 200).find(row => row.id === first.id).balance_minor, 19000);
  const rows = assertStatus(await request('/wallet-transactions?wallet_id=' + first.id + '&q=0001-ab'), 200);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider_reference, '0001-Ab9');
  assertStatus(await post('/wallet-transactions/' + saved.id + '/reverse', { reason: 'fixture reversal' }), 201);
  assertStatus(await post(route(first.id), receipt), 409);
  assertStatus(await post(route(second.id), receipt), 201);
  const latest = assertStatus(await request('/wallet-transactions?wallet_id=' + first.id), 200);
  assert.equal(latest.find(row => row.kind === 'reversal').provider_reference, null);
});
