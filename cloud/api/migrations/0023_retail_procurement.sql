ALTER TABLE purchases ADD COLUMN supplier_credit_minor INTEGER NOT NULL DEFAULT 0
  CHECK (supplier_credit_minor BETWEEN 0 AND total_minor - paid_minor);
ALTER TABLE purchases ADD COLUMN gross_total_minor INTEGER GENERATED ALWAYS AS (total_minor) VIRTUAL;
ALTER TABLE purchases ADD COLUMN net_total_minor INTEGER GENERATED ALWAYS AS (total_minor - supplier_credit_minor) VIRTUAL;
ALTER TABLE inventory_movements ADD COLUMN supplier_stock_return_id INTEGER REFERENCES supplier_stock_returns(id) ON DELETE RESTRICT;
ALTER TABLE retail_device_sales ADD COLUMN unit_cost_minor INTEGER CHECK (unit_cost_minor >= 0);

CREATE TABLE purchase_order_items (
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor BETWEEN 0 AND 100000000000),
  landed_unit_minor INTEGER NOT NULL DEFAULT 0 CHECK (landed_unit_minor BETWEEN 0 AND 100000000000),
  PRIMARY KEY (purchase_id, product_id)
) STRICT;

CREATE TABLE supplier_stock_returns (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  credit_minor INTEGER NOT NULL CHECK (credit_minor BETWEEN 0 AND 900000000000000),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  requested_items TEXT NOT NULL CHECK (json_valid(requested_items) AND json_type(requested_items) = 'array'
    AND json_array_length(requested_items) BETWEEN 1 AND 40),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;
CREATE INDEX supplier_stock_returns_purchase ON supplier_stock_returns(purchase_id, id DESC);

CREATE TABLE supplier_stock_return_items (
  return_id INTEGER NOT NULL REFERENCES supplier_stock_returns(id) ON DELETE RESTRICT,
  purchase_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
  PRIMARY KEY (return_id, product_id),
  FOREIGN KEY (purchase_id, product_id) REFERENCES purchase_order_items(purchase_id, product_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX supplier_stock_return_items_order ON supplier_stock_return_items(purchase_id, product_id);

CREATE TABLE supplier_stock_return_devices (
  return_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL UNIQUE REFERENCES retail_devices(id) ON DELETE RESTRICT,
  PRIMARY KEY (return_id, device_id),
  FOREIGN KEY (return_id, product_id) REFERENCES supplier_stock_return_items(return_id, product_id) ON DELETE RESTRICT
) STRICT;

CREATE VIEW purchase_order_progress AS
SELECT o.*, p.tracking, o.unit_cost_minor + o.landed_unit_minor AS inventory_unit_cost_minor,
  COALESCE((
    SELECT SUM(i.quantity) FROM purchase_stock_receipt_items i JOIN purchase_stock_receipts r ON r.id = i.receipt_id
    LEFT JOIN purchase_stock_reversals v ON v.receipt_id = r.id
    WHERE r.purchase_id = o.purchase_id AND i.product_id = o.product_id AND v.id IS NULL
  ), 0) AS received_quantity,
  COALESCE((
    SELECT SUM(i.quantity) FROM supplier_stock_return_items i
    WHERE i.purchase_id = o.purchase_id AND i.product_id = o.product_id
  ), 0) AS returned_quantity
FROM purchase_order_items o JOIN products p ON p.id = o.product_id;

CREATE TRIGGER purchase_order_item_active BEFORE INSERT ON purchase_order_items
WHEN NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND active = 1)
BEGIN SELECT RAISE(ABORT, 'PURCHASE_PRODUCT_UNAVAILABLE'); END;
CREATE TRIGGER purchase_order_items_no_update BEFORE UPDATE ON purchase_order_items
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER purchase_order_items_no_delete BEFORE DELETE ON purchase_order_items
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

CREATE TRIGGER purchase_receipt_order_quantities BEFORE INSERT ON purchase_stock_receipt_items
WHEN EXISTS (
  SELECT 1 FROM purchase_stock_receipts r JOIN purchase_order_items o ON o.purchase_id = r.purchase_id
  WHERE r.id = NEW.receipt_id
) AND NOT EXISTS (
  SELECT 1 FROM purchase_stock_receipts r JOIN purchase_order_progress o ON o.purchase_id = r.purchase_id
  WHERE r.id = NEW.receipt_id AND o.product_id = NEW.product_id AND NEW.quantity <= o.quantity - o.received_quantity
)
BEGIN SELECT RAISE(ABORT, 'PURCHASE_RECEIPT_ORDER_QUANTITY'); END;

CREATE TRIGGER purchase_receipt_return_guard BEFORE INSERT ON purchase_stock_reversals
WHEN EXISTS (
  SELECT 1 FROM purchase_stock_receipts r JOIN purchase_stock_receipt_items i ON i.receipt_id = r.id
  JOIN purchase_order_progress o ON o.purchase_id = r.purchase_id AND o.product_id = i.product_id
  WHERE r.id = NEW.receipt_id AND o.received_quantity - i.quantity < o.returned_quantity
)
BEGIN SELECT RAISE(ABORT, 'PURCHASE_RECEIPT_HAS_RETURNS'); END;

DROP TRIGGER retail_inventory_guard;
CREATE TRIGGER retail_inventory_guard BEFORE INSERT ON inventory_movements
WHEN EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND tracking <> 'quantity')
  AND NEW.source_type NOT IN ('invoice', 'refund')
  AND NEW.purchase_stock_receipt_id IS NULL AND NEW.purchase_stock_reversal_id IS NULL
  AND NEW.supplier_stock_return_id IS NULL
BEGIN SELECT RAISE(ABORT, 'RETAIL_DEVICE_MOVEMENT_REQUIRED'); END;

CREATE TRIGGER supplier_stock_return_validate BEFORE INSERT ON supplier_stock_returns
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.requested_items) j LEFT JOIN purchase_order_progress o
      ON o.purchase_id = NEW.purchase_id AND o.product_id = json_extract(j.value, '$.product_id')
    WHERE o.product_id IS NULL OR json_extract(j.value, '$.quantity') > o.received_quantity - o.returned_quantity
  ) THEN RAISE(ABORT, 'SUPPLIER_RETURN_QUANTITY') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.requested_items) j JOIN products p ON p.id = json_extract(j.value, '$.product_id')
    WHERE COALESCE(json_array_length(j.value, '$.device_ids'), 0)
      <> CASE WHEN p.tracking = 'quantity' THEN 0 ELSE json_extract(j.value, '$.quantity') END
  ) OR EXISTS (
    SELECT 1 FROM json_each(NEW.requested_items) j CROSS JOIN json_each(j.value, '$.device_ids') v
    LEFT JOIN retail_devices d ON d.id = v.value AND d.product_id = json_extract(j.value, '$.product_id')
    LEFT JOIN purchase_stock_receipts r ON r.id = d.receipt_id
    WHERE d.id IS NULL OR d.status <> 'available' OR r.purchase_id <> NEW.purchase_id
  ) THEN RAISE(ABORT, 'SUPPLIER_RETURN_DEVICE') END;
  SELECT CASE WHEN NEW.credit_minor <> (
    SELECT SUM(o.unit_cost_minor * json_extract(j.value, '$.quantity'))
    FROM json_each(NEW.requested_items) j JOIN purchase_order_items o
      ON o.purchase_id = NEW.purchase_id AND o.product_id = json_extract(j.value, '$.product_id')
  ) OR NEW.credit_minor > (
    SELECT net_total_minor - paid_minor FROM purchases WHERE id = NEW.purchase_id
  ) THEN RAISE(ABORT, 'SUPPLIER_RETURN_BALANCE') END;
END;

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
    FROM supplier_stock_return_items WHERE return_id = NEW.id;
  UPDATE purchases SET supplier_credit_minor = supplier_credit_minor + NEW.credit_minor WHERE id = NEW.purchase_id;
END;

CREATE TRIGGER supplier_stock_return_no_update BEFORE UPDATE ON supplier_stock_returns
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER supplier_stock_return_no_delete BEFORE DELETE ON supplier_stock_returns
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER supplier_stock_return_item_no_update BEFORE UPDATE ON supplier_stock_return_items
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER supplier_stock_return_item_no_delete BEFORE DELETE ON supplier_stock_return_items
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER supplier_stock_return_device_no_update BEFORE UPDATE ON supplier_stock_return_devices
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER supplier_stock_return_device_no_delete BEFORE DELETE ON supplier_stock_return_devices
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

DROP TRIGGER retail_invoice_bind_devices;
CREATE TRIGGER retail_invoice_bind_devices AFTER INSERT ON invoice_items
WHEN json_array_length(NEW.device_ids_json) > 0
BEGIN
  INSERT INTO retail_device_sales(invoice_id, product_id, device_id, warranty_months, warranty_starts_on,
    warranty_expires_on, unit_cost_minor)
  SELECT NEW.invoice_id, NEW.product_id, j.value, p.warranty_months,
    CASE WHEN p.warranty_months > 0 THEN i.invoice_date END,
    CASE WHEN p.warranty_months > 0 THEN date(i.invoice_date, '+' || p.warranty_months || ' months', 'floor') END,
    o.unit_cost_minor + o.landed_unit_minor
  FROM json_each(NEW.device_ids_json) j JOIN products p ON p.id = NEW.product_id
    JOIN invoices i ON i.id = NEW.invoice_id JOIN retail_devices d ON d.id = j.value
    JOIN purchase_stock_receipts r ON r.id = d.receipt_id
    LEFT JOIN purchase_order_items o ON o.purchase_id = r.purchase_id AND o.product_id = d.product_id;
  UPDATE retail_devices SET status = 'sold' WHERE id IN (SELECT value FROM json_each(NEW.device_ids_json));
END;

DROP VIEW supplier_balances;
CREATE VIEW supplier_balances AS
SELECT s.*, COALESCE(p.purchase_total_minor, 0) AS purchase_total_minor,
  COALESCE(p.purchase_paid_minor, 0) AS purchase_paid_minor, COALESCE(p.purchases_count, 0) AS purchases_count,
  COALESCE(r.opening_paid_minor, 0) AS opening_paid_minor,
  s.opening_minor - COALESCE(r.opening_paid_minor, 0) + COALESCE(p.purchase_due_minor, 0) AS balance_minor
FROM suppliers s
LEFT JOIN (
  SELECT supplier_id, SUM(net_total_minor) AS purchase_total_minor, SUM(paid_minor) AS purchase_paid_minor,
    SUM(net_total_minor - paid_minor) AS purchase_due_minor, COUNT(*) AS purchases_count
  FROM purchases GROUP BY supplier_id
) p ON p.supplier_id = s.id
LEFT JOIN (
  SELECT supplier_id, SUM(opening_applied_minor) AS opening_paid_minor FROM supplier_receipts GROUP BY supplier_id
) r ON r.supplier_id = s.id;

DROP TRIGGER allocate_supplier_receipt;
CREATE TRIGGER allocate_supplier_receipt AFTER INSERT ON supplier_receipts
BEGIN
  SELECT CASE WHEN NEW.opening_applied_minor <> MAX(0, NEW.amount_minor - (
      SELECT COALESCE(SUM(net_total_minor - paid_minor), 0) FROM purchases WHERE supplier_id = NEW.supplier_id
    )) OR NEW.opening_applied_minor > (
      SELECT opening_minor FROM suppliers WHERE id = NEW.supplier_id
    ) - (
      SELECT COALESCE(SUM(opening_applied_minor), 0) FROM supplier_receipts
      WHERE supplier_id = NEW.supplier_id AND id <> NEW.id
    ) THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
  INSERT INTO supplier_receipt_allocations(receipt_id, purchase_id, amount_minor)
  SELECT NEW.id, ranked.id, MIN(ranked.due, NEW.amount_minor - ranked.previous_due)
  FROM (
    SELECT id, net_total_minor - paid_minor AS due,
      COALESCE(SUM(net_total_minor - paid_minor) OVER (
        ORDER BY purchase_date, id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0) AS previous_due
    FROM purchases WHERE supplier_id = NEW.supplier_id AND paid_minor < net_total_minor
  ) ranked WHERE NEW.amount_minor > ranked.previous_due;
END;

DROP TRIGGER apply_supplier_receipt_allocation;
CREATE TRIGGER apply_supplier_receipt_allocation AFTER INSERT ON supplier_receipt_allocations
BEGIN
  UPDATE purchases SET paid_minor = paid_minor + NEW.amount_minor
  WHERE id = NEW.purchase_id AND paid_minor + NEW.amount_minor <= net_total_minor
    AND supplier_id = (SELECT supplier_id FROM supplier_receipts WHERE id = NEW.receipt_id);
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
END;

DROP TRIGGER apply_supplier_payment;
CREATE TRIGGER apply_supplier_payment AFTER INSERT ON supplier_payments
BEGIN
  UPDATE purchases SET paid_minor = paid_minor + NEW.amount_minor
  WHERE id = NEW.purchase_id AND paid_minor + NEW.amount_minor <= net_total_minor;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
END;
