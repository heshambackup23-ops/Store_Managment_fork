ALTER TABLE settings ADD COLUMN retail_discount_limit_bps INTEGER NOT NULL DEFAULT 1500
  CHECK (retail_discount_limit_bps BETWEEN 0 AND 10000);

CREATE TABLE retail_discount_requests (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  items_json TEXT NOT NULL CHECK (json_valid(items_json) AND json_type(items_json) = 'array'),
  total_minor INTEGER NOT NULL CHECK (total_minor BETWEEN 0 AND 900000000000000),
  discount_minor INTEGER NOT NULL CHECK (discount_minor BETWEEN 1 AND 900000000000000),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE retail_discount_approvals (
  request_id INTEGER PRIMARY KEY REFERENCES retail_discount_requests(id),
  operation_id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id),
  supervisor_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE retail_invoice_discount_controls (
  invoice_id INTEGER PRIMARY KEY REFERENCES invoices(id),
  request_id INTEGER UNIQUE REFERENCES retail_discount_approvals(request_id),
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  limit_bps INTEGER NOT NULL CHECK (limit_bps BETWEEN 0 AND 10000)
) STRICT;

CREATE TRIGGER retail_discount_approval_validate BEFORE INSERT ON retail_discount_approvals BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_discount_requests r WHERE r.id = NEW.request_id
    AND julianday(r.created_at) >= julianday('now','-1 hour')) THEN RAISE(ABORT, 'RETAIL_DISCOUNT_EXPIRED') END;
  SELECT CASE WHEN NEW.supervisor_id = (SELECT cashier_id FROM retail_discount_requests WHERE id = NEW.request_id)
    THEN RAISE(ABORT, 'RETAIL_DISCOUNT_SEPARATION') END;
END;

CREATE TRIGGER retail_invoice_discount_validate BEFORE INSERT ON retail_invoice_discount_controls BEGIN
  SELECT CASE WHEN NEW.request_id IS NULL AND EXISTS (
    SELECT 1 FROM invoice_items WHERE invoice_id = NEW.invoice_id
    GROUP BY invoice_id HAVING SUM(unit_discount_minor * quantity) >
      (SUM(original_unit_price_minor * quantity) / 10000) * NEW.limit_bps +
      ((SUM(original_unit_price_minor * quantity) % 10000) * NEW.limit_bps) / 10000
  ) THEN RAISE(ABORT, 'RETAIL_DISCOUNT_APPROVAL_REQUIRED') END;
  SELECT CASE WHEN NEW.request_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM retail_discount_requests r JOIN retail_discount_approvals a ON a.request_id = r.id
    JOIN invoices i ON i.id = NEW.invoice_id AND i.total_minor = r.total_minor
    WHERE r.id = NEW.request_id AND r.cashier_id = NEW.cashier_id AND julianday(r.created_at) >= julianday('now','-1 hour')
    AND r.discount_minor = (SELECT SUM(unit_discount_minor * quantity) FROM invoice_items WHERE invoice_id = i.id)
    AND json_array_length(r.items_json) = (SELECT count(*) FROM invoice_items WHERE invoice_id = i.id)
    AND NOT EXISTS (SELECT 1 FROM json_each(r.items_json) j LEFT JOIN invoice_items ii
      ON ii.invoice_id = i.id AND ii.product_id = json_extract(j.value,'$.product_id')
      AND ii.quantity = json_extract(j.value,'$.quantity') AND ii.unit_discount_minor = json_extract(j.value,'$.unit_discount_minor')
      WHERE ii.product_id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM retail_invoice_discount_controls d WHERE d.request_id = r.id)
  ) THEN RAISE(ABORT, 'RETAIL_DISCOUNT_APPROVAL_INVALID') END;
END;

CREATE TRIGGER retail_discount_request_no_update BEFORE UPDATE ON retail_discount_requests BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_discount_request_no_delete BEFORE DELETE ON retail_discount_requests BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_discount_approval_no_update BEFORE UPDATE ON retail_discount_approvals BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_discount_approval_no_delete BEFORE DELETE ON retail_discount_approvals BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_invoice_discount_no_update BEFORE UPDATE ON retail_invoice_discount_controls BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_invoice_discount_no_delete BEFORE DELETE ON retail_invoice_discount_controls BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
