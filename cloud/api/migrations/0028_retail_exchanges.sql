CREATE TABLE retail_exchanges (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  return_id INTEGER NOT NULL UNIQUE REFERENCES retail_returns(id),
  replacement_invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
  replacement_total_minor INTEGER NOT NULL CHECK (replacement_total_minor >= 0),
  difference_minor INTEGER NOT NULL,
  walk_in_confirmed INTEGER NOT NULL CHECK (walk_in_confirmed IN (0, 1)),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
) STRICT;

CREATE TRIGGER retail_exchange_validate BEFORE INSERT ON retail_exchanges
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM retail_returns r JOIN invoices original ON original.id = r.invoice_id
    JOIN invoices replacement ON replacement.id = NEW.replacement_invoice_id
    JOIN business_operations op ON op.id = replacement.id AND op.operation IN ('invoice.checkout', 'cashier.checkout')
    WHERE r.id = NEW.return_id AND replacement.id <> original.id AND replacement.id > r.id
      AND unixepoch(replacement.created_at) >= unixepoch(r.created_at)
      AND replacement.refunded_at IS NULL AND replacement.replaces_invoice_id IS NULL
      AND replacement.legacy_import_fingerprint IS NULL
      AND NOT EXISTS (SELECT 1 FROM retail_returns WHERE invoice_id = replacement.id)
      AND replacement.total_minor = NEW.replacement_total_minor
      AND replacement.total_minor - r.total_minor = NEW.difference_minor
  ) THEN RAISE(ABORT, 'RETAIL_EXCHANGE_REPLACEMENT') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM retail_returns r JOIN invoices original ON original.id = r.invoice_id
    JOIN invoices replacement ON replacement.id = NEW.replacement_invoice_id
    WHERE r.id = NEW.return_id AND original.customer_id IS replacement.customer_id
      AND (original.customer_id IS NOT NULL OR NEW.walk_in_confirmed = 1)
  ) THEN RAISE(ABORT, 'RETAIL_EXCHANGE_CUSTOMER') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_exchanges
    WHERE return_id = NEW.return_id OR replacement_invoice_id = NEW.replacement_invoice_id)
    THEN RAISE(ABORT, 'RETAIL_EXCHANGE_ALREADY_LINKED') END;
END;

CREATE TRIGGER retail_exchange_no_update BEFORE UPDATE ON retail_exchanges BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_exchange_no_delete BEFORE DELETE ON retail_exchanges BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
