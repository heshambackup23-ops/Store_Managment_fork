import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const core = readFileSync(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8');
const business = readFileSync(new URL('../migrations/0002_business.sql', import.meta.url), 'utf8');

function database(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(core);
  db.exec(business);
  db.exec(`
    INSERT INTO users (id, name, email, password_hash, role_id) VALUES (1, 'Demo', 'demo@example.invalid', 'unused', 1);
    INSERT INTO customers (id, name) VALUES (1, 'Demo customer');
    INSERT INTO products (id, name, price_minor, cost_minor) VALUES (1, 'Demo product', 2500, 1250);
    INSERT INTO inventory_movements(product_id, delta, source_type, source_id, actor_id)
      VALUES (1, 1, 'adjustment', 1, 1);
  `);
  return db;
}

function transactional(db, sql) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(sql);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function value(db, sql) {
  return Object.values(db.prepare(sql).get())[0];
}

function sell(db, invoiceId, paid = 2500) {
  const customerId = paid < 2500 ? 1 : 'NULL';
  transactional(db, `
    INSERT INTO invoices(id, customer_id, total_minor, paid_minor, actor_id) VALUES (${invoiceId}, ${customerId}, 2500, ${paid}, 1);
    INSERT INTO invoice_items(invoice_id, product_id, product_name, quantity, unit_price_minor, unit_cost_minor)
      VALUES (${invoiceId}, 1, 'Demo product', 1, 2500, 1250);
    ${paid ? `INSERT INTO invoice_payments VALUES (${invoiceId}, ${invoiceId}, ${paid}, 'checkout', 1, CURRENT_TIMESTAMP);` : ''}
  `);
}

test('stock shortage rolls back invoice and full refund restores stock exactly once', t => {
  const db = database(t);
  sell(db, 1);
  assert.throws(() => sell(db, 2), /INSUFFICIENT_STOCK/);
  assert.equal(value(db, 'SELECT COUNT(*) FROM invoices'), 1);
  assert.equal(value(db, 'SELECT COUNT(*) FROM invoice_items'), 1);
  assert.equal(value(db, 'SELECT stock FROM products WHERE id = 1'), 0);
  db.exec("INSERT INTO invoice_refunds(id, invoice_id, total_minor, returned_minor, reason, actor_id) VALUES (10, 1, 2500, 2500, 'demo', 1)");
  assert.equal(value(db, 'SELECT stock FROM products WHERE id = 1'), 1);
  assert.equal(value(db, 'SELECT status FROM invoices WHERE id = 1'), 'refunded');
  assert.throws(() => db.exec("INSERT INTO invoice_refunds(id, invoice_id, total_minor, returned_minor, reason, actor_id) VALUES (11, 1, 2500, 2500, 'repeat', 1)"), /UNIQUE/);
  assert.equal(value(db, 'SELECT stock FROM products WHERE id = 1'), 1);
  assert.throws(() => db.exec('UPDATE inventory_movements SET delta = 12'), /IMMUTABLE_LEDGER/);
});

test('installment applies once to invoice and blocks direct and excess payments', t => {
  const db = database(t);
  sell(db, 1, 500);
  assert.throws(() => db.exec(`
    INSERT INTO installments(id, customer_id, invoice_id, principal_minor, due_date, actor_id)
      VALUES (5, 1, 1, 1900, '2030-02-01', 1)
  `), /INSTALLMENT_BALANCE_MISMATCH/);
  db.exec(`
    INSERT INTO installments(id, customer_id, invoice_id, principal_minor, due_date, actor_id)
      VALUES (5, 1, 1, 2000, '2030-02-01', 1);
    INSERT INTO installment_payments(id, installment_id, amount_minor, actor_id) VALUES (6, 5, 1200, 1);
  `);
  assert.equal(value(db, 'SELECT paid_minor FROM invoices WHERE id = 1'), 1700);
  assert.throws(() => db.exec("INSERT INTO invoice_payments(id, invoice_id, amount_minor, source_type, actor_id) VALUES (7, 1, 1, 'payment', 1)"), /USE_INSTALLMENT_PAYMENT/);
  assert.throws(() => db.exec('INSERT INTO installment_payments(id, installment_id, amount_minor, actor_id) VALUES (8, 5, 801, 1)'), /PAYMENT_EXCEEDS_BALANCE/);
  assert.equal(value(db, 'SELECT SUM(amount_minor) FROM invoice_payments WHERE invoice_id = 1'), 1700);
  db.exec('INSERT INTO installment_payments(id, installment_id, amount_minor, actor_id) VALUES (8, 5, 800, 1)');
  assert.equal(value(db, 'SELECT status FROM invoices WHERE id = 1'), 'paid');
  assert.equal(value(db, 'SELECT status FROM installments WHERE id = 5'), 'paid');
});

test('damage reversals and supplier payments preserve ledger balances', t => {
  const db = database(t);
  db.exec(`
    INSERT INTO damaged_stock(id, product_id, quantity, unit_cost_minor, reason, actor_id) VALUES (1, 1, 1, 1250, 'demo', 1);
    INSERT INTO damaged_stock_reversals(id, damage_id, reason, actor_id) VALUES (2, 1, 'demo', 1);
    INSERT INTO suppliers (id, name) VALUES (1, 'Demo vendor');
    INSERT INTO purchases (id, supplier_id, description, total_minor, purchase_date, actor_id)
      VALUES (1, 1, 'Demo purchase', 500, '2030-02-01', 1);
    INSERT INTO supplier_payments (id, purchase_id, amount_minor, actor_id) VALUES (1, 1, 300, 1);
  `);
  assert.equal(value(db, 'SELECT stock FROM products WHERE id = 1'), 1);
  assert.throws(() => db.exec("INSERT INTO damaged_stock_reversals(id, damage_id, reason, actor_id) VALUES (3, 1, 'repeat', 1)"), /UNIQUE/);
  assert.throws(() => db.exec('INSERT INTO supplier_payments (id, purchase_id, amount_minor, actor_id) VALUES (2, 1, 250, 1)'), /PAYMENT_EXCEEDS_BALANCE/);
  assert.equal(value(db, 'SELECT paid_minor FROM purchases WHERE id = 1'), 300);
});

test('wallet provider fee and cash commission have separate deltas, and reversal frees period limit', t => {
  const db = database(t);
  db.exec(`
    INSERT INTO wallets(id, name, daily_send_limit_minor, monthly_send_limit_minor) VALUES (1, 'Demo wallet', 1000, 2000);
    INSERT INTO wallet_transactions(id, wallet_id, kind, amount_minor, delta_minor, actor_id)
      VALUES (1, 1, 'opening', 1500, 1500, 1);
    INSERT INTO wallet_transactions(id, wallet_id, kind, amount_minor, commission_minor, fee_minor, delta_minor, cash_delta_minor, business_day, actor_id)
      VALUES (2, 1, 'send', 800, 60, 25, -825, 860, '2030-02-01', 1);
  `);
  assert.equal(value(db, 'SELECT balance_minor FROM wallets'), 675);
  assert.equal(value(db, 'SELECT SUM(cash_delta_minor) FROM wallet_transactions'), 860);
  const nextSend = `
    INSERT INTO wallet_transactions(id, wallet_id, kind, amount_minor, delta_minor, cash_delta_minor, business_day, actor_id)
      VALUES (3, 1, 'send', 500, -500, 500, '2030-02-01', 1)
  `;
  assert.throws(() => db.exec(nextSend), /WALLET_BALANCE_OR_LIMIT/);
  db.exec(`
    INSERT INTO wallet_transactions(id, wallet_id, kind, amount_minor, commission_minor, fee_minor, delta_minor, cash_delta_minor, reversal_of, actor_id)
      VALUES (4, 1, 'reversal', 800, 60, 25, 825, -860, 2, 1);
  `);
  assert.equal(value(db, 'SELECT balance_minor FROM wallets'), 1500);
  db.exec(nextSend);
  assert.equal(value(db, 'SELECT balance_minor FROM wallets'), 1000);
  assert.throws(() => db.exec('UPDATE wallet_transactions SET amount_minor = 1'), /IMMUTABLE_LEDGER/);
});

test('partial deferred settlement blocks reversal and cannot oversettle', t => {
  const db = database(t);
  db.exec(`
    INSERT INTO wallets(id, name) VALUES (1, 'Demo wallet');
    INSERT INTO wallet_transactions(id, wallet_id, kind, amount_minor, delta_minor, actor_id)
      VALUES (1, 1, 'opening', 1500, 1500, 1);
    INSERT INTO wallet_transactions(id, wallet_id, kind, amount_minor, commission_minor, delta_minor, actor_id)
      VALUES (2, 1, 'send', 500, 50, -500, 1);
    INSERT INTO wallet_debts(id, wallet_transaction_id, customer_id, direction, principal_minor)
      VALUES (2, 2, 1, 'receivable', 550);
    INSERT INTO wallet_debt_payments(id, wallet_debt_id, amount_minor, actor_id) VALUES (3, 2, 300, 1);
  `);
  assert.throws(() => db.exec('INSERT INTO wallet_debt_payments(id, wallet_debt_id, amount_minor, actor_id) VALUES (4, 2, 251, 1)'), /PAYMENT_EXCEEDS_BALANCE/);
  assert.throws(() => db.exec(`
    INSERT INTO wallet_transactions(id, wallet_id, kind, amount_minor, commission_minor, delta_minor, reversal_of, actor_id)
      VALUES (5, 1, 'reversal', 500, 50, 500, 2, 1)
  `), /WALLET_DEBT_SETTLED/);
  db.exec('INSERT INTO wallet_debt_payments(id, wallet_debt_id, amount_minor, actor_id) VALUES (4, 2, 250, 1)');
  assert.equal(value(db, 'SELECT status FROM wallet_debts'), 'paid');
  assert.equal(value(db, 'SELECT balance_minor FROM wallets'), 1000);
});

test('idempotency journal keys are unique per actor and failed operations can retry', t => {
  const db = database(t);
  assert.throws(() => transactional(db, `
    INSERT INTO business_operations(actor_id, request_key, operation, fingerprint) VALUES (1, 'request-key', 'test', 'a');
    INSERT INTO inventory_movements(product_id, delta, source_type, source_id, actor_id)
      VALUES (1, -2, 'adjustment', 99, 1);
  `), /INSUFFICIENT_STOCK/);
  assert.equal(value(db, 'SELECT COUNT(*) FROM business_operations'), 0);
  db.exec("INSERT INTO business_operations(actor_id, request_key, operation, fingerprint) VALUES (1, 'request-key', 'test', 'a')");
  assert.throws(() => db.exec("INSERT INTO business_operations(actor_id, request_key, operation, fingerprint) VALUES (1, 'request-key', 'test', 'b')"), /UNIQUE/);
});
