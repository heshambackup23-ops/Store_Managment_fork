import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'
import { dateTime } from '../scripts/laravel-finance-export.mjs'
import { assertWalletRestore, walletRestore } from '../scripts/restore-laravel-wallets.mjs'

const cutoff = '2026-10-31T18:00:00.000Z'
const timestamp = value => value == null ? null : dateTime(value)
const at = (day, time = '10:30:00') => `2026-10-${String(day).padStart(2, '0')}T${time}Z`
const tx = (id, day, type, fields) => ({
  id, uuid: '9faf84f8-ad36-4c3f-94f2-' + String(id).padStart(12, '0'), wallet_id: 601,
  type, status: 'completed', amount: '0.00', commission: '0.00', fee: '0.00', profit: '0.00',
  wallet_delta: '0.00', cash_delta: '0.00', payment_method: 'cash', receivable: '0.00',
  occurred_at: at(day), created_at: at(day), ...fields,
})

function input() {
  return {
    customers: [{ id: 41, name: 'عميل اختبار' }],
    wallets: [{
      id: 601, name: 'محفظة الاختبار', provider: 'vodafone_cash', identifier: '01000000000',
      holder_name: 'اختبار', notes: 'سجل اصطناعي', warn_at_percent: '72', is_active: '0',
      opening_balance: '100.00', balance: '75.50', per_transaction_limit: '10.00',
      default_commission_percent: '2.50', default_fee_percent: '1.00',
      created_at: at(1), updated_at: at(10),
    }],
    wallet_transactions: [
      tx(602, 2, 'send', {
        amount: '20.00', commission: '4.00', fee: '3.00', profit: '1.00',
        wallet_delta: '-23.00', cash_delta: '24.00', balance_after: '77.00',
      }),
      tx(603, 3, 'send', {
        amount: '5.00', commission: '1.00', fee: '0.00', profit: '1.00',
        wallet_delta: '-5.00', balance_after: '72.00', payment_method: 'deferred', customer_id: 41, receivable: '4.50',
      }),
      tx(604, 4, 'settlement', {
        settles_id: 603, customer_id: 41, cash_delta: '1.50', balance_after: '72.00',
        occurred_at: at(4, '21:15:00'), created_at: at(4, '21:15:00'),
      }),
      tx(605, 5, 'receive', {
        amount: '5.00', commission: '0.50', fee: '0.50', profit: '0.00', status: 'reversed',
        wallet_delta: '4.50', cash_delta: '-4.50', balance_after: '76.50', reversed_at: at(6),
      }),
      tx(606, 6, 'reversal', {
        reverses_id: 605, wallet_delta: '-4.50', cash_delta: '4.50', balance_after: '72.00', notes: 'عكس اختباري',
      }),
      tx(607, 7, 'adjustment', { wallet_delta: '4.00', balance_after: '76.00', notes: 'مطابقة الاختبار' }),
      tx(608, 8, 'profit_withdrawal', { wallet_delta: '-0.50', balance_after: '75.50' }),
    ],
    wallet_cash_adjustments: [
      { id: 1, kind: 'opening', amount: '5.00', occurred_at: at(1) },
      { id: 2, kind: 'profit_withdraw', amount: '-0.25', occurred_at: at(9) },
    ],
    wallet_expenses: [
      { id: 1, amount: '0.50', category: 'ورق', spent_on: '2026-10-02', created_at: at(2) },
      { id: 2, amount: '0.20', category: 'ورق', spent_on: '2026-10-02', created_at: at(2), voided_at: at(3), void_reason: 'أُلغي' },
    ],
    wallet_audit_logs: [{
      id: 1, action: 'transaction.settled', subject_type: 'wallet_transaction', subject_id: 603,
      user_id: 19, user_name: 'موظف أصلي', meta: '{"settlement_id":604}', created_at: at(4, '21:15:00'),
    }],
  }
}

async function database() {
  const db = new DatabaseSync(':memory:')
  const migrations = new URL('../migrations/', import.meta.url)
  db.exec('PRAGMA foreign_keys = ON')
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    db.exec(await readFile(new URL(name, migrations), 'utf8'))
  }
  db.exec(`INSERT INTO users(id,name,email,password_hash,role_id) VALUES (1,'operator','operator@example.invalid','unusable',1);
    INSERT INTO customers(id,name) VALUES (41,'عميل اختبار');`)
  return db
}

test('wallet restore matches the provider, drawer, deferred balance and net profit', async () => {
  const plan = walletRestore(input(), { actor: 1, cutoff, timestamp })
  const db = await database()
  try {
    db.exec(plan.sql)
    const counts = assertWalletRestore(db, plan.checks)
    assert.equal(counts.wallet_debt_payments, 1)
    assert.equal(counts.wallet_adjustments, 1)
    assert.equal(counts.wallet_profit_withdrawals, 2)
    assert.equal(counts.legacy_wallet_sources, 13)
    assert.deepEqual(plan.checks.totals, {
      provider_balance_minor: '7550', drawer_minor: '2975', receivables_minor: '450', transfer_margin_minor: '200',
      drawer_expense_minor: '50', profit_withdrawn_minor: '75', profit_available_minor: '75', working_capital_minor: '10900',
    })
    const wallet = db.prepare('SELECT warn_at_percent, holder_name, default_commission_bps, transaction_limit_minor, active FROM wallets').get()
    assert.deepEqual({ ...wallet }, { warn_at_percent: 72, holder_name: 'اختبار', default_commission_bps: 250, transaction_limit_minor: 1000, active: 0 })
    const reversal = db.prepare('SELECT business_day, reversal_of, amount_minor FROM wallet_transactions WHERE id=606').get()
    assert.deepEqual({ ...reversal }, { business_day: '2026-10-06', reversal_of: 605, amount_minor: 500 })
    assert.equal(db.prepare('SELECT created_at FROM wallet_debt_payments WHERE id=604').get().created_at, '2026-10-04 21:15:00.000')
    assert.equal(db.prepare('SELECT created_at FROM wallet_transactions WHERE id=607').get().created_at, '2026-10-07 10:30:00.000')
    assert.equal(db.prepare('SELECT created_at FROM wallet_transactions WHERE id=608').get().created_at, '2026-10-08 10:30:00.000')
    assert.equal(db.prepare("SELECT json_extract(details_json,'$.source_actor') AS actor FROM legacy_wallet_sources WHERE source_table='wallet_audit_logs'").get().actor, 19)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    const next = db.prepare("INSERT INTO business_operations(actor_id,request_key,operation,fingerprint) VALUES (1,'next','test','test') RETURNING id").get()
    assert.ok(next.id > 608)
    assert.throws(() => db.exec(plan.sql), /UNIQUE/)
  } finally {
    db.close()
  }
})

test('wallet restore stops on balance drift, unexplained debt, ambiguous reversal and incomplete snapshots', () => {
  const options = { actor: 1, cutoff, timestamp }
  const balance = input()
  balance.wallets[0].balance = '75.51'
  assert.throws(() => walletRestore(balance, options), /Wallet ID 601 balance/)
  const debt = input()
  debt.wallet_transactions[1].receivable = '4.49'
  assert.throws(() => walletRestore(debt, options), /does not match its collections/)
  const reversal = input()
  reversal.wallet_transactions[4].reverses_id = 602
  assert.throws(() => walletRestore(reversal, options), /does not match its original/)
  const partial = input()
  delete partial.wallet_expenses
  assert.throws(() => walletRestore(partial, options), /requires the wallet_expenses table/)
})

test('D1 batch retains source audit linkage and a migrated debt accepts a later collection', async (t) => {
  const miniflare = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: 'export default {fetch() { return new Response("local"); }}',
    compatibilityDate: '2026-01-01', d1Databases: ['DB'],
  }))
  t.after(() => miniflare.dispose())
  const db = await miniflare.getD1Database('DB')
  const apply = sql => db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)))
  const migrations = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await apply(await readFile(new URL(name, migrations), 'utf8'))
  }
  await apply(`INSERT INTO users(id,name,email,password_hash,role_id) VALUES (1,'operator','operator@example.invalid','unusable',1);
    INSERT INTO customers(id,name) VALUES (41,'عميل اختبار');`)
  const plan = walletRestore(input(), { actor: 1, cutoff, timestamp })
  await apply(plan.sql)
  const audit = await db.prepare(`SELECT a.action, json_extract(p.details_json, '$.source_actor_name') AS source_actor
    FROM legacy_wallet_sources p JOIN audit_logs a ON a.id=p.target_id WHERE p.source_table='wallet_audit_logs'`).first()
  assert.deepEqual(audit, { action: 'wallet.legacy.transaction.settled', source_actor: 'موظف أصلي' })
  assert.equal(await db.prepare('SELECT drawer_minor FROM wallet_financial_totals').first('drawer_minor'), 2975)
  await db.prepare(`INSERT INTO wallet_debt_payments(id,wallet_debt_id,amount_minor,actor_id)
    VALUES (1001,603,200,1)`).run()
  const totals = await db.prepare('SELECT drawer_minor, receivables_minor, working_capital_minor FROM wallet_financial_totals').first()
  assert.deepEqual(totals, { drawer_minor: 3175, receivables_minor: 250, working_capital_minor: 10900 })
})
