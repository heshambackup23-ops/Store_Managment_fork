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
    db.prepare("INSERT INTO roles(id, name) VALUES (5, 'stock counter')"),
    db.prepare("INSERT INTO role_permissions(role_id, permission) VALUES (5, 'inventory.stocktake.count')"),
    db.prepare("INSERT INTO roles(id, name) VALUES (6, 'cashier without discount')"),
    db.prepare("INSERT INTO role_permissions(role_id, permission) VALUES (6, 'invoices.create')"),
    db.prepare(`INSERT INTO users(id, name, email, password_hash, role_id) VALUES
      (1, 'Demo admin', 'admin@example.invalid', 'unused', 1),
      (2, 'Demo reader', 'reader@example.invalid', 'unused', 2),
      (4, 'Demo wallet reader', 'wallet-reader@example.invalid', 'unused', 4),
      (5, 'Demo stock counter', 'stock-counter@example.invalid', 'unused', 5),
      (6, 'Demo cashier', 'cashier@example.invalid', 'unused', 6)`),
    db.prepare("INSERT INTO products(id, name, price_minor, cost_minor, barcode) VALUES (1, 'منتج تجريبي', 2500, 1250, 'DEMO-100')"),
    db.prepare("INSERT INTO customers(id, name) VALUES (1, 'عميل تجريبي')"),
  ]);
  const tokens = new Map([0, 1, 3, 4, 5].map(identity => [identity, randomBytes(32).toString('base64url')]));
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
    assert.equal(salesReport.days[0].cash_received_minor, 0);
    assert.equal(salesReport.days[0].cash_returned_minor, 0);
    assert.equal(salesReport.days[0].unclassified_received_minor, 2000);
    assert.equal(salesReport.days[0].unclassified_returned_minor, 2000);
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

  await t.test('unit discounts require separate permission and return at the net unit price', async () => {
    const product = assertStatus(await post('/products', { name: 'Discount fixture', price_minor: 1200 }), 201);
    assertStatus(await post('/inventory/adjustments', { product_id: product.id, delta: 3, note: 'discount opening stock' }), 201);
    const line = { product_id: product.id, quantity: 2, unit_discount_minor: 125 };
    const sale = { items: [line], paid_minor: 2150, expected_total_minor: 2150 };
    assertStatus(await post('/invoices', sale, { identity: 5 }), 403);
    assert.equal((await post('/invoices', { ...sale, expected_total_minor: undefined })).json.code, 'RETAIL_DISCOUNT_TOTAL_REQUIRED');
    assertStatus(await post('/invoices', { ...sale, expected_total_minor: 2400 }), 409);
    assertStatus(await post('/invoices', { ...sale, items: [{ ...line, unit_discount_minor: 1201 }] }), 409);
    const invoice = assertStatus(await post('/invoices', sale), 201);
    const detail = assertStatus(await request('/invoices/' + invoice.id), 200);
    assert.deepEqual([detail.total_minor, detail.items[0].original_unit_price_minor,
      detail.items[0].unit_discount_minor, detail.items[0].unit_price_minor], [2150, 1200, 125, 1075]);
    assertStatus(await request('/products/' + product.id, { method: 'PATCH', body: { price_minor: 1300 } }), 200);
    const ordinarySale = { items: [{ product_id: product.id, quantity: 1 }], paid_minor: 1300, expected_total_minor: 1300 };
    assertStatus(await post('/invoices', ordinarySale, { identity: 5 }), 201);
    const returned = assertStatus(await post('/invoices/' + invoice.id + '/returns', {
      items: [{ product_id: product.id, quantity: 1, disposition: 'resale' }], reason: 'one discounted unit returned',
    }), 201);
    assert.equal(returned.total_minor, 1075);
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
    assert.equal(assertStatus(await request(path), 200).unit_value_minor, 1250);
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

  await t.test('tracked receipt and checkout bind a unique physical device and retain warranty history', async () => {
    const product = assertStatus(await post('/products', {
      name: 'Tracked phone', price_minor: 5000, tracking: 'imei', warranty_months: 1,
    }), 201);
    const appliance = assertStatus(await post('/products', {
      name: 'Tracked appliance', price_minor: 7500, tracking: 'serial',
    }), 201);
    const supplier = assertStatus(await post('/suppliers', { name: 'Tracked stock supplier' }), 201);
    const purchase = assertStatus(await post('/purchases', {
      supplier_id: supplier.id, description: 'Tracked stock delivery', total_minor: 9000, purchase_date: '2026-01-01',
    }), 201);
    const receipts = '/purchases/' + purchase.id + '/receipts';
    const device = { serial_number: 'QA-01', imei1: '490154203237518', imei2: '356938035643809' };
    const receipt = (items, reference) => post(receipts, { items, reference, received_on: '2026-01-10' });
    const phoneLine = { product_id: product.id, quantity: 1 };
    const applianceLine = { product_id: appliance.id, quantity: 1 };
    const stock = async () => assertStatus(await request('/products/' + product.id), 200).stock;
    assert.equal((await receipt([phoneLine], 'MISSING')).json.code, 'RETAIL_DEVICE_RECEIPT_COUNT');
    assertStatus(await receipt([{ ...phoneLine, devices: [{ ...device, imei1: '490154203237519' }] }], 'BAD-IMEI'), 422);
    const recorded = assertStatus(await receipt([{ ...phoneLine, devices: [device] }], 'TRACKED-1'), 201);
    assert.equal(await stock(), 1);
    const duplicate = await receipt([{ ...applianceLine, devices: [
      { serial_number: 'AP-01', imei1: device.imei2 },
    ] }], 'CROSS-IMEI');
    assert.equal(duplicate.json.code, 'RETAIL_DEVICE_IDENTITY_DUPLICATE');
    assert.equal((await receipt([{ ...applianceLine, devices: [{ serial_number: 'qa-01' }] }], 'SERIAL-DUPE')).json.code,
      'RETAIL_DEVICE_IDENTITY_DUPLICATE');
    assert.equal((await post('/inventory/adjustments', {
      product_id: product.id, delta: 1, note: 'anonymous increase',
    })).json.code, 'RETAIL_DEVICE_MOVEMENT_REQUIRED');
    assert.equal((await request('/products/' + product.id, {
      method: 'PATCH', body: { tracking: 'quantity' },
    })).json.code, 'RETAIL_TRACKING_HAS_STOCK');
    const devices = assertStatus(await request('/retail/devices?status=available&q=' + device.imei2), 200);
    assert.equal(devices.length, 1);
    const physicalId = devices[0].id;
    assertStatus(await request('/retail/devices', { identity: 3 }), 403);
    const purchaseLedger = assertStatus(await request(receipts), 200);
    assert.deepEqual(purchaseLedger[0].items[0].devices, [device]);
    const sell = (items, options) => post('/invoices', { items, paid_minor: 5000, invoice_date: '2026-01-31' }, options);
    assert.equal((await sell([phoneLine])).json.code, 'RETAIL_DEVICE_SALE_COUNT');
    const saleLine = { ...phoneLine, device_ids: [physicalId] };
    const key = randomUUID();
    const competing = await Promise.all([sell([saleLine], { key }), sell([saleLine])]);
    assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
    const sale = competing.find(result => result.status === 201).json.data;
    assert.equal(await stock(), 0);
    const salesInvoice = assertStatus(await request('/invoices/' + sale.id), 200);
    assert.deepEqual(salesInvoice.items[0].device_ids, [physicalId]);
    assert.equal(salesInvoice.devices[0].serial_number, device.serial_number);
    const physical = '/retail/devices/' + physicalId;
    const beforeEvent = assertStatus(await request(physical), 200);
    assert.equal(beforeEvent.status, 'sold');
    assert.equal(beforeEvent.sales[0].warranty_starts_on, '2026-01-31');
    assert.equal(beforeEvent.sales[0].warranty_expires_on, '2026-02-28');
    assert.equal(beforeEvent.sales[0].warranty_basis, 'sale');
    assert.equal((await post(physical + '/events', { kind: 'installed', occurred_on: '2026-01-30' })).json.code,
      'RETAIL_DEVICE_EVENT_STATE');
    assertStatus(await post(physical + '/events', { kind: 'delivered', occurred_on: '2026-02-01' }), 201);
    assertStatus(await post(physical + '/events', { kind: 'installed', occurred_on: '2026-02-02' }), 201);
    assert.deepEqual(assertStatus(await request(physical), 200).events.map(event => event.kind), ['installed', 'delivered']);
    assert.equal((await post('/invoices/' + sale.id + '/refund', { reason: 'device requires line return' })).json.code,
      'RETAIL_DEVICE_RETURN_REQUIRED');
    assert.equal((await post(receipts + '/' + recorded.id + '/reverse', { reason: 'sold already' })).json.code,
      'RETAIL_RECEIPT_DEVICE_HISTORY');
    const returns = '/invoices/' + sale.id + '/returns';
    const eligible = assertStatus(await request(returns), 200);
    assert.deepEqual(eligible.items[0].devices.map(device => device.id), [physicalId]);
    const returnItem = { ...saleLine, disposition: 'resale' };
    const returnOne = item => post(returns, { reason: 'tracked return', items: [item] });
    assert.equal((await returnOne({ ...returnItem, device_ids: [] })).json.code, 'RETAIL_RETURN_DEVICE');
    assert.equal((await returnOne({ ...returnItem, device_ids: [physicalId + 999] })).json.code, 'RETAIL_RETURN_DEVICE');
    const returned = assertStatus(await returnOne(returnItem), 201);
    assert.equal(returned.items[0].devices[0].id, physicalId);
    assert.equal(assertStatus(await request(physical), 200).status, 'available');
    assert.equal(await stock(), 1);
    const profile = { warranty_basis: 'installation', warranty_months: 120, warranty_guarantor: '  الوكيل التجريبي  ' };
    const configured = assertStatus(await request('/products/' + product.id, { method: 'PATCH', body: profile }), 200);
    assert.equal(configured.warranty_guarantor, 'الوكيل التجريبي');
    assertStatus(await request('/products/' + product.id, { method: 'PATCH', body: { warranty_basis: 'unsupported' } }), 422);
    const resale = assertStatus(await sell([saleLine]), 201);
    const resaleInvoice = '/invoices/' + resale.id;
    const pending = assertStatus(await request(resaleInvoice), 200).devices[0];
    assert.equal(pending.warranty_status, 'pending');
    assert.equal(pending.warranty_basis, 'installation');
    assert.equal(pending.warranty_starts_on, null);
    assert.equal(pending.warranty_expires_on, null);
    assertStatus(await post(physical + '/events', { kind: 'delivered', occurred_on: '2026-02-02', proof_reference: 'DL-١٢٣' }), 201);
    assertStatus(await post(physical + '/events', { kind: 'warranty_claim', proof_reference: 'x'.repeat(121) }), 422);
    assert.equal(assertStatus(await request(resaleInvoice), 200).devices[0].warranty_status, 'pending');
    assert.equal((await post(physical + '/events', { kind: 'installed', occurred_on: '2026-02-01' })).json.code,
      'RETAIL_DEVICE_MILESTONE_ORDER');
    const installed = { kind: 'installed', occurred_on: '2026-02-04', proof_reference: '  INST-٤٥٦  ' };
    const installKey = randomUUID();
    const recordedInstallation = assertStatus(await post(physical + '/events', installed, { key: installKey }), 201);
    assert.deepEqual(assertStatus(await post(physical + '/events', installed, { key: installKey }), 201), recordedInstallation);
    assertStatus(await request('/products/' + product.id, { method: 'PATCH', body: {
      warranty_basis: 'delivery', warranty_guarantor: 'مركز التجربة', warranty_months: 2,
    } }), 200);
    const warranty = assertStatus(await request(physical), 200);
    assert.deepEqual(warranty.sales.map(s => [s.warranty_basis, s.warranty_guarantor, s.warranty_status]), [
      ['installation', 'الوكيل التجريبي', 'active'], ['sale', null, 'returned'],
    ]);
    assert.equal(warranty.events[0].proof_reference, 'INST-٤٥٦');
    const active = assertStatus(await request(resaleInvoice), 200).devices[0];
    assert.deepEqual([active.warranty_starts_on, active.warranty_expires_on, active.warranty_proof_reference],
      ['2026-02-04', '2036-02-04', 'INST-٤٥٦']);
    assert.equal((await returnOne(returnItem)).json.code, 'RETAIL_RETURN_INVOICE_CLOSED');
    assertStatus(await post('/invoices/' + resale.id + '/returns', {
      reason: 'defective after resale', items: [{ ...saleLine, disposition: 'quarantine' }],
    }), 201);
    const held = assertStatus(await request(physical), 200);
    assert.equal(held.status, 'quarantined');
    assert.deepEqual(held.returns.map(row => row.disposition), ['quarantine', 'resale']);
    assert.equal(held.sales[0].warranty_status, 'returned');
    assert.equal(await stock(), 0);
    assert.equal((await sell([saleLine])).json.code, 'RETAIL_DEVICE_UNAVAILABLE');
    const repair = assertStatus(await post('/maintenance', {
      customer_name: 'Inspection fixture', item: product.name, problem: 'display defect', retail_device_id: physicalId,
    }), 201);
    assert.equal(assertStatus(await request(physical), 200).repairs[0].id, repair.id);
    assert.equal('repairs' in assertStatus(await request(physical, { identity: 1 }), 200), false);
    const resolution = physical + '/quarantine-resolution';
    const inspection = { disposition: 'restock', reason: 'Repaired, inspected and sellable', return_id: held.returns[0].return_id };
    assertStatus(await post(resolution, inspection, { identity: 1 }), 403);
    assert.equal((await post(resolution, { ...inspection, return_id: held.returns[1].return_id })).json.code, 'RETAIL_QUARANTINE_STATE');
    const resolutionKey = randomUUID();
    const resolved = assertStatus(await post(resolution, inspection, { key: resolutionKey }), 201);
    const repeats = await Promise.all([post(resolution, inspection, { key: resolutionKey }), post(resolution, inspection)]);
    assert.deepEqual(assertStatus(repeats[0], 201), resolved);
    assertStatus(repeats[1], 409);
    assert.equal(await stock(), 1);
    const restored = assertStatus(await request(physical), 200);
    assert.equal(restored.status, 'available');
    assert.deepEqual(restored.quarantine_resolutions.map(record => record.return_id), [inspection.return_id]);
    const deliverySale = assertStatus(await sell([saleLine]), 201);
    const deliveryInvoice = '/invoices/' + deliverySale.id;
    assert.equal(assertStatus(await request(deliveryInvoice), 200).devices[0].warranty_status, 'pending');
    assertStatus(await post(physical + '/events', { kind: 'delivered', occurred_on: '2026-02-28', proof_reference: 'DL-٢' }), 201);
    const delivery = assertStatus(await request(deliveryInvoice), 200).devices[0];
    assert.deepEqual([delivery.warranty_basis, delivery.warranty_guarantor, delivery.warranty_starts_on, delivery.warranty_expires_on],
      ['delivery', 'مركز التجربة', '2026-02-28', '2026-04-28']);
    assert.equal(delivery.warranty_status, 'expired');
    const movements = assertStatus(await request('/inventory/movements?product_id=' + product.id), 200);
    assert.equal(movements.filter(row => row.quarantine_resolution_id === resolved.id && row.delta === 1).length, 1);

    const migrated = assertStatus(await post('/products', { name: 'Previously untracked unit', price_minor: 1000 }), 201);
    assertStatus(await post('/inventory/adjustments', { product_id: migrated.id, delta: 1, note: 'historical quantity fixture' }), 201);
    const oldInvoice = assertStatus(await post('/invoices', { items: [{ product_id: migrated.id, quantity: 1 }], paid_minor: 1000 }), 201);
    assert.equal((await request('/products/' + migrated.id, { method: 'PATCH', body: { tracking: 'serial' } })).json.code,
      'RETAIL_TRACKING_HAS_STOCK');
    const oldReturns = '/invoices/' + oldInvoice.id + '/returns';
    assert.equal(assertStatus(await request(oldReturns), 200).items[0].quarantine_only, 0);
    const oldLine = { product_id: migrated.id, quantity: 1 };
    assertStatus(await post(oldReturns, { reason: 'unidentified device', items: [{ ...oldLine, disposition: 'quarantine' }] }), 201);
    assert.equal(assertStatus(await request('/products/' + migrated.id), 200).stock, 0);
  });

  await t.test('priced purchase controls partial receiving, device cost and supplier liability credit', async () => {
    const product = assertStatus(await post('/products', { name: 'Tracked appliance costing', price_minor: 2000, tracking: 'serial' }), 201);
    const supplier = assertStatus(await post('/suppliers', { name: 'Priced order supplier' }), 201);
    const item = { product_id: product.id, quantity: 3, unit_cost_minor: 700, landed_unit_minor: 11 };
    const data = { supplier_id: supplier.id, description: 'Priced order', purchase_date: '2026-01-01', total_minor: 2100, items: [item] };
    assert.equal((await post('/purchases', { ...data, total_minor: 2101 })).json.code, 'PURCHASE_ORDER_TOTAL');
    const purchase = assertStatus(await post('/purchases', data), 201);
    const path = '/purchases/' + purchase.id;
    const order = async () => assertStatus(await request(path), 200);
    const delivery = (reference, serials) => post(path + '/receipts', { reference, items: [
      { product_id: product.id, quantity: serials.length, devices: serials.map(serial_number => ({ serial_number })) },
    ] });
    assert.equal((await order()).landed_cost_minor, 33);
    assertStatus(await delivery('DEL-1', ['AP-QA-01', 'AP-QA-02']), 201);
    assert.deepEqual([(await order()).items[0].received_quantity, (await order()).items[0].remaining_quantity], [2, 1]);
    assert.equal((await delivery('OVER-ORDER', ['AP-QA-03', 'AP-QA-04'])).json.code, 'PURCHASE_RECEIPT_ORDER_QUANTITY');
    assertStatus(await delivery('DEL-2', ['AP-QA-03']), 201);
    const devices = assertStatus(await request('/retail/devices?purchase_id=' + purchase.id + '&status=available'), 200);
    assert.equal(devices.length, 3);
    const sold = assertStatus(await post('/invoices', {
      items: [{ product_id: product.id, quantity: 1, device_ids: [devices[2].id] }], paid_minor: 2000,
    }), 201);
    assert.equal(assertStatus(await request('/invoices/' + sold.id), 200).devices[0].unit_cost_minor, 711);
    assertStatus(await post(path + '/payments', { amount_minor: 1200 }), 201);
    const returnPath = path + '/returns';
    const returnItem = device_ids => ({ product_id: product.id, quantity: device_ids.length, device_ids });
    const credit = (items, options = {}) => post(returnPath, { reason: 'Supplier accepted return', items }, options);
    assert.equal((await credit([returnItem([devices[2].id])])).json.code, 'SUPPLIER_RETURN_DEVICE');
    assert.equal((await credit([returnItem([devices[0].id, devices[1].id])])).json.code, 'SUPPLIER_RETURN_BALANCE');
    assert.equal((await order()).supplier_credit_minor, 0);
    const key = randomUUID();
    const first = assertStatus(await credit([returnItem([devices[0].id])], { key }), 201);
    assert.deepEqual(assertStatus(await credit([returnItem([devices[0].id])], { key }), 201), first);
    const history = assertStatus(await request(returnPath), 200);
    assert.equal(history[0].credit_minor, 700);
    assert.deepEqual(history[0].items[0].device_ids, [devices[0].id]);
    const net = await order();
    assert.deepEqual([net.gross_total_minor, net.net_total_minor, net.paid_minor, net.items[0].returned_quantity], [2100, 1400, 1200, 1]);
    assert.equal(assertStatus(await request('/suppliers/' + supplier.id), 200).balance_minor, 200);
    assertStatus(await post('/suppliers/' + supplier.id + '/payments', { amount_minor: 201 }), 409);
    assertStatus(await post('/suppliers/' + supplier.id + '/payments', { amount_minor: 200 }), 201);
    assert.equal(assertStatus(await request('/suppliers/' + supplier.id), 200).balance_minor, 0);
    assert.equal(assertStatus(await request('/products/' + product.id), 200).stock, 1);
    assert.equal(assertStatus(await request('/retail/devices/' + devices[0].id), 200).status, 'returned_to_supplier');
  });

  await t.test('quantity costs reconcile priced receipts, sales, returns, losses and authorized opening valuations', async () => {
    const product = assertStatus(await post('/products', { name: 'Quantity cost fixture', price_minor: 1000 }), 201);
    const productId = product.id;
    const supplier = assertStatus(await post('/suppliers', { name: 'Quantity cost supplier' }), 201);
    const costPath = '/retail/quantity-costs/' + productId;
    const valuation = async () => assertStatus(await request(costPath), 200);
    const movements = async () => assertStatus(await request(costPath + '/movements'), 200);
    const verify = async (stock, amount) => {
      const current = await valuation();
      assert.deepEqual([current.stock, current.inventory_value_minor], [stock, amount]);
    };
    const createReceipt = async (reference, quantity, unitCost, landedCost = 0) => {
      const items = unitCost === null ? undefined : [{
        product_id: productId, quantity, unit_cost_minor: unitCost, landed_unit_minor: landedCost,
      }];
      const purchase = assertStatus(await post('/purchases', { supplier_id: supplier.id, description: reference,
        purchase_date: '2026-01-01', total_minor: unitCost === null ? 999 : unitCost * quantity, items }), 201);
      const receiptPath = '/purchases/' + purchase.id + '/receipts';
      const receipt = assertStatus(await post(receiptPath, { reference, items: [{ product_id: productId, quantity }] }), 201);
      return { purchase, reversePath: receiptPath + '/' + receipt.id + '/reverse' };
    };
    const sale = async quantity => assertStatus(await post('/invoices', {
      items: [{ product_id: productId, quantity }], paid_minor: quantity * 1000,
    }), 201);
    const returnLine = async (invoiceId, disposition) => assertStatus(await post('/invoices/' + invoiceId + '/returns', {
      reason: 'quantity cost return', items: [{ product_id: productId, quantity: 1, disposition }],
    }), 201);
    await verify(0, 0);
    await createReceipt('Landed A', 2, 23, 10);
    await createReceipt('Landed B', 1, 30, 5);
    await verify(3, 101);
    const sold = await sale(3);
    assert.equal((await movements()).find(row => row.source_type === 'invoice' && row.source_id === sold.id).cost_delta_minor, -101);
    await verify(0, 0);
    const resaleA = await returnLine(sold.id, 'resale');
    await verify(1, 33);
    await returnLine(sold.id, 'quarantine');
    await verify(1, 33);
    const resaleB = await returnLine(sold.id, 'resale');
    await verify(2, 67);
    const refunds = (await movements()).filter(row => row.source_type === 'refund' && [resaleA.id, resaleB.id].includes(row.source_id));
    assert.deepEqual(refunds.map(row => row.cost_delta_minor), [34, 33]);

    const one = await sale(1);
    await verify(1, 34);
    assertStatus(await post('/invoices/' + one.id + '/refund', { reason: 'legacy full refund' }), 201);
    await verify(2, 67);
    const loss = assertStatus(await post('/damaged', { product_id: productId, quantity: 2, reason: 'damage quantity pool' }), 201);
    await verify(0, 0);
    assertStatus(await post('/damaged/' + loss.id + '/correct', { quantity: 1, reason: 'one unit recovered' }), 201);
    await verify(1, 33);
    assert.equal(assertStatus(await request('/damaged/' + loss.id), 200).verified_inventory_loss_minor, 34);
    assertStatus(await post('/damaged/' + loss.id + '/reverse', { reason: 'restored remaining known loss' }), 201);
    await verify(2, 67);

    const immediate = await createReceipt('Reverse exact', 2, 22);
    await verify(4, 111);
    assertStatus(await post(immediate.reversePath, { reason: 'cancel untouched receipt' }), 201);
    await verify(2, 67);
    const returned = await createReceipt('Supplier return', 2, 11);
    await verify(4, 89);
    assertStatus(await post('/purchases/' + returned.purchase.id + '/returns', {
      reason: 'supplier return', items: [{ product_id: productId, quantity: 1 }],
    }), 201);
    await verify(3, 67);
    const unpriced = await createReceipt('No proven price', 1, null);
    await verify(4, null);
    assertStatus(await post(unpriced.reversePath, { reason: 'unpriced receipt reversed' }), 201);
    await verify(3, null);
    const pending = await valuation();
    const value = { expected_stock: pending.stock, expected_movement_id: pending.last_movement_id,
      value_minor: 801, reason: 'authorized opening valuation after physical count' };
    assertStatus(await request(costPath, { identity: 1 }), 403);
    assertStatus(await post(costPath + '/opening', value, { identity: 1 }), 403);
    assert.equal((await post(costPath + '/opening', { ...value, expected_movement_id: 0 })).json.code, 'RETAIL_OPENING_VALUE_STALE');
    const key = randomUUID();
    const opened = assertStatus(await post(costPath + '/opening', value, { key }), 201);
    assert.deepEqual(assertStatus(await post(costPath + '/opening', value, { key }), 201), opened);
    await verify(3, 801);
    assert.equal((await post(costPath + '/opening', value)).json.code, 'RETAIL_OPENING_VALUE_STALE');
    assertStatus(await post('/inventory/adjustments', { product_id: productId, delta: -1, note: 'known shrinkage' }), 201);
    await verify(2, 534);
    assertStatus(await post('/inventory/adjustments', { product_id: productId, delta: 1, note: 'unpriced adjustment' }), 201);
    await verify(3, null);
    await createReceipt('Priced does not prove old stock', 1, 9);
    await verify(4, null);
    const unknownSale = await sale(4);
    assert.equal((await movements()).find(row => row.source_id === unknownSale.id).cost_delta_minor, null);
    await verify(0, 0);
    await createReceipt('Known after depletion', 2, 20);
    await verify(2, 40);
    const ambiguous = await createReceipt('Prior receipt later corrected', 1, 80);
    await createReceipt('Later priced receipt', 1, 30);
    await verify(4, 150);
    assertStatus(await post(ambiguous.reversePath, { reason: 'historical receipt correction after later movement' }), 201);
    await verify(3, null);
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

  await t.test('line returns credit linked debt, pay only the remainder and isolate unsellable stock', async () => {
    const product = assertStatus(await post('/products', { name: 'Partial return fixture', price_minor: 2000 }), 201);
    const stock = async () => assertStatus(await request('/products/' + product.id), 200).stock;
    assertStatus(await post('/inventory/adjustments', { product_id: product.id, delta: 3, note: 'return fixture' }), 201);
    const shift = assertStatus(await post('/retail/shifts', { register_name: 'Partial returns counter', opening_minor: 1000 }), 201);
    const invoice = assertStatus(await post('/invoices', {
      customer_id: 1, items: [{ product_id: product.id, quantity: 3 }], paid_minor: 1500,
      shift_id: shift.id, payments: [{ method: 'cash', amount_minor: 1500 }],
    }), 201);
    const url = '/invoices/' + invoice.id;
    const returns = url + '/returns';
    const installment = assertStatus(await post('/installments', {
      customer_id: 1, invoice_id: invoice.id, principal_minor: 4500, due_date: '2099-01-01',
    }), 201);
    const installmentUrl = '/installments/' + installment.id;
    assertStatus(await post(installmentUrl + '/payments', { amount_minor: 1000,
      shift_id: shift.id, payments: [{ method: 'cash', amount_minor: 1000 }],
    }), 201);
    assert.equal(await stock(), 0);
    assertStatus(await request(returns, { identity: 1 }), 403);
    const first = { reason: 'sealed item', items: [{ product_id: product.id, quantity: 1, disposition: 'resale' }] };
    assertStatus(await post(returns, first, { identity: 1 }), 403);
    const key = randomUUID();
    const replay = await Promise.all([post(returns, first, { key }), post(returns, first, { key })]);
    const initial = assertStatus(replay[0], 201);
    assert.deepEqual(assertStatus(replay[1], 201), initial);
    assert.equal(initial.total_minor, 2000);
    assert.equal(initial.debt_reduction_minor, 2000);
    assert.equal(initial.returned_minor, 0);
    assert.equal(await stock(), 1);
    const mobileSold = assertStatus(await request('/sales', { android: true }), 200).find(row => row.id === product.id);
    assert.equal(mobileSold.sold_quantity, 2);
    const details = assertStatus(await request(url), 200);
    assert.deepEqual([details.total_minor, details.paid_minor, details.outstanding_minor, details.gross_total_minor], [4000, 2500, 1500, 6000]);
    const schedule = assertStatus(await request(installmentUrl), 200);
    assert.deepEqual([schedule.principal_minor, schedule.paid_minor, schedule.retail_credit_minor], [2500, 1000, 2000]);
    assert.equal(assertStatus(await request(url, { android: true }), 200).remaining_amount, '15.00');
    const ledger = assertStatus(await request('/customers/1/ledger'), 200);
    assert.equal(ledger.entries.find(row => row.kind === 'installment' && row.record_id === installment.id).remaining_minor, 1500);
    assert.equal((await post(url + '/refund', { reason: 'legacy path' })).json.code, 'RETAIL_RETURN_USE_ITEMS');

    const second = { reason: 'opened and defective', items: [{ product_id: product.id, quantity: 1, disposition: 'quarantine' }] };
    assert.equal((await post(returns, { ...second, expected_returned_minor: 0 })).json.code, 'RETAIL_RETURN_PAYOUT_CHANGED');
    assert.equal((await post(returns, second)).json.code, 'RETAIL_SHIFT_REQUIRED');
    assert.equal((await post(returns, { ...second, shift_id: shift.id, payments: [{ method: 'card', amount_minor: 500 }] })).json.code,
      'RETAIL_REFUND_METHOD_LIMIT');
    assert.equal(assertStatus(await request(returns), 200).items[0].returned_quantity, 1);
    assertStatus(await post(installmentUrl + '/payments', { amount_minor: 1501 }), 409);
    const next = assertStatus(await post(returns, { ...second, shift_id: shift.id, payments: [{ method: 'cash', amount_minor: 500 }] }), 201);
    assert.equal(next.debt_reduction_minor, 1500);
    assert.equal(next.returned_minor, 500);
    assert.equal(await stock(), 1);
    assert.equal(assertStatus(await request(installmentUrl), 200).status, 'paid');
    assert.equal(assertStatus(await request(installmentUrl, { android: true }), 200).remaining, '0.00');

    const remaining = { ...first, shift_id: shift.id, payments: [{ method: 'cash', amount_minor: 2000 }] };
    const competed = await Promise.all([post(returns, remaining), post(returns, remaining)]);
    assert.deepEqual(competed.map(result => result.status).sort(), [201, 409]);
    assert.equal(await stock(), 2);
    const final = assertStatus(await request(returns), 200);
    assert.deepEqual([final.paid_minor, final.outstanding_minor, final.status, final.items[0].refundable_quantity], [0, 0, 'refunded', 0]);
    assert.equal(final.returns.length, 3);
    assert.equal(assertStatus(await request('/retail/shifts/' + shift.id), 200).expected_minor, 1000);
    assertStatus(await post(`/retail/shifts/${shift.id}/close`, { expected_minor: 1000, observed_minor: 1000 }), 201);
  });

  await t.test('blind stock count posts once after independent approval and rejects stale counts', async () => {
    const product = assertStatus(await post('/products', { name: 'Blind counted fixture', price_minor: 2000, barcode: 'BLIND-001' }), 201);
    const tracked = assertStatus(await post('/products', { name: 'Blind tracked fixture', price_minor: 2000, tracking: 'serial' }), 201);
    const paths = { counts: '/retail/stocktakes', lookup: '/retail/stocktake-products' };
    const counter = { identity: 4 };
    const adjust = delta => post('/inventory/adjustments', { product_id: product.id, delta, note: 'fixture count' });
    const read = async () => assertStatus(await request('/products/' + product.id), 200).stock;
    const record = (observed, id = product.id, options = counter) => post(paths.counts, { product_id: id, observed_quantity: observed }, options);
    const approve = (id, options) => post(`${paths.counts}/${id}/approve`, { reason: 'confirmed after review' }, options);
    assertStatus(await adjust(5), 201);
    const lookup = assertStatus(await request(paths.lookup + '?q=BLIND-001', counter), 200);
    assert.deepEqual(lookup, [{ id: product.id, name: 'Blind counted fixture', barcode: 'BLIND-001', tracking: 'quantity' }]);
    assertStatus(await request('/products/' + product.id, counter), 403);
    assertStatus(await request(paths.counts, { identity: 1 }), 403);
    const stale = assertStatus(await record(4), 201);
    assert.equal(stale.status, 'pending_approval');
    assert.equal(await read(), 5);
    assertStatus(await approve(stale.id, counter), 403);
    assertStatus(await adjust(1), 201);
    assertStatus(await adjust(-1), 201);
    assert.equal(await read(), 5);
    assert.equal((await approve(stale.id)).json.code, 'RETAIL_STOCKTAKE_STALE');
    assert.equal(assertStatus(await request(paths.counts + '?status=stale', counter), 200)[0].id, stale.id);

    const own = assertStatus(await record(4, product.id, {}), 201);
    assert.equal((await approve(own.id)).json.code, 'RETAIL_STOCKTAKE_SEPARATION');
    assert.ok(!assertStatus(await request(paths.counts, counter), 200).some(row => row.id === own.id));
    const approved = assertStatus(await record(4), 201);
    const key = randomUUID();
    const replays = await Promise.all([approve(approved.id, { key }), approve(approved.id, { key })]);
    const done = assertStatus(replays[0], 201);
    assert.deepEqual(assertStatus(replays[1], 201), done);
    assert.equal(done.status, 'approved');
    assert.equal(done.difference_quantity, -1);
    assert.equal(await read(), 4);
    const movements = assertStatus(await request('/inventory/movements?product_id=' + product.id), 200);
    assert.equal(movements.filter(row => row.note.startsWith('فرق جرد #' + approved.id)).length, 1);
    assert.equal(assertStatus(await record(4), 201).status, 'matched');
    const report = assertStatus(await record(1, tracked.id), 201);
    assert.equal(report.status, 'report_only');
    assert.equal((await approve(report.id)).json.code, 'RETAIL_STOCKTAKE_NOT_PENDING');
    assert.equal(assertStatus(await request('/products/' + tracked.id), 200).stock, 0);
  });

  await t.test('exchange links one later replacement to the same customer without posting money again', async () => {
    const product = assertStatus(await post('/products', { name: 'Exchange original', price_minor: 2000 }), 201);
    const upgrade = assertStatus(await post('/products', { name: 'Exchange replacement', price_minor: 2600 }), 201);
    for (const item of [product, upgrade]) assertStatus(await post('/inventory/adjustments', {
      product_id: item.id, delta: 4, note: 'exchange fixture',
    }), 201);
    const shift = assertStatus(await post('/retail/shifts', { register_name: 'Exchange register', opening_minor: 1000 }), 201);
    const shiftUrl = '/retail/shifts/' + shift.id;
    const sale = async (item, customer_id) => assertStatus(await post('/invoices', {
      customer_id, items: [{ product_id: item.id, quantity: 1 }], paid_minor: item === product ? 2000 : 2600,
      shift_id: shift.id, payments: [{ method: 'cash', amount_minor: item === product ? 2000 : 2600 }],
    }), 201);
    const returnSale = async invoice => assertStatus(await post(`/invoices/${invoice.id}/returns`, {
      reason: 'customer exchange', items: [{ product_id: product.id, quantity: 1, disposition: 'resale' }],
      shift_id: shift.id, payments: [{ method: 'cash', amount_minor: 2000 }],
    }), 201);
    const original = await sale(product, 1);
    const tooEarly = await sale(upgrade, 1);
    const returned = await returnSale(original);
    const returns = `/invoices/${original.id}/returns`;
    const link = `${returns}/${returned.id}/exchange`;
    assert.equal((await post(link, { replacement_invoice_id: tooEarly.id, reason: 'too early' })).json.code,
      'RETAIL_EXCHANGE_REPLACEMENT');
    const stranger = await sale(upgrade, null);
    assert.equal((await post(link, { replacement_invoice_id: stranger.id, reason: 'different customer', confirm_walk_in: true })).json.code,
      'RETAIL_EXCHANGE_CUSTOMER');
    const replacement = await sale(upgrade, 1);
    const moneyBefore = assertStatus(await request(shiftUrl), 200);
    const body = { replacement_invoice_id: replacement.id, reason: 'upgrade to newer model' };
    const key = randomUUID();
    const results = await Promise.all([post(link, body, { key }), post(link, body, { key })]);
    const exchange = assertStatus(results[0], 201);
    assert.deepEqual(assertStatus(results[1], 201), exchange);
    assert.deepEqual([exchange.return_id, exchange.replacement_total_minor, exchange.difference_minor], [returned.id, 2600, 600]);
    assert.equal((await post(link, body)).json.code, 'RETAIL_EXCHANGE_ALREADY_LINKED');
    const history = assertStatus(await request(returns), 200).returns[0].exchange;
    assert.equal(history.replacement_invoice_id, replacement.id);
    assert.equal(history.difference_minor, 600);
    assert.deepEqual(assertStatus(await request(shiftUrl), 200), moneyBefore);

    const walkIn = await sale(product, null);
    const walkInReturn = await returnSale(walkIn);
    const walkInReplacement = await sale(upgrade, null);
    const walkInLink = `/invoices/${walkIn.id}/returns/${walkInReturn.id}/exchange`;
    const walkInBody = { replacement_invoice_id: walkInReplacement.id, reason: 'receipt confirmed in person' };
    assert.equal((await post(walkInLink, walkInBody)).json.code, 'RETAIL_EXCHANGE_CUSTOMER');
    assertStatus(await post(walkInLink, { ...walkInBody, confirm_walk_in: true }), 201);
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

test('accountant export separates cash movements from documents and requires its own permission', async t => {
  const request = await worker(t);
  const post = (path, body) => request(path, { method: 'POST', body });
  const shift = assertStatus(await post('/retail/shifts', { register_name: 'Accountant fixture', opening_minor: 10000 }), 201);
  assertStatus(await post(`/retail/shifts/${shift.id}/cash-movements`, {
    kind: 'general_expense', amount_minor: 1200, reason: 'fixture expense', reference: '=TEST-EXPENSE',
  }), 201);
  const denied = await request('/retail/accountant.csv', { identity: 1 });
  assertStatus(denied, 403);
  assertStatus(await request('/retail/audit', { identity: 1 }), 403);
  const exported = await request('/retail/accountant.csv');
  assert.equal(exported.status, 200, JSON.stringify(exported.json));
  const rows = parse(exported.csv, { bom: true, columns: true });
  assert.deepEqual(rows.map(row => [row.record_type, row.amount_egp]).sort(), [['manual_drawer', '-12.00'], ['shift_open', '100.00']]);
  assert.equal(rows.find(row => row.record_type === 'manual_drawer').reference, "'=TEST-EXPENSE");
  assert.ok(assertStatus(await request('/retail/audit?q=retail.'), 200).some(row => row.action.includes('cash')));
});

test('shared drawer counts maintenance and wallet cash once and preserves the wallet provider ledger', async t => {
  const request = await worker(t);
  const post = (path, body, options = {}) => request(path, { method: 'POST', body, ...options });
  const shift = assertStatus(await post('/retail/shifts', { register_name: 'Shared drawer test', opening_minor: 10000 }), 201);
  const wallet = assertStatus(await post('/wallets', { name: 'Shared drawer test', opening_minor: 50000 }), 201);
  const repair = assertStatus(await post('/maintenance', { customer_name: 'Synthetic repair', item: 'Synthetic device', problem: 'Synthetic fault', price_minor: 15000 }), 201);
  const shiftPath = '/retail/shifts/' + shift.id;
  const walletPath = '/wallets/' + wallet.id + '/transactions';
  const maintenancePath = '/maintenance/' + repair.id + '/payments';
  const mobileSale = assertStatus(await post('/retail/checkout', { items: [{ product_id: 1, quantity: 1 }], paid_minor: 2500,
    expected_total_minor: 2500, shift_id: shift.id, payments: [{ method: 'card', amount_minor: 2500, reference: 'Android fixture' }] }, { android: true }), 409);
  assert.equal(mobileSale, undefined);
  assertStatus(await post('/inventory/adjustments', { product_id: 1, delta: 1, note: 'Android fixture stock' }), 201);
  const invoice = assertStatus(await post('/retail/checkout', { items: [{ product_id: 1, quantity: 1 }], paid_minor: 2500,
    expected_total_minor: 2500, shift_id: shift.id, payments: [{ method: 'card', amount_minor: 2500, reference: 'Android fixture' }] }, { android: true }), 201);
  assert.deepEqual({ total: invoice.total_minor, paid: invoice.paid_minor, number: invoice.invoice_number },
    { total: 2500, paid: 2500, number: String(invoice.id) });
  const cashTransfer = { kind: 'send', amount_minor: 5000, commission_minor: 100, fee_minor: 50, shared_shift_id: shift.id };
  const key = randomUUID();
  const move = assertStatus(await post(walletPath, cashTransfer, { key }), 201);
  assert.deepEqual(assertStatus(await post(walletPath, cashTransfer, { key }), 201), move);
  assertStatus(await post(maintenancePath, { amount_minor: 2500, shared_shift_id: shift.id }), 201);
  assertStatus(await post(maintenancePath, { amount_minor: 1500 }), 201);
  assertStatus(await post(walletPath, { kind: 'send', amount_minor: 1000, commission_minor: 0, fee_minor: 0 }), 201);
  assert.equal(assertStatus(await request(shiftPath), 200).expected_minor, 17600);
  const report = assertStatus(await request('/reports/wallets'), 200);
  assert.equal(report.drawer_minor, 1000);
  assert.equal(report.shared_drawer_minor, 5100);
  assert.equal(assertStatus(await request('/wallets'), 200).find(row => row.id === wallet.id).balance_minor, 43950);
  assertStatus(await post('/wallet-transactions/' + move.id + '/reverse', { reason: 'must attribute the same cash' }), 409);
  assertStatus(await post(walletPath, { kind: 'receive', amount_minor: 18000, shared_shift_id: shift.id }), 409);
  assertStatus(await post('/wallet-transactions/' + move.id + '/reverse', { reason: 'shared reversal', shared_shift_id: shift.id }), 201);
  assert.equal(assertStatus(await request(shiftPath), 200).expected_minor, 12500);
  assert.equal(assertStatus(await request('/reports/wallets'), 200).shared_drawer_minor, 0);
  assertStatus(await post(shiftPath + '/close', { observed_minor: 12500, expected_minor: 12500 }), 201);
  assertStatus(await post(maintenancePath, { amount_minor: 1000, shared_shift_id: shift.id }), 409);
  assert.equal(assertStatus(await request('/maintenance/' + repair.id), 200).paid_minor, 4000);
});
