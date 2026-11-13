CREATE TABLE retail_branches (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(code) BETWEEN 2 AND 24),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

INSERT INTO retail_branches(id, code, name) VALUES (1, 'HQ', 'الفرع الرئيسي');

-- Existing documents and opening balances belong to the original shop.
-- These defaults remain compatible with historical import and older clients.
ALTER TABLE invoices ADD COLUMN branch_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE purchase_stock_receipts ADD COLUMN branch_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE supplier_stock_returns ADD COLUMN branch_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE damaged_stock ADD COLUMN branch_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE retail_devices ADD COLUMN branch_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE retail_shifts ADD COLUMN branch_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE retail_stocktakes ADD COLUMN branch_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE retail_stocktakes ADD COLUMN last_transfer_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE inventory_movements ADD COLUMN branch_hint_id INTEGER REFERENCES retail_branches(id);

CREATE TABLE retail_branch_stock (
  branch_id INTEGER NOT NULL REFERENCES retail_branches(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  stock INTEGER NOT NULL CHECK (stock BETWEEN 0 AND 1000000000),
  PRIMARY KEY(branch_id, product_id)
) STRICT;

INSERT INTO retail_branch_stock(branch_id, product_id, stock)
  SELECT 1, id, stock FROM products WHERE stock > 0;

CREATE TRIGGER retail_branch_opening_stock AFTER INSERT ON products WHEN NEW.stock > 0
BEGIN
  INSERT INTO retail_branch_stock(branch_id, product_id, stock) VALUES (1, NEW.id, NEW.stock);
END;

CREATE TABLE retail_branch_movement_links (
  movement_id INTEGER PRIMARY KEY REFERENCES inventory_movements(id),
  branch_id INTEGER NOT NULL REFERENCES retail_branches(id)
) STRICT;
CREATE INDEX retail_branch_movement_branch_idx ON retail_branch_movement_links(branch_id, movement_id DESC);

CREATE TRIGGER retail_branch_documents_invoice BEFORE INSERT ON invoices
WHEN NOT EXISTS (SELECT 1 FROM retail_branches b WHERE b.id = NEW.branch_id AND b.active = 1)
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_UNAVAILABLE'); END;
CREATE TRIGGER retail_branch_documents_invoice_immutable BEFORE UPDATE OF branch_id ON invoices WHEN OLD.branch_id <> NEW.branch_id
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_branch_documents_receipt BEFORE INSERT ON purchase_stock_receipts
WHEN NOT EXISTS (SELECT 1 FROM retail_branches b WHERE b.id = NEW.branch_id AND b.active = 1)
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_UNAVAILABLE'); END;
CREATE TRIGGER retail_branch_documents_supplier_return BEFORE INSERT ON supplier_stock_returns
WHEN NOT EXISTS (SELECT 1 FROM retail_branches b WHERE b.id = NEW.branch_id AND b.active = 1)
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_UNAVAILABLE'); END;
CREATE TRIGGER retail_branch_supplier_return_source BEFORE INSERT ON supplier_stock_returns
WHEN NEW.disposition_review_id IS NULL AND EXISTS (SELECT 1 FROM json_each(NEW.requested_items) j, json_each(j.value,'$.device_ids') v
    JOIN retail_devices d ON d.id = v.value WHERE d.branch_id <> NEW.branch_id)
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_DEVICE'); END;
CREATE TRIGGER retail_branch_supplier_return_quantity BEFORE INSERT ON supplier_stock_returns
WHEN NEW.disposition_review_id IS NULL AND EXISTS (
  SELECT 1 FROM json_each(NEW.requested_items) j JOIN products p ON p.id = json_extract(j.value, '$.product_id')
  WHERE p.tracking = 'quantity' AND json_extract(j.value,'$.quantity') >
    COALESCE((SELECT SUM(i.quantity) FROM purchase_stock_receipt_items i
      JOIN purchase_stock_receipts r ON r.id = i.receipt_id
      LEFT JOIN purchase_stock_reversals v ON v.receipt_id = r.id
      WHERE r.purchase_id = NEW.purchase_id AND r.branch_id = NEW.branch_id AND i.product_id = p.id AND v.id IS NULL),0)
    - COALESCE((SELECT SUM(i.quantity) FROM supplier_stock_return_items i
      JOIN supplier_stock_returns r ON r.id = i.return_id
      WHERE r.purchase_id = NEW.purchase_id AND r.branch_id = NEW.branch_id AND i.product_id = p.id),0)
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_SUPPLIER_QUANTITY'); END;
CREATE TRIGGER retail_branch_documents_damage BEFORE INSERT ON damaged_stock
WHEN NOT EXISTS (SELECT 1 FROM retail_branches b WHERE b.id = NEW.branch_id AND b.active = 1)
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_UNAVAILABLE'); END;
CREATE TRIGGER retail_branch_documents_damage_immutable BEFORE UPDATE OF branch_id ON damaged_stock WHEN OLD.branch_id <> NEW.branch_id
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

-- Resolve each canonical stock event from its immutable source document. Transfers use
-- their own double-sided record: no purchase, sale, or change in company cost is created.
CREATE VIEW retail_branch_movement_origin AS
SELECT m.id, COALESCE(
  m.branch_hint_id, sale.branch_id, full_sale.branch_id, partial_sale.branch_id,
  receipt.branch_id, reversal_receipt.branch_id, vendor_return.branch_id, damaged.branch_id,
  counted.branch_id, qdevice.branch_id, 1) AS branch_id
FROM inventory_movements m
LEFT JOIN invoices sale ON m.source_type = 'invoice' AND sale.id = m.source_id
LEFT JOIN invoice_refunds f ON m.source_type = 'refund' AND f.id = m.source_id
LEFT JOIN invoices full_sale ON full_sale.id = f.invoice_id
LEFT JOIN retail_returns r ON m.source_type = 'refund' AND r.id = m.source_id
LEFT JOIN invoices partial_sale ON partial_sale.id = r.invoice_id
LEFT JOIN purchase_stock_receipts receipt ON receipt.id = m.purchase_stock_receipt_id
LEFT JOIN purchase_stock_reversals pr ON pr.id = m.purchase_stock_reversal_id
LEFT JOIN purchase_stock_receipts reversal_receipt ON reversal_receipt.id = pr.receipt_id
LEFT JOIN supplier_stock_returns vendor_return ON vendor_return.id = m.supplier_stock_return_id
LEFT JOIN damaged_stock_corrections dc ON m.source_type = 'adjustment' AND dc.id = m.source_id
LEFT JOIN damaged_stock_reversals dr ON m.source_type = 'damage_reversal' AND dr.id = m.source_id
LEFT JOIN damaged_stock damaged ON damaged.id = CASE WHEN m.source_type = 'damage' THEN m.source_id ELSE COALESCE(dc.damage_id, dr.damage_id) END
LEFT JOIN retail_stocktake_approvals a ON m.source_type = 'adjustment' AND a.id = m.source_id
LEFT JOIN retail_stocktakes counted ON counted.id = a.stocktake_id
LEFT JOIN retail_quarantine_resolutions qr ON qr.id = m.quarantine_resolution_id
LEFT JOIN retail_devices qdevice ON qdevice.id = qr.device_id;

CREATE TRIGGER retail_branch_movement_post AFTER INSERT ON inventory_movements BEGIN
  INSERT INTO retail_branch_movement_links(movement_id, branch_id)
    SELECT id, branch_id FROM retail_branch_movement_origin WHERE id = NEW.id;
  INSERT INTO retail_branch_stock(branch_id, product_id, stock)
    SELECT branch_id, NEW.product_id, 0 FROM retail_branch_movement_links WHERE movement_id = NEW.id
    ON CONFLICT(branch_id, product_id) DO NOTHING;
  UPDATE retail_branch_stock SET stock = stock + NEW.delta
    WHERE product_id = NEW.product_id
      AND branch_id = (SELECT branch_id FROM retail_branch_movement_links WHERE movement_id = NEW.id)
      AND stock + NEW.delta BETWEEN 0 AND 1000000000;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'RETAIL_BRANCH_STOCK') END;
END;
CREATE TRIGGER retail_branch_movement_link_no_update BEFORE UPDATE ON retail_branch_movement_links
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_branch_movement_link_no_delete BEFORE DELETE ON retail_branch_movement_links
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

DROP TRIGGER retail_receipt_register_devices;
CREATE TRIGGER retail_receipt_register_devices AFTER INSERT ON purchase_stock_receipt_items
WHEN json_array_length(NEW.devices_json) > 0
BEGIN
  INSERT INTO retail_devices(product_id, receipt_id, serial_number, imei1, imei2, branch_id)
    SELECT NEW.product_id, NEW.receipt_id, json_extract(j.value, '$.serial_number'),
      json_extract(j.value, '$.imei1'), json_extract(j.value, '$.imei2'), r.branch_id
    FROM json_each(NEW.devices_json) j JOIN purchase_stock_receipts r ON r.id = NEW.receipt_id;
END;
CREATE TRIGGER retail_branch_receipt_reverse BEFORE INSERT ON purchase_stock_reversals
WHEN EXISTS (SELECT 1 FROM retail_devices d JOIN purchase_stock_receipts r ON r.id = d.receipt_id
  WHERE r.id = NEW.receipt_id AND d.branch_id <> r.branch_id)
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_DEVICE'); END;
CREATE TRIGGER retail_branch_invoice_devices BEFORE INSERT ON invoice_items
WHEN EXISTS (SELECT 1 FROM json_each(NEW.device_ids_json) j JOIN retail_devices d ON d.id = j.value
  JOIN invoices i ON i.id = NEW.invoice_id WHERE i.branch_id <> d.branch_id)
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_DEVICE'); END;

CREATE TABLE retail_branch_transfers (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  from_branch_id INTEGER NOT NULL REFERENCES retail_branches(id),
  to_branch_id INTEGER NOT NULL REFERENCES retail_branches(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000000),
  device_ids_json TEXT NOT NULL CHECK (json_valid(device_ids_json) AND json_type(device_ids_json) = 'array'
    AND json_array_length(device_ids_json) <= 100),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 500),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (from_branch_id <> to_branch_id)
) STRICT;
CREATE INDEX retail_branch_transfer_product_idx ON retail_branch_transfers(product_id, id DESC);
CREATE INDEX retail_branch_transfer_from_idx ON retail_branch_transfers(from_branch_id, id DESC);
CREATE INDEX retail_branch_transfer_to_idx ON retail_branch_transfers(to_branch_id, id DESC);
CREATE INDEX retail_branch_devices_idx ON retail_devices(branch_id, product_id, status, id);

CREATE TABLE retail_branch_transfer_devices (
  transfer_id INTEGER NOT NULL REFERENCES retail_branch_transfers(id),
  device_id INTEGER NOT NULL REFERENCES retail_devices(id),
  PRIMARY KEY(transfer_id, device_id)
) STRICT;
CREATE INDEX retail_branch_transfer_device_idx ON retail_branch_transfer_devices(device_id, transfer_id DESC);
CREATE TRIGGER retail_branch_transfer_device_no_update BEFORE UPDATE ON retail_branch_transfer_devices
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_branch_transfer_device_no_delete BEFORE DELETE ON retail_branch_transfer_devices
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

DROP TRIGGER retail_device_identity_immutable;
CREATE TRIGGER retail_device_identity_immutable BEFORE UPDATE ON retail_devices
WHEN NEW.id IS NOT OLD.id OR NEW.product_id IS NOT OLD.product_id OR NEW.receipt_id IS NOT OLD.receipt_id
  OR NEW.inventory_intake_id IS NOT OLD.inventory_intake_id OR NEW.intake_cost_minor IS NOT OLD.intake_cost_minor
  OR NEW.serial_number IS NOT OLD.serial_number COLLATE BINARY OR NEW.imei1 IS NOT OLD.imei1
  OR NEW.imei2 IS NOT OLD.imei2 OR NEW.created_at IS NOT OLD.created_at
  OR NOT (
    (OLD.branch_id <> NEW.branch_id AND OLD.status = 'available' AND NEW.status = 'available' AND EXISTS (
      SELECT 1 FROM retail_branch_transfers t
      WHERE t.id = (SELECT MAX(x.transfer_id) FROM retail_branch_transfer_devices x WHERE x.device_id = OLD.id)
        AND t.product_id = OLD.product_id AND t.from_branch_id = OLD.branch_id AND t.to_branch_id = NEW.branch_id
    ))
    OR (OLD.branch_id = NEW.branch_id AND (
      (OLD.status = 'available' AND NEW.status IN ('sold','voided','returned_to_supplier'))
      OR (OLD.status = 'sold' AND NEW.status IN ('available','quarantined'))
      OR (OLD.status = 'quarantined' AND NEW.status = 'available' AND EXISTS (
        SELECT 1 FROM retail_quarantine_resolutions q
        WHERE q.device_id = OLD.id AND q.return_id = (SELECT MAX(return_id) FROM retail_return_devices WHERE device_id = OLD.id)
      ))
      OR (OLD.status = 'quarantined' AND NEW.status = 'returned_to_supplier' AND EXISTS (
        SELECT 1 FROM supplier_stock_return_devices v JOIN supplier_stock_returns r ON r.id = v.return_id
        JOIN retail_device_disposition_reviews a ON a.id = r.disposition_review_id
        JOIN retail_device_dispositions q ON q.id = a.request_id
        WHERE v.device_id = OLD.id AND q.device_id = OLD.id AND a.decision = 'approve' AND q.disposition = 'supplier'
      ))
      OR EXISTS (
        SELECT 1 FROM retail_device_count_adjustments x WHERE x.device_id = OLD.id
          AND x.from_status = OLD.status AND x.to_status = NEW.status
          AND x.approval_id = (SELECT MAX(a.approval_id) FROM retail_device_count_adjustments a WHERE a.device_id = OLD.id)
      )
    ))
  )
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

CREATE TRIGGER retail_branch_transfer_validate BEFORE INSERT ON retail_branch_transfers BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_branches b WHERE b.id = NEW.from_branch_id AND b.active = 1)
    OR NOT EXISTS (SELECT 1 FROM retail_branches b WHERE b.id = NEW.to_branch_id AND b.active = 1)
    OR NOT EXISTS (SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.active = 1)
    THEN RAISE(ABORT, 'RETAIL_BRANCH_UNAVAILABLE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM products p WHERE p.id = NEW.product_id AND
    CASE WHEN p.tracking = 'quantity' THEN json_array_length(NEW.device_ids_json) <> 0
      ELSE json_array_length(NEW.device_ids_json) <> NEW.quantity END)
    OR json_array_length(NEW.device_ids_json) <> (SELECT count(DISTINCT d.id)
      FROM json_each(NEW.device_ids_json) j JOIN retail_devices d ON d.id = j.value AND j.type = 'integer'
      WHERE d.branch_id = NEW.from_branch_id AND d.product_id = NEW.product_id AND d.status = 'available')
    THEN RAISE(ABORT, 'RETAIL_BRANCH_DEVICE') END;
END;

CREATE TRIGGER retail_branch_transfer_post AFTER INSERT ON retail_branch_transfers BEGIN
  UPDATE retail_branch_stock SET stock = stock - NEW.quantity
    WHERE branch_id = NEW.from_branch_id AND product_id = NEW.product_id AND stock >= NEW.quantity;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'RETAIL_BRANCH_STOCK') END;
  INSERT INTO retail_branch_stock(branch_id, product_id, stock) VALUES(NEW.to_branch_id, NEW.product_id, NEW.quantity)
    ON CONFLICT(branch_id, product_id) DO UPDATE SET stock = stock + excluded.stock;
  INSERT INTO retail_branch_transfer_devices(transfer_id, device_id)
    SELECT NEW.id, value FROM json_each(NEW.device_ids_json);
  UPDATE retail_devices SET branch_id = NEW.to_branch_id WHERE id IN (SELECT value FROM json_each(NEW.device_ids_json));
END;
CREATE TRIGGER retail_branch_transfer_no_update BEFORE UPDATE ON retail_branch_transfers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_branch_transfer_no_delete BEFORE DELETE ON retail_branch_transfers
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

CREATE TRIGGER retail_branch_serial_count_scope BEFORE INSERT ON retail_device_inventory_reviews
WHEN EXISTS (SELECT 1 FROM retail_devices d WHERE d.product_id = NEW.product_id AND d.branch_id <> 1
  AND d.status IN ('available','stocktake_missing'))
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_SERIAL_COUNT'); END;
CREATE TRIGGER retail_branch_serial_approval_scope BEFORE INSERT ON retail_device_inventory_approvals
WHEN EXISTS (SELECT 1 FROM retail_device_inventory_reviews r JOIN retail_devices d ON d.product_id = r.product_id
  WHERE r.id = NEW.review_id AND d.branch_id <> 1 AND d.status IN ('available','stocktake_missing'))
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_SERIAL_COUNT'); END;

DROP VIEW retail_stocktake_records;
CREATE VIEW retail_stocktake_records AS
SELECT s.id, s.product_id, s.product_name, s.tracking, s.expected_quantity, s.observed_quantity,
  s.observed_quantity - s.expected_quantity AS difference_quantity, s.reason, s.actor_id, s.actor_name, s.created_at,
  s.branch_id, b.name AS branch_name, p.quantity_scale,
  a.approved_by, a.approval_reason, a.approved_at,
  CASE WHEN a.id IS NOT NULL THEN 'approved'
    WHEN s.expected_quantity = s.observed_quantity THEN 'matched'
    WHEN s.tracking <> 'quantity' THEN 'report_only'
    WHEN p.active = 0 OR p.tracking <> s.tracking OR COALESCE(bs.stock,0) <> s.expected_quantity OR s.last_movement_id <> COALESCE((
      SELECT MAX(m.id) FROM inventory_movements m WHERE m.product_id = s.product_id
    ), 0) OR s.last_transfer_id <> COALESCE((SELECT MAX(t.id) FROM retail_branch_transfers t WHERE t.product_id = s.product_id),0)
    THEN 'stale' ELSE 'pending_approval' END AS status
FROM retail_stocktakes s JOIN products p ON p.id = s.product_id JOIN retail_branches b ON b.id = s.branch_id
LEFT JOIN retail_branch_stock bs ON bs.branch_id = s.branch_id AND bs.product_id = s.product_id
LEFT JOIN retail_stocktake_approvals a ON a.stocktake_id = s.id;

DROP TRIGGER retail_stocktake_snapshot;
CREATE TRIGGER retail_stocktake_snapshot BEFORE INSERT ON retail_stocktakes BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM products p JOIN retail_branches b ON b.id = NEW.branch_id AND b.active = 1
    LEFT JOIN retail_branch_stock bs ON bs.branch_id = b.id AND bs.product_id = p.id
    WHERE p.id = NEW.product_id AND p.active = 1 AND p.tracking = NEW.tracking
      AND COALESCE(bs.stock,0) = NEW.expected_quantity
      AND NEW.last_movement_id = COALESCE((SELECT MAX(id) FROM inventory_movements WHERE product_id = p.id), 0)
      AND NEW.last_transfer_id = COALESCE((SELECT MAX(id) FROM retail_branch_transfers WHERE product_id = p.id),0)
  ) THEN RAISE(ABORT, 'RETAIL_STOCKTAKE_PRODUCT') END;
END;

DROP TRIGGER retail_shift_only_one_open;
CREATE TRIGGER retail_shift_only_one_open BEFORE INSERT ON retail_shifts BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_branches b WHERE b.id = NEW.branch_id AND b.active = 1)
    THEN RAISE(ABORT, 'RETAIL_BRANCH_UNAVAILABLE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_shifts s
    WHERE (s.actor_id = NEW.actor_id OR (s.branch_id = NEW.branch_id AND s.register_name = NEW.register_name))
      AND NOT EXISTS (SELECT 1 FROM retail_shift_closures c WHERE c.shift_id = s.id))
    THEN RAISE(ABORT, 'RETAIL_SHIFT_ALREADY_OPEN') END;
END;

CREATE TRIGGER retail_branch_tender_match BEFORE INSERT ON retail_tender_batches
WHEN NEW.invoice_id IS NOT NULL AND NEW.shift_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM invoices i JOIN retail_shifts s ON s.id = NEW.shift_id
  WHERE i.id = NEW.invoice_id AND i.branch_id <> s.branch_id
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_BRANCH_SHIFT'); END;

DROP TRIGGER retail_device_disposition_review_apply;
CREATE TRIGGER retail_device_disposition_review_apply AFTER INSERT ON retail_device_disposition_reviews
WHEN NEW.decision = 'approve'
BEGIN
  INSERT INTO maintenance_requests(id, retail_device_id, customer_name, item, problem, requested_date, notes, actor_id)
    SELECT NEW.id, d.id, 'صيانة داخلية للمخزون', p.name, q.reason, NEW.decided_on, NEW.reason, NEW.actor_id
    FROM retail_device_dispositions q JOIN retail_devices d ON d.id = q.device_id
    JOIN products p ON p.id = d.product_id WHERE q.id = NEW.request_id AND q.disposition = 'repair';
  INSERT INTO supplier_stock_returns(id, purchase_id, credit_minor, reason, requested_items, actor_id,
    unapplied_credit_minor, vendor_reference, disposition_review_id, branch_id)
    SELECT NEW.id, r.purchase_id, o.unit_cost_minor, q.reason,
      json_array(json_object('product_id', d.product_id, 'quantity', 1, 'device_ids', json_array(d.id))),
      NEW.actor_id, MAX(0, o.unit_cost_minor - p.net_total_minor + p.paid_minor), q.supplier_reference, NEW.id, d.branch_id
    FROM retail_device_dispositions q JOIN retail_devices d ON d.id = q.device_id
    JOIN purchase_stock_receipts r ON r.id = d.receipt_id JOIN purchases p ON p.id = r.purchase_id
    JOIN purchase_order_items o ON o.purchase_id = r.purchase_id AND o.product_id = d.product_id
    WHERE q.id = NEW.request_id AND q.disposition = 'supplier';
END;
