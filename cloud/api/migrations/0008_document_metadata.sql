ALTER TABLE invoices ADD COLUMN invoice_date TEXT;
ALTER TABLE invoices ADD COLUMN notes TEXT NOT NULL DEFAULT '';
CREATE INDEX invoices_document_date_idx ON invoices(COALESCE(invoice_date, date(created_at)), id);

ALTER TABLE installments ADD COLUMN product_name TEXT NOT NULL DEFAULT '';
ALTER TABLE installments ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(items_json) AND json_type(items_json) = 'array');
ALTER TABLE installments ADD COLUMN payment_date TEXT;
ALTER TABLE installments ADD COLUMN marked_overdue INTEGER NOT NULL DEFAULT 0 CHECK (marked_overdue IN (0, 1));
