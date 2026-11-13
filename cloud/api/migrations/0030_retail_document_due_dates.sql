ALTER TABLE invoices ADD COLUMN due_date TEXT CHECK (due_date IS NULL OR (date(due_date, '+0 days') IS due_date
  AND due_date >= COALESCE(invoice_date, date(created_at))));
ALTER TABLE purchases ADD COLUMN due_date TEXT CHECK (due_date IS NULL OR (date(due_date, '+0 days') IS due_date
  AND due_date >= purchase_date));
