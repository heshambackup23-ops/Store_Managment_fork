ALTER TABLE wallet_profit_withdrawals ADD COLUMN shared_shift_id INTEGER REFERENCES retail_shifts(id);

CREATE TABLE retail_wallet_drawer (
  operation_id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  shift_id INTEGER NOT NULL REFERENCES retail_shifts(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  source TEXT NOT NULL CHECK (source IN ('wallet_collection','wallet_expense','wallet_profit')),
  delta_minor INTEGER NOT NULL CHECK (delta_minor BETWEEN -900000000000000 AND 900000000000000 AND delta_minor <> 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX retail_wallet_drawer_shift ON retail_wallet_drawer(shift_id, operation_id);

CREATE VIEW retail_drawer_service_ledger AS SELECT * FROM retail_service_cash UNION ALL SELECT * FROM retail_wallet_drawer;

DROP VIEW retail_shift_positions;
CREATE VIEW retail_shift_positions AS
WITH positions AS (
  SELECT s.*,
    COALESCE((SELECT sum(m.delta_minor) FROM retail_cash_movements m WHERE m.shift_id = s.id), 0) AS cash_movements_minor,
    COALESCE((SELECT sum(m.delta_minor) FROM retail_drawer_service_ledger m WHERE m.shift_id = s.id), 0) AS service_cash_minor
  FROM retail_shifts s
)
SELECT s.id, s.register_name, s.actor_id, s.actor_name, s.opening_minor, s.business_day, s.opened_at,
  CASE WHEN c.shift_id IS NULL THEN 'open' WHEN a.shift_id IS NOT NULL THEN 'approved'
    WHEN c.emergency_close = 1 OR c.observed_minor <> c.expected_minor THEN 'pending_approval' ELSE 'closed' END AS status,
  COALESCE(c.expected_minor, s.opening_minor + s.cash_movements_minor + s.service_cash_minor + COALESCE((SELECT sum(t.delta_minor)
    FROM retail_tender_ledger t WHERE t.shift_id = s.id AND t.method = 'cash'), 0)) AS expected_minor,
  c.observed_minor, c.observed_minor - c.expected_minor AS difference_minor,
  c.closed_by, closer.name AS closed_by_name, c.close_reason, c.closed_at, c.emergency_close,
  a.approved_by, a.approval_reason, a.approved_at, s.cash_movements_minor, s.service_cash_minor
FROM positions s LEFT JOIN retail_shift_closures c ON c.shift_id = s.id
LEFT JOIN users closer ON closer.id = c.closed_by LEFT JOIN retail_shift_approvals a ON a.shift_id = s.id;

CREATE TRIGGER retail_wallet_drawer_validate BEFORE INSERT ON retail_wallet_drawer BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_shift_positions s WHERE s.id = NEW.shift_id AND s.actor_id = NEW.actor_id
    AND s.status = 'open') THEN RAISE(ABORT, 'RETAIL_SHIFT_UNAVAILABLE') END;
  SELECT CASE WHEN NOT (
    NEW.source = 'wallet_collection' AND EXISTS (SELECT 1 FROM wallet_debt_payments p JOIN wallet_debts d ON d.id = p.wallet_debt_id
      WHERE p.id = NEW.operation_id AND d.direction = 'receivable' AND p.actor_id = NEW.actor_id AND p.amount_minor = NEW.delta_minor)
    OR NEW.source = 'wallet_expense' AND EXISTS (SELECT 1 FROM wallet_cash_entries e WHERE e.id = NEW.operation_id
      AND e.kind IN ('expense','expense_reversal') AND e.actor_id = NEW.actor_id AND e.delta_minor = NEW.delta_minor)
    OR NEW.source = 'wallet_profit' AND EXISTS (SELECT 1 FROM wallet_profit_withdrawals p WHERE p.id = NEW.operation_id
      AND p.shared_shift_id = NEW.shift_id AND p.wallet_id IS NULL AND p.actor_id = NEW.actor_id AND -p.amount_minor = NEW.delta_minor)
  ) THEN RAISE(ABORT, 'RETAIL_SERVICE_SOURCE') END;
  SELECT CASE WHEN (SELECT expected_minor FROM retail_shift_positions WHERE id = NEW.shift_id) + NEW.delta_minor
    NOT BETWEEN 0 AND 8000000000000000 THEN RAISE(ABORT, 'RETAIL_CASH_MOVEMENT_BALANCE') END;
END;
CREATE TRIGGER retail_wallet_drawer_no_update BEFORE UPDATE ON retail_wallet_drawer BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_wallet_drawer_no_delete BEFORE DELETE ON retail_wallet_drawer BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

DROP VIEW wallet_financial_totals;
CREATE VIEW wallet_financial_totals AS
WITH ledger AS (
  SELECT
    (SELECT COALESCE(SUM(t.cash_delta_minor), 0) FROM wallet_transactions t WHERE NOT EXISTS (
      SELECT 1 FROM retail_service_cash r WHERE r.operation_id = t.id AND r.source = 'wallet_cash'))
      + (SELECT COALESCE(SUM(p.amount_minor), 0) FROM wallet_debt_payments p WHERE NOT EXISTS (
        SELECT 1 FROM retail_wallet_drawer r WHERE r.operation_id = p.id AND r.source = 'wallet_collection'))
      + (SELECT COALESCE(SUM(e.delta_minor), 0) FROM wallet_cash_entries e WHERE NOT EXISTS (
        SELECT 1 FROM retail_wallet_drawer r WHERE r.operation_id = e.id AND r.source = 'wallet_expense'))
      - (SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_profit_withdrawals WHERE wallet_id IS NULL AND shared_shift_id IS NULL) AS drawer_minor,
    (SELECT COALESCE(SUM(balance_minor), 0) FROM wallets) AS provider_balance_minor,
    (SELECT COALESCE(SUM(principal_minor - paid_minor), 0) FROM wallet_debts WHERE voided_at IS NULL) AS receivables_minor,
    (SELECT COALESCE(SUM(t.commission_minor - t.fee_minor), 0) FROM wallet_transactions t WHERE t.kind IN ('send','receive')
      AND NOT EXISTS (SELECT 1 FROM wallet_transactions r WHERE r.reversal_of = t.id)) AS transfer_margin_minor,
    (SELECT COALESCE(SUM(-delta_minor), 0) FROM wallet_cash_entries WHERE kind IN ('expense', 'expense_reversal')) AS drawer_expense_minor,
    (SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_profit_withdrawals) AS profit_withdrawn_minor,
    (SELECT COALESCE(SUM(delta_minor), 0) FROM retail_drawer_service_ledger WHERE source <> 'maintenance_cash') AS shared_drawer_minor
), balance AS (
  SELECT *, transfer_margin_minor - drawer_expense_minor - profit_withdrawn_minor AS profit_available_minor FROM ledger
)
SELECT *, provider_balance_minor + drawer_minor + shared_drawer_minor + receivables_minor - profit_available_minor AS working_capital_minor
FROM balance;

DROP TRIGGER validate_wallet_profit_withdrawal;
CREATE TRIGGER validate_wallet_profit_withdrawal BEFORE INSERT ON wallet_profit_withdrawals BEGIN
  SELECT CASE WHEN NEW.amount_minor > profit_available_minor OR
    (NEW.wallet_id IS NULL AND NEW.shared_shift_id IS NULL AND NEW.amount_minor > drawer_minor)
    THEN RAISE(ABORT, 'PROFIT_OR_SOURCE_BALANCE') END FROM wallet_financial_totals;
  SELECT CASE WHEN NEW.wallet_id IS NOT NULL AND (NEW.shared_shift_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM wallets WHERE id = NEW.wallet_id AND active = 1 AND balance_minor >= NEW.amount_minor))
    THEN RAISE(ABORT, 'PROFIT_OR_SOURCE_BALANCE') END;
END;
