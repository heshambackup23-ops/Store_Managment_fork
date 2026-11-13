ALTER TABLE products ADD COLUMN warranty_basis TEXT NOT NULL DEFAULT 'sale'
  CHECK (warranty_basis IN ('sale', 'delivery', 'installation'));
ALTER TABLE products ADD COLUMN warranty_guarantor TEXT
  CHECK (warranty_guarantor IS NULL OR (length(warranty_guarantor) BETWEEN 1 AND 160
    AND warranty_guarantor = trim(warranty_guarantor) AND instr(warranty_guarantor, char(0)) = 0));

ALTER TABLE retail_device_events ADD COLUMN proof_reference TEXT
  CHECK (proof_reference IS NULL OR (length(proof_reference) BETWEEN 1 AND 120
    AND proof_reference = trim(proof_reference) AND instr(proof_reference, char(0)) = 0));

CREATE TABLE retail_device_warranties (
  invoice_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('sale', 'delivery', 'installation')),
  guarantor TEXT CHECK (guarantor IS NULL OR (length(guarantor) BETWEEN 1 AND 160
    AND guarantor = trim(guarantor) AND instr(guarantor, char(0)) = 0)),
  PRIMARY KEY (invoice_id, product_id, device_id),
  FOREIGN KEY (invoice_id, product_id, device_id) REFERENCES retail_device_sales(invoice_id, product_id, device_id)
) STRICT;

-- Existing device sales retain the original sale-date policy and have no recorded guarantor.
INSERT INTO retail_device_warranties (invoice_id, product_id, device_id, basis)
SELECT invoice_id, product_id, device_id, 'sale' FROM retail_device_sales;

CREATE TRIGGER retail_device_warranty_snapshot AFTER INSERT ON retail_device_sales
BEGIN
  INSERT INTO retail_device_warranties (invoice_id, product_id, device_id, basis, guarantor)
  SELECT NEW.invoice_id, NEW.product_id, NEW.device_id, warranty_basis, warranty_guarantor
  FROM products WHERE id = NEW.product_id;
END;

CREATE TRIGGER retail_device_warranty_no_update BEFORE UPDATE ON retail_device_warranties
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

CREATE TRIGGER retail_device_warranty_no_delete BEFORE DELETE ON retail_device_warranties
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

CREATE TRIGGER retail_device_milestone_order BEFORE INSERT ON retail_device_events
WHEN NEW.kind IN ('delivered', 'installed') AND EXISTS (
  SELECT 1 FROM retail_device_events e
  WHERE e.invoice_id = NEW.invoice_id AND e.product_id = NEW.product_id AND e.device_id = NEW.device_id
    AND ((NEW.kind = 'delivered' AND e.kind = 'installed' AND NEW.occurred_on > e.occurred_on)
      OR (NEW.kind = 'installed' AND e.kind = 'delivered' AND NEW.occurred_on < e.occurred_on))
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_DEVICE_MILESTONE_ORDER'); END;

CREATE VIEW retail_device_sale_warranty AS
WITH coverage AS (
  SELECT s.invoice_id, s.product_id, s.device_id, s.warranty_months, s.created_at, s.unit_cost_minor,
    w.basis AS warranty_basis, w.guarantor AS warranty_guarantor,
    CASE WHEN s.warranty_months > 0 THEN CASE w.basis
      WHEN 'sale' THEN s.warranty_starts_on ELSE e.occurred_on END END AS warranty_starts_on,
    CASE WHEN s.warranty_months > 0 THEN e.proof_reference END AS warranty_proof_reference,
    EXISTS (SELECT 1 FROM retail_return_devices r WHERE r.invoice_id = s.invoice_id AND r.device_id = s.device_id) AS warranty_returned
  FROM retail_device_sales s JOIN retail_device_warranties w USING (invoice_id, product_id, device_id)
  LEFT JOIN retail_device_events e ON e.invoice_id = s.invoice_id AND e.product_id = s.product_id AND e.device_id = s.device_id
    AND ((w.basis = 'delivery' AND e.kind = 'delivered') OR (w.basis = 'installation' AND e.kind = 'installed'))
)
SELECT *, date(warranty_starts_on, '+' || warranty_months || ' months', 'floor') AS warranty_expires_on FROM coverage;
