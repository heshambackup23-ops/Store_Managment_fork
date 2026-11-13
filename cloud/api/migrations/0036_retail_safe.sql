CREATE TABLE retail_safe_opening (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  operation_id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id),
  opening_minor INTEGER NOT NULL CHECK (opening_minor BETWEEN 0 AND 900000000000000),
  opening_reason TEXT NOT NULL CHECK (length(trim(opening_reason)) BETWEEN 1 AND 1000),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  opened_by_name TEXT NOT NULL,
  opened_at TEXT NOT NULL
) STRICT;

CREATE TABLE retail_safe_transfers (
  movement_id INTEGER PRIMARY KEY REFERENCES retail_cash_movements(id),
  safe_id INTEGER NOT NULL REFERENCES retail_safe_opening(id) CHECK (safe_id = 1)
) STRICT;

CREATE VIEW retail_safe_ledger AS
SELECT m.id, m.shift_id, m.kind, m.amount_minor, -m.delta_minor AS delta_minor,
  m.reason, m.reference, m.actor_id, m.actor_name, m.created_at
FROM retail_safe_transfers t JOIN retail_cash_movements m ON m.id = t.movement_id;

CREATE VIEW retail_safe_position AS
SELECT o.*, o.opening_minor + COALESCE((SELECT SUM(delta_minor) FROM retail_safe_ledger), 0) AS expected_minor
FROM retail_safe_opening o;

CREATE TRIGGER retail_safe_opening_validate BEFORE INSERT ON retail_safe_opening BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_safe_opening) THEN RAISE(ABORT, 'RETAIL_SAFE_ALREADY_OPEN') END;
END;

CREATE TRIGGER retail_safe_transfer_validate BEFORE INSERT ON retail_safe_transfers BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_cash_movements m JOIN retail_safe_opening o ON o.id = NEW.safe_id
    WHERE m.id = NEW.movement_id AND m.id > o.operation_id AND m.kind IN ('safe_deposit', 'safe_withdrawal'))
    THEN RAISE(ABORT, 'RETAIL_SAFE_TRANSFER_INVALID') END;
  SELECT CASE WHEN (SELECT expected_minor FROM retail_safe_position) -
    (SELECT delta_minor FROM retail_cash_movements WHERE id = NEW.movement_id) NOT BETWEEN 0 AND 8000000000000000
    THEN RAISE(ABORT, 'RETAIL_SAFE_BALANCE') END;
END;

CREATE TRIGGER retail_safe_capture_drawer_transfer AFTER INSERT ON retail_cash_movements
WHEN NEW.kind IN ('safe_deposit', 'safe_withdrawal') BEGIN
  INSERT INTO retail_safe_transfers(movement_id, safe_id)
  SELECT NEW.id, id FROM retail_safe_opening WHERE operation_id < NEW.id;
END;

CREATE TABLE retail_safe_counts (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  expected_minor INTEGER NOT NULL CHECK (expected_minor BETWEEN 0 AND 8000000000000000),
  observed_minor INTEGER NOT NULL CHECK (observed_minor BETWEEN 0 AND 900000000000000),
  difference_minor INTEGER GENERATED ALWAYS AS (observed_minor - expected_minor) VIRTUAL,
  reason TEXT NOT NULL CHECK (length(reason) <= 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  business_day TEXT NOT NULL,
  CHECK (observed_minor = expected_minor OR length(trim(reason)) > 0)
) STRICT;

CREATE TRIGGER retail_safe_count_validate BEFORE INSERT ON retail_safe_counts BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_safe_opening) THEN RAISE(ABORT, 'RETAIL_SAFE_NOT_OPEN') END;
  SELECT CASE WHEN (SELECT expected_minor FROM retail_safe_position) <> NEW.expected_minor
    THEN RAISE(ABORT, 'RETAIL_SAFE_BALANCE_CHANGED') END;
  SELECT CASE WHEN NEW.observed_minor <> NEW.expected_minor AND length(trim(NEW.reason)) = 0
    THEN RAISE(ABORT, 'RETAIL_SAFE_REASON_REQUIRED') END;
END;

CREATE TRIGGER retail_safe_opening_no_update BEFORE UPDATE ON retail_safe_opening BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_safe_opening_no_delete BEFORE DELETE ON retail_safe_opening BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_safe_transfer_no_update BEFORE UPDATE ON retail_safe_transfers BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_safe_transfer_no_delete BEFORE DELETE ON retail_safe_transfers BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_safe_count_no_update BEFORE UPDATE ON retail_safe_counts BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_safe_count_no_delete BEFORE DELETE ON retail_safe_counts BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
