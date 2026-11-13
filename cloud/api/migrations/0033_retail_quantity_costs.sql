ALTER TABLE products ADD COLUMN inventory_value_minor INTEGER CHECK (
  inventory_value_minor IS NULL OR (typeof(inventory_value_minor) = 'integer'
    AND inventory_value_minor BETWEEN 0 AND 900000000000000 AND (stock > 0 OR inventory_value_minor = 0))
);

CREATE TABLE retail_quantity_movement_costs (
  movement_id INTEGER PRIMARY KEY REFERENCES inventory_movements(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  stock_before INTEGER NOT NULL,
  stock_after INTEGER NOT NULL,
  value_before_minor INTEGER,
  value_after_minor INTEGER,
  cost_delta_minor INTEGER,
  damage_id INTEGER REFERENCES damaged_stock(id),
  damage_quantity_after INTEGER,
  damage_value_after_minor INTEGER
) STRICT;
CREATE INDEX retail_quantity_costs_source ON retail_quantity_movement_costs(source_type, source_id, product_id);
CREATE INDEX retail_quantity_costs_damage ON retail_quantity_movement_costs(damage_id, movement_id DESC) WHERE damage_id IS NOT NULL;

CREATE VIEW retail_quantity_sale_costs AS
SELECT source_id AS invoice_id, product_id, -delta AS quantity, -cost_delta_minor AS cost_minor, movement_id
FROM retail_quantity_movement_costs WHERE source_type = 'invoice';

CREATE TABLE retail_quantity_return_costs (
  return_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  disposition TEXT NOT NULL,
  invoice_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  cost_minor INTEGER CHECK (cost_minor >= 0),
  PRIMARY KEY (return_id, product_id, disposition),
  FOREIGN KEY (return_id, product_id, disposition) REFERENCES retail_return_items(return_id, product_id, disposition)
) STRICT;
CREATE INDEX retail_quantity_return_costs_invoice ON retail_quantity_return_costs(invoice_id, product_id);

-- Use cumulative quantities so rounding telescopes to the original invoice cost.
CREATE TRIGGER retail_quantity_return_cost AFTER INSERT ON retail_return_items
WHEN EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND tracking = 'quantity')
BEGIN
  INSERT INTO retail_quantity_return_costs(return_id, product_id, disposition, invoice_id, quantity, cost_minor)
  WITH before AS (
    SELECT COALESCE(SUM(quantity), 0) AS returned FROM retail_quantity_return_costs
    WHERE invoice_id = NEW.invoice_id AND product_id = NEW.product_id
  )
  SELECT NEW.return_id, NEW.product_id, NEW.disposition, NEW.invoice_id, NEW.quantity,
    (s.cost_minor / s.quantity) * NEW.quantity
      + (s.cost_minor % s.quantity) * (before.returned + NEW.quantity) / s.quantity
      - (s.cost_minor % s.quantity) * before.returned / s.quantity
  FROM before LEFT JOIN retail_quantity_sale_costs s ON s.invoice_id = NEW.invoice_id AND s.product_id = NEW.product_id;
END;

CREATE TABLE retail_quantity_opening_valuations (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  expected_stock INTEGER NOT NULL CHECK (expected_stock BETWEEN 1 AND 1000000000),
  expected_movement_id INTEGER NOT NULL CHECK (expected_movement_id >= 0),
  value_minor INTEGER NOT NULL CHECK (value_minor BETWEEN 0 AND 900000000000000),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TRIGGER retail_quantity_value_opening BEFORE INSERT ON retail_quantity_opening_valuations
WHEN NOT EXISTS (
  SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.tracking = 'quantity' AND p.active = 1
    AND p.inventory_value_minor IS NULL AND p.stock = NEW.expected_stock AND NEW.expected_movement_id = COALESCE(
      (SELECT MAX(m.id) FROM inventory_movements m WHERE m.product_id = p.id), 0)
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_OPENING_VALUE_STALE'); END;

CREATE TRIGGER retail_quantity_value_apply AFTER INSERT ON retail_quantity_opening_valuations
BEGIN
  UPDATE products SET inventory_value_minor = NEW.value_minor, updated_at = CURRENT_TIMESTAMP WHERE id = NEW.product_id;
END;

CREATE TRIGGER retail_quantity_opening_no_update BEFORE UPDATE ON retail_quantity_opening_valuations
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_quantity_opening_no_delete BEFORE DELETE ON retail_quantity_opening_valuations
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_quantity_movement_no_update BEFORE UPDATE ON retail_quantity_movement_costs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_quantity_movement_no_delete BEFORE DELETE ON retail_quantity_movement_costs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_quantity_return_no_update BEFORE UPDATE ON retail_quantity_return_costs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_quantity_return_no_delete BEFORE DELETE ON retail_quantity_return_costs
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

DROP TRIGGER apply_inventory_movement;
CREATE TRIGGER apply_inventory_movement AFTER INSERT ON inventory_movements
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.stock + NEW.delta BETWEEN 0 AND 1000000000
  ) THEN RAISE(ABORT, 'INSUFFICIENT_STOCK') END;

  INSERT INTO retail_quantity_movement_costs(movement_id, product_id, source_type, source_id, delta,
    stock_before, stock_after, value_before_minor, value_after_minor, cost_delta_minor,
    damage_id, damage_quantity_after, damage_value_after_minor)
  WITH context AS (
    SELECT p.stock AS before_quantity, p.stock + NEW.delta AS after_quantity,
      CASE WHEN p.stock = 0 THEN 0 ELSE p.inventory_value_minor END AS before_value,
      CASE WHEN NEW.source_type = 'damage' THEN NEW.source_id ELSE COALESCE(dc.damage_id, dr.damage_id) END AS damage_id,
      dc.previous_quantity AS damage_previous_quantity,
      s.cost_minor AS original_sale_cost, rr.cost_minor AS line_return_cost,
      reverse_cost.cost_delta_minor AS receipt_cost, o.unit_cost_minor + o.landed_unit_minor AS received_unit_cost
    FROM products p
    LEFT JOIN purchase_stock_receipts r ON r.id = NEW.purchase_stock_receipt_id
    LEFT JOIN purchase_order_items o ON o.purchase_id = r.purchase_id AND o.product_id = p.id
    LEFT JOIN invoice_refunds f ON NEW.source_type = 'refund' AND f.id = NEW.source_id AND f.legacy_refund_reference IS NULL
    LEFT JOIN retail_quantity_sale_costs s ON s.invoice_id = f.invoice_id AND s.product_id = p.id
    LEFT JOIN retail_quantity_return_costs rr ON NEW.source_type = 'refund' AND rr.return_id = NEW.source_id
      AND rr.product_id = p.id AND rr.disposition = 'resale'
    LEFT JOIN damaged_stock_corrections dc ON NEW.source_type = 'adjustment' AND dc.id = NEW.source_id
      AND NEW.delta = dc.previous_quantity - dc.quantity
      AND p.id = (SELECT product_id FROM damaged_stock WHERE id = dc.damage_id)
    LEFT JOIN damaged_stock_reversals dr ON NEW.source_type = 'damage_reversal' AND dr.id = NEW.source_id
    LEFT JOIN purchase_stock_reversals pr ON pr.id = NEW.purchase_stock_reversal_id
    LEFT JOIN inventory_movements receipt_movement ON receipt_movement.id = (
      SELECT MAX(m.id) FROM inventory_movements m WHERE m.product_id = p.id AND m.id < NEW.id
    ) AND receipt_movement.purchase_stock_receipt_id = pr.receipt_id
    LEFT JOIN retail_quantity_movement_costs reverse_cost ON reverse_cost.movement_id = receipt_movement.id
    WHERE p.id = NEW.product_id AND p.tracking = 'quantity'
  ), damage_pool AS (
    SELECT ctx.*, loss.damage_value_after_minor AS previous_damage_value,
      COALESCE(loss.damage_quantity_after, ctx.damage_previous_quantity, d.quantity) AS previous_damage_quantity
    FROM context ctx LEFT JOIN damaged_stock d ON d.id = ctx.damage_id
    LEFT JOIN retail_quantity_movement_costs loss ON loss.movement_id = (
      SELECT MAX(c.movement_id) FROM retail_quantity_movement_costs c WHERE c.damage_id = ctx.damage_id
    )
  ), valuation AS (
    SELECT *, CASE
      -- Integer quotient and remainder avoid overflow from directly multiplying inventory value by quantity.
      WHEN NEW.purchase_stock_reversal_id IS NOT NULL THEN
        CASE WHEN receipt_cost IS NOT NULL AND receipt_cost <= before_value AND
          (after_quantity > 0 OR receipt_cost = before_value) THEN -receipt_cost END
      WHEN NEW.delta < 0 THEN
        -((before_value / before_quantity) * -NEW.delta + (before_value % before_quantity) * -NEW.delta / before_quantity)
      WHEN NEW.purchase_stock_receipt_id IS NOT NULL THEN NEW.delta * received_unit_cost
      WHEN NEW.source_type = 'refund' THEN COALESCE(line_return_cost, original_sale_cost)
      WHEN damage_id IS NOT NULL AND previous_damage_quantity >= NEW.delta THEN
        (previous_damage_value / previous_damage_quantity) * NEW.delta
          + (previous_damage_value % previous_damage_quantity) * NEW.delta / previous_damage_quantity
      ELSE NULL END AS change_value
    FROM damage_pool
  )
  SELECT NEW.id, NEW.product_id, NEW.source_type, NEW.source_id, NEW.delta,
    before_quantity, after_quantity, before_value, CASE WHEN after_quantity = 0 THEN 0 ELSE before_value + change_value END,
    change_value, damage_id,
    CASE WHEN NEW.source_type = 'damage' THEN -NEW.delta
      WHEN damage_id IS NOT NULL THEN previous_damage_quantity - NEW.delta END,
    CASE WHEN NEW.source_type = 'damage' THEN -change_value
      WHEN damage_id IS NOT NULL AND previous_damage_quantity = NEW.delta THEN 0
      WHEN damage_id IS NOT NULL THEN previous_damage_value - change_value END
  FROM valuation;

  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM retail_quantity_movement_costs c WHERE c.movement_id = NEW.id
      AND (c.value_after_minor > 900000000000000 OR c.damage_value_after_minor > 900000000000000)
  ) THEN RAISE(ABORT, 'RETAIL_INVENTORY_VALUE_LIMIT') END;
  UPDATE products SET stock = stock + NEW.delta, updated_at = CURRENT_TIMESTAMP,
    inventory_value_minor = (SELECT value_after_minor FROM retail_quantity_movement_costs WHERE movement_id = NEW.id)
    WHERE id = NEW.product_id;
END;
