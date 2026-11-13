ALTER TABLE wallets ADD COLUMN default_commission_bps INTEGER NOT NULL DEFAULT 0 CHECK (default_commission_bps BETWEEN 0 AND 10000);
ALTER TABLE wallets ADD COLUMN default_commission_min_minor INTEGER NOT NULL DEFAULT 0 CHECK (default_commission_min_minor BETWEEN 0 AND 900000000000000);
ALTER TABLE wallets ADD COLUMN default_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (default_fee_bps BETWEEN 0 AND 10000);
ALTER TABLE wallets ADD COLUMN default_fee_min_minor INTEGER NOT NULL DEFAULT 0 CHECK (default_fee_min_minor BETWEEN 0 AND 900000000000000);
ALTER TABLE wallets ADD COLUMN default_fee_max_minor INTEGER CHECK (default_fee_max_minor BETWEEN default_fee_min_minor AND 900000000000000);

CREATE TABLE wallet_adjustments (
  id INTEGER PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  delta_minor INTEGER NOT NULL CHECK (delta_minor BETWEEN -900000000000000 AND 900000000000000 AND delta_minor <> 0),
  reason TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  business_day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX wallet_adjustments_wallet_idx ON wallet_adjustments(wallet_id, id DESC);

CREATE TRIGGER apply_wallet_adjustment AFTER INSERT ON wallet_adjustments
BEGIN
  INSERT INTO wallet_transactions(id, wallet_id, kind, amount_minor, delta_minor, business_day, note, actor_id)
  VALUES (NEW.id, NEW.wallet_id, CASE WHEN NEW.delta_minor > 0 THEN 'settlement_in' ELSE 'settlement_out' END,
    ABS(NEW.delta_minor), NEW.delta_minor, NEW.business_day, NEW.reason, NEW.actor_id);
END;

CREATE TRIGGER wallet_adjustment_no_generic_reversal BEFORE INSERT ON wallet_transactions
WHEN NEW.kind = 'reversal' AND EXISTS (SELECT 1 FROM wallet_adjustments WHERE id = NEW.reversal_of)
BEGIN
  SELECT RAISE(ABORT, 'INVALID_WALLET_REVERSAL');
END;

DROP TRIGGER apply_wallet_transaction;
CREATE TRIGGER apply_wallet_transaction AFTER INSERT ON wallet_transactions
BEGIN
  UPDATE wallets SET balance_minor = balance_minor + NEW.delta_minor, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.wallet_id AND (active = 1 OR NEW.kind = 'reversal')
      AND balance_minor + NEW.delta_minor BETWEEN 0 AND 900000000000000
      AND (NEW.kind IN ('opening', 'reversal') OR transaction_limit_minor IS NULL OR NEW.amount_minor <= transaction_limit_minor
        OR EXISTS (SELECT 1 FROM wallet_profit_withdrawals WHERE id = NEW.id AND wallet_id = NEW.wallet_id)
        OR EXISTS (SELECT 1 FROM wallet_adjustments WHERE id = NEW.id AND wallet_id = NEW.wallet_id));
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'WALLET_BALANCE_OR_LIMIT') END;
END;

CREATE TABLE damaged_stock_images (
  record_id INTEGER PRIMARY KEY REFERENCES damaged_stock(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  content BLOB NOT NULL CHECK (length(content) BETWEEN 1 AND 131072),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE maintenance_images (
  record_id INTEGER PRIMARY KEY REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  content BLOB NOT NULL CHECK (length(content) BETWEEN 1 AND 131072),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TRIGGER damaged_stock_images_demo_cap BEFORE INSERT ON damaged_stock_images
WHEN NOT EXISTS (SELECT 1 FROM damaged_stock_images WHERE record_id = NEW.record_id)
  AND (SELECT COUNT(*) FROM damaged_stock_images) >= 100
BEGIN
  SELECT RAISE(ABORT, 'BUSINESS_IMAGE_CAPACITY');
END;

CREATE TRIGGER maintenance_images_demo_cap BEFORE INSERT ON maintenance_images
WHEN NOT EXISTS (SELECT 1 FROM maintenance_images WHERE record_id = NEW.record_id)
  AND (SELECT COUNT(*) FROM maintenance_images) >= 100
BEGIN
  SELECT RAISE(ABORT, 'BUSINESS_IMAGE_CAPACITY');
END;
