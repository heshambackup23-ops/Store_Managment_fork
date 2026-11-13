ALTER TABLE retail_shift_closures
  ADD COLUMN emergency_close INTEGER NOT NULL DEFAULT 0 CHECK (emergency_close IN (0, 1));

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
    WHEN c.emergency_close = 1 OR c.observed_minor <> c.expected_minor THEN 'pending_approval' ELSE 'closed' END AS status,
  COALESCE(c.expected_minor, s.opening_minor + s.cash_movements_minor + s.service_cash_minor + COALESCE((SELECT sum(t.delta_minor)
    FROM retail_tender_ledger t WHERE t.shift_id = s.id AND t.method = 'cash'), 0)) AS expected_minor,
  c.observed_minor, c.observed_minor - c.expected_minor AS difference_minor,
  c.closed_by, closer.name AS closed_by_name, c.close_reason, c.closed_at, c.emergency_close,
  a.approved_by, a.approval_reason, a.approved_at, s.cash_movements_minor, s.service_cash_minor
FROM positions s LEFT JOIN retail_shift_closures c ON c.shift_id = s.id
LEFT JOIN users closer ON closer.id = c.closed_by
LEFT JOIN retail_shift_approvals a ON a.shift_id = s.id;

DROP TRIGGER retail_shift_check_close;
CREATE TRIGGER retail_shift_check_close BEFORE INSERT ON retail_shift_closures BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_shifts WHERE id = NEW.shift_id)
    THEN RAISE(ABORT, 'RETAIL_SHIFT_NOT_FOUND') END;
  SELECT CASE WHEN NEW.emergency_close = 0 AND NOT EXISTS (
    SELECT 1 FROM retail_shifts WHERE id = NEW.shift_id AND actor_id = NEW.closed_by)
    THEN RAISE(ABORT, 'RETAIL_SHIFT_NOT_OWNED') END;
  SELECT CASE WHEN NEW.emergency_close = 1 AND EXISTS (
    SELECT 1 FROM retail_shifts WHERE id = NEW.shift_id AND actor_id = NEW.closed_by)
    THEN RAISE(ABORT, 'RETAIL_EMERGENCY_CLOSE_OWN_SHIFT') END;
  SELECT CASE WHEN NEW.emergency_close = 1 AND NOT EXISTS (
    SELECT 1 FROM business_operations
    WHERE id = NEW.operation_id AND actor_id = NEW.closed_by AND operation = 'retail.shift.emergency_close')
    THEN RAISE(ABORT, 'RETAIL_EMERGENCY_CLOSE_OPERATION') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_shift_closures WHERE shift_id = NEW.shift_id)
    THEN RAISE(ABORT, 'RETAIL_SHIFT_NOT_OPEN') END;
  SELECT CASE WHEN (SELECT expected_minor FROM retail_shift_positions WHERE id = NEW.shift_id) <> NEW.expected_minor
    THEN RAISE(ABORT, 'RETAIL_SHIFT_BALANCE_CHANGED') END;
  SELECT CASE WHEN NEW.emergency_close = 1 AND length(trim(NEW.close_reason)) = 0
    THEN RAISE(ABORT, 'RETAIL_EMERGENCY_CLOSE_REASON') END;
  SELECT CASE WHEN NEW.observed_minor <> NEW.expected_minor AND length(trim(NEW.close_reason)) = 0
    THEN RAISE(ABORT, 'RETAIL_SHIFT_REASON_REQUIRED') END;
END;

DROP TRIGGER retail_shift_check_approval;
CREATE TRIGGER retail_shift_check_approval BEFORE INSERT ON retail_shift_approvals BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_shift_closures c WHERE c.shift_id = NEW.shift_id
      AND (c.emergency_close = 1 OR c.observed_minor <> c.expected_minor))
    OR EXISTS (SELECT 1 FROM retail_shift_approvals a WHERE a.shift_id = NEW.shift_id)
    THEN RAISE(ABORT, 'RETAIL_SHIFT_NO_PENDING_APPROVAL') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_shifts s JOIN retail_shift_closures c ON c.shift_id = s.id
    WHERE s.id = NEW.shift_id AND NEW.approved_by IN (s.actor_id, c.closed_by))
    THEN RAISE(ABORT, 'RETAIL_SHIFT_APPROVAL_SEPARATION') END;
END;
