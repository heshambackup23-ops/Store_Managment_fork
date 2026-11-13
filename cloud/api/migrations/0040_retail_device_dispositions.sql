CREATE TABLE retail_device_dispositions (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  return_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  disposition TEXT NOT NULL CHECK (disposition IN ('repair', 'supplier', 'write_off')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  supplier_reference TEXT CHECK (length(trim(supplier_reference)) BETWEEN 1 AND 100),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (return_id, device_id) REFERENCES retail_return_devices(return_id, device_id) ON DELETE RESTRICT,
  CHECK ((disposition = 'supplier') = (supplier_reference IS NOT NULL))
) STRICT;
CREATE INDEX retail_device_disposition_history ON retail_device_dispositions(device_id, id DESC);

CREATE TABLE retail_device_disposition_reviews (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  request_id INTEGER NOT NULL UNIQUE REFERENCES retail_device_dispositions(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_on TEXT NOT NULL CHECK (date(decided_on) IS decided_on),
  loss_minor INTEGER CHECK (loss_minor >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

ALTER TABLE supplier_stock_returns ADD COLUMN unapplied_credit_minor INTEGER NOT NULL DEFAULT 0
  CHECK (unapplied_credit_minor BETWEEN 0 AND credit_minor);
ALTER TABLE supplier_stock_returns ADD COLUMN vendor_reference TEXT
  CHECK (length(trim(vendor_reference)) BETWEEN 1 AND 100);
ALTER TABLE supplier_stock_returns ADD COLUMN disposition_review_id INTEGER REFERENCES retail_device_disposition_reviews(id);
CREATE UNIQUE INDEX supplier_stock_return_disposition ON supplier_stock_returns(disposition_review_id)
  WHERE disposition_review_id IS NOT NULL;
CREATE UNIQUE INDEX supplier_stock_return_vendor_reference ON supplier_stock_returns(purchase_id, vendor_reference COLLATE NOCASE)
  WHERE vendor_reference IS NOT NULL;

CREATE VIEW retail_active_device_dispositions AS
SELECT q.device_id, q.return_id, q.id AS request_id, a.id AS review_id,
  CASE q.disposition WHEN 'repair' THEN 'in_repair' WHEN 'write_off' THEN 'written_off' END AS effective_status
FROM retail_device_dispositions q
JOIN retail_device_disposition_reviews a ON a.request_id = q.id AND a.decision = 'approve'
LEFT JOIN maintenance_requests m ON m.id = a.id AND q.disposition = 'repair'
JOIN retail_devices d ON d.id = q.device_id AND d.status = 'quarantined'
WHERE q.return_id = (SELECT MAX(return_id) FROM retail_return_devices r WHERE r.device_id = q.device_id)
  AND (q.disposition = 'write_off' OR (q.disposition = 'repair' AND m.archived_at IS NULL AND m.status <> 'cancelled'))
  AND a.id = (
    SELECT MAX(later.id) FROM retail_device_disposition_reviews later
    JOIN retail_device_dispositions request ON request.id = later.request_id
    LEFT JOIN maintenance_requests repair ON repair.id = later.id AND request.disposition = 'repair'
    WHERE request.device_id = q.device_id AND request.return_id = q.return_id AND later.decision = 'approve'
      AND (request.disposition = 'write_off' OR (request.disposition = 'repair' AND repair.archived_at IS NULL AND repair.status <> 'cancelled'))
  );

CREATE TRIGGER retail_device_disposition_validate BEFORE INSERT ON retail_device_dispositions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM retail_return_devices r JOIN retail_devices d ON d.id = r.device_id
    WHERE r.return_id = NEW.return_id AND r.device_id = NEW.device_id AND r.disposition = 'quarantine'
      AND d.status = 'quarantined' AND r.return_id = (SELECT MAX(return_id) FROM retail_return_devices WHERE device_id = d.id)
  ) OR EXISTS (
    SELECT 1 FROM retail_active_device_dispositions a LEFT JOIN maintenance_requests m ON m.id = a.review_id
    WHERE a.device_id = NEW.device_id AND (a.effective_status = 'written_off' OR NEW.disposition = 'repair'
      OR m.status NOT IN ('completed', 'delivered'))
  )
    OR EXISTS (
      SELECT 1 FROM retail_device_dispositions q LEFT JOIN retail_device_disposition_reviews a ON a.request_id = q.id
      WHERE q.device_id = NEW.device_id AND a.id IS NULL
    ) THEN RAISE(ABORT, 'RETAIL_QUARANTINE_STATE') END;
  SELECT CASE WHEN NEW.disposition = 'supplier' AND NOT EXISTS (
    SELECT 1 FROM retail_devices d JOIN purchase_stock_receipts r ON r.id = d.receipt_id
    JOIN purchase_order_items o ON o.purchase_id = r.purchase_id AND o.product_id = d.product_id
    WHERE d.id = NEW.device_id
  ) THEN RAISE(ABORT, 'RETAIL_DISPOSITION_SUPPLIER_SOURCE') END;
END;

CREATE TRIGGER retail_device_disposition_review_validate BEFORE INSERT ON retail_device_disposition_reviews
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_device_dispositions q WHERE q.id = NEW.request_id AND q.actor_id = NEW.actor_id)
    THEN RAISE(ABORT, 'RETAIL_DISPOSITION_SEPARATION') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM retail_device_dispositions q JOIN retail_devices d ON d.id = q.device_id
    WHERE q.id = NEW.request_id AND d.status = 'quarantined'
      AND q.return_id = (SELECT MAX(return_id) FROM retail_return_devices WHERE device_id = q.device_id)
  ) OR EXISTS (SELECT 1 FROM retail_device_disposition_reviews WHERE request_id = NEW.request_id)
    THEN RAISE(ABORT, 'RETAIL_QUARANTINE_STATE') END;
  SELECT CASE WHEN NEW.loss_minor IS NOT (
    SELECT s.unit_cost_minor
    FROM retail_device_dispositions q JOIN retail_return_devices r USING (return_id, device_id)
    JOIN retail_device_sales s USING (invoice_id, product_id, device_id)
    WHERE q.id = NEW.request_id AND q.disposition = 'write_off' AND NEW.decision = 'approve'
  ) THEN RAISE(ABORT, 'RETAIL_DISPOSITION_COST') END;
END;

DROP TRIGGER retail_device_identity_immutable;
CREATE TRIGGER retail_device_identity_immutable BEFORE UPDATE ON retail_devices
WHEN NEW.id IS NOT OLD.id OR NEW.product_id IS NOT OLD.product_id OR NEW.receipt_id IS NOT OLD.receipt_id
  OR NEW.serial_number IS NOT OLD.serial_number COLLATE BINARY OR NEW.imei1 IS NOT OLD.imei1
  OR NEW.imei2 IS NOT OLD.imei2 OR NEW.created_at IS NOT OLD.created_at
  OR NEW.inventory_intake_id IS NOT OLD.inventory_intake_id OR NEW.intake_cost_minor IS NOT OLD.intake_cost_minor
  OR NOT ((OLD.status = 'available' AND NEW.status IN ('sold','voided','returned_to_supplier'))
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
    ))
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

CREATE TRIGGER retail_quarantine_open_disposition BEFORE INSERT ON retail_quarantine_resolutions
WHEN EXISTS (
  SELECT 1 FROM retail_device_dispositions q LEFT JOIN retail_device_disposition_reviews a ON a.request_id = q.id
  WHERE q.device_id = NEW.device_id AND q.return_id = NEW.return_id AND a.id IS NULL
) OR EXISTS (
  SELECT 1 FROM retail_active_device_dispositions a LEFT JOIN maintenance_requests m ON m.id = a.review_id
  WHERE a.device_id = NEW.device_id AND a.return_id = NEW.return_id
    AND (a.effective_status = 'written_off' OR m.status NOT IN ('completed', 'delivered'))
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_DISPOSITION_OPEN'); END;

CREATE TRIGGER retail_device_internal_repair_guard BEFORE UPDATE ON maintenance_requests
WHEN EXISTS (
  SELECT 1 FROM retail_device_disposition_reviews a JOIN retail_device_dispositions q ON q.id = a.request_id
  WHERE a.id = OLD.id AND q.disposition = 'repair' AND a.decision = 'approve'
) AND (NEW.retail_device_id IS NOT OLD.retail_device_id OR NEW.customer_id IS NOT NULL OR NEW.price_minor <> 0)
BEGIN SELECT RAISE(ABORT, 'RETAIL_DISPOSITION_INTERNAL_REPAIR'); END;

DROP TRIGGER supplier_stock_return_validate;
CREATE TRIGGER supplier_stock_return_validate BEFORE INSERT ON supplier_stock_returns
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.requested_items) j LEFT JOIN purchase_order_progress o
      ON o.purchase_id = NEW.purchase_id AND o.product_id = json_extract(j.value, '$.product_id')
    WHERE o.product_id IS NULL OR json_extract(j.value, '$.quantity') > o.received_quantity - o.returned_quantity
  ) THEN RAISE(ABORT, 'SUPPLIER_RETURN_QUANTITY') END;
  SELECT CASE WHEN NEW.disposition_review_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM retail_device_disposition_reviews a JOIN retail_device_dispositions q ON q.id = a.request_id
    JOIN retail_devices d ON d.id = q.device_id JOIN purchase_stock_receipts r ON r.id = d.receipt_id
    WHERE a.id = NEW.disposition_review_id AND a.id = NEW.id AND a.actor_id = NEW.actor_id
      AND a.decision = 'approve' AND q.disposition = 'supplier' AND q.supplier_reference = NEW.vendor_reference
      AND r.purchase_id = NEW.purchase_id AND d.status = 'quarantined'
      AND json_array_length(NEW.requested_items) = 1 AND json_array_length(NEW.requested_items, '$[0].device_ids') = 1
      AND json_extract(NEW.requested_items, '$[0].device_ids[0]') = d.id
      AND json_extract(NEW.requested_items, '$[0].product_id') = d.product_id
      AND json_extract(NEW.requested_items, '$[0].quantity') = 1
  ) THEN RAISE(ABORT, 'SUPPLIER_RETURN_DEVICE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.requested_items) j JOIN products p ON p.id = json_extract(j.value, '$.product_id')
    WHERE COALESCE(json_array_length(j.value, '$.device_ids'), 0)
      <> CASE WHEN p.tracking = 'quantity' THEN 0 ELSE json_extract(j.value, '$.quantity') END
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.requested_items) j CROSS JOIN json_each(j.value, '$.device_ids') v
    LEFT JOIN retail_devices d ON d.id = v.value AND d.product_id = json_extract(j.value, '$.product_id')
    LEFT JOIN purchase_stock_receipts r ON r.id = d.receipt_id
    WHERE d.id IS NULL OR r.purchase_id IS NOT NEW.purchase_id
      OR d.status <> CASE WHEN NEW.disposition_review_id IS NULL THEN 'available' ELSE 'quarantined' END
  ) THEN RAISE(ABORT, 'SUPPLIER_RETURN_DEVICE') END;
  SELECT CASE WHEN NEW.credit_minor <> (
    SELECT SUM(o.unit_cost_minor * json_extract(j.value, '$.quantity'))
    FROM json_each(NEW.requested_items) j JOIN purchase_order_items o
      ON o.purchase_id = NEW.purchase_id AND o.product_id = json_extract(j.value, '$.product_id')
  ) OR NEW.credit_minor - NEW.unapplied_credit_minor > (
    SELECT net_total_minor - paid_minor FROM purchases WHERE id = NEW.purchase_id
  ) OR NEW.unapplied_credit_minor <> CASE WHEN NEW.disposition_review_id IS NULL THEN 0 ELSE (
    SELECT MAX(0, NEW.credit_minor - net_total_minor + paid_minor) FROM purchases WHERE id = NEW.purchase_id
  ) END THEN RAISE(ABORT, 'SUPPLIER_RETURN_BALANCE') END;
END;

DROP TRIGGER supplier_stock_return_apply;
CREATE TRIGGER supplier_stock_return_apply AFTER INSERT ON supplier_stock_returns
BEGIN
  INSERT INTO supplier_stock_return_items (return_id, purchase_id, product_id, quantity, unit_cost_minor)
    SELECT NEW.id, NEW.purchase_id, o.product_id, json_extract(j.value, '$.quantity'), o.unit_cost_minor
    FROM json_each(NEW.requested_items) j JOIN purchase_order_items o
      ON o.purchase_id = NEW.purchase_id AND o.product_id = json_extract(j.value, '$.product_id');
  INSERT INTO supplier_stock_return_devices (return_id, product_id, device_id)
    SELECT NEW.id, json_extract(j.value, '$.product_id'), v.value
    FROM json_each(NEW.requested_items) j CROSS JOIN json_each(j.value, '$.device_ids') v;
  UPDATE retail_devices SET status = 'returned_to_supplier'
    WHERE id IN (SELECT device_id FROM supplier_stock_return_devices WHERE return_id = NEW.id);
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id, supplier_stock_return_id)
    SELECT product_id, -quantity, 'adjustment', NEW.id, NEW.reason, NEW.actor_id, NEW.id
    FROM supplier_stock_return_items WHERE return_id = NEW.id AND NEW.disposition_review_id IS NULL;
  UPDATE purchases SET supplier_credit_minor = supplier_credit_minor + NEW.credit_minor - NEW.unapplied_credit_minor
    WHERE id = NEW.purchase_id;
END;

CREATE TRIGGER retail_device_disposition_review_apply AFTER INSERT ON retail_device_disposition_reviews
WHEN NEW.decision = 'approve'
BEGIN
  INSERT INTO maintenance_requests(id, retail_device_id, customer_name, item, problem, requested_date, notes, actor_id)
    SELECT NEW.id, d.id, 'صيانة داخلية للمخزون', p.name, q.reason, NEW.decided_on, NEW.reason, NEW.actor_id
    FROM retail_device_dispositions q JOIN retail_devices d ON d.id = q.device_id
    JOIN products p ON p.id = d.product_id WHERE q.id = NEW.request_id AND q.disposition = 'repair';
  INSERT INTO supplier_stock_returns(id, purchase_id, credit_minor, reason, requested_items, actor_id,
    unapplied_credit_minor, vendor_reference, disposition_review_id)
    SELECT NEW.id, r.purchase_id, o.unit_cost_minor, q.reason,
      json_array(json_object('product_id', d.product_id, 'quantity', 1, 'device_ids', json_array(d.id))),
      NEW.actor_id, MAX(0, o.unit_cost_minor - p.net_total_minor + p.paid_minor), q.supplier_reference, NEW.id
    FROM retail_device_dispositions q JOIN retail_devices d ON d.id = q.device_id
    JOIN purchase_stock_receipts r ON r.id = d.receipt_id JOIN purchases p ON p.id = r.purchase_id
    JOIN purchase_order_items o ON o.purchase_id = r.purchase_id AND o.product_id = d.product_id
    WHERE q.id = NEW.request_id AND q.disposition = 'supplier';
END;

CREATE TRIGGER retail_device_dispositions_no_update BEFORE UPDATE ON retail_device_dispositions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_device_dispositions_no_delete BEFORE DELETE ON retail_device_dispositions
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_device_disposition_reviews_no_update BEFORE UPDATE ON retail_device_disposition_reviews
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_device_disposition_reviews_no_delete BEFORE DELETE ON retail_device_disposition_reviews
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
