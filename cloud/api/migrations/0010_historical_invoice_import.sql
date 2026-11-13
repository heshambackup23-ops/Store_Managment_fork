CREATE TABLE historical_invoice_imports (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fingerprint TEXT NOT NULL UNIQUE CHECK (length(fingerprint) = 64),
  cutoff_at TEXT NOT NULL,
  invoice_count INTEGER NOT NULL CHECK (invoice_count > 0),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

ALTER TABLE invoices ADD COLUMN legacy_invoice_number TEXT;
ALTER TABLE invoices ADD COLUMN legacy_customer_name TEXT;
ALTER TABLE invoices ADD COLUMN historical_paid_minor INTEGER
  CHECK (historical_paid_minor BETWEEN 0 AND paid_minor);
ALTER TABLE invoices ADD COLUMN legacy_import_fingerprint TEXT REFERENCES historical_invoice_imports(fingerprint);

CREATE UNIQUE INDEX invoice_legacy_number ON invoices(legacy_invoice_number)
  WHERE legacy_invoice_number IS NOT NULL;

CREATE TRIGGER historical_invoice_identity_insert BEFORE INSERT ON invoices
WHEN (NEW.legacy_import_fingerprint IS NULL) <> (NEW.legacy_invoice_number IS NULL)
  OR (NEW.legacy_import_fingerprint IS NULL) <> (NEW.legacy_customer_name IS NULL)
  OR (NEW.legacy_import_fingerprint IS NULL) <> (NEW.historical_paid_minor IS NULL)
  OR (NEW.legacy_import_fingerprint IS NOT NULL AND NEW.historical_paid_minor <> NEW.paid_minor)
BEGIN
  SELECT RAISE(ABORT, 'HISTORICAL_INVOICE_SNAPSHOT_INVALID');
END;

CREATE TRIGGER historical_invoice_identity_update BEFORE UPDATE OF
  legacy_import_fingerprint, legacy_invoice_number, legacy_customer_name, historical_paid_minor ON invoices
WHEN NEW.legacy_import_fingerprint IS NOT OLD.legacy_import_fingerprint
  OR NEW.legacy_invoice_number IS NOT OLD.legacy_invoice_number
  OR NEW.legacy_customer_name IS NOT OLD.legacy_customer_name
  OR NEW.historical_paid_minor IS NOT OLD.historical_paid_minor
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

DROP TRIGGER invoice_item_stock;
CREATE TRIGGER invoice_item_stock AFTER INSERT ON invoice_items
BEGIN
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, actor_id)
    SELECT NEW.product_id, -NEW.quantity, 'invoice', NEW.invoice_id, actor_id
    FROM invoices WHERE id = NEW.invoice_id AND legacy_import_fingerprint IS NULL;
END;

ALTER TABLE installments ADD COLUMN historical_paid_minor INTEGER
  CHECK (historical_paid_minor BETWEEN 0 AND paid_minor);

CREATE TRIGGER historical_installment_identity BEFORE UPDATE OF historical_paid_minor ON installments
WHEN NEW.historical_paid_minor IS NOT OLD.historical_paid_minor
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

DROP TRIGGER installment_requires_invoice_balance;
CREATE TRIGGER installment_requires_invoice_balance BEFORE INSERT ON installments WHEN NEW.invoice_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM invoices
    WHERE id = NEW.invoice_id AND customer_id = NEW.customer_id AND refunded_at IS NULL
      AND (
        (NEW.historical_paid_minor IS NULL AND total_minor - paid_minor = NEW.principal_minor)
        OR (
          NEW.historical_paid_minor = NEW.paid_minor AND historical_paid_minor = NEW.paid_minor
          AND NEW.principal_minor = total_minor
        )
      )
  ) THEN RAISE(ABORT, 'INSTALLMENT_BALANCE_MISMATCH') END;
END;
