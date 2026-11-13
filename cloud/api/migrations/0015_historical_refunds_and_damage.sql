ALTER TABLE invoice_refunds ADD COLUMN legacy_refund_reference TEXT;
CREATE UNIQUE INDEX legacy_refund_reference_unique ON invoice_refunds(legacy_refund_reference)
  WHERE legacy_refund_reference IS NOT NULL;

DROP TRIGGER apply_invoice_refund;
CREATE TRIGGER apply_invoice_refund AFTER INSERT ON invoice_refunds
BEGIN
  SELECT CASE WHEN NEW.legacy_refund_reference IS NOT NULL AND (
    length(trim(NEW.legacy_refund_reference)) NOT BETWEEN 1 AND 120
    OR NOT EXISTS (
      SELECT 1 FROM invoices i
      JOIN historical_invoice_imports h ON h.fingerprint = i.legacy_import_fingerprint
      WHERE i.id = NEW.invoice_id AND NEW.created_at BETWEEN i.created_at AND h.cutoff_at
    )
  ) THEN RAISE(ABORT, 'HISTORICAL_REFUND_EVIDENCE_INVALID') END;
  UPDATE invoices SET refunded_at = NEW.created_at,
    updated_at = CASE WHEN NEW.legacy_refund_reference IS NULL THEN CURRENT_TIMESTAMP ELSE updated_at END
    WHERE id = NEW.invoice_id AND refunded_at IS NULL
      AND total_minor = NEW.total_minor AND paid_minor = NEW.returned_minor;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'INVOICE_NOT_REFUNDABLE') END;
  UPDATE installments SET voided_at = NEW.created_at,
    updated_at = CASE WHEN NEW.legacy_refund_reference IS NULL THEN CURRENT_TIMESTAMP ELSE updated_at END
    WHERE invoice_id = NEW.invoice_id;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id)
    SELECT product_id, quantity, 'refund', NEW.id, NEW.reason, NEW.actor_id
    FROM invoice_items WHERE invoice_id = NEW.invoice_id AND NEW.legacy_refund_reference IS NULL;
END;

CREATE TRIGGER historical_invoice_refund_no_update BEFORE UPDATE ON invoice_refunds
WHEN OLD.legacy_refund_reference IS NOT NULL OR NEW.legacy_refund_reference IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TRIGGER historical_invoice_refund_no_delete BEFORE DELETE ON invoice_refunds
WHEN OLD.legacy_refund_reference IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TABLE historical_damage_imports (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fingerprint TEXT NOT NULL UNIQUE CHECK (length(fingerprint) = 64),
  cutoff_at TEXT NOT NULL,
  damage_count INTEGER NOT NULL CHECK (damage_count > 0),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

ALTER TABLE damaged_stock ADD COLUMN legacy_damage_fingerprint TEXT REFERENCES historical_damage_imports(fingerprint);
ALTER TABLE damaged_stock ADD COLUMN legacy_product_name TEXT;
ALTER TABLE damaged_stock ADD COLUMN legacy_product_barcode TEXT;
ALTER TABLE damaged_stock ADD COLUMN legacy_quantity INTEGER;
ALTER TABLE damaged_stock ADD COLUMN legacy_stock_before INTEGER;
ALTER TABLE damaged_stock ADD COLUMN legacy_stock_after INTEGER;
ALTER TABLE damaged_stock ADD COLUMN legacy_created_by INTEGER;
ALTER TABLE damaged_stock ADD COLUMN legacy_created_by_name TEXT;
ALTER TABLE damaged_stock ADD COLUMN legacy_updated_at TEXT;
ALTER TABLE damaged_stock_reversals ADD COLUMN legacy_damage_fingerprint TEXT REFERENCES historical_damage_imports(fingerprint);
ALTER TABLE damaged_stock_reversals ADD COLUMN legacy_voided_by INTEGER;

CREATE TRIGGER historical_damage_identity_insert BEFORE INSERT ON damaged_stock
WHEN NEW.legacy_damage_fingerprint IS NOT NULL OR NEW.legacy_product_name IS NOT NULL
  OR NEW.legacy_product_barcode IS NOT NULL OR NEW.legacy_quantity IS NOT NULL
  OR NEW.legacy_stock_before IS NOT NULL OR NEW.legacy_stock_after IS NOT NULL OR NEW.legacy_created_by IS NOT NULL
  OR NEW.legacy_created_by_name IS NOT NULL OR NEW.legacy_updated_at IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM historical_damage_imports h WHERE h.fingerprint = NEW.legacy_damage_fingerprint
      AND NEW.actor_id = h.actor_id AND NEW.created_at <= NEW.legacy_updated_at AND NEW.legacy_updated_at <= h.cutoff_at
      AND length(trim(NEW.legacy_product_name)) BETWEEN 1 AND 255 AND NEW.legacy_quantity = NEW.quantity
      AND NEW.legacy_stock_before >= 0 AND NEW.legacy_stock_before - NEW.legacy_stock_after = NEW.quantity
  ) THEN RAISE(ABORT, 'HISTORICAL_DAMAGE_SNAPSHOT_INVALID') END;
END;

CREATE TRIGGER historical_damage_identity_update BEFORE UPDATE OF legacy_damage_fingerprint, legacy_product_name,
  legacy_product_barcode, legacy_quantity, legacy_stock_before, legacy_stock_after, legacy_created_by,
  legacy_created_by_name, legacy_updated_at ON damaged_stock
WHEN NEW.legacy_damage_fingerprint IS NOT OLD.legacy_damage_fingerprint OR NEW.legacy_product_name IS NOT OLD.legacy_product_name
  OR NEW.legacy_product_barcode IS NOT OLD.legacy_product_barcode OR NEW.legacy_quantity IS NOT OLD.legacy_quantity
  OR NEW.legacy_stock_before IS NOT OLD.legacy_stock_before OR NEW.legacy_stock_after IS NOT OLD.legacy_stock_after
  OR NEW.legacy_created_by IS NOT OLD.legacy_created_by OR NEW.legacy_created_by_name IS NOT OLD.legacy_created_by_name
  OR NEW.legacy_updated_at IS NOT OLD.legacy_updated_at
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

DROP TRIGGER apply_damaged_stock;
CREATE TRIGGER apply_damaged_stock AFTER INSERT ON damaged_stock WHEN NEW.legacy_damage_fingerprint IS NULL
BEGIN
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id)
    VALUES (NEW.product_id, -NEW.quantity, 'damage', NEW.id, NEW.reason, NEW.actor_id);
END;

DROP TRIGGER reverse_damaged_stock;
CREATE TRIGGER reverse_damaged_stock AFTER INSERT ON damaged_stock_reversals
BEGIN
  SELECT CASE WHEN (NEW.legacy_damage_fingerprint IS NULL AND NEW.legacy_voided_by IS NOT NULL)
    OR (NEW.legacy_damage_fingerprint IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM damaged_stock d JOIN historical_damage_imports h ON h.fingerprint = d.legacy_damage_fingerprint
      WHERE d.id = NEW.damage_id AND d.legacy_damage_fingerprint = NEW.legacy_damage_fingerprint
        AND NEW.created_at BETWEEN d.created_at AND h.cutoff_at AND NEW.actor_id = h.actor_id
    )) THEN RAISE(ABORT, 'HISTORICAL_DAMAGE_SNAPSHOT_INVALID') END;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id)
    SELECT product_id, quantity, 'damage_reversal', NEW.id, NEW.reason, NEW.actor_id
    FROM damaged_stock WHERE id = NEW.damage_id AND NEW.legacy_damage_fingerprint IS NULL;
END;

CREATE TRIGGER historical_damage_reversal_no_update BEFORE UPDATE ON damaged_stock_reversals
WHEN OLD.legacy_damage_fingerprint IS NOT NULL OR NEW.legacy_damage_fingerprint IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TRIGGER historical_damage_reversal_no_delete BEFORE DELETE ON damaged_stock_reversals
WHEN OLD.legacy_damage_fingerprint IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
