ALTER TABLE wallets ADD COLUMN holder_name TEXT NOT NULL DEFAULT '';
ALTER TABLE wallets ADD COLUMN notes TEXT NOT NULL DEFAULT '';
ALTER TABLE wallets ADD COLUMN warn_at_percent INTEGER NOT NULL DEFAULT 80 CHECK (warn_at_percent BETWEEN 1 AND 100);

CREATE TABLE legacy_wallet_sources (
  source_table TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  target_table TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  PRIMARY KEY (source_table, source_id),
  UNIQUE (target_table, target_id)
) STRICT;

CREATE TRIGGER legacy_wallet_sources_no_update BEFORE UPDATE ON legacy_wallet_sources
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TRIGGER legacy_wallet_sources_no_delete BEFORE DELETE ON legacy_wallet_sources
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

DROP TRIGGER apply_wallet_adjustment;
CREATE TRIGGER apply_wallet_adjustment AFTER INSERT ON wallet_adjustments
BEGIN
  INSERT INTO wallet_transactions (id, wallet_id, kind, amount_minor, delta_minor, business_day, note, actor_id, created_at)
  VALUES (NEW.id, NEW.wallet_id, CASE WHEN NEW.delta_minor > 0 THEN 'settlement_in' ELSE 'settlement_out' END,
    ABS(NEW.delta_minor), NEW.delta_minor, NEW.business_day, NEW.reason, NEW.actor_id, NEW.created_at);
END;

DROP TRIGGER apply_wallet_profit_withdrawal;
CREATE TRIGGER apply_wallet_profit_withdrawal AFTER INSERT ON wallet_profit_withdrawals WHEN NEW.wallet_id IS NOT NULL
BEGIN
  INSERT INTO wallet_transactions (id, wallet_id, kind, amount_minor, delta_minor, business_day, note, actor_id, created_at)
  VALUES (NEW.id, NEW.wallet_id, 'settlement_out', NEW.amount_minor, -NEW.amount_minor, NEW.business_day, NEW.note, NEW.actor_id, NEW.created_at);
END;
