ALTER TABLE settings ADD COLUMN retail_require_shift INTEGER NOT NULL DEFAULT 0 CHECK (retail_require_shift IN (0, 1));

CREATE TABLE retail_shifts (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  register_name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(register_name)) BETWEEN 1 AND 80),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  actor_name TEXT NOT NULL,
  opening_minor INTEGER NOT NULL CHECK (opening_minor BETWEEN 0 AND 900000000000000),
  business_day TEXT NOT NULL,
  opened_at TEXT NOT NULL
) STRICT;

CREATE TABLE retail_shift_closures (
  shift_id INTEGER PRIMARY KEY REFERENCES retail_shifts(id),
  operation_id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id),
  closed_by INTEGER NOT NULL REFERENCES users(id),
  expected_minor INTEGER NOT NULL CHECK (expected_minor BETWEEN -8000000000000000 AND 8000000000000000),
  observed_minor INTEGER NOT NULL CHECK (observed_minor BETWEEN 0 AND 900000000000000),
  close_reason TEXT NOT NULL CHECK (length(close_reason) <= 1000),
  closed_at TEXT NOT NULL,
  CHECK (expected_minor = observed_minor OR length(trim(close_reason)) > 0)
) STRICT;

CREATE TABLE retail_shift_approvals (
  shift_id INTEGER PRIMARY KEY REFERENCES retail_shift_closures(shift_id),
  operation_id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id),
  approved_by INTEGER NOT NULL REFERENCES users(id),
  approval_reason TEXT NOT NULL CHECK (length(trim(approval_reason)) BETWEEN 1 AND 1000),
  approved_at TEXT NOT NULL
) STRICT;

CREATE TABLE retail_tender_batches (
  operation_id INTEGER NOT NULL REFERENCES business_operations(id),
  source TEXT NOT NULL CHECK (source IN ('invoice_payment', 'installment_payment', 'full_refund', 'partial_refund', 'supplier_payment', 'supplier_receipt')),
  shift_id INTEGER REFERENCES retail_shifts(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  invoice_id INTEGER REFERENCES invoices(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 0 AND 900000000000000),
  payments_json TEXT NOT NULL CHECK (json_valid(payments_json) AND json_type(payments_json) = 'array'),
  PRIMARY KEY (operation_id, source)
) STRICT;

CREATE TABLE retail_tenders (
  operation_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  position INTEGER NOT NULL,
  shift_id INTEGER NOT NULL REFERENCES retail_shifts(id),
  method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'wallet', 'bank_transfer')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  reference TEXT,
  PRIMARY KEY (operation_id, source, position),
  FOREIGN KEY (operation_id, source) REFERENCES retail_tender_batches(operation_id, source)
) STRICT;

CREATE INDEX retail_shift_register_idx ON retail_shifts(register_name, id DESC);
CREATE INDEX retail_shift_actor_idx ON retail_shifts(actor_id, id DESC);
CREATE INDEX retail_tenders_shift_method_idx ON retail_tenders(shift_id, method);
CREATE INDEX retail_tender_batches_invoice_idx ON retail_tender_batches(invoice_id, source, operation_id);
CREATE INDEX business_operations_retail_date_idx ON business_operations(created_at, id);

CREATE VIEW retail_tender_ledger AS
SELECT t.*, b.invoice_id, b.actor_id, o.created_at,
  CASE WHEN t.source IN ('invoice_payment', 'installment_payment') THEN t.amount_minor ELSE -t.amount_minor END AS delta_minor
FROM retail_tenders t
JOIN retail_tender_batches b ON b.operation_id = t.operation_id AND b.source = t.source
JOIN business_operations o ON o.id = t.operation_id;

CREATE VIEW retail_shift_positions AS
SELECT s.id, s.register_name, s.actor_id, s.actor_name, s.opening_minor, s.business_day, s.opened_at,
  CASE WHEN c.shift_id IS NULL THEN 'open' WHEN a.shift_id IS NOT NULL THEN 'approved'
    WHEN c.observed_minor <> c.expected_minor THEN 'pending_approval' ELSE 'closed' END AS status,
  COALESCE(c.expected_minor, s.opening_minor + COALESCE((SELECT sum(t.delta_minor)
    FROM retail_tender_ledger t WHERE t.shift_id = s.id AND t.method = 'cash'), 0)) AS expected_minor,
  c.observed_minor, c.observed_minor - c.expected_minor AS difference_minor,
  c.closed_by, c.close_reason, c.closed_at, a.approved_by, a.approval_reason, a.approved_at
FROM retail_shifts s LEFT JOIN retail_shift_closures c ON c.shift_id = s.id
LEFT JOIN retail_shift_approvals a ON a.shift_id = s.id;

CREATE TRIGGER retail_shift_only_one_open BEFORE INSERT ON retail_shifts BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_shifts s
    WHERE (s.actor_id = NEW.actor_id OR s.register_name = NEW.register_name)
      AND NOT EXISTS (SELECT 1 FROM retail_shift_closures c WHERE c.shift_id = s.id))
    THEN RAISE(ABORT, 'RETAIL_SHIFT_ALREADY_OPEN') END;
END;

CREATE TRIGGER retail_shift_check_close BEFORE INSERT ON retail_shift_closures BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_shifts s WHERE s.id = NEW.shift_id AND s.actor_id = NEW.closed_by)
    THEN RAISE(ABORT, 'RETAIL_SHIFT_NOT_OWNED') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_shift_closures c WHERE c.shift_id = NEW.shift_id)
    THEN RAISE(ABORT, 'RETAIL_SHIFT_NOT_OPEN') END;
  SELECT CASE WHEN (SELECT expected_minor FROM retail_shift_positions s WHERE s.id = NEW.shift_id) <> NEW.expected_minor
    THEN RAISE(ABORT, 'RETAIL_SHIFT_BALANCE_CHANGED') END;
  SELECT CASE WHEN NEW.observed_minor <> NEW.expected_minor AND length(trim(NEW.close_reason)) = 0
    THEN RAISE(ABORT, 'RETAIL_SHIFT_REASON_REQUIRED') END;
END;

CREATE TRIGGER retail_shift_check_approval BEFORE INSERT ON retail_shift_approvals BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_shift_closures c WHERE c.shift_id = NEW.shift_id
      AND c.observed_minor <> c.expected_minor)
    OR EXISTS (SELECT 1 FROM retail_shift_approvals a WHERE a.shift_id = NEW.shift_id)
    THEN RAISE(ABORT, 'RETAIL_SHIFT_NO_PENDING_APPROVAL') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_shifts s WHERE s.id = NEW.shift_id AND s.actor_id = NEW.approved_by)
    THEN RAISE(ABORT, 'RETAIL_SHIFT_APPROVAL_SEPARATION') END;
END;

CREATE TRIGGER retail_tender_validate BEFORE INSERT ON retail_tender_batches BEGIN
  SELECT CASE WHEN NEW.shift_id IS NULL AND NEW.amount_minor > 0 AND (
    (SELECT retail_require_shift FROM settings WHERE id = 1) = 1 OR (NEW.source IN ('full_refund', 'partial_refund') AND EXISTS (
      SELECT 1 FROM retail_tender_batches b WHERE b.invoice_id = NEW.invoice_id AND b.shift_id IS NOT NULL
        AND b.amount_minor > 0 AND b.source IN ('invoice_payment', 'installment_payment')
    ))) THEN RAISE(ABORT, 'RETAIL_SHIFT_REQUIRED') END;
  SELECT CASE WHEN NEW.shift_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM retail_shifts s WHERE s.id = NEW.shift_id AND s.actor_id = NEW.actor_id
    AND NOT EXISTS (SELECT 1 FROM retail_shift_closures c WHERE c.shift_id = s.id))
    THEN RAISE(ABORT, 'RETAIL_SHIFT_UNAVAILABLE') END;
  SELECT CASE WHEN NEW.shift_id IS NOT NULL AND NEW.amount_minor <> (
    SELECT COALESCE(SUM(json_extract(value, '$.amount_minor')), 0) FROM json_each(NEW.payments_json))
    THEN RAISE(ABORT, 'RETAIL_TENDER_TOTAL_MISMATCH') END;
  SELECT CASE WHEN NEW.shift_id IS NOT NULL AND NEW.source IN ('full_refund', 'partial_refund') AND (
    SELECT COALESCE(SUM(MAX(0, requested.amount - MAX(0, COALESCE((
      SELECT SUM(delta_minor) FROM retail_tender_ledger WHERE invoice_id = NEW.invoice_id AND method = requested.method
    ), 0)))), 0)
    FROM (SELECT json_extract(value, '$.method') AS method, SUM(json_extract(value, '$.amount_minor')) AS amount
      FROM json_each(NEW.payments_json) GROUP BY 1) requested
  ) > MAX(0, (SELECT paid_minor FROM invoices WHERE id = NEW.invoice_id)
    - COALESCE((SELECT SUM(amount_minor) FROM retail_tender_batches b WHERE b.invoice_id = NEW.invoice_id
      AND b.shift_id IS NOT NULL AND b.source IN ('invoice_payment', 'installment_payment')), 0)
    - COALESCE((SELECT SUM(MAX(0, -remaining)) FROM (SELECT SUM(delta_minor) AS remaining
      FROM retail_tender_ledger WHERE invoice_id = NEW.invoice_id GROUP BY method)), 0)
    - COALESCE((SELECT SUM(amount_minor) FROM retail_tender_batches b WHERE b.invoice_id = NEW.invoice_id
      AND b.shift_id IS NULL AND b.source = 'partial_refund'), 0))
    THEN RAISE(ABORT, 'RETAIL_REFUND_METHOD_LIMIT') END;
END;

CREATE TRIGGER retail_tender_apply AFTER INSERT ON retail_tender_batches BEGIN
  INSERT INTO retail_tenders(operation_id, source, position, shift_id, method, amount_minor, reference)
  SELECT NEW.operation_id, NEW.source, key, NEW.shift_id, json_extract(value, '$.method'),
    json_extract(value, '$.amount_minor'), json_extract(value, '$.reference') FROM json_each(NEW.payments_json);
END;

CREATE TRIGGER retail_shift_no_update BEFORE UPDATE ON retail_shifts BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_shift_no_delete BEFORE DELETE ON retail_shifts BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_shift_close_no_update BEFORE UPDATE ON retail_shift_closures BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_shift_close_no_delete BEFORE DELETE ON retail_shift_closures BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_shift_approval_no_update BEFORE UPDATE ON retail_shift_approvals BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_shift_approval_no_delete BEFORE DELETE ON retail_shift_approvals BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_tender_batch_no_update BEFORE UPDATE ON retail_tender_batches BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_tender_batch_no_delete BEFORE DELETE ON retail_tender_batches BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_tender_no_update BEFORE UPDATE ON retail_tenders BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_tender_no_delete BEFORE DELETE ON retail_tenders BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
