CREATE TABLE retail_stocktakes (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name TEXT NOT NULL,
  tracking TEXT NOT NULL CHECK (tracking IN ('quantity','serial','imei')),
  expected_quantity INTEGER NOT NULL CHECK (expected_quantity BETWEEN 0 AND 1000000000),
  observed_quantity INTEGER NOT NULL CHECK (observed_quantity BETWEEN 0 AND 1000000000),
  last_movement_id INTEGER NOT NULL CHECK (last_movement_id >= 0),
  reason TEXT NOT NULL CHECK (length(reason) <= 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  actor_name TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX retail_stocktakes_actor ON retail_stocktakes(actor_id, id DESC);
CREATE INDEX retail_stocktakes_product ON retail_stocktakes(product_id, id DESC);

CREATE TABLE retail_stocktake_approvals (
  stocktake_id INTEGER PRIMARY KEY REFERENCES retail_stocktakes(id),
  id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id),
  approved_by INTEGER NOT NULL REFERENCES users(id),
  approval_reason TEXT NOT NULL CHECK (length(approval_reason) <= 1000),
  approved_at TEXT NOT NULL
) STRICT;

CREATE VIEW retail_stocktake_records AS
SELECT s.id, s.product_id, s.product_name, s.tracking, s.expected_quantity, s.observed_quantity,
  s.observed_quantity - s.expected_quantity AS difference_quantity, s.reason, s.actor_id, s.actor_name, s.created_at,
  a.approved_by, a.approval_reason, a.approved_at,
  CASE WHEN a.id IS NOT NULL THEN 'approved'
    WHEN s.expected_quantity = s.observed_quantity THEN 'matched'
    WHEN s.tracking <> 'quantity' THEN 'report_only'
    WHEN p.active = 0 OR p.tracking <> s.tracking OR p.stock <> s.expected_quantity OR s.last_movement_id <> COALESCE((
      SELECT MAX(m.id) FROM inventory_movements m WHERE m.product_id = s.product_id
    ), 0) THEN 'stale' ELSE 'pending_approval' END AS status
FROM retail_stocktakes s JOIN products p ON p.id = s.product_id
LEFT JOIN retail_stocktake_approvals a ON a.stocktake_id = s.id;

CREATE TRIGGER retail_stocktake_snapshot BEFORE INSERT ON retail_stocktakes
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.active = 1
      AND p.stock = NEW.expected_quantity AND p.tracking = NEW.tracking
      AND NEW.last_movement_id = COALESCE((SELECT MAX(id) FROM inventory_movements WHERE product_id = p.id), 0)
  ) THEN RAISE(ABORT, 'RETAIL_STOCKTAKE_PRODUCT') END;
END;

CREATE TRIGGER retail_stocktake_approve BEFORE INSERT ON retail_stocktake_approvals
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_stocktake_records WHERE id = NEW.stocktake_id AND status = 'stale')
    THEN RAISE(ABORT, 'RETAIL_STOCKTAKE_STALE') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_stocktake_records WHERE id = NEW.stocktake_id AND status = 'pending_approval')
    THEN RAISE(ABORT, 'RETAIL_STOCKTAKE_NOT_PENDING') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_stocktakes WHERE id = NEW.stocktake_id AND actor_id = NEW.approved_by)
    THEN RAISE(ABORT, 'RETAIL_STOCKTAKE_SEPARATION') END;
END;

CREATE TRIGGER retail_stocktake_post AFTER INSERT ON retail_stocktake_approvals
BEGIN
  INSERT INTO inventory_movements (product_id, delta, source_type, source_id, note, actor_id, created_at)
    SELECT product_id, observed_quantity - expected_quantity, 'adjustment', NEW.id,
      'فرق جرد #' || id || CASE WHEN NEW.approval_reason <> '' THEN ' · ' || NEW.approval_reason ELSE '' END,
      NEW.approved_by, NEW.approved_at
    FROM retail_stocktakes WHERE id = NEW.stocktake_id;
END;

CREATE TRIGGER retail_stocktake_no_update BEFORE UPDATE ON retail_stocktakes BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_stocktake_no_delete BEFORE DELETE ON retail_stocktakes BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_stocktake_approval_no_update BEFORE UPDATE ON retail_stocktake_approvals BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_stocktake_approval_no_delete BEFORE DELETE ON retail_stocktake_approvals BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
