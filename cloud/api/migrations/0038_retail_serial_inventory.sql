CREATE TABLE retail_device_inventory_reviews (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('opening','count')),
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  source_product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
  expected_stock INTEGER NOT NULL CHECK (expected_stock BETWEEN 0 AND 1000000000),
  expected_movement INTEGER NOT NULL CHECK (expected_movement >= 0),
  expected_review INTEGER NOT NULL CHECK (expected_review >= 0),
  source_expected_stock INTEGER,
  source_expected_movement INTEGER,
  source_reference TEXT NOT NULL CHECK (length(source_reference) BETWEEN 1 AND 120),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  scanned_json TEXT NOT NULL CHECK (json_valid(scanned_json) AND json_type(scanned_json) = 'array'),
  additions_json TEXT NOT NULL CHECK (json_valid(additions_json) AND json_type(additions_json) = 'array'),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (source_product_id IS NULL OR (kind = 'opening' AND source_product_id <> product_id
    AND source_expected_stock > 0 AND source_expected_movement >= 0)),
  CHECK (kind <> 'opening' OR (json_array_length(scanned_json) = 0 AND json_array_length(additions_json) > 0))
) STRICT;
CREATE INDEX retail_device_inventory_reviews_product ON retail_device_inventory_reviews(product_id, id DESC);
CREATE INDEX retail_device_inventory_reviews_actor ON retail_device_inventory_reviews(actor_id, id DESC);

CREATE TABLE retail_device_inventory_approvals (
  review_id INTEGER PRIMARY KEY REFERENCES retail_device_inventory_reviews(id) ON DELETE RESTRICT,
  id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id) ON DELETE RESTRICT,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE retail_device_inventory_observations (
  review_id INTEGER NOT NULL REFERENCES retail_device_inventory_reviews(id) ON DELETE RESTRICT,
  device_id INTEGER NOT NULL REFERENCES retail_devices(id) ON DELETE RESTRICT,
  disposition TEXT NOT NULL CHECK (disposition IN ('present','missing','recovered')),
  PRIMARY KEY (review_id, device_id)
) STRICT;

CREATE TABLE retail_device_count_adjustments (
  approval_id INTEGER NOT NULL REFERENCES retail_device_inventory_approvals(id) ON DELETE RESTRICT,
  device_id INTEGER NOT NULL REFERENCES retail_devices(id) ON DELETE RESTRICT,
  from_status TEXT NOT NULL CHECK (from_status IN ('available','stocktake_missing')),
  to_status TEXT NOT NULL CHECK (to_status IN ('available','stocktake_missing') AND to_status <> from_status),
  PRIMARY KEY (approval_id, device_id)
) STRICT;
CREATE INDEX retail_device_count_adjustments_device ON retail_device_count_adjustments(device_id, approval_id DESC);

-- Preserve existing device IDs and all inbound references while allowing a separate documented origin.
PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;
DROP TRIGGER retail_device_no_delete;
DROP TRIGGER retail_device_validate_insert;
DROP TRIGGER retail_device_identity_immutable;
CREATE TABLE retail_devices_rebuild (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  receipt_id INTEGER,
  serial_number TEXT COLLATE NOCASE,
  imei1 TEXT,
  imei2 TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','quarantined','voided','returned_to_supplier','stocktake_missing')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  inventory_intake_id INTEGER REFERENCES retail_device_inventory_reviews(id) ON DELETE RESTRICT,
  intake_cost_minor INTEGER CHECK (intake_cost_minor BETWEEN 0 AND 900000000000000),
  FOREIGN KEY (receipt_id, product_id) REFERENCES purchase_stock_receipt_items(receipt_id, product_id) ON DELETE RESTRICT,
  CHECK ((receipt_id IS NOT NULL AND inventory_intake_id IS NULL AND intake_cost_minor IS NULL)
    OR (receipt_id IS NULL AND inventory_intake_id IS NOT NULL AND intake_cost_minor IS NOT NULL)),
  CHECK (serial_number IS NOT NULL OR imei1 IS NOT NULL),
  CHECK (serial_number IS NULL OR (length(serial_number) BETWEEN 1 AND 100 AND serial_number = trim(serial_number))),
  CHECK (imei1 IS NULL OR (length(imei1) = 15 AND imei1 NOT GLOB '*[^0-9]*' AND imei1 <> '000000000000000')),
  CHECK (imei2 IS NULL OR (imei1 IS NOT NULL AND length(imei2) = 15 AND imei2 NOT GLOB '*[^0-9]*'
    AND imei2 <> '000000000000000' AND imei2 <> imei1))
) STRICT;
INSERT INTO retail_devices_rebuild (id, product_id, receipt_id, serial_number, imei1, imei2, status, created_at)
SELECT id, product_id, receipt_id, serial_number, imei1, imei2, status, created_at FROM retail_devices;
DROP TABLE retail_devices;
ALTER TABLE retail_devices_rebuild RENAME TO retail_devices;
PRAGMA legacy_alter_table = OFF;
PRAGMA defer_foreign_keys = OFF;

CREATE UNIQUE INDEX retail_devices_serial ON retail_devices(serial_number) WHERE status <> 'voided' AND serial_number IS NOT NULL;
CREATE INDEX retail_devices_imei1 ON retail_devices(imei1) WHERE status <> 'voided' AND imei1 IS NOT NULL;
CREATE INDEX retail_devices_imei2 ON retail_devices(imei2) WHERE status <> 'voided' AND imei2 IS NOT NULL;
CREATE INDEX retail_devices_product ON retail_devices(product_id, status, id);
CREATE INDEX retail_devices_receipt ON retail_devices(receipt_id, product_id, id);
CREATE INDEX retail_devices_intake ON retail_devices(inventory_intake_id);

CREATE TRIGGER retail_device_validate_insert BEFORE INSERT ON retail_devices
BEGIN
  SELECT CASE WHEN NEW.inventory_intake_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM retail_device_inventory_reviews r JOIN retail_device_inventory_approvals a ON a.review_id = r.id
    CROSS JOIN json_each(r.additions_json) j
    WHERE r.id = NEW.inventory_intake_id AND r.product_id = NEW.product_id
      AND json_extract(j.value, '$.serial_number') IS NEW.serial_number COLLATE BINARY
      AND json_extract(j.value, '$.imei1') IS NEW.imei1 AND json_extract(j.value, '$.imei2') IS NEW.imei2
      AND json_extract(j.value, '$.unit_cost_minor') = NEW.intake_cost_minor
  ) THEN RAISE(ABORT, 'RETAIL_SERIAL_INTAKE_INVALID') END;
  SELECT CASE WHEN NEW.status <> 'available' OR NOT EXISTS (
    SELECT 1 FROM products WHERE id = NEW.product_id AND (
      (tracking = 'serial' AND NEW.serial_number IS NOT NULL) OR (tracking = 'imei' AND NEW.imei1 IS NOT NULL)
    )
  ) THEN RAISE(ABORT, 'RETAIL_DEVICE_IDENTITY_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(json_array(NEW.imei1, NEW.imei2)) codes WHERE codes.value IS NOT NULL AND (
      SELECT SUM(CASE WHEN digit > 9 THEN digit - 9 ELSE digit END) FROM (
        SELECT CAST(substr(codes.value, digits.value, 1) AS INTEGER) * (1 + (digits.value % 2 = 0)) AS digit
        FROM json_each('[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15]') digits
      )
    ) % 10 <> 0
  ) THEN RAISE(ABORT, 'RETAIL_DEVICE_IDENTITY_REQUIRED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM retail_devices d WHERE d.status <> 'voided' AND (
      d.serial_number = NEW.serial_number OR d.imei1 IN (NEW.imei1, NEW.imei2) OR d.imei2 IN (NEW.imei1, NEW.imei2)
    )
  ) THEN RAISE(ABORT, 'RETAIL_DEVICE_IDENTITY_DUPLICATE') END;
END;

CREATE TRIGGER retail_device_no_delete BEFORE DELETE ON retail_devices BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

CREATE TRIGGER retail_device_identity_immutable BEFORE UPDATE ON retail_devices
WHEN NEW.id IS NOT OLD.id OR NEW.product_id IS NOT OLD.product_id OR NEW.receipt_id IS NOT OLD.receipt_id
  OR NEW.inventory_intake_id IS NOT OLD.inventory_intake_id OR NEW.intake_cost_minor IS NOT OLD.intake_cost_minor
  OR NEW.serial_number IS NOT OLD.serial_number COLLATE BINARY OR NEW.imei1 IS NOT OLD.imei1
  OR NEW.imei2 IS NOT OLD.imei2 OR NEW.created_at IS NOT OLD.created_at
  OR NOT ((OLD.status = 'available' AND NEW.status IN ('sold','voided','returned_to_supplier'))
    OR (OLD.status = 'sold' AND NEW.status IN ('available','quarantined'))
    OR (OLD.status = 'quarantined' AND NEW.status = 'available' AND EXISTS (
      SELECT 1 FROM retail_quarantine_resolutions q
      WHERE q.device_id = OLD.id AND q.return_id = (SELECT MAX(return_id) FROM retail_return_devices WHERE device_id = OLD.id)
    ))
    OR EXISTS (
      SELECT 1 FROM retail_device_count_adjustments x WHERE x.device_id = OLD.id
        AND x.from_status = OLD.status AND x.to_status = NEW.status
        AND x.approval_id = (SELECT MAX(a.approval_id) FROM retail_device_count_adjustments a WHERE a.device_id = OLD.id)
    ))
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

DROP TRIGGER retail_inventory_guard;
CREATE TRIGGER retail_inventory_guard BEFORE INSERT ON inventory_movements
WHEN EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND tracking <> 'quantity')
  AND NEW.source_type NOT IN ('invoice', 'refund')
  AND NEW.purchase_stock_receipt_id IS NULL AND NEW.purchase_stock_reversal_id IS NULL
  AND NEW.supplier_stock_return_id IS NULL AND NEW.quarantine_resolution_id IS NULL
  AND NOT (NEW.source_type = 'adjustment' AND EXISTS (
    SELECT 1 FROM retail_device_inventory_approvals a JOIN retail_device_inventory_reviews r ON r.id = a.review_id
    WHERE a.id = NEW.source_id AND r.product_id = NEW.product_id AND a.actor_id = NEW.actor_id
      AND NEW.delta = json_array_length(r.additions_json) + COALESCE((
        SELECT SUM(CASE o.disposition WHEN 'missing' THEN -1 WHEN 'recovered' THEN 1 ELSE 0 END)
        FROM retail_device_inventory_observations o WHERE o.review_id = r.id
      ), 0)
  ))
BEGIN SELECT RAISE(ABORT, 'RETAIL_DEVICE_MOVEMENT_REQUIRED'); END;

DROP TRIGGER retail_invoice_bind_devices;
CREATE TRIGGER retail_invoice_bind_devices AFTER INSERT ON invoice_items
WHEN json_array_length(NEW.device_ids_json) > 0
BEGIN
  INSERT INTO retail_device_sales(invoice_id, product_id, device_id, warranty_months, warranty_starts_on,
    warranty_expires_on, unit_cost_minor)
  SELECT NEW.invoice_id, NEW.product_id, j.value, p.warranty_months,
    CASE WHEN p.warranty_months > 0 THEN i.invoice_date END,
    CASE WHEN p.warranty_months > 0 THEN date(i.invoice_date, '+' || p.warranty_months || ' months', 'floor') END,
    COALESCE(d.intake_cost_minor, o.unit_cost_minor + o.landed_unit_minor)
  FROM json_each(NEW.device_ids_json) j JOIN products p ON p.id = NEW.product_id
    JOIN invoices i ON i.id = NEW.invoice_id JOIN retail_devices d ON d.id = j.value
    LEFT JOIN purchase_stock_receipts r ON r.id = d.receipt_id
    LEFT JOIN purchase_order_items o ON o.purchase_id = r.purchase_id AND o.product_id = d.product_id;
  UPDATE retail_devices SET status = 'sold' WHERE id IN (SELECT value FROM json_each(NEW.device_ids_json));
END;

CREATE VIEW retail_device_inventory_positions AS
SELECT p.id AS product_id, p.name AS product_name, p.barcode, p.tracking, p.stock, p.inventory_value_minor,
  COALESCE((SELECT MAX(m.id) FROM inventory_movements m WHERE m.product_id = p.id), 0) AS movement_id,
  COALESCE((SELECT MAX(a.id) FROM retail_device_inventory_approvals a
    JOIN retail_device_inventory_reviews r ON r.id = a.review_id WHERE r.product_id = p.id), 0) AS review_id
FROM products p WHERE p.active = 1;

CREATE VIEW retail_device_inventory_records AS
SELECT r.*, p.name AS product_name, sp.name AS source_product_name, a.id AS approval_id, a.actor_id AS approved_by,
  a.reason AS approval_reason, a.created_at AS approved_at,
  COALESCE((SELECT COUNT(*) FROM retail_device_inventory_observations o WHERE o.review_id = r.id AND o.disposition = 'missing'), 0) AS missing_count,
  COALESCE((SELECT COUNT(*) FROM retail_device_inventory_observations o WHERE o.review_id = r.id AND o.disposition = 'recovered'), 0) AS recovered_count,
  json_array_length(r.additions_json) AS added_count,
  CASE WHEN a.id IS NOT NULL THEN 'approved'
    WHEN r.kind = 'count' AND json_array_length(r.additions_json) = 0 AND NOT EXISTS (
      SELECT 1 FROM retail_device_inventory_observations o WHERE o.review_id = r.id AND o.disposition <> 'present'
    ) THEN 'matched'
    WHEN p.id IS NULL OR p.active <> 1 OR p.tracking = 'quantity'
      OR p.stock <> r.expected_stock OR live.movement_id <> r.expected_movement OR live.review_id <> r.expected_review
      OR (r.source_product_id IS NOT NULL AND (source.product_id IS NULL OR source.tracking <> 'quantity'
        OR source.stock <> r.source_expected_stock OR source.movement_id <> r.source_expected_movement))
    THEN 'stale' ELSE 'pending_approval' END AS status
FROM retail_device_inventory_reviews r
JOIN products p ON p.id = r.product_id
LEFT JOIN products sp ON sp.id = r.source_product_id
LEFT JOIN retail_device_inventory_positions live ON live.product_id = r.product_id
LEFT JOIN retail_device_inventory_positions source ON source.product_id = r.source_product_id
LEFT JOIN retail_device_inventory_approvals a ON a.review_id = r.id;

CREATE TRIGGER retail_serial_review_validate BEFORE INSERT ON retail_device_inventory_reviews
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM retail_device_inventory_positions p WHERE p.product_id = NEW.product_id AND p.tracking <> 'quantity'
      AND p.stock = NEW.expected_stock AND p.movement_id = NEW.expected_movement AND p.review_id = NEW.expected_review
      AND p.stock = (SELECT COUNT(*) FROM retail_devices d WHERE d.product_id = p.product_id AND d.status = 'available')
      AND (NEW.kind <> 'opening' OR NEW.source_product_id IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM retail_devices d WHERE d.product_id = p.product_id
      ))
  ) OR (NEW.source_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM retail_device_inventory_positions p WHERE p.product_id = NEW.source_product_id AND p.tracking = 'quantity'
      AND p.stock = NEW.source_expected_stock AND p.movement_id = NEW.source_expected_movement
      AND p.stock >= json_array_length(NEW.additions_json)
  )) THEN RAISE(ABORT, 'RETAIL_SERIAL_STALE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.scanned_json) j WHERE (
      SELECT COUNT(*) FROM retail_devices d WHERE d.product_id = NEW.product_id AND d.status IN ('available','stocktake_missing')
        AND (d.serial_number = j.value OR d.imei1 = j.value OR d.imei2 = j.value)
    ) <> 1
  ) OR EXISTS (
    SELECT 1 FROM retail_devices d CROSS JOIN json_each(NEW.scanned_json) j
    WHERE d.product_id = NEW.product_id AND d.status IN ('available','stocktake_missing')
      AND (d.serial_number = j.value OR d.imei1 = j.value OR d.imei2 = j.value)
    GROUP BY d.id HAVING COUNT(*) > 1
  ) THEN RAISE(ABORT, 'RETAIL_SERIAL_SCAN_INVALID') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.additions_json) j JOIN products p ON p.id = NEW.product_id
    WHERE (p.tracking = 'imei' AND json_extract(j.value, '$.imei1') IS NULL)
      OR (p.tracking = 'serial' AND json_extract(j.value, '$.serial_number') IS NULL)
      OR EXISTS (
        SELECT 1 FROM retail_devices d WHERE d.status <> 'voided' AND
          (d.serial_number = json_extract(j.value, '$.serial_number') OR d.imei1 IN (
            json_extract(j.value, '$.imei1'), json_extract(j.value, '$.imei2')) OR d.imei2 IN (
            json_extract(j.value, '$.imei1'), json_extract(j.value, '$.imei2')))
      )
  ) THEN RAISE(ABORT, 'RETAIL_SERIAL_INTAKE_INVALID') END;
END;

CREATE TRIGGER retail_serial_review_snapshot AFTER INSERT ON retail_device_inventory_reviews
WHEN NEW.kind = 'count'
BEGIN
  INSERT INTO retail_device_inventory_observations(review_id, device_id, disposition)
    SELECT NEW.id, d.id,
      CASE WHEN d.status = 'stocktake_missing' THEN 'recovered' WHEN j.value IS NULL THEN 'missing' ELSE 'present' END
    FROM retail_devices d LEFT JOIN json_each(NEW.scanned_json) j
      ON d.serial_number = j.value OR d.imei1 = j.value OR d.imei2 = j.value
    WHERE d.product_id = NEW.product_id AND (d.status = 'available' OR (d.status = 'stocktake_missing' AND j.value IS NOT NULL));
END;

CREATE TRIGGER retail_serial_approval_validate BEFORE INSERT ON retail_device_inventory_approvals
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_device_inventory_records WHERE id = NEW.review_id AND status = 'pending_approval')
    THEN RAISE(ABORT, 'RETAIL_SERIAL_STALE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_device_inventory_reviews WHERE id = NEW.review_id AND actor_id = NEW.actor_id)
    THEN RAISE(ABORT, 'RETAIL_STOCKTAKE_SEPARATION') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM retail_device_inventory_reviews r JOIN products p ON p.id = r.source_product_id
    WHERE r.id = NEW.review_id AND p.inventory_value_minor IS NOT NULL AND p.stock > 0
      AND (SELECT SUM(json_extract(j.value, '$.unit_cost_minor')) FROM json_each(r.additions_json) j)
        <> (p.inventory_value_minor / p.stock) * json_array_length(r.additions_json)
          + (p.inventory_value_minor % p.stock) * json_array_length(r.additions_json) / p.stock
  ) THEN RAISE(ABORT, 'RETAIL_SERIAL_TRANSFER_COST') END;
END;

CREATE TRIGGER retail_serial_approval_post AFTER INSERT ON retail_device_inventory_approvals
BEGIN
  INSERT INTO retail_device_count_adjustments(approval_id, device_id, from_status, to_status)
    SELECT NEW.id, device_id,
      CASE disposition WHEN 'missing' THEN 'available' ELSE 'stocktake_missing' END,
      CASE disposition WHEN 'missing' THEN 'stocktake_missing' ELSE 'available' END
    FROM retail_device_inventory_observations WHERE review_id = NEW.review_id AND disposition <> 'present';
  UPDATE retail_devices SET status = (SELECT x.to_status FROM retail_device_count_adjustments x
    WHERE x.approval_id = NEW.id AND x.device_id = retail_devices.id)
    WHERE id IN (SELECT x.device_id FROM retail_device_count_adjustments x WHERE x.approval_id = NEW.id);
  INSERT INTO retail_devices(product_id, serial_number, imei1, imei2, inventory_intake_id, intake_cost_minor)
    SELECT r.product_id, json_extract(j.value, '$.serial_number'), json_extract(j.value, '$.imei1'),
      json_extract(j.value, '$.imei2'), r.id, json_extract(j.value, '$.unit_cost_minor')
    FROM retail_device_inventory_reviews r CROSS JOIN json_each(r.additions_json) j WHERE r.id = NEW.review_id;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id)
    SELECT source_product_id, -json_array_length(additions_json), 'adjustment', NEW.id,
      'نقل رصيد افتتاحي للأجهزة · ' || source_reference, NEW.actor_id
    FROM retail_device_inventory_reviews WHERE id = NEW.review_id AND source_product_id IS NOT NULL;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id)
    SELECT product_id, added_count + recovered_count - missing_count, 'adjustment', NEW.id,
      CASE kind WHEN 'opening' THEN 'افتتاح أجهزة متتبعة · ' ELSE 'تسوية جرد الأجهزة · ' END || source_reference, NEW.actor_id
    FROM retail_device_inventory_records WHERE id = NEW.review_id AND added_count + recovered_count <> missing_count;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM retail_device_inventory_reviews r JOIN products p ON p.id = r.product_id WHERE r.id = NEW.review_id
      AND p.stock <> (SELECT COUNT(*) FROM retail_devices d WHERE d.product_id = p.id AND d.status = 'available')
  ) THEN RAISE(ABORT, 'RETAIL_SERIAL_STALE') END;
END;

CREATE TRIGGER retail_device_inventory_review_no_update BEFORE UPDATE ON retail_device_inventory_reviews BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_device_inventory_review_no_delete BEFORE DELETE ON retail_device_inventory_reviews BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_device_inventory_approval_no_update BEFORE UPDATE ON retail_device_inventory_approvals BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_device_inventory_approval_no_delete BEFORE DELETE ON retail_device_inventory_approvals BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_device_inventory_observation_no_update BEFORE UPDATE ON retail_device_inventory_observations BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_device_inventory_observation_no_delete BEFORE DELETE ON retail_device_inventory_observations BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_device_count_adjustment_no_update BEFORE UPDATE ON retail_device_count_adjustments BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_device_count_adjustment_no_delete BEFORE DELETE ON retail_device_count_adjustments BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
