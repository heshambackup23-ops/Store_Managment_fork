CREATE TABLE retail_cash_movements (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  shift_id INTEGER NOT NULL REFERENCES retail_shifts(id),
  kind TEXT NOT NULL CHECK (kind IN ('safe_deposit', 'safe_withdrawal', 'general_expense')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  delta_minor INTEGER GENERATED ALWAYS AS (CASE WHEN kind = 'safe_withdrawal' THEN amount_minor ELSE -amount_minor END) VIRTUAL,
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  reference TEXT COLLATE NOCASE CHECK (reference IS NULL OR length(trim(reference)) BETWEEN 1 AND 100),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX retail_cash_movements_shift ON retail_cash_movements(shift_id, id DESC);
CREATE UNIQUE INDEX retail_cash_movements_ref ON retail_cash_movements(shift_id, reference) WHERE reference IS NOT NULL;
CREATE UNIQUE INDEX retail_cash_movements_unreferenced ON retail_cash_movements(shift_id, kind, amount_minor, reason COLLATE NOCASE)
  WHERE reference IS NULL;

DROP VIEW retail_shift_positions;
CREATE VIEW retail_shift_positions AS
WITH positions AS (
  SELECT s.*, COALESCE((SELECT sum(m.delta_minor) FROM retail_cash_movements m WHERE m.shift_id = s.id), 0) AS cash_movements_minor
  FROM retail_shifts s
)
SELECT s.id, s.register_name, s.actor_id, s.actor_name, s.opening_minor, s.business_day, s.opened_at,
  CASE WHEN c.shift_id IS NULL THEN 'open' WHEN a.shift_id IS NOT NULL THEN 'approved'
    WHEN c.observed_minor <> c.expected_minor THEN 'pending_approval' ELSE 'closed' END AS status,
  COALESCE(c.expected_minor, s.opening_minor + s.cash_movements_minor + COALESCE((SELECT sum(t.delta_minor)
    FROM retail_tender_ledger t WHERE t.shift_id = s.id AND t.method = 'cash'), 0)) AS expected_minor,
  c.observed_minor, c.observed_minor - c.expected_minor AS difference_minor,
  c.closed_by, c.close_reason, c.closed_at, a.approved_by, a.approval_reason, a.approved_at,
  s.cash_movements_minor
FROM positions s LEFT JOIN retail_shift_closures c ON c.shift_id = s.id
LEFT JOIN retail_shift_approvals a ON a.shift_id = s.id;

CREATE TRIGGER retail_cash_movement_validate BEFORE INSERT ON retail_cash_movements BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_shifts s WHERE s.id = NEW.shift_id AND s.actor_id = NEW.actor_id
    AND NOT EXISTS (SELECT 1 FROM retail_shift_closures c WHERE c.shift_id = s.id))
    THEN RAISE(ABORT, 'RETAIL_SHIFT_UNAVAILABLE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_cash_movements m WHERE m.shift_id = NEW.shift_id
    AND ((NEW.reference IS NOT NULL AND m.reference = NEW.reference) OR (NEW.reference IS NULL AND m.reference IS NULL
      AND m.kind = NEW.kind AND m.amount_minor = NEW.amount_minor AND m.reason = NEW.reason COLLATE NOCASE)))
    THEN RAISE(ABORT, 'RETAIL_CASH_MOVEMENT_DUPLICATE') END;
  SELECT CASE WHEN NEW.kind <> 'safe_withdrawal' AND NEW.amount_minor > (
    SELECT expected_minor FROM retail_shift_positions WHERE id = NEW.shift_id
  ) THEN RAISE(ABORT, 'RETAIL_CASH_MOVEMENT_BALANCE') END;
  SELECT CASE WHEN NEW.kind = 'safe_withdrawal' AND NEW.amount_minor + (
    SELECT expected_minor FROM retail_shift_positions WHERE id = NEW.shift_id
  ) > 8000000000000000 THEN RAISE(ABORT, 'RETAIL_CASH_MOVEMENT_BALANCE') END;
END;

CREATE TRIGGER retail_cash_movement_no_update BEFORE UPDATE ON retail_cash_movements BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_cash_movement_no_delete BEFORE DELETE ON retail_cash_movements BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
