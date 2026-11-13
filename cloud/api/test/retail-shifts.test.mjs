import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

test('retail tenders and shifts reconcile cash, guard the register and preserve legacy receipts', async t => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-01-01', d1Databases: ['DB'] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const execute = sql => db.batch(unstable_splitSqlQuery(sql).map(command => db.prepare(command)));
  const migrations = new URL('../migrations/', import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    await execute(readFileSync(new URL(name, migrations), 'utf8'));
  }
  await execute(`
    INSERT INTO roles(id,name) VALUES (2,'cashier'), (3,'viewer'), (4,'emergency-only');
    INSERT INTO role_permissions(role_id,permission) VALUES (2,'retail.shifts.operate'), (2,'retail.shifts.approve'),
      (2,'invoices.create'), (2,'invoices.view'), (2,'invoices.pay'), (2,'invoices.refund'),
      (2,'suppliers.pay'), (2,'suppliers.manage'), (2,'installments.manage'), (2,'installments.pay'),
      (2,'reports.view'), (3,'products.view'), (4,'retail.shifts.emergency_close');
    INSERT INTO users(id,name,email,password_hash,role_id) VALUES (1,'Supervisor','admin@example.invalid','unused',1),
      (2,'Cashier A','cashier-a@example.invalid','unused',2), (3,'Cashier B','cashier-b@example.invalid','unused',2),
      (4,'Reader','reader@example.invalid','unused',3), (5,'Duty manager','duty-manager@example.invalid','unused',4);
    INSERT INTO products(id,name,price_minor,stock) VALUES (1,'Mobile accessory',1000,15);
    INSERT INTO customers(id,name) VALUES (1,'Demo customer');
    INSERT INTO suppliers(id,name,opening_minor) VALUES (1,'Demo supplier',5000);
  `);
  const tokens = Array.from({ length: 5 }, () => randomBytes(32).toString('base64url'));
  await db.batch(tokens.map((token, i) => db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), i + 1, Math.floor(Date.now() / 1000) + 300)));

  async function call(path, { user = 2, input, key = randomUUID(), method = input ? 'POST' : 'GET', android = false } = {}) {
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method, headers: { Authorization: 'Bearer ' + tokens[user - 1], 'Content-Type': 'application/json', 'Idempotency-Key': key,
        ...(android ? { 'X-Store-Client': 'android' } : {}) },
      body: input ? JSON.stringify(input) : undefined,
    });
    return { status: response.status, json: await response.json() };
  }
  function expect({ status, json }, required, code) {
    assert.equal(status, required, JSON.stringify(json));
    if (code) assert.equal(json.code, code);
    return json.data;
  }
  const cash = amount_minor => ({ method: 'cash', amount_minor });
  const card = amount_minor => ({ method: 'card', amount_minor, reference: 'SYNTHETIC-REF' });
  const sale = { items: [{ product_id: 1, quantity: 1 }], customer_id: 1, paid_minor: 1000 };
  const shifts = '/retail/shifts';

  expect(await call(shifts, { user: 4 }), 403);
  expect(await call('/invoices', { input: sale }), 201);
  const key = randomUUID();
  const input = { register_name: 'Front Desk', opening_minor: 400 };
  const opened = await Promise.all([call(shifts, { input, key }), call(shifts, { input, key })]);
  const shift = expect(opened[0], 201);
  assert.equal(expect(opened[1], 201).id, shift.id);
  assert.equal(shift.expected_minor, 400);
  assert.equal(shift.status, 'open');
  expect(await call(shifts, { user: 3, input: { ...input, register_name: 'front desk' } }), 409, 'RETAIL_SHIFT_ALREADY_OPEN');
  expect(await call(shifts, { input: { ...input, register_name: 'Back Desk' } }), 409, 'RETAIL_SHIFT_ALREADY_OPEN');
  const href = shifts + '/' + shift.id;
  expect(await call('/retail/settings', { method: 'PATCH', input: { require_shift: true } }), 403);
  expect(await call('/retail/settings', { method: 'PATCH', user: 1, input: { require_shift: true } }), 200);
  expect(await call('/invoices', { input: sale }), 409, 'RETAIL_SHIFT_REQUIRED');
  const withShift = (payments, data = {}) => ({ ...data, shift_id: shift.id, payments });
  expect(await call('/invoices', { user: 3, input: withShift([cash(1000)], sale) }), 409, 'RETAIL_SHIFT_UNAVAILABLE');
  expect(await call('/invoices', { input: withShift([cash(500)], sale) }), 422, 'RETAIL_TENDER_TOTAL_MISMATCH');
  const saleKey = randomUUID();
  const mixedInput = withShift([cash(600), card(400)], sale);
  const mixed = expect(await call('/invoices', { input: mixedInput, key: saleKey }), 201);
  assert.equal(expect(await call('/invoices', { input: mixedInput, key: saleKey }), 201).id, mixed.id);
  const invoice = expect(await call('/invoices/' + mixed.id), 200);
  assert.deepEqual(invoice.tenders.map(({ method, amount_minor }) => [method, amount_minor]), [['cash', 600], ['card', 400]]);

  const refundPath = '/invoices/' + mixed.id + '/refund';
  expect(await call(refundPath, { input: { reason: 'Test return' } }), 409, 'RETAIL_SHIFT_REQUIRED');
  expect(await call(refundPath, { input: {}, android: true }), 409, 'RETAIL_SHIFT_REQUIRED');
  expect(await call(refundPath, { input: withShift([cash(1000)], { reason: 'Test return' }) }), 422, 'RETAIL_REFUND_METHOD_LIMIT');
  expect(await call(refundPath, { input: withShift([cash(600), card(400)], { reason: 'Test return' }) }), 201);

  expect(await call('/invoices', { input: { ...sale, paid_minor: 0, invoice_date: '2026-11-13', due_date: '2026-11-12' } }), 422, 'RETAIL_DUE_DATE');
  const credit = expect(await call('/invoices', { input: { ...sale, paid_minor: 0, due_date: shift.business_day } }), 201);
  expect(await call('/invoices/' + credit.id + '/pay', { input: { amount: '3.00' }, android: true }), 409, 'RETAIL_SHIFT_REQUIRED');
  expect(await call('/invoices/' + credit.id + '/payments', { input: withShift([cash(300)], { amount_minor: 300 }) }), 201);
  const installment = expect(await call('/installments', { input: { customer_id: 1, invoice_id: credit.id,
    due_date: '2026-12-01', principal_minor: 700, paid_minor: 0 } }), 201);
  expect(await call('/installments/' + installment.id + '/payments', {
    input: withShift([{ method: 'wallet', amount_minor: 100 }], { amount_minor: 100 }),
  }), 201);
  const purchase = expect(await call('/purchases', { input: withShift([cash(50), { method: 'bank_transfer', amount_minor: 50 }],
    { supplier_id: 1, description: 'Test purchase', total_minor: 300, paid_minor: 100, purchase_date: shift.business_day }) }), 201);
  expect(await call('/purchases/' + purchase.id + '/due-date', { input: { due_date: shift.business_day }, method: 'PATCH' }), 200);
  expect(await call('/purchases/' + purchase.id + '/payments', { input: withShift([cash(100)], { amount_minor: 100 }) }), 201);
  expect(await call('/suppliers/1/payments', { input: withShift([cash(10)], { amount_minor: 10 }) }), 201);

  const detail = expect(await call(href), 200);
  assert.equal(detail.expected_minor, 540);
  assert.deepEqual(detail.totals, [
    { method: 'cash', received_minor: 900, paid_out_minor: 760 }, { method: 'card', received_minor: 400, paid_out_minor: 400 },
    { method: 'wallet', received_minor: 100, paid_out_minor: 0 }, { method: 'bank_transfer', received_minor: 0, paid_out_minor: 50 },
  ]);
  expect(await call(href + '/close', { user: 3, input: { observed_minor: 540 } }), 403, 'RETAIL_SHIFT_NOT_OWNED');
  expect(await call(href + '/close', { input: { observed_minor: 540, expected_minor: 539 } }), 409, 'RETAIL_SHIFT_BALANCE_CHANGED');
  expect(await call(href + '/close', { input: { observed_minor: 535 } }), 422, 'RETAIL_SHIFT_REASON_REQUIRED');
  const closed = expect(await call(href + '/close', { input: { observed_minor: 535, expected_minor: 540, reason: 'Count variance' } }), 201);
  assert.equal(closed.status, 'pending_approval');
  assert.equal(closed.difference_minor, -5);
  expect(await call('/invoices', { input: withShift([cash(1000)], sale) }), 409, 'RETAIL_SHIFT_UNAVAILABLE');
  expect(await call(href + '/approve', { input: { reason: 'Reviewed' } }), 403, 'RETAIL_SHIFT_APPROVAL_SEPARATION');
  const approved = expect(await call(href + '/approve', { user: 1, input: { reason: 'Reviewed' } }), 201);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approved_by, 1);
  assert.equal(approved.expected_minor, 540);
  assert.deepEqual(expect(await call(shifts + '?status=approved'), 200).map(({ id }) => id), [shift.id]);

  const report = expect(await call('/reports/sales', { user: 1 }), 200);
  const day = report.days.find(row => row.day === shift.business_day);
  assert.equal(report.timezone, 'Africa/Cairo');
  assert.equal(day.received_minor, 2400);
  assert.equal(day.cash_received_minor, 900);
  assert.equal(day.unclassified_received_minor, 1000);
  assert.equal(day.cash_returned_minor, 600);
  const receivable = expect(await call('/reports/aging?side=receivable', { user: 1 }), 200);
  assert.deepEqual(receivable.items.map(({ source, outstanding_minor }) => [source, outstanding_minor]), [['installment', 600]]);
  const invoiceOnly = expect(await call('/reports/aging?side=receivable'), 200);
  assert.deepEqual(invoiceOnly.visible_sources, ['invoice']);
  assert.deepEqual(invoiceOnly.items.map(({ source, outstanding_minor, bucket }) => [source, outstanding_minor, bucket]),
    [['invoice', 600, 'not_due']]);
  expect(await call('/reports/aging?side=payable'), 403);
  const payable = expect(await call('/reports/aging?side=payable', { user: 1 }), 200);
  assert.deepEqual(payable.items.map(({ source, outstanding_minor }) => [source, outstanding_minor]),
    [['purchase', 90], ['supplier_opening', 5000]]);
  assert.equal(payable.totals.undated, 5000);
  assert.equal(payable.totals.not_due, 90);
  const settlements = expect(await call(`/reports/tender-settlements?method=card&shift_id=${shift.id}&per_page=1`, { user: 1 }), 200);
  assert.deepEqual(settlements.totals, [{ method: 'card', received_minor: 400, paid_out_minor: 400, net_minor: 0,
    unreferenced: 0, matched_count: 0, pending_count: 2 }]);
  assert.equal(settlements.items.length, 1);
  assert.equal(settlements.items[0].reference, 'SYNTHETIC-REF');
  expect(await call('/reports/tender-settlements', { user: 4 }), 403);
  const posting = settlements.items[0];
  const matchPath = '/reports/tender-settlements/match';
  const matchInput = { operation_id: posting.operation_id, source: posting.source, position: posting.position,
    observed_delta_minor: posting.delta_minor, statement_reference: 'BANK-SYNTHETIC-01', statement_date: shift.business_day };
  expect(await call(matchPath, { user: 4, input: matchInput }), 403);
  expect(await call(matchPath, { user: 1, input: { ...matchInput, observed_delta_minor: -posting.delta_minor } }), 422, 'RETAIL_TENDER_MATCH_AMOUNT');
  expect(await call(matchPath, { user: 1, input: { ...matchInput, operation_id: 99999 } }), 404, 'RETAIL_TENDER_NOT_FOUND');
  const matchKey = randomUUID();
  const match = expect(await call(matchPath, { user: 1, input: matchInput, key: matchKey }), 201);
  assert.deepEqual(expect(await call(matchPath, { user: 1, input: matchInput, key: matchKey }), 201), match);
  expect(await call(matchPath, { user: 1, input: matchInput }), 409, 'RETAIL_TENDER_ALREADY_MATCHED');
  const matched = expect(await call('/reports/tender-settlements?method=card&status=matched', { user: 1 }), 200);
  assert.equal(matched.items.length, 1);
  assert.equal(matched.items[0].settlement_status, 'matched');
  assert.equal(matched.items[0].statement_reference, 'BANK-SYNTHETIC-01');
  assert.equal(matched.totals[0].matched_count, 1);
  const pending = expect(await call('/reports/tender-settlements?method=card&status=pending', { user: 1 }), 200);
  assert.equal(pending.items.length, 1);
  assert.equal(pending.items[0].settlement_status, 'pending');

  await t.test('settles mixed signed card lines net of fees and reverses without deleting evidence', async () => {
    const base = '/reports/tender-settlements';
    const reverse = id => `${base}/${id}/reverse`;
    expect(await call(reverse(match.match_operation_id), { user: 1, input: { reason: 'Correct statement grouping' } }), 201);
    const items = [posting, pending.items[0]].map(({ operation_id, source, position }) => ({ operation_id, source, position }));
    const input = { items, method: 'card', fee_minor: 25, observed_minor: -25,
      statement_date: shift.business_day, statement_reference: 'BANK-BATCH' };
    expect(await call(base + '/batches', { user: 1, input: { ...input, observed_minor: 0 } }), 422, 'RETAIL_SETTLEMENT_NET');
    const key = randomUUID();
    const batch = expect(await call(base + '/batches', { user: 1, key, input }), 201);
    assert.equal(expect(await call(base + '/batches', { user: 1, key, input }), 201).id, batch.id);
    expect(await call(base + '/batches', { user: 1, input: { ...input, statement_reference: 'BANK-BATCH-DUPLICATE' } }), 409, 'RETAIL_TENDER_ALREADY_MATCHED');
    const report = expect(await call(base + '?method=card&status=matched', { user: 1 }), 200);
    assert.equal(report.items.length, 2);
    assert.ok(report.items.every(row => row.settlement_id === batch.id && row.settlement_type === 'batch'));
    expect(await call(reverse(batch.id), { user: 1, input: { reason: 'Statement corrected' } }), 201);
    assert.equal(expect(await call(base + '?method=card&status=pending', { user: 1 }), 200).items.length, 2);
    assert.equal(await db.prepare('SELECT COUNT(*) AS total FROM retail_settlement_batches').first('total'), 1);
  });

  await t.test('filters InstaPay settlement references without mixing ordinary bank transfers', async () => {
    const transferShift = expect(await call(shifts, { input: { register_name: 'Bank transfer fixture', opening_minor: 0 } }), 201);
    const endpoint = '/reports/tender-settlements';
    for (const reference of ['InstaPay:FIXTURE-1', 'InstaPay:', 'WIRE-FIXTURE-2']) {
      expect(await call('/invoices', { input: {
        ...sale, shift_id: transferShift.id, payments: [{ method: 'bank_transfer', amount_minor: 1000, reference }],
      } }), 201);
    }
    const query = '?method=bank_transfer&shift_id=' + transferShift.id;
    const general = expect(await call(endpoint + query, { user: 1 }), 200);
    assert.equal(general.items.length, 3);
    const filtered = expect(await call(endpoint + query + '&channel=instapay', { user: 1 }), 200);
    assert.deepEqual(filtered.items.map(row => row.reference), ['InstaPay:FIXTURE-1']);
    assert.equal(filtered.totals[0].received_minor, 1000);
    expect(await call(endpoint + query + '&channel=instapay', { user: 4 }), 403);
    expect(await call(endpoint + '?method=card&channel=instapay', { user: 1 }), 422);
    const [item] = filtered.items;
    expect(await call(endpoint + '/batches', { user: 1, input: {
      items: [{ operation_id: item.operation_id, source: item.source, position: item.position }],
      method: 'bank_transfer', fee_minor: 0, observed_minor: 1000, statement_date: transferShift.business_day,
      statement_reference: 'INSTA-PAY-FIXTURE',
    } }), 201);
    assert.equal(expect(await call(endpoint + query + '&channel=instapay&status=matched', { user: 1 }), 200).items.length, 1);
    expect(await call(shifts + '/' + transferShift.id + '/close', { input: { observed_minor: 0 } }), 201);
  });

  await t.test('emergency closure releases the drawer and requires review by a third actor', async () => {
    const absent = expect(await call(shifts, { input: { register_name: 'Emergency Drawer', opening_minor: 5000 } }), 201);
    const route = shifts + '/' + absent.id;
    const close = route + '/emergency-close';
    const counted = { observed_minor: 4950, expected_minor: 5000, reason: 'Operator absent after count' };
    expect(await call(close, { input: counted }), 403, 'forbidden');
    expect(await call(close, { user: 1, input: { ...counted, expected_minor: 4999 } }), 409, 'RETAIL_SHIFT_BALANCE_CHANGED');
    expect(await call(close, { user: 1, input: { ...counted, reason: '   ' } }), 422, 'validation');
    expect(await call(close, { user: 5, input: { observed_minor: 4950, reason: counted.reason } }), 422, 'validation');
    assert.ok(expect(await call(shifts + '?status=open', { user: 5 }), 200).some(row => row.id === absent.id));
    const closeKey = randomUUID();
    const emergency = expect(await call(close, { user: 1, input: counted, key: closeKey }), 201);
    assert.equal(emergency.emergency_close, 1);
    assert.equal(emergency.status, 'pending_approval');
    assert.equal(emergency.closed_by_name, 'Supervisor');
    assert.equal(emergency.closed_by, 1);
    assert.equal(emergency.difference_minor, -50);
    assert.deepEqual(expect(await call(close, { user: 1, input: counted, key: closeKey }), 201), emergency);
    expect(await call(close, { user: 1, input: { ...counted, reason: 'Changed' }, key: closeKey }), 409, 'IDEMPOTENCY_CONFLICT');
    expect(await call(close, { user: 5, input: counted }), 409, 'RETAIL_SHIFT_NOT_OPEN');
    expect(await call(route + '/approve', { user: 1, input: { reason: 'Self' } }), 403, 'RETAIL_SHIFT_APPROVAL_SEPARATION');
    expect(await call(route + '/approve', { user: 2, input: { reason: 'Owner' } }), 403, 'RETAIL_SHIFT_APPROVAL_SEPARATION');
    expect(await call(route + '/approve', { user: 5, input: { reason: 'Emergency-only' } }), 403, 'forbidden');
    assert.equal(await db.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'retail.shift.emergency_close'").first('count'), 1);
    const next = expect(await call(shifts, { user: 3, input: { register_name: 'Emergency Drawer', opening_minor: 4950 } }), 201);
    assert.equal(next.status, 'open');
    assert.equal(expect(await call(route + '/approve', { user: 3, input: { reason: 'Independent review' } }), 201).status, 'approved');

    const own = expect(await call(shifts, { user: 1, input: { register_name: 'Supervisor drawer', opening_minor: 100 } }), 201);
    const noDifference = { observed_minor: 100, expected_minor: 100, reason: 'Counted' };
    const ownRoute = shifts + '/' + own.id;
    expect(await call(ownRoute + '/emergency-close', { user: 1, input: noDifference }), 422, 'RETAIL_EMERGENCY_CLOSE_OWN_SHIFT');
    assert.equal(expect(await call(ownRoute + '/emergency-close', { user: 5, input: noDifference }), 201).status, 'pending_approval');
    assert.equal(expect(await call(ownRoute + '/approve', { user: 3, input: { reason: 'Verified matched count' } }), 201).status, 'approved');
  });

  await assert.rejects(db.prepare('UPDATE retail_tender_matches SET observed_delta_minor = 1').run(), /IMMUTABLE_LEDGER/);
  await assert.rejects(db.prepare('UPDATE retail_shift_closures SET expected_minor = 0').run(), /IMMUTABLE_LEDGER/);
  await assert.rejects(db.prepare('DELETE FROM retail_tenders').run(), /IMMUTABLE_LEDGER/);
});
