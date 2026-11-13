CREATE TABLE retail_service_cash (
  operation_id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  shift_id INTEGER NOT NULL REFERENCES retail_shifts(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  source TEXT NOT NULL CHECK(source IN ('maintenance_cash','wallet_cash')),
  delta_minor INTEGER NOT NULL CHECK(delta_minor BETWEEN -900000000000000 AND 900000000000000 AND delta_minor <> 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX retail_service_cash_shift ON retail_service_cash(shift_id, operation_id);
CREATE INDEX retail_service_cash_source ON retail_service_cash(source, operation_id);

DROP VIEW retail_shift_positions;
CREATE VIEW retail_shift_positions AS
WITH positions AS (
  SELECT s.*,
    COALESCE((SELECT sum(m.delta_minor) FROM retail_cash_movements m WHERE m.shift_id = s.id), 0) AS cash_movements_minor,
    COALESCE((SELECT sum(m.delta_minor) FROM retail_service_cash m WHERE m.shift_id = s.id), 0) AS service_cash_minor
  FROM retail_shifts s
)
SELECT s.id, s.register_name, s.actor_id, s.actor_name, s.opening_minor, s.business_day, s.opened_at,
  CASE WHEN c.shift_id IS NULL THEN 'open' WHEN a.shift_id IS NOT NULL THEN 'approved'
    WHEN c.observed_minor <> c.expected_minor THEN 'pending_approval' ELSE 'closed' END AS status,
  COALESCE(c.expected_minor, s.opening_minor + s.cash_movements_minor + s.service_cash_minor + COALESCE((SELECT sum(t.delta_minor)
    FROM retail_tender_ledger t WHERE t.shift_id = s.id AND t.method = 'cash'), 0)) AS expected_minor,
  c.observed_minor, c.observed_minor - c.expected_minor AS difference_minor,
  c.closed_by, c.close_reason, c.closed_at, a.approved_by, a.approval_reason, a.approved_at,
  s.cash_movements_minor, s.service_cash_minor
FROM positions s LEFT JOIN retail_shift_closures c ON c.shift_id = s.id
LEFT JOIN retail_shift_approvals a ON a.shift_id = s.id;

CREATE TRIGGER retail_service_cash_validate BEFORE INSERT ON retail_service_cash BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_shifts s WHERE s.id = NEW.shift_id AND s.actor_id = NEW.actor_id
    AND NOT EXISTS (SELECT 1 FROM retail_shift_closures c WHERE c.shift_id = s.id))
    THEN RAISE(ABORT, 'RETAIL_SHIFT_UNAVAILABLE') END;
  SELECT CASE WHEN NEW.source = 'maintenance_cash' AND NOT EXISTS (SELECT 1 FROM maintenance_payments p
    WHERE p.id = NEW.operation_id AND p.actor_id = NEW.actor_id AND p.amount_minor = NEW.delta_minor)
    THEN RAISE(ABORT, 'RETAIL_SERVICE_SOURCE') END;
  SELECT CASE WHEN NEW.source = 'wallet_cash' AND NOT EXISTS (SELECT 1 FROM wallet_transactions t
    WHERE t.id = NEW.operation_id AND t.actor_id = NEW.actor_id AND t.cash_delta_minor = NEW.delta_minor
      AND (t.kind IN ('send','receive') OR (t.kind = 'reversal' AND EXISTS (SELECT 1 FROM retail_service_cash x
        WHERE x.operation_id = t.reversal_of AND x.source = 'wallet_cash'))))
    THEN RAISE(ABORT, 'RETAIL_SERVICE_SOURCE') END;
  SELECT CASE WHEN NEW.delta_minor < 0 AND -NEW.delta_minor > (
    SELECT expected_minor FROM retail_shift_positions WHERE id = NEW.shift_id
  ) THEN RAISE(ABORT, 'RETAIL_CASH_MOVEMENT_BALANCE') END;
  SELECT CASE WHEN NEW.delta_minor > 0 AND NEW.delta_minor + (
    SELECT expected_minor FROM retail_shift_positions WHERE id = NEW.shift_id
  ) > 8000000000000000 THEN RAISE(ABORT, 'RETAIL_CASH_MOVEMENT_BALANCE') END;
END;

CREATE TRIGGER retail_service_cash_no_update BEFORE UPDATE ON retail_service_cash
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_service_cash_no_delete BEFORE DELETE ON retail_service_cash
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

DROP VIEW wallet_financial_totals;
CREATE VIEW wallet_financial_totals AS
WITH ledger AS (
  SELECT
    (SELECT COALESCE(SUM(t.cash_delta_minor), 0) FROM wallet_transactions t WHERE NOT EXISTS (
      SELECT 1 FROM retail_service_cash r WHERE r.operation_id = t.id AND r.source = 'wallet_cash'))
      + (SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_debt_payments)
      + (SELECT COALESCE(SUM(delta_minor), 0) FROM wallet_cash_entries)
      - (SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_profit_withdrawals WHERE wallet_id IS NULL) AS drawer_minor,
    (SELECT COALESCE(SUM(balance_minor), 0) FROM wallets) AS provider_balance_minor,
    (SELECT COALESCE(SUM(principal_minor - paid_minor), 0) FROM wallet_debts WHERE voided_at IS NULL) AS receivables_minor,
    (SELECT COALESCE(SUM(t.commission_minor - t.fee_minor), 0) FROM wallet_transactions t WHERE t.kind IN ('send','receive')
      AND NOT EXISTS (SELECT 1 FROM wallet_transactions r WHERE r.reversal_of = t.id)) AS transfer_margin_minor,
    (SELECT COALESCE(SUM(-delta_minor), 0) FROM wallet_cash_entries WHERE kind IN ('expense', 'expense_reversal')) AS drawer_expense_minor,
    (SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_profit_withdrawals) AS profit_withdrawn_minor,
    (SELECT COALESCE(SUM(delta_minor), 0) FROM retail_service_cash WHERE source = 'wallet_cash') AS shared_drawer_minor
), balance AS (
  SELECT *, transfer_margin_minor - drawer_expense_minor - profit_withdrawn_minor AS profit_available_minor FROM ledger
)
SELECT *, provider_balance_minor + drawer_minor + shared_drawer_minor + receivables_minor - profit_available_minor AS working_capital_minor
FROM balance;
