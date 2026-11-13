ALTER TABLE suppliers ADD COLUMN email TEXT;
ALTER TABLE suppliers ADD COLUMN opening_minor INTEGER NOT NULL DEFAULT 0 CHECK (opening_minor BETWEEN 0 AND 900000000000000);

ALTER TABLE purchases ADD COLUMN payment_type TEXT NOT NULL DEFAULT 'credit' CHECK (payment_type IN ('cash', 'credit'));
ALTER TABLE supplier_payments ADD COLUMN payment_date TEXT;
CREATE INDEX purchases_supplier_oldest_idx ON purchases(supplier_id, purchase_date, id)
  WHERE paid_minor < total_minor;

CREATE TABLE supplier_receipts (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  opening_applied_minor INTEGER NOT NULL CHECK (opening_applied_minor BETWEEN 0 AND amount_minor),
  payment_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX supplier_receipts_supplier_idx ON supplier_receipts(supplier_id, id DESC);

CREATE TABLE supplier_receipt_allocations (
  receipt_id INTEGER NOT NULL REFERENCES supplier_receipts(id) ON DELETE RESTRICT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  PRIMARY KEY (receipt_id, purchase_id)
) STRICT;
CREATE INDEX supplier_receipt_allocations_purchase_idx ON supplier_receipt_allocations(purchase_id, receipt_id);

CREATE VIEW supplier_balances AS
SELECT s.*, COALESCE(p.purchase_total_minor, 0) AS purchase_total_minor,
  COALESCE(p.purchase_paid_minor, 0) AS purchase_paid_minor,
  COALESCE(p.purchases_count, 0) AS purchases_count,
  COALESCE(r.opening_paid_minor, 0) AS opening_paid_minor,
  s.opening_minor - COALESCE(r.opening_paid_minor, 0) + COALESCE(p.purchase_due_minor, 0) AS balance_minor
FROM suppliers s
LEFT JOIN (
  SELECT supplier_id, SUM(total_minor) AS purchase_total_minor, SUM(paid_minor) AS purchase_paid_minor,
    SUM(total_minor - paid_minor) AS purchase_due_minor, COUNT(*) AS purchases_count
  FROM purchases GROUP BY supplier_id
) p ON p.supplier_id = s.id
LEFT JOIN (
  SELECT supplier_id, SUM(opening_applied_minor) AS opening_paid_minor
  FROM supplier_receipts GROUP BY supplier_id
) r ON r.supplier_id = s.id;

CREATE TRIGGER supplier_opening_above_allocations BEFORE UPDATE OF opening_minor ON suppliers
WHEN NEW.opening_minor < (
  SELECT COALESCE(SUM(opening_applied_minor), 0) FROM supplier_receipts WHERE supplier_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'SUPPLIER_OPENING_PAID');
END;

CREATE TRIGGER allocate_supplier_receipt AFTER INSERT ON supplier_receipts
BEGIN
  SELECT CASE WHEN NEW.opening_applied_minor <> MAX(0, NEW.amount_minor - (
      SELECT COALESCE(SUM(total_minor - paid_minor), 0) FROM purchases WHERE supplier_id = NEW.supplier_id
    )) OR NEW.opening_applied_minor > (
      SELECT opening_minor FROM suppliers WHERE id = NEW.supplier_id
    ) - (
      SELECT COALESCE(SUM(opening_applied_minor), 0) FROM supplier_receipts
      WHERE supplier_id = NEW.supplier_id AND id <> NEW.id
    )
    THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;

  INSERT INTO supplier_receipt_allocations(receipt_id, purchase_id, amount_minor)
  SELECT NEW.id, ranked.id, MIN(ranked.due, NEW.amount_minor - ranked.previous_due)
  FROM (
    SELECT id, total_minor - paid_minor AS due,
      COALESCE(SUM(total_minor - paid_minor) OVER (
        ORDER BY purchase_date, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0) AS previous_due
    FROM purchases WHERE supplier_id = NEW.supplier_id AND paid_minor < total_minor
  ) ranked
  WHERE NEW.amount_minor > ranked.previous_due;
END;

CREATE TRIGGER apply_supplier_receipt_allocation AFTER INSERT ON supplier_receipt_allocations
BEGIN
  UPDATE purchases SET paid_minor = paid_minor + NEW.amount_minor
  WHERE id = NEW.purchase_id AND paid_minor + NEW.amount_minor <= total_minor
    AND supplier_id = (SELECT supplier_id FROM supplier_receipts WHERE id = NEW.receipt_id);
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
END;

ALTER TABLE personal_debts ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE personal_debt_payments ADD COLUMN note TEXT NOT NULL DEFAULT '';

CREATE TABLE debt_voids (
  id INTEGER PRIMARY KEY,
  debt_id INTEGER NOT NULL UNIQUE REFERENCES personal_debts(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TRIGGER void_unpaid_personal_debt BEFORE INSERT ON debt_voids
WHEN NOT EXISTS (SELECT 1 FROM personal_debts WHERE id = NEW.debt_id AND paid_minor = 0)
BEGIN
  SELECT RAISE(ABORT, 'HAS_FINANCIAL_HISTORY');
END;

CREATE TRIGGER payment_requires_active_debt BEFORE INSERT ON personal_debt_payments
WHEN EXISTS (SELECT 1 FROM debt_voids WHERE debt_id = NEW.debt_id)
BEGIN
  SELECT RAISE(ABORT, 'RECORD_VOIDED');
END;

CREATE TABLE installment_voids (
  id INTEGER PRIMARY KEY,
  installment_id INTEGER NOT NULL UNIQUE REFERENCES installments(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TRIGGER apply_installment_void AFTER INSERT ON installment_voids
BEGIN
  UPDATE installments SET voided_at = NEW.created_at, updated_at = NEW.created_at
    WHERE id = NEW.installment_id AND voided_at IS NULL AND invoice_id IS NULL AND paid_minor = 0;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'HAS_FINANCIAL_HISTORY') END;
END;

ALTER TABLE damaged_stock ADD COLUMN damaged_on TEXT;
ALTER TABLE damaged_stock ADD COLUMN notes TEXT NOT NULL DEFAULT '';
CREATE INDEX damaged_stock_date_idx ON damaged_stock(COALESCE(damaged_on, date(created_at)));

CREATE TABLE damaged_stock_corrections (
  id INTEGER PRIMARY KEY,
  damage_id INTEGER NOT NULL REFERENCES damaged_stock(id) ON DELETE RESTRICT,
  previous_quantity INTEGER NOT NULL CHECK (previous_quantity BETWEEN 1 AND 1000000),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  previous_unit_minor INTEGER NOT NULL CHECK (previous_unit_minor >= 0),
  unit_value_minor INTEGER NOT NULL CHECK (unit_value_minor >= 0 AND unit_value_minor * quantity <= 900000000000000),
  previous_reason TEXT NOT NULL,
  reason TEXT NOT NULL,
  previous_damaged_on TEXT,
  damaged_on TEXT NOT NULL,
  previous_notes TEXT NOT NULL,
  notes TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX damaged_stock_corrections_damage_idx ON damaged_stock_corrections(damage_id, id DESC);

CREATE TRIGGER apply_damage_correction AFTER INSERT ON damaged_stock_corrections
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM damaged_stock_reversals WHERE damage_id = NEW.damage_id)
    THEN RAISE(ABORT, 'RECORD_VOIDED') END;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id)
    SELECT product_id, NEW.previous_quantity - NEW.quantity, 'adjustment', NEW.id, NEW.reason, NEW.actor_id
    FROM damaged_stock WHERE id = NEW.damage_id AND NEW.previous_quantity <> NEW.quantity;
  UPDATE damaged_stock SET quantity = NEW.quantity, unit_cost_minor = NEW.unit_value_minor,
    reason = NEW.reason, damaged_on = NEW.damaged_on, notes = NEW.notes
    WHERE id = NEW.damage_id;
END;

ALTER TABLE maintenance_requests ADD COLUMN archived_at TEXT;
ALTER TABLE maintenance_requests ADD COLUMN archived_by INTEGER REFERENCES users(id) ON DELETE RESTRICT;
CREATE INDEX maintenance_active_dates_idx ON maintenance_requests(requested_date, id) WHERE archived_at IS NULL;

CREATE TRIGGER payment_requires_active_maintenance BEFORE INSERT ON maintenance_payments
WHEN EXISTS (SELECT 1 FROM maintenance_requests WHERE id = NEW.maintenance_id AND archived_at IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'RECORD_VOIDED');
END;

ALTER TABLE wallet_transactions ADD COLUMN counterparty TEXT NOT NULL DEFAULT '';

CREATE TABLE wallet_profit_withdrawals (
  id INTEGER PRIMARY KEY,
  wallet_id INTEGER REFERENCES wallets(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  business_day TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE VIEW wallet_financial_totals AS
WITH ledger AS (
  SELECT
    (SELECT COALESCE(SUM(cash_delta_minor), 0) FROM wallet_transactions)
      + (SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_debt_payments)
      + (SELECT COALESCE(SUM(delta_minor), 0) FROM wallet_cash_entries)
      - (SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_profit_withdrawals WHERE wallet_id IS NULL) AS drawer_minor,
    (SELECT COALESCE(SUM(balance_minor), 0) FROM wallets) AS provider_balance_minor,
    (SELECT COALESCE(SUM(principal_minor - paid_minor), 0) FROM wallet_debts WHERE voided_at IS NULL) AS receivables_minor,
    (SELECT COALESCE(SUM(t.commission_minor - t.fee_minor), 0)
      FROM wallet_transactions t WHERE t.kind IN ('send', 'receive')
        AND NOT EXISTS (SELECT 1 FROM wallet_transactions r WHERE r.reversal_of = t.id)) AS transfer_margin_minor,
    (SELECT COALESCE(SUM(-delta_minor), 0) FROM wallet_cash_entries
      WHERE kind IN ('expense', 'expense_reversal')) AS drawer_expense_minor,
    (SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_profit_withdrawals) AS profit_withdrawn_minor
), balance AS (
  SELECT *, transfer_margin_minor - drawer_expense_minor - profit_withdrawn_minor AS profit_available_minor
  FROM ledger
)
SELECT *, provider_balance_minor + drawer_minor + receivables_minor - profit_available_minor AS working_capital_minor
FROM balance;

CREATE TRIGGER validate_wallet_profit_withdrawal BEFORE INSERT ON wallet_profit_withdrawals
BEGIN
  SELECT CASE WHEN NEW.amount_minor > profit_available_minor OR (NEW.wallet_id IS NULL AND NEW.amount_minor > drawer_minor)
    THEN RAISE(ABORT, 'PROFIT_OR_SOURCE_BALANCE') END FROM wallet_financial_totals;
  SELECT CASE WHEN NEW.wallet_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM wallets WHERE id = NEW.wallet_id AND active = 1 AND balance_minor >= NEW.amount_minor
  ) THEN RAISE(ABORT, 'PROFIT_OR_SOURCE_BALANCE') END;
END;

CREATE TRIGGER apply_wallet_profit_withdrawal AFTER INSERT ON wallet_profit_withdrawals WHEN NEW.wallet_id IS NOT NULL
BEGIN
  INSERT INTO wallet_transactions(id, wallet_id, kind, amount_minor, delta_minor, business_day, note, actor_id)
    VALUES (NEW.id, NEW.wallet_id, 'settlement_out', NEW.amount_minor, -NEW.amount_minor, NEW.business_day, NEW.note, NEW.actor_id);
END;

DROP TRIGGER apply_wallet_transaction;
CREATE TRIGGER apply_wallet_transaction AFTER INSERT ON wallet_transactions
BEGIN
  UPDATE wallets SET balance_minor = balance_minor + NEW.delta_minor, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.wallet_id AND (active = 1 OR NEW.kind = 'reversal')
      AND balance_minor + NEW.delta_minor BETWEEN 0 AND 900000000000000
      AND (NEW.kind IN ('opening', 'reversal') OR transaction_limit_minor IS NULL OR NEW.amount_minor <= transaction_limit_minor
        OR EXISTS (SELECT 1 FROM wallet_profit_withdrawals WHERE id = NEW.id AND wallet_id = NEW.wallet_id));
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'WALLET_BALANCE_OR_LIMIT') END;
END;

CREATE TRIGGER wallet_profit_no_update BEFORE UPDATE ON wallet_profit_withdrawals
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TRIGGER wallet_profit_no_delete BEFORE DELETE ON wallet_profit_withdrawals
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TRIGGER wallet_profit_no_generic_reversal BEFORE INSERT ON wallet_transactions
WHEN NEW.kind = 'reversal' AND EXISTS (
  SELECT 1 FROM wallet_profit_withdrawals WHERE id = NEW.reversal_of AND wallet_id IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_WALLET_REVERSAL');
END;
