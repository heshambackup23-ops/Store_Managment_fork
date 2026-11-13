import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

test('drawer movements require permission, preserve receipts and lock when the shift closes', async t => {
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
    INSERT INTO roles(id,name) VALUES (2,'operator'), (3,'cash controller');
    INSERT INTO role_permissions(role_id,permission) VALUES (2,'retail.shifts.operate'),
      (3,'retail.shifts.operate'), (3,'retail.cash.manage'), (3,'invoices.create');
    INSERT INTO users(id,name,email,password_hash,role_id) VALUES (1,'Supervisor','admin@example.invalid','unused',1),
      (2,'Operator','operator@example.invalid','unused',2), (3,'Cashier','cashier@example.invalid','unused',3);
    INSERT INTO products(id,name,price_minor,stock) VALUES (1,'Test',1000,3);
  `);
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('base64url'));
  await db.batch(tokens.map((token, i) => db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), i + 1, Math.floor(Date.now() / 1000) + 300)));

  async function call(path, { user = 3, input, key = randomUUID() } = {}) {
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + tokens[user - 1],
        'Content-Type': 'application/json', 'Idempotency-Key': key }, body: input ? JSON.stringify(input) : undefined,
    });
    return { status: response.status, json: await response.json() };
  }
  function expect(response, status, code) {
    assert.equal(response.status, status, JSON.stringify(response.json));
    if (code) assert.equal(response.json.code, code);
    return response.json.data;
  }

  const base = '/retail/shifts';
  const shift = expect(await call(base, { input: { register_name: 'Drawer A', opening_minor: 4000 } }), 201);
  const ownShift = expect(await call(base, { user: 2, input: { register_name: 'Drawer B', opening_minor: 5000 } }), 201);
  const href = `${base}/${shift.id}`;
  const movements = href + '/cash-movements';
  const expense = { kind: 'general_expense', amount_minor: 700, reason: 'دفتر إيصالات' };
  expect(await call(`${base}/${ownShift.id}/cash-movements`, { user: 2, input: expense }), 403, 'forbidden');
  expect(await call(`${base}/${ownShift.id}/cash-movements`, { input: expense }), 409, 'RETAIL_SHIFT_UNAVAILABLE');
  expect(await call(movements, { user: 1, input: expense }), 409, 'RETAIL_SHIFT_UNAVAILABLE');
  expect(await call(movements, { user: 2 }), 404, 'RETAIL_SHIFT_NOT_FOUND');
  expect(await call(movements, { input: { ...expense, kind: 'invoice_payment' } }), 422, 'validation');
  expect(await call(movements, { input: { ...expense, amount_minor: 4001 } }), 409, 'RETAIL_CASH_MOVEMENT_BALANCE');

  const key = randomUUID();
  const results = await Promise.all([call(movements, { input: expense, key }), call(movements, { input: expense, key })]);
  const expenseResult = expect(results[0], 201);
  assert.deepEqual(expect(results[1], 201), expenseResult);
  assert.equal(expenseResult.delta_minor, -700);
  assert.equal(expenseResult.actor_name, 'Cashier');
  expect(await call(movements, { input: expense }), 409, 'RETAIL_CASH_MOVEMENT_DUPLICATE');
  const withdrawal = { kind: 'safe_withdrawal', amount_minor: 500, reason: 'عهدة إضافية', reference: 'SAFE-001' };
  assert.equal(expect(await call(movements, { input: withdrawal }), 201).delta_minor, 500);
  expect(await call(movements, { input: { ...withdrawal, reference: 'safe-001', kind: 'safe_deposit' } }), 409, 'RETAIL_CASH_MOVEMENT_DUPLICATE');
  const deposit = { kind: 'safe_deposit', amount_minor: 900, reason: 'تسليم النقد', reference: 'SAFE-002' };
  assert.equal(expect(await call(movements, { input: deposit }), 201).delta_minor, -900);
  expect(await call('/invoices', { input: { items: [{ product_id: 1, quantity: 1 }], paid_minor: 1000, shift_id: shift.id,
    payments: [{ method: 'cash', amount_minor: 1000 }] } }), 201);
  const detail = expect(await call(href), 200);
  assert.equal(detail.opening_minor, 4000);
  assert.equal(detail.cash_movements_minor, -1100);
  assert.equal(detail.expected_minor, 3900);
  assert.deepEqual(detail.cash_movement_totals, [{ kind: 'safe_deposit', amount_minor: 900 },
    { kind: 'safe_withdrawal', amount_minor: 500 }, { kind: 'general_expense', amount_minor: 700 }]);
  assert.deepEqual(detail.totals[0], { method: 'cash', received_minor: 1000, paid_out_minor: 0 });
  assert.equal(expect(await call(movements + '?per_page=1', { user: 1 }), 200).length, 1);
  assert.equal((await call(movements + '?per_page=1', { user: 1 })).json.meta.total, 3);
  expect(await call(href + '/close', { input: { observed_minor: 3900, expected_minor: 5000 } }), 409, 'RETAIL_SHIFT_BALANCE_CHANGED');

  const competing = await Promise.all([
    call(href + '/close', { input: { observed_minor: 3900, expected_minor: 3900 } }),
    call(movements, { input: { ...deposit, amount_minor: 100, reference: 'SAFE-003' } }),
  ]);
  assert.deepEqual(competing.map(result => result.status).sort(), [201, 409]);
  if (competing[0].status === 409) {
    expect(await call(href + '/close', { input: { observed_minor: 3800, expected_minor: 3800 } }), 201);
  }
  assert.equal(expect(await call(href), 200).status, 'closed');
  expect(await call(movements, { input: { ...deposit, reference: 'SAFE-004' } }), 409, 'RETAIL_SHIFT_UNAVAILABLE');
  const counts = await db.prepare(`SELECT (SELECT count(*) FROM retail_cash_movements) AS movements,
    (SELECT count(*) FROM audit_logs WHERE action LIKE 'retail.shift.cash.%') AS audits,
    (SELECT count(*) FROM wallet_cash_entries) AS wallet_entries`).first();
  assert.equal(counts.movements, counts.audits);
  assert.equal(counts.wallet_entries, 0);
  await assert.rejects(db.prepare('UPDATE retail_cash_movements SET reason = ? WHERE id = ?').bind('Changed', expenseResult.id).run(), /IMMUTABLE_LEDGER/);
  await assert.rejects(db.prepare('DELETE FROM retail_cash_movements WHERE id = ?').bind(expenseResult.id).run(), /IMMUTABLE_LEDGER/);
});
