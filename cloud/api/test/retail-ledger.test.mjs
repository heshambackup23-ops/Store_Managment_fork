import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

test('posts operating sources once, reviews unknown payments and cost, and freezes closed Cairo periods', async t => {
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
    INSERT INTO roles(id, name) VALUES (2, 'Fixture ledger reader');
    INSERT INTO role_permissions(role_id, permission) VALUES (2, 'retail.ledger.view');
    INSERT INTO users(id, name, email, password_hash, role_id) VALUES
      (1, 'Fixture owner', 'ledger-owner@example.invalid', 'unused', 1),
      (2, 'Fixture viewer', 'ledger-reader@example.invalid', 'unused', 2);
  `);
  const tokens = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')];
  await db.batch(tokens.map((token, index) => db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), index + 1, Math.floor(Date.now() / 1000) + 300)));

  async function call(path, input, { status = input ? 201 : 200, user = 1, key = randomUUID(), code } = {}) {
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method: input ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + tokens[user - 1], 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: input ? JSON.stringify(input) : undefined,
    });
    const payload = await response.json();
    assert.equal(response.status, status, path + ' ' + JSON.stringify(payload));
    if (code) assert.equal(payload.code, code, path);
    return payload.data;
  }

  const { today } = await call('/retail/ledger', undefined, { user: 2 });
  const now = today.slice(0, 7);
  const previous = new Date(now + '-01T00:00:00Z');
  previous.setUTCDate(0);
  const historicDay = previous.toISOString().slice(0, 10);
  const historic = historicDay.slice(0, 7);
  // In Cairo 22:30 UTC on the preceding date is already the first day of the month.
  const preceding = new Date(historic + '-01T00:00:00Z');
  preceding.setUTCDate(0);
  const utcBoundary = preceding.toISOString().slice(0, 10) + 'T22:30:00Z';
  const operating = '/retail/ledger/operating';
  const practice = '/retail/ledger/practice';
  const path = `${operating}/periods/${historic}`;
  const practicePeriod = `${practice}/periods/${historic}`;
  const start = { first_period: historic, reason: 'Fixture reviewed opening month' };
  await call(operating + '/start', start, { user: 2, status: 403, code: 'forbidden' });
  await call(operating + '/start', start);
  await call(practice + '/start', start);

  // A true source from an earlier period with neither a recorded tender nor a verified stock cost.
  await db.batch([
    db.prepare(`INSERT INTO products(id,name,price_minor,tracking) VALUES (500,'Historic fixture',700,'quantity')`),
    db.prepare(`INSERT INTO inventory_movements(product_id,delta,source_type,source_id,actor_id,created_at) VALUES (500,1,'import',500,1,?)`).bind(utcBoundary),
    db.prepare(`INSERT INTO invoices(id,total_minor,paid_minor,actor_id,created_at) VALUES (500,700,700,1,?)`).bind(utcBoundary),
    db.prepare(`INSERT INTO invoice_items(invoice_id,product_id,product_name,quantity,unit_price_minor,unit_cost_minor) VALUES (500,500,'Historic fixture',1,700,0)`),
    db.prepare(`INSERT INTO invoice_payments(id,invoice_id,amount_minor,source_type,actor_id,created_at) VALUES (500,500,700,'checkout',1,?)`).bind(utcBoundary),
  ]);
  const close = { reason: 'Reviewed statements and counted balances' };
  await call(path + '/close', close, { status: 409, code: 'LEDGER_CLOSE_PENDING' });
  const key = randomUUID();
  const posted = await call(path + '/sync', {}, { key });
  assert.equal(posted.reviewed, 3);
  assert.equal((await call(path + '/sync', {}, { key })).id, posted.id);
  assert.equal((await call(path + '/sync', {})).reviewed, 0);
  const [historicEntry] = await call(path + '/entries');
  assert.equal(historicEntry.posting_day, historic + '-01');
  await call(path + '/close', close, { status: 409, code: 'LEDGER_CLOSE_ISSUES' });
  const issues = await call(path + '/issues');
  assert.deepEqual(issues.map(row => row.issue).sort(), ['cost_unknown', 'payment_unknown']);
  const ledgerLine = (account, debit_minor, credit_minor) => ({ account, debit_minor, credit_minor });
  await call(path + '/issues/resolve', { source: 'invoice_payment', source_ref: '500', code: 'payment_unknown', reason: 'Historic cash receipt 500',
    lines: [ledgerLine('1000', 699, 0), ledgerLine('1090', 0, 699)] }, { status: 409, code: 'LEDGER_INVALID_RESOLUTION' });
  await call(path + '/issues/resolve', { source: 'invoice_payment', source_ref: '500', code: 'payment_unknown', reason: 'Historic cash receipt 500',
    lines: [ledgerLine('1000', 700, 0), ledgerLine('1090', 0, 700)] });
  await call(path + '/issues/resolve', { source: 'sale_cost', source_ref: '500', code: 'cost_unknown', reason: 'Historic supplier record fixes cost at 3 EGP',
    lines: [ledgerLine('5000', 300, 0), ledgerLine('1200', 0, 300)] });
  const attempt = randomUUID();
  const closed = await call(path + '/close', close, { key: attempt });
  assert.equal((await call(path + '/close', close, { key: attempt })).id, closed.id);
  const operatingClosed = await call(path);
  assert.equal(operatingClosed.status, 'closed');
  assert.equal(operatingClosed.entry_count, 4);
  assert.equal(operatingClosed.trial_balance.find(row => row.code === '1090').closing_minor, '0');
  assert.equal(operatingClosed.trial_balance.find(row => row.code === '5000').closing_minor, '300');
  assert.equal(operatingClosed.trial_balance.find(row => row.code === '1000').closing_minor, '700');
  await call(path + '/sync', {}, { status: 409, code: 'LEDGER_PERIOD_CLOSED' });

  const manual = { posting_day: historicDay, description: 'Fixture counted practice opening cash',
    lines: [ledgerLine('1000', 1000, 0), ledgerLine('3000', 0, 1000)] };
  await call(practice + '/entries', { ...manual, lines: [manual.lines[0], ledgerLine('3000', 0, 500)] }, { status: 422, code: 'LEDGER_UNBALANCED' });
  await call(practice + '/entries', manual);
  const [entry] = await call(practicePeriod + '/entries');
  await call(practicePeriod + '/close', close);
  await call(practice + '/entries', manual, { status: 409, code: 'LEDGER_PERIOD_CLOSED' });
  await call(practice + `/entries/${entry.id}/reverse`, { posting_day: today, description: 'Reverse fixture in next open month' });
  const closedBalance = await call(practicePeriod);
  assert.equal(closedBalance.trial_balance.find(row => row.code === '1000').closing_minor, '1000');
  assert.equal((await call(`${practice}/periods/${now}`)).trial_balance.find(row => row.code === '1000').closing_minor, '0');
  await call(`${practice}/periods/${now}/close`, close, { status: 422, code: 'LEDGER_MONTH_IN_PROGRESS' });

  const supplier = await call('/suppliers', { name: 'Ledger fixture supplier' });
  const stock = await call('/products', { name: 'Ledger fixture accessories', price_minor: 700 });
  const purchase = await call('/purchases', { supplier_id: supplier.id, description: 'Four priced pieces', total_minor: 1200,
    purchase_date: today, items: [{ product_id: stock.id, quantity: 4, unit_cost_minor: 300 }] });
  await call(`/purchases/${purchase.id}/receipts`, { reference: 'LEDGER-RECEIPT', items: [{ product_id: stock.id, quantity: 4 }] });
  const shift = await call('/retail/shifts', { register_name: 'Fixture GL drawer', opening_minor: 1000 });
  const cash = amount_minor => ({ method: 'cash', amount_minor });
  const invoice = await call('/retail/checkout', { shift_id: shift.id, invoice_date: historicDay, paid_minor: 1400,
    expected_total_minor: 1400, payments: [cash(700), { method: 'card', amount_minor: 700, reference: 'LEDGER-CARD' }],
    items: [{ product_id: stock.id, quantity: 2 }] });
  await call(`/invoices/${invoice.id}/returns`, { shift_id: shift.id, reason: 'Ledger fixture partial return',
    expected_returned_minor: 700, payments: [cash(700)], items: [{ product_id: stock.id, quantity: 1, disposition: 'resale' }] });
  await call(`/purchases/${purchase.id}/payments`, { shift_id: shift.id, amount_minor: 200, payments: [cash(200)] });
  const current = `${operating}/periods/${now}`;
  assert.ok((await call(current + '/sync', {})).reviewed >= 9);
  const currentReport = await call(current);
  assert.equal(currentReport.pending, 0);
  assert.equal(currentReport.unresolved, 0);
  const movement = code => currentReport.trial_balance.find(row => row.code === code);
  assert.deepEqual([movement('4000').credit_minor, movement('4010').debit_minor, movement('5000').debit_minor,
    movement('5000').credit_minor, movement('1200').debit_minor, movement('1200').credit_minor, movement('2000').closing_minor,
    movement('1040').debit_minor], ['1400', '700', '600', '300', '1500', '600', '-1000', '700']);
  assert.equal((await call(path)).entry_count, 4, 'backdated document label does not rewrite a closed period');
  await assert.rejects(db.prepare('UPDATE retail_ledger_entries SET description = ? WHERE id = ?').bind('tamper', entry.id).run(), /IMMUTABLE_LEDGER/);
});
