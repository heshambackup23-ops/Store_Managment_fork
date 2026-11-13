CREATE TABLE wallet_reconciliations (
  id INTEGER PRIMARY KEY,
  target TEXT NOT NULL CHECK (target IN ('drawer', 'wallet')),
  wallet_id INTEGER REFERENCES wallets(id),
  wallet_name TEXT,
  expected_minor INTEGER NOT NULL CHECK (expected_minor BETWEEN -8000000000000000 AND 8000000000000000),
  observed_minor INTEGER NOT NULL CHECK (observed_minor BETWEEN 0 AND 900000000000000),
  reason TEXT NOT NULL CHECK (length(reason) <= 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  actor_name TEXT NOT NULL,
  business_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  request_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  UNIQUE (actor_id, request_key),
  CHECK ((target = 'drawer' AND wallet_id IS NULL AND wallet_name IS NULL)
    OR (target = 'wallet' AND wallet_id IS NOT NULL AND wallet_name IS NOT NULL)),
  CHECK (expected_minor = observed_minor OR length(trim(reason)) > 0)
) STRICT;

CREATE INDEX wallet_reconciliations_target ON wallet_reconciliations(target, wallet_id, id DESC);
CREATE INDEX wallet_reconciliations_day ON wallet_reconciliations(business_day, id DESC);

CREATE TRIGGER wallet_reconciliations_no_update BEFORE UPDATE ON wallet_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TRIGGER wallet_reconciliations_no_delete BEFORE DELETE ON wallet_reconciliations
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TRIGGER wallet_reconciliations_audit AFTER INSERT ON wallet_reconciliations
BEGIN
  INSERT INTO audit_logs(actor_id, action, entity_type, entity_id, created_at)
  VALUES (NEW.actor_id, 'wallet.reconcile', 'wallet_reconciliation', NEW.id, NEW.created_at);
END;

CREATE VIEW wallet_reconciliation_targets AS
SELECT 'drawer' AS target, NULL AS wallet_id, NULL AS wallet_name, drawer_minor AS expected_minor
FROM wallet_financial_totals
UNION ALL
SELECT 'wallet', id, name, balance_minor FROM wallets;
