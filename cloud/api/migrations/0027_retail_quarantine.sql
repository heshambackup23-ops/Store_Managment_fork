CREATE TABLE retail_quarantine_resolutions (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  return_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition = 'restock'),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (return_id, device_id),
  FOREIGN KEY (return_id, device_id) REFERENCES retail_return_devices(return_id, device_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX retail_quarantine_device ON retail_quarantine_resolutions(device_id, id DESC);

ALTER TABLE inventory_movements ADD COLUMN quarantine_resolution_id INTEGER
  REFERENCES retail_quarantine_resolutions(id) ON DELETE RESTRICT;

DROP TRIGGER retail_device_identity_immutable;
CREATE TRIGGER retail_device_identity_immutable BEFORE UPDATE ON retail_devices
WHEN NEW.id IS NOT OLD.id OR NEW.product_id IS NOT OLD.product_id OR NEW.receipt_id IS NOT OLD.receipt_id
  OR NEW.serial_number IS NOT OLD.serial_number COLLATE BINARY OR NEW.imei1 IS NOT OLD.imei1
  OR NEW.imei2 IS NOT OLD.imei2 OR NEW.created_at IS NOT OLD.created_at
  OR NOT ((OLD.status = 'available' AND NEW.status IN ('sold','voided','returned_to_supplier'))
    OR (OLD.status = 'sold' AND NEW.status IN ('available','quarantined'))
    OR (OLD.status = 'quarantined' AND NEW.status = 'available' AND EXISTS (
      SELECT 1 FROM retail_quarantine_resolutions q
      WHERE q.device_id = OLD.id AND q.return_id = (SELECT MAX(return_id) FROM retail_return_devices WHERE device_id = OLD.id)
    )))
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

DROP TRIGGER retail_inventory_guard;
CREATE TRIGGER retail_inventory_guard BEFORE INSERT ON inventory_movements
WHEN EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND tracking <> 'quantity')
  AND NEW.source_type NOT IN ('invoice', 'refund')
  AND NEW.purchase_stock_receipt_id IS NULL AND NEW.purchase_stock_reversal_id IS NULL
  AND NEW.supplier_stock_return_id IS NULL AND NEW.quarantine_resolution_id IS NULL
BEGIN SELECT RAISE(ABORT, 'RETAIL_DEVICE_MOVEMENT_REQUIRED'); END;

CREATE TRIGGER retail_quarantine_movement_validate BEFORE INSERT ON inventory_movements
WHEN NEW.quarantine_resolution_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM retail_quarantine_resolutions q JOIN retail_devices d ON d.id = q.device_id
  WHERE q.id = NEW.quarantine_resolution_id AND q.id = NEW.source_id AND q.actor_id = NEW.actor_id
    AND d.product_id = NEW.product_id AND d.status = 'available' AND NEW.delta = 1 AND NEW.source_type = 'adjustment'
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_QUARANTINE_STATE'); END;

CREATE TRIGGER retail_quarantine_validate BEFORE INSERT ON retail_quarantine_resolutions
WHEN NOT EXISTS (
  SELECT 1 FROM retail_return_devices r JOIN retail_devices d ON d.id = r.device_id
  JOIN products p ON p.id = d.product_id
  WHERE r.return_id = NEW.return_id AND r.device_id = NEW.device_id AND r.disposition = 'quarantine'
    AND d.status = 'quarantined' AND p.active = 1
    AND r.return_id = (SELECT MAX(return_id) FROM retail_return_devices WHERE device_id = NEW.device_id)
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_QUARANTINE_STATE'); END;

CREATE TRIGGER retail_quarantine_restock AFTER INSERT ON retail_quarantine_resolutions
BEGIN
  UPDATE retail_devices SET status = 'available' WHERE id = NEW.device_id;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id, quarantine_resolution_id)
    SELECT product_id, 1, 'adjustment', NEW.id, NEW.reason, NEW.actor_id, NEW.id
    FROM retail_devices WHERE id = NEW.device_id;
END;

CREATE TRIGGER retail_quarantine_no_update BEFORE UPDATE ON retail_quarantine_resolutions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_quarantine_no_delete BEFORE DELETE ON retail_quarantine_resolutions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
