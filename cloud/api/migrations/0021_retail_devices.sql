ALTER TABLE products ADD COLUMN tracking TEXT NOT NULL DEFAULT 'quantity' CHECK (tracking IN ('quantity','serial','imei'));
ALTER TABLE products ADD COLUMN warranty_months INTEGER NOT NULL DEFAULT 0 CHECK (warranty_months BETWEEN 0 AND 120);
ALTER TABLE purchase_stock_receipt_items ADD COLUMN devices_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(devices_json) AND json_type(devices_json) = 'array');
ALTER TABLE invoice_items ADD COLUMN device_ids_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(device_ids_json) AND json_type(device_ids_json) = 'array');

CREATE TABLE retail_devices (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  receipt_id INTEGER NOT NULL,
  serial_number TEXT COLLATE NOCASE,
  imei1 TEXT,
  imei2 TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','sold','quarantined','voided','returned_to_supplier')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receipt_id, product_id) REFERENCES purchase_stock_receipt_items(receipt_id, product_id) ON DELETE RESTRICT,
  CHECK (serial_number IS NOT NULL OR imei1 IS NOT NULL),
  CHECK (serial_number IS NULL OR (length(serial_number) BETWEEN 1 AND 100 AND serial_number = trim(serial_number))),
  CHECK (imei1 IS NULL OR (length(imei1) = 15 AND imei1 NOT GLOB '*[^0-9]*' AND imei1 <> '000000000000000')),
  CHECK (imei2 IS NULL OR (imei1 IS NOT NULL AND length(imei2) = 15 AND imei2 NOT GLOB '*[^0-9]*'
    AND imei2 <> '000000000000000' AND imei2 <> imei1))
) STRICT;

CREATE UNIQUE INDEX retail_devices_serial ON retail_devices(serial_number) WHERE status <> 'voided' AND serial_number IS NOT NULL;
CREATE INDEX retail_devices_imei1 ON retail_devices(imei1) WHERE status <> 'voided' AND imei1 IS NOT NULL;
CREATE INDEX retail_devices_imei2 ON retail_devices(imei2) WHERE status <> 'voided' AND imei2 IS NOT NULL;
CREATE INDEX retail_devices_product ON retail_devices(product_id, status, id);
CREATE INDEX retail_devices_receipt ON retail_devices(receipt_id, product_id, id);

CREATE TABLE retail_device_sales (
  invoice_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL REFERENCES retail_devices(id) ON DELETE RESTRICT,
  warranty_months INTEGER NOT NULL CHECK (warranty_months BETWEEN 0 AND 120),
  warranty_starts_on TEXT,
  warranty_expires_on TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (invoice_id, product_id, device_id),
  FOREIGN KEY (invoice_id, product_id) REFERENCES invoice_items(invoice_id, product_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX retail_device_sales_device ON retail_device_sales(device_id);

CREATE TABLE retail_device_events (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  invoice_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('delivered','installed','warranty_claim')),
  occurred_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id, product_id, device_id)
    REFERENCES retail_device_sales(invoice_id, product_id, device_id) ON DELETE RESTRICT
) STRICT;

CREATE INDEX retail_device_events_device ON retail_device_events(device_id, id DESC);
CREATE UNIQUE INDEX retail_device_events_milestone
  ON retail_device_events(invoice_id, product_id, device_id, kind) WHERE kind IN ('delivered','installed');

CREATE TRIGGER retail_tracking_change BEFORE UPDATE OF tracking ON products
WHEN OLD.tracking <> NEW.tracking AND
  (OLD.stock <> 0 OR NEW.stock <> 0 OR EXISTS (SELECT 1 FROM inventory_movements WHERE product_id = OLD.id)
    OR EXISTS (SELECT 1 FROM invoice_items WHERE product_id = OLD.id))
BEGIN
  SELECT RAISE(ABORT, 'RETAIL_TRACKING_HAS_STOCK');
END;

CREATE TRIGGER retail_device_validate_insert BEFORE INSERT ON retail_devices
BEGIN
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

CREATE TRIGGER retail_device_identity_immutable BEFORE UPDATE ON retail_devices
WHEN NEW.id IS NOT OLD.id OR NEW.product_id IS NOT OLD.product_id OR NEW.receipt_id IS NOT OLD.receipt_id
  OR NEW.serial_number IS NOT OLD.serial_number COLLATE BINARY OR NEW.imei1 IS NOT OLD.imei1
  OR NEW.imei2 IS NOT OLD.imei2 OR NEW.created_at IS NOT OLD.created_at
  OR NOT ((OLD.status = 'available' AND NEW.status IN ('sold','voided','returned_to_supplier'))
    OR (OLD.status = 'sold' AND NEW.status IN ('available','quarantined')))
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TRIGGER retail_device_no_delete BEFORE DELETE ON retail_devices
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TRIGGER retail_receipt_validate_devices BEFORE INSERT ON purchase_stock_receipt_items
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM products WHERE id = NEW.product_id AND (
      (tracking = 'quantity' AND json_array_length(NEW.devices_json) <> 0) OR
      (tracking <> 'quantity' AND json_array_length(NEW.devices_json) <> NEW.quantity)
    )
  ) THEN RAISE(ABORT, 'RETAIL_DEVICE_RECEIPT_COUNT') END;
END;

CREATE TRIGGER retail_receipt_register_devices AFTER INSERT ON purchase_stock_receipt_items
WHEN json_array_length(NEW.devices_json) > 0
BEGIN
  INSERT INTO retail_devices(product_id, receipt_id, serial_number, imei1, imei2)
    SELECT NEW.product_id, NEW.receipt_id, json_extract(j.value, '$.serial_number'),
      json_extract(j.value, '$.imei1'), json_extract(j.value, '$.imei2')
    FROM json_each(NEW.devices_json) j;
END;

CREATE TRIGGER retail_receipt_reverse_devices BEFORE INSERT ON purchase_stock_reversals
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM retail_devices d WHERE d.receipt_id = NEW.receipt_id AND (
      d.status <> 'available' OR EXISTS (SELECT 1 FROM retail_device_sales s WHERE s.device_id = d.id)
    )
  ) THEN RAISE(ABORT, 'RETAIL_RECEIPT_DEVICE_HISTORY') END;
  UPDATE retail_devices SET status = 'voided' WHERE receipt_id = NEW.receipt_id;
END;

CREATE TRIGGER retail_invoice_validate_devices BEFORE INSERT ON invoice_items
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM products WHERE id = NEW.product_id AND (
      (tracking = 'quantity' AND json_array_length(NEW.device_ids_json) <> 0) OR
      (tracking <> 'quantity' AND json_array_length(NEW.device_ids_json) <> NEW.quantity)
    )
  ) THEN RAISE(ABORT, 'RETAIL_DEVICE_SALE_COUNT') END;
  SELECT CASE WHEN (
    SELECT COUNT(DISTINCT d.id) FROM json_each(NEW.device_ids_json) j
    JOIN retail_devices d ON d.id = j.value AND j.type = 'integer'
    WHERE d.product_id = NEW.product_id AND d.status = 'available'
  ) <> json_array_length(NEW.device_ids_json) THEN RAISE(ABORT, 'RETAIL_DEVICE_UNAVAILABLE') END;
END;

CREATE TRIGGER retail_invoice_bind_devices AFTER INSERT ON invoice_items
WHEN json_array_length(NEW.device_ids_json) > 0
BEGIN
  INSERT INTO retail_device_sales(invoice_id, product_id, device_id, warranty_months, warranty_starts_on, warranty_expires_on)
  SELECT NEW.invoice_id, NEW.product_id, j.value, p.warranty_months,
    CASE WHEN p.warranty_months > 0 THEN i.invoice_date END,
    CASE WHEN p.warranty_months > 0 THEN date(i.invoice_date, '+' || p.warranty_months || ' months', 'floor') END
  FROM json_each(NEW.device_ids_json) j JOIN products p ON p.id = NEW.product_id
    JOIN invoices i ON i.id = NEW.invoice_id;
  UPDATE retail_devices SET status = 'sold' WHERE id IN (SELECT value FROM json_each(NEW.device_ids_json));
END;

CREATE TRIGGER retail_device_sale_no_update BEFORE UPDATE ON retail_device_sales
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
CREATE TRIGGER retail_device_sale_no_delete BEFORE DELETE ON retail_device_sales
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TRIGGER retail_legacy_refund_guard BEFORE INSERT ON invoice_refunds
WHEN NEW.legacy_refund_reference IS NULL AND EXISTS (
  SELECT 1 FROM invoice_items i JOIN products p ON p.id = i.product_id
  WHERE i.invoice_id = NEW.invoice_id AND p.tracking <> 'quantity'
)
BEGIN
  SELECT RAISE(ABORT, 'RETAIL_DEVICE_RETURN_REQUIRED');
END;

CREATE TRIGGER retail_inventory_guard BEFORE INSERT ON inventory_movements
WHEN EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND tracking <> 'quantity')
  AND NEW.source_type NOT IN ('invoice', 'refund')
  AND NEW.purchase_stock_receipt_id IS NULL AND NEW.purchase_stock_reversal_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'RETAIL_DEVICE_MOVEMENT_REQUIRED');
END;

CREATE TRIGGER retail_device_event_no_update BEFORE UPDATE ON retail_device_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
CREATE TRIGGER retail_device_event_validate BEFORE INSERT ON retail_device_events
WHEN NOT EXISTS (
  SELECT 1 FROM retail_device_sales s JOIN invoices i ON i.id = s.invoice_id JOIN retail_devices d ON d.id = s.device_id
  WHERE s.invoice_id = NEW.invoice_id AND s.product_id = NEW.product_id AND s.device_id = NEW.device_id
    AND d.status = 'sold' AND NEW.occurred_on >= i.invoice_date
    AND s.rowid = (SELECT MAX(rowid) FROM retail_device_sales WHERE device_id = NEW.device_id)
)
BEGIN
  SELECT RAISE(ABORT, 'RETAIL_DEVICE_EVENT_STATE');
END;
CREATE TRIGGER retail_device_event_no_delete BEFORE DELETE ON retail_device_events
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
