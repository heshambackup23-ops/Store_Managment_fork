ALTER TABLE invoices ADD COLUMN replaces_invoice_id INTEGER REFERENCES invoices(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX invoice_replacement_once ON invoices(replaces_invoice_id) WHERE replaces_invoice_id IS NOT NULL;
