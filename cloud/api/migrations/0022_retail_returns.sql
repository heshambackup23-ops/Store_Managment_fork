ALTER TABLE invoices ADD COLUMN retail_return_minor INTEGER NOT NULL DEFAULT 0
  CHECK (retail_return_minor BETWEEN 0 AND total_minor);
ALTER TABLE invoices ADD COLUMN retail_refunded_minor INTEGER NOT NULL DEFAULT 0
  CHECK (retail_refunded_minor BETWEEN 0 AND MIN(retail_return_minor, paid_minor));
ALTER TABLE invoices ADD COLUMN net_total_minor INTEGER GENERATED ALWAYS AS (total_minor - retail_return_minor) VIRTUAL;
ALTER TABLE invoices ADD COLUMN net_paid_minor INTEGER GENERATED ALWAYS AS (paid_minor - retail_refunded_minor) VIRTUAL;
ALTER TABLE invoices ADD COLUMN outstanding_minor INTEGER GENERATED ALWAYS AS (
  CASE WHEN refunded_at IS NOT NULL THEN 0 ELSE net_total_minor - net_paid_minor END
) VIRTUAL;
ALTER TABLE invoices ADD COLUMN net_status TEXT GENERATED ALWAYS AS (
  CASE WHEN refunded_at IS NOT NULL THEN 'refunded' WHEN net_total_minor = net_paid_minor THEN 'paid' ELSE 'open' END
) VIRTUAL;

ALTER TABLE installments ADD COLUMN retail_credit_minor INTEGER NOT NULL DEFAULT 0
  CHECK (retail_credit_minor BETWEEN 0 AND principal_minor - paid_minor);
ALTER TABLE installments ADD COLUMN net_principal_minor INTEGER GENERATED ALWAYS AS (principal_minor - retail_credit_minor) VIRTUAL;
ALTER TABLE installments ADD COLUMN net_status TEXT GENERATED ALWAYS AS (
  CASE WHEN voided_at IS NOT NULL THEN 'voided' WHEN paid_minor = net_principal_minor THEN 'paid' ELSE 'open' END
) VIRTUAL;

CREATE TABLE retail_returns (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  returned_minor INTEGER NOT NULL CHECK (returned_minor BETWEEN 0 AND total_minor),
  debt_reduction_minor INTEGER NOT NULL CHECK (debt_reduction_minor = total_minor - returned_minor),
  expected_returned_minor INTEGER CHECK (expected_returned_minor BETWEEN 0 AND 900000000000000),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  requested_items TEXT NOT NULL CHECK (json_valid(requested_items) AND json_type(requested_items) = 'array'
    AND json_array_length(requested_items) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX retail_returns_invoice ON retail_returns(invoice_id, id DESC);
CREATE INDEX retail_returns_created ON retail_returns(created_at);

CREATE TABLE retail_return_items (
  return_id INTEGER NOT NULL REFERENCES retail_returns(id),
  invoice_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  disposition TEXT NOT NULL CHECK (disposition IN ('resale','quarantine')),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  PRIMARY KEY (return_id, product_id, disposition),
  FOREIGN KEY (invoice_id, product_id) REFERENCES invoice_items(invoice_id, product_id)
) STRICT;
CREATE INDEX retail_return_items_invoice ON retail_return_items(invoice_id, product_id);

CREATE TABLE retail_return_devices (
  return_id INTEGER NOT NULL,
  invoice_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  disposition TEXT NOT NULL,
  device_id INTEGER NOT NULL,
  PRIMARY KEY (return_id, device_id),
  UNIQUE (invoice_id, device_id),
  FOREIGN KEY (return_id, product_id, disposition) REFERENCES retail_return_items(return_id, product_id, disposition),
  FOREIGN KEY (invoice_id, product_id, device_id) REFERENCES retail_device_sales(invoice_id, product_id, device_id)
) STRICT;

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
    SELECT SUM(i.unit_price_minor * json_extract(j.value, '$.quantity'))
    FROM json_each(NEW.requested_items) j JOIN invoice_items i ON i.invoice_id = NEW.invoice_id
      AND i.product_id = json_extract(j.value, '$.product_id')
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

CREATE TRIGGER retail_return_apply AFTER INSERT ON retail_returns
BEGIN
  INSERT INTO retail_return_items (return_id, invoice_id, product_id, quantity, disposition, unit_price_minor)
    SELECT NEW.id, NEW.invoice_id, i.product_id, json_extract(j.value, '$.quantity'),
      json_extract(j.value, '$.disposition'), i.unit_price_minor
    FROM json_each(NEW.requested_items) j JOIN invoice_items i ON i.invoice_id = NEW.invoice_id
      AND i.product_id = json_extract(j.value, '$.product_id');
  INSERT INTO retail_return_devices (return_id, invoice_id, product_id, disposition, device_id)
    SELECT NEW.id, NEW.invoice_id, json_extract(j.value, '$.product_id'), json_extract(j.value, '$.disposition'), v.value
    FROM json_each(NEW.requested_items) j CROSS JOIN json_each(j.value, '$.device_ids') v;
  UPDATE retail_devices SET status = CASE (
    SELECT disposition FROM retail_return_devices WHERE return_id = NEW.id AND device_id = retail_devices.id
  ) WHEN 'resale' THEN 'available' ELSE 'quarantined' END
    WHERE id IN (SELECT device_id FROM retail_return_devices WHERE return_id = NEW.id);
  INSERT INTO inventory_movements (product_id, delta, source_type, source_id, note, actor_id, created_at)
    SELECT product_id, quantity, 'refund', NEW.id, NEW.reason, NEW.actor_id, NEW.created_at
    FROM retail_return_items WHERE return_id = NEW.id AND disposition = 'resale';
  UPDATE installments SET retail_credit_minor = retail_credit_minor + NEW.debt_reduction_minor,
    updated_at = NEW.created_at
    WHERE invoice_id = NEW.invoice_id AND voided_at IS NULL AND NEW.debt_reduction_minor > 0;
  UPDATE invoices SET retail_return_minor = retail_return_minor + NEW.total_minor,
    retail_refunded_minor = retail_refunded_minor + NEW.returned_minor, updated_at = NEW.created_at,
    refunded_at = CASE WHEN NOT EXISTS (
      SELECT 1 FROM invoice_items i WHERE i.invoice_id = NEW.invoice_id AND i.quantity > COALESCE((
        SELECT SUM(quantity) FROM retail_return_items r WHERE r.invoice_id = i.invoice_id AND r.product_id = i.product_id
      ), 0)
    ) THEN NEW.created_at ELSE refunded_at END
    WHERE id = NEW.invoice_id;
END;

CREATE TRIGGER retail_return_no_update BEFORE UPDATE ON retail_returns BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_return_no_delete BEFORE DELETE ON retail_returns BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_return_item_no_update BEFORE UPDATE ON retail_return_items BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_return_item_no_delete BEFORE DELETE ON retail_return_items BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_return_device_no_update BEFORE UPDATE ON retail_return_devices BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_return_device_no_delete BEFORE DELETE ON retail_return_devices BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

CREATE TRIGGER retail_return_legacy_guard BEFORE INSERT ON invoice_refunds
WHEN EXISTS (SELECT 1 FROM retail_returns WHERE invoice_id = NEW.invoice_id)
  OR (NEW.legacy_refund_reference IS NOT NULL AND EXISTS (SELECT 1 FROM retail_device_sales WHERE invoice_id = NEW.invoice_id))
BEGIN SELECT RAISE(ABORT, 'RETAIL_RETURN_USE_ITEMS'); END;

DROP TRIGGER installment_requires_invoice_balance;
CREATE TRIGGER installment_requires_invoice_balance BEFORE INSERT ON installments WHEN NEW.invoice_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND customer_id = NEW.customer_id AND refunded_at IS NULL
      AND ((NEW.historical_paid_minor IS NULL AND outstanding_minor = NEW.principal_minor)
        OR (NEW.historical_paid_minor = NEW.paid_minor AND historical_paid_minor = NEW.paid_minor
          AND NEW.principal_minor = total_minor))
  ) THEN RAISE(ABORT, 'INSTALLMENT_BALANCE_MISMATCH') END;
END;

DROP TRIGGER apply_invoice_payment;
CREATE TRIGGER apply_invoice_payment AFTER INSERT ON invoice_payments
BEGIN
  SELECT CASE WHEN NEW.source_type = 'checkout' AND NOT EXISTS (
    SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND paid_minor = NEW.amount_minor AND refunded_at IS NULL
  ) THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
  SELECT CASE WHEN NEW.source_type = 'payment' AND EXISTS (
    SELECT 1 FROM installments WHERE invoice_id = NEW.invoice_id AND voided_at IS NULL
  ) THEN RAISE(ABORT, 'USE_INSTALLMENT_PAYMENT') END;
  UPDATE invoices SET paid_minor = paid_minor + NEW.amount_minor, updated_at = CURRENT_TIMESTAMP
    WHERE NEW.source_type <> 'checkout' AND id = NEW.invoice_id AND refunded_at IS NULL
      AND NEW.amount_minor <= outstanding_minor;
  SELECT CASE WHEN NEW.source_type <> 'checkout' AND changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
END;

DROP TRIGGER apply_installment_payment;
CREATE TRIGGER apply_installment_payment AFTER INSERT ON installment_payments
BEGIN
  UPDATE installments SET paid_minor = paid_minor + NEW.amount_minor, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.installment_id AND voided_at IS NULL AND paid_minor + NEW.amount_minor <= net_principal_minor;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
  INSERT INTO invoice_payments(id, invoice_id, amount_minor, source_type, actor_id)
    SELECT NEW.id, invoice_id, NEW.amount_minor, 'installment', NEW.actor_id
      FROM installments WHERE id = NEW.installment_id AND invoice_id IS NOT NULL;
END;
