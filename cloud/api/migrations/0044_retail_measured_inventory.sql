-- Keep millimeters in the inventory ledger and piastres in the money ledger.
-- Existing products and invoice lines have a scale of 1.
ALTER TABLE products ADD COLUMN measurement_unit TEXT NOT NULL DEFAULT 'piece'
  CHECK (measurement_unit IN ('piece', 'meter'));
ALTER TABLE products ADD COLUMN quantity_scale INTEGER GENERATED ALWAYS AS (
  CASE measurement_unit WHEN 'meter' THEN 1000 ELSE 1 END
) VIRTUAL;
ALTER TABLE invoice_items ADD COLUMN quantity_scale INTEGER NOT NULL DEFAULT 1 CHECK (quantity_scale IN (1, 1000));
ALTER TABLE invoice_items ADD COLUMN line_total_minor INTEGER GENERATED ALWAYS AS (
  (unit_price_minor * quantity + quantity_scale / 2) / quantity_scale
) VIRTUAL;
ALTER TABLE invoice_items ADD COLUMN line_gross_minor INTEGER GENERATED ALWAYS AS (
  (COALESCE(original_unit_price_minor, unit_price_minor) * quantity + quantity_scale / 2) / quantity_scale
) VIRTUAL;

CREATE TRIGGER retail_meter_product_insert BEFORE INSERT ON products
WHEN NEW.measurement_unit = 'meter' AND
  (NEW.tracking <> 'quantity' OR NEW.units_per_pack <> 1 OR NEW.pack_barcode IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'RETAIL_METER_PRODUCT'); END;

CREATE TRIGGER retail_meter_product_update BEFORE UPDATE OF measurement_unit, tracking, units_per_pack, pack_barcode ON products
WHEN NEW.measurement_unit IS NOT OLD.measurement_unit OR (NEW.measurement_unit = 'meter' AND
  (NEW.tracking <> 'quantity' OR NEW.units_per_pack <> 1 OR NEW.pack_barcode IS NOT NULL))
BEGIN SELECT RAISE(ABORT, 'RETAIL_METER_PRODUCT'); END;

CREATE TRIGGER retail_meter_invoice_scale_insert BEFORE INSERT ON invoice_items
WHEN NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND quantity_scale = NEW.quantity_scale)
BEGIN SELECT RAISE(ABORT, 'RETAIL_MEASUREMENT_SCALE'); END;
CREATE TRIGGER retail_meter_invoice_scale_update BEFORE UPDATE OF quantity_scale ON invoice_items
WHEN NEW.quantity_scale <> OLD.quantity_scale
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

DROP VIEW purchase_order_progress;
CREATE VIEW purchase_order_progress AS
SELECT o.*, p.tracking, p.measurement_unit, p.quantity_scale,
  o.unit_cost_minor + o.landed_unit_minor AS inventory_unit_cost_minor,
  (o.unit_cost_minor * o.quantity + p.quantity_scale / 2) / p.quantity_scale AS line_total_minor,
  (o.landed_unit_minor * o.quantity + p.quantity_scale / 2) / p.quantity_scale AS landed_total_minor,
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
      reverse_cost.cost_delta_minor AS receipt_cost, o.unit_cost_minor, o.landed_unit_minor,
      o.received_quantity, p.quantity_scale
    FROM products p
    LEFT JOIN purchase_stock_receipts r ON r.id = NEW.purchase_stock_receipt_id
    LEFT JOIN purchase_order_progress o ON o.purchase_id = r.purchase_id AND o.product_id = p.id
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
      -- The receipt item is visible here. Round cumulatively so splitting a delivery
      -- does not change the final merchandise or additional cost.
      WHEN NEW.purchase_stock_receipt_id IS NOT NULL THEN
        (unit_cost_minor * received_quantity + quantity_scale / 2) / quantity_scale
        - (unit_cost_minor * (received_quantity - NEW.delta) + quantity_scale / 2) / quantity_scale
        + (landed_unit_minor * received_quantity + quantity_scale / 2) / quantity_scale
        - (landed_unit_minor * (received_quantity - NEW.delta) + quantity_scale / 2) / quantity_scale
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

DROP TRIGGER retail_return_validate;
CREATE TRIGGER retail_return_validate BEFORE INSERT ON retail_returns
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND refunded_at IS NULL)
    THEN RAISE(ABORT, 'RETAIL_RETURN_INVOICE_CLOSED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.requested_items) j LEFT JOIN invoice_items i
      ON i.invoice_id = NEW.invoice_id AND i.product_id = json_extract(j.value, '$.product_id')
    GROUP BY json_extract(j.value, '$.product_id')
    HAVING i.product_id IS NULL OR SUM(json_extract(j.value, '$.quantity')) + COALESCE((
      SELECT SUM(quantity) FROM retail_return_items WHERE invoice_id = NEW.invoice_id AND product_id = i.product_id
    ), 0) > i.quantity
  ) THEN RAISE(ABORT, 'RETAIL_RETURN_QUANTITY') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.requested_items) j JOIN products p ON p.id = json_extract(j.value, '$.product_id')
    WHERE CASE WHEN EXISTS (
      SELECT 1 FROM retail_device_sales WHERE invoice_id = NEW.invoice_id AND product_id = p.id
    ) THEN COALESCE(json_array_length(j.value, '$.device_ids'), 0) <> json_extract(j.value, '$.quantity')
    ELSE COALESCE(json_array_length(j.value, '$.device_ids'), 0) <> 0
      OR (p.tracking <> 'quantity' AND json_extract(j.value, '$.disposition') <> 'quarantine') END
  ) THEN RAISE(ABORT, 'RETAIL_RETURN_DEVICE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.requested_items) j CROSS JOIN json_each(j.value, '$.device_ids') v
    LEFT JOIN retail_device_sales s ON s.invoice_id = NEW.invoice_id
      AND s.product_id = json_extract(j.value, '$.product_id') AND s.device_id = v.value
    LEFT JOIN retail_devices d ON d.id = s.device_id
    WHERE s.device_id IS NULL OR d.status <> 'sold' OR EXISTS (
      SELECT 1 FROM retail_return_devices r WHERE r.invoice_id = NEW.invoice_id AND r.device_id = d.id
    )
  ) THEN RAISE(ABORT, 'RETAIL_RETURN_DEVICE') END;
  SELECT CASE WHEN NEW.total_minor <> (
    SELECT SUM((i.unit_price_minor * (COALESCE(previous.sum_quantity, 0) + requested.quantity) + i.quantity_scale / 2) / i.quantity_scale
      - (i.unit_price_minor * COALESCE(previous.sum_quantity, 0) + i.quantity_scale / 2) / i.quantity_scale)
    FROM (
      SELECT json_extract(value, '$.product_id') AS product_id, SUM(json_extract(value, '$.quantity')) AS quantity
      FROM json_each(NEW.requested_items) GROUP BY 1
    ) requested JOIN invoice_items i ON i.invoice_id = NEW.invoice_id AND i.product_id = requested.product_id
    LEFT JOIN (SELECT product_id, SUM(quantity) AS sum_quantity FROM retail_return_items
      WHERE invoice_id = NEW.invoice_id GROUP BY product_id) previous ON previous.product_id = i.product_id
  ) OR NEW.debt_reduction_minor <> (
    SELECT MIN(NEW.total_minor, outstanding_minor) FROM invoices WHERE id = NEW.invoice_id
  ) THEN RAISE(ABORT, 'RETAIL_RETURN_BALANCE') END;
  SELECT CASE WHEN NEW.expected_returned_minor IS NOT NULL AND NEW.expected_returned_minor <> NEW.returned_minor
    THEN RAISE(ABORT, 'RETAIL_RETURN_PAYOUT_CHANGED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM installments a JOIN invoices i ON i.id = a.invoice_id
    WHERE a.invoice_id = NEW.invoice_id AND a.voided_at IS NULL
      AND a.net_principal_minor - a.paid_minor <> i.outstanding_minor
  ) THEN RAISE(ABORT, 'RETAIL_RETURN_BALANCE') END;
END;


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
    SELECT SUM((o.unit_cost_minor * (o.returned_quantity + json_extract(j.value, '$.quantity')) + o.quantity_scale / 2) / o.quantity_scale
      - (o.unit_cost_minor * o.returned_quantity + o.quantity_scale / 2) / o.quantity_scale)
    FROM json_each(NEW.requested_items) j JOIN purchase_order_progress o
      ON o.purchase_id = NEW.purchase_id AND o.product_id = json_extract(j.value, '$.product_id')
  ) OR NEW.credit_minor - NEW.unapplied_credit_minor > (
    SELECT net_total_minor - paid_minor FROM purchases WHERE id = NEW.purchase_id
  ) OR NEW.unapplied_credit_minor <> CASE WHEN NEW.disposition_review_id IS NULL THEN 0 ELSE (
    SELECT MAX(0, NEW.credit_minor - net_total_minor + paid_minor) FROM purchases WHERE id = NEW.purchase_id
  ) END THEN RAISE(ABORT, 'SUPPLIER_RETURN_BALANCE') END;
END;


DROP TRIGGER retail_invoice_discount_validate;
CREATE TRIGGER retail_invoice_discount_validate BEFORE INSERT ON retail_invoice_discount_controls BEGIN
  SELECT CASE WHEN NEW.request_id IS NULL AND EXISTS (
    SELECT 1 FROM invoice_items WHERE invoice_id = NEW.invoice_id
    GROUP BY invoice_id HAVING SUM(line_gross_minor - line_total_minor) >
      (SUM(line_gross_minor) / 10000) * NEW.limit_bps +
      ((SUM(line_gross_minor) % 10000) * NEW.limit_bps) / 10000
  ) THEN RAISE(ABORT, 'RETAIL_DISCOUNT_APPROVAL_REQUIRED') END;
  SELECT CASE WHEN NEW.request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM retail_discount_requests r JOIN retail_discount_approvals a ON a.request_id = r.id
    JOIN invoices i ON i.id = NEW.invoice_id AND i.total_minor = r.total_minor
    WHERE r.id = NEW.request_id AND r.cashier_id = NEW.cashier_id AND julianday(r.created_at) >= julianday('now','-1 hour')
    AND r.discount_minor = (SELECT SUM(line_gross_minor - line_total_minor) FROM invoice_items WHERE invoice_id = i.id)
    AND json_array_length(r.items_json) = (SELECT count(*) FROM invoice_items WHERE invoice_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM json_each(r.items_json) j LEFT JOIN invoice_items ii
      ON ii.invoice_id = i.id AND ii.product_id = json_extract(j.value,'$.product_id')
      AND ii.quantity = json_extract(j.value,'$.quantity') AND ii.unit_discount_minor = json_extract(j.value,'$.unit_discount_minor')
      WHERE ii.product_id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM retail_invoice_discount_controls d WHERE d.request_id = r.id)
  ) THEN RAISE(ABORT, 'RETAIL_DISCOUNT_APPROVAL_INVALID') END;
END;
