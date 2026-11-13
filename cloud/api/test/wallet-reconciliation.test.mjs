import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

test('wallet and drawer counts snapshot exact balances without moving money', async t => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral',
  });
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-01-01', d1Databases: ['DB'],
  }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const migrations = new URL('../migrations/', import.meta.url);
  const apply = sql => db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)));
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await apply(await readFile(new URL(name, migrations), 'utf8'));
  }
  await apply(`
    INSERT INTO roles(id, name) VALUES (2, 'wallet-cashier'), (3, 'wallet-reader');
    INSERT INTO role_permissions(role_id, permission) VALUES
      (2, 'wallets.cash'), (3, 'wallets.view');
    INSERT INTO users(id, name, email, password_hash, role_id) VALUES
      (1, 'مسؤول الجرد', 'admin@example.invalid', 'unused', 1),
      (2, 'أمين النقدية', 'cashier@example.invalid', 'unused', 2),
      (3, 'مراجع المحافظ', 'reader@example.invalid', 'unused', 3);
    INSERT INTO wallets(id, name, provider) VALUES (21, 'محفظة فودافون تجريبية', 'vodafone_cash');
    INSERT INTO wallet_transactions(id, wallet_id, kind, amount_minor, delta_minor, actor_id)
      VALUES (11, 21, 'opening', 6600, 6600, 1);
    UPDATE wallets SET active = 0 WHERE id = 21;
    INSERT INTO wallet_cash_entries(id, kind, delta_minor, business_day, note, actor_id)
      VALUES (12, 'opening', 3350, '2026-10-31', 'رصيد اختباري', 1);
  `);
  const tokens = Array.from({ length: 3 }, () => randomBytes(32).toString('base64url'));
  await db.batch(tokens.map((token, index) => db.prepare(
    'INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)',
  ).bind(createHash('sha256').update(token).digest('base64url'), index + 1, Math.floor(Date.now() / 1000) + 300)));

  async function request(path, { input, key = randomUUID(), user = 1 } = {}) {
    const headers = { Authorization: 'Bearer ' + tokens[user - 1] };
    if (input) {
      headers['Content-Type'] = 'application/json';
      if (key) headers['Idempotency-Key'] = key;
    }
    const result = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method: input ? 'POST' : 'GET', headers, body: input ? JSON.stringify(input) : undefined,
    });
    return { status: result.status, json: await result.json() };
  }

  function result(response, status) {
    assert.equal(response.status, status, JSON.stringify(response.json));
    return response.json;
  }

  const path = '/wallet-reconciliation';
  const wallet = { target: 'wallet', wallet_id: 21, expected_minor: 6600, observed_minor: 6600 };
  assert.equal(result(await request(path, { user: 3 }), 403).code, 'forbidden');
  assert.equal(result(await request(path + '/history', { user: 3 }), 403).code, 'forbidden');
  assert.equal(result(await request(path, { input: wallet, user: 3 }), 403).code, 'forbidden');
  assert.equal(result(await request(path, { input: wallet, key: null }), 400).code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(result(await request(path, { input: { ...wallet, observed_minor: 66.5 } }), 422).code, 'validation');
  assert.equal(result(await request(path, { input: { ...wallet, actor_id: 3 } }), 422).code, 'validation');
  assert.equal(result(await request(path, { input: { ...wallet, observed_minor: 6599, reason: '\0' } }), 422).code, 'validation');
  assert.equal(result(await request(path, { input: { ...wallet, wallet_id: 22 } }), 404).code, 'RECONCILIATION_TARGET_NOT_FOUND');
  assert.equal(result(await request(path, { input: { ...wallet, observed_minor: 6599, reason: '  ' } }), 422).code,
    'RECONCILIATION_REASON_REQUIRED');

  const overview = result(await request(path, { user: 2 }), 200).data;
  assert.match(overview.business_day, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(overview.targets, [
    { target: 'drawer', wallet_id: null, wallet_name: null, expected_minor: 3350, latest: null },
    { target: 'wallet', wallet_id: 21, wallet_name: 'محفظة فودافون تجريبية', expected_minor: 6600, latest: null },
  ]);

  const key = randomUUID();
  const attempts = await Promise.all([request(path, { input: wallet, key, user: 2 }), request(path, { input: wallet, key, user: 2 })]);
  assert.deepEqual(attempts.map(({ status }) => status).sort(), [200, 201]);
  const matched = attempts.find(({ status }) => status === 201).json.data;
  assert.deepEqual(matched, attempts.find(({ status }) => status === 200).json.data);
  assert.equal(matched.actor_id, 2);
  assert.equal(matched.actor_name, 'أمين النقدية');
  assert.equal(matched.difference_minor, 0);
  assert.equal(matched.reason, '');
  assert.match(matched.created_at, /^\d{4}-\d{2}-\d{2}T.+Z$/);
  assert.equal(result(await request(path, { input: { ...wallet, reason: 'اختلاف الطلب' }, key, user: 2 }), 409).code,
    'IDEMPOTENCY_CONFLICT');

  const drawer = { target: 'drawer', expected_minor: 3350, observed_minor: 3324, reason: '  عجز نقدي قيد المراجعة  ' };
  const difference = result(await request(path, { input: drawer }), 201).data;
  assert.equal(difference.difference_minor, -26);
  assert.equal(difference.reason, 'عجز نقدي قيد المراجعة');
  assert.equal(difference.actor_id, 1);
  const audit = (await db.prepare(`SELECT actor_id, action, entity_type, entity_id FROM audit_logs
    WHERE action = 'wallet.reconcile' ORDER BY id`).all()).results;
  assert.deepEqual(audit, [
    { actor_id: 2, action: 'wallet.reconcile', entity_type: 'wallet_reconciliation', entity_id: matched.id },
    { actor_id: 1, action: 'wallet.reconcile', entity_type: 'wallet_reconciliation', entity_id: difference.id },
  ]);
  assert.deepEqual(await db.prepare(`SELECT drawer_minor, provider_balance_minor,
    (SELECT count(*) FROM wallet_transactions) AS transactions,
    (SELECT count(*) FROM wallet_cash_entries) AS cash_entries FROM wallet_financial_totals`).first(),
  { drawer_minor: 3350, provider_balance_minor: 6600, transactions: 1, cash_entries: 1 });

  await apply(`
    UPDATE wallets SET active = 1, name = 'المحفظة بعد إعادة التسمية' WHERE id = 21;
    UPDATE users SET name = 'أمين النقدية بعد التعديل' WHERE id = 2;
    INSERT INTO wallet_adjustments(id, wallet_id, delta_minor, reason, business_day, actor_id)
      VALUES (13, 21, 25, 'حركة دفترية مستقلة', '2026-10-31', 1);
  `);
  assert.deepEqual(result(await request(path, { input: wallet, key, user: 2 }), 200).data, matched);
  assert.equal(result(await request(path, { input: wallet, user: 2 }), 409).code, 'RECONCILIATION_BALANCE_CHANGED');
  const latest = result(await request(path), 200).data.targets;
  assert.equal(latest[0].latest.difference_minor, -26);
  assert.equal(latest[1].expected_minor, 6625);
  assert.equal(latest[1].wallet_name, 'المحفظة بعد إعادة التسمية');
  assert.deepEqual(latest[1].latest, matched);

  const history = result(await request(path + `/history?wallet_id=21&from=${matched.business_day}&to=${matched.business_day}&per_page=1`), 200);
  assert.deepEqual(history.data, [matched]);
  assert.equal(history.meta.total, 1);
  const drawerHistory = result(await request(path + '/history?target=drawer'), 200);
  assert.deepEqual(drawerHistory.data, [difference]);
  assert.equal(result(await request(path + '/history?from=2026-02-30'), 422).code, 'validation');
  assert.equal(result(await request(path + '/history?from=2026-11-01&to=2026-10-30'), 422).code, 'invalid_dates');
  await assert.rejects(db.prepare('UPDATE wallet_reconciliations SET reason = ? WHERE id = ?').bind('تعديل', matched.id).run(), /IMMUTABLE_LEDGER/);
  await assert.rejects(db.prepare('DELETE FROM wallet_reconciliations WHERE id = ?').bind(matched.id).run(), /IMMUTABLE_LEDGER/);

  await db.prepare(`INSERT INTO wallet_cash_entries (id, kind, delta_minor, business_day, note, actor_id)
    VALUES (14, 'correction', -3382, ?, 'حركة دفترية مستقلة', 1)`).bind(matched.business_day).run();
  const emptyDrawer = result(await request(path, {
    input: { target: 'drawer', observed_minor: 0, reason: 'الصندوق فارغ، جارٍ مراجعة الرصيد الدفتري' },
  }), 201).data;
  assert.equal(emptyDrawer.expected_minor, -32);
  assert.equal(emptyDrawer.difference_minor, 32);
  assert.equal(await db.prepare('SELECT drawer_minor FROM wallet_financial_totals').first('drawer_minor'), -32);
});
