ALTER TABLE purchases ADD COLUMN legacy_initial_paid_minor INTEGER
  CHECK (legacy_initial_paid_minor BETWEEN 0 AND paid_minor);
ALTER TABLE purchases ADD COLUMN legacy_updated_at TEXT;
ALTER TABLE supplier_payments ADD COLUMN legacy_receipt_number TEXT;
ALTER TABLE supplier_payments ADD COLUMN legacy_updated_at TEXT;
ALTER TABLE supplier_receipts ADD COLUMN legacy_receipt_number TEXT;
ALTER TABLE supplier_receipts ADD COLUMN legacy_updated_at TEXT;
ALTER TABLE supplier_receipts ADD COLUMN legacy_first_purchase_id INTEGER REFERENCES purchases(id) ON DELETE RESTRICT;
