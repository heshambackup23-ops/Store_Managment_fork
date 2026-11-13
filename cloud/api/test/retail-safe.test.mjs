import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { unstable_splitSqlQuery } from 'wrangler';

test('safe activation preserves earlier drawer activity and transfers remain balanced under competition', async t => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral' });
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-01-01', d1Databases: ['DB'] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const execute = sql => db.batch(unstable_splitSqlQuery(sql).map(command => db.prepare(command)));
  const migrations = new URL('../migrations/', import.meta.url);
  const migrationsToApply = readdirSync(migrations).filter(name => name.endsWith('.sql')).sort();
  const safeMigration = migrationsToApply.findIndex(name => name.startsWith('0036_'));
  assert.notEqual(safeMigration, -1);
  for (const name of migrationsToApply.slice(0, safeMigration)) await execute(readFileSync(new URL(name, migrations), 'utf8'));
  await execute(`
    INSERT INTO roles(id,name) VALUES (2,'cashier'), (3,'supervisor'), (4,'safe manager');
    INSERT INTO role_permissions(role_id,permission) VALUES (2,'retail.shifts.operate'), (2,'retail.cash.manage'),
      (3,'retail.shifts.approve'), (4,'retail.safe.manage');
    INSERT INTO users(id,name,email,password_hash,role_id) VALUES (1,'Admin','admin@example.invalid','unused',1),
      (2,'Cashier','cashier@example.invalid','unused',2), (3,'Supervisor','supervisor@example.invalid','unused',3),
      (4,'Safe Manager','safe-manager@example.invalid','unused',4);
    INSERT INTO business_operations(id,actor_id,request_key,operation,fingerprint) VALUES
      (20,2,'initial-shift','retail.shift.open','test'), (21,2,'earlier-transfer','retail.shift.cash.safe_deposit','test');
    INSERT INTO retail_shifts(id,register_name,actor_id,actor_name,opening_minor,business_day,opened_at)
      VALUES (20,'Demo drawer',2,'Cashier',1000,'2026-11-12','2026-11-12T12:00:00.000Z');
    INSERT INTO retail_cash_movements(id,shift_id,kind,amount_minor,reason,actor_id,actor_name,created_at)
      VALUES (21,20,'safe_deposit',100,'Earlier deposit',2,'Cashier','2026-11-12T13:00:00.000Z');
  `);
  for (const name of migrationsToApply.slice(safeMigration)) await execute(readFileSync(new URL(name, migrations), 'utf8'));
  const tokens = Array.from({ length: 4 }, () => randomBytes(32).toString('base64url'));
  await db.batch(tokens.map((token, index) => db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), index + 1, Math.floor(Date.now() / 1000) + 300)));

  async function call(path, { user = 4, input, key = randomUUID() } = {}) {
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method: input ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + tokens[user - 1],
        'Content-Type': 'application/json', 'Idempotency-Key': key }, body: input ? JSON.stringify(input) : undefined,
    });
    return { status: response.status, json: await response.json() };
  }
  function expect(result, status, code) {
    assert.equal(result.status, status, JSON.stringify(result.json));
    if (code) assert.equal(result.json.code, code);
    return result.json.data;
  }
  const safe = '/retail/safe';
  const shift = '/retail/shifts/20';
  const drawer = shift + '/cash-movements';
  const count = safe + '/count';
  const open = safe + '/open';
  expect(await call(safe, { user: 2 }), 403);
  expect(await call(safe + '/movements', { user: 2 }), 403);
  expect(await call(count, { input: { observed_minor: 0 } }), 409, 'RETAIL_SAFE_NOT_OPEN');
  const inactive = expect(await call(safe, { user: 3 }), 200);
  assert.equal(inactive.active, false);
  assert.equal(inactive.expected_minor, null);

  const deposit = amount_minor => ({ kind: 'safe_deposit', amount_minor, reason: 'Safe deposit' });
  const withdraw = amount_minor => ({ kind: 'safe_withdrawal', amount_minor, reason: 'Safe withdrawal' });
  expect(await call(drawer, { user: 2, input: deposit(30) }), 201);
  assert.equal(expect(await call(shift, { user: 2 }), 200).expected_minor, 870);
  const opening = { opening_minor: 250, reason: 'Approved opening count' };
  expect(await call(open, { user: 3, input: opening }), 403);
  const openingKey = randomUUID();
  const opened = expect(await call(open, { input: opening, key: openingKey }), 201);
  assert.equal(opened.opening_minor, 250);
  assert.equal(opened.opened_by, 4);
  expect(await call(open, { input: opening }), 409, 'RETAIL_SAFE_ALREADY_OPEN');
  assert.deepEqual(expect(await call(safe + '/movements'), 200), []);

  const transferKey = randomUUID();
  const transfer = expect(await call(drawer, { user: 2, input: deposit(125), key: transferKey }), 201);
  assert.equal(transfer.delta_minor, -125);
  assert.deepEqual(expect(await call(drawer, { user: 2, input: deposit(125), key: transferKey }), 201), transfer);
  assert.deepEqual(expect(await call(open, { input: opening, key: openingKey }), 201), opened);
  const position = expect(await call(safe, { user: 3 }), 200);
  assert.equal(position.active, true);
  assert.equal(position.expected_minor, 375);
  assert.equal(expect(await call(shift, { user: 2 }), 200).expected_minor, 745);
  assert.equal(expect(await call(safe + '/movements'), 200)[0].delta_minor, 125);
  expect(await call(drawer, { user: 2, input: { kind: 'general_expense', amount_minor: 20, reason: 'Office supplies' } }), 201);
  assert.equal(expect(await call(safe), 200).expected_minor, 375);

  expect(await call(drawer, { user: 2, input: withdraw(376) }), 409, 'RETAIL_SAFE_BALANCE');
  assert.equal(expect(await call(shift, { user: 2 }), 200).expected_minor, 725);
  expect(await call(count, { user: 3, input: { observed_minor: 375 } }), 403);
  expect(await call(count, { input: { expected_minor: 250, observed_minor: 250 } }), 409, 'RETAIL_SAFE_BALANCE_CHANGED');
  expect(await call(count, { input: { observed_minor: 370 } }), 422, 'RETAIL_SAFE_REASON_REQUIRED');
  const counted = expect(await call(count, { input: { expected_minor: 375, observed_minor: 370, reason: 'Under review' } }), 201);
  assert.equal(counted.difference_minor, -5);
  assert.equal(counted.actor_name, 'Safe Manager');
  assert.equal(expect(await call(safe), 200).expected_minor, 375);
  assert.deepEqual(expect(await call(safe), 200).latest_count, counted);
  assert.deepEqual(expect(await call(safe + '/counts', { user: 3 }), 200), [counted]);

  const competitors = await Promise.all([1, 2].map(number => call(drawer, { user: 2,
    input: { ...withdraw(250), reference: 'SAFE-WITHDRAW-' + number } })));
  assert.deepEqual(competitors.map(result => result.status).sort(), [201, 409]);
  assert.equal(competitors.find(result => result.status === 409).json.code, 'RETAIL_SAFE_BALANCE');
  assert.equal(expect(await call(safe), 200).expected_minor, 125);
  assert.equal(expect(await call(shift, { user: 2 }), 200).expected_minor, 975);
  assert.equal(expect(await call(safe + '/movements'), 200).length, 2);
  await assert.rejects(db.prepare('UPDATE retail_safe_opening SET opening_minor = 0').run(), /IMMUTABLE_LEDGER/);
  await assert.rejects(db.prepare('DELETE FROM retail_safe_counts').run(), /IMMUTABLE_LEDGER/);
  await assert.rejects(db.prepare('DELETE FROM retail_safe_transfers').run(), /IMMUTABLE_LEDGER/);
  await assert.rejects(db.prepare('INSERT INTO retail_safe_transfers(movement_id,safe_id) VALUES (21,1)').run(), /RETAIL_SAFE_TRANSFER_INVALID/);
});
