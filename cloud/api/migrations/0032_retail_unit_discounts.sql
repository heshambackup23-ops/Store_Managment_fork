ALTER TABLE invoice_items ADD COLUMN original_unit_price_minor INTEGER
  CHECK (original_unit_price_minor IS NULL OR original_unit_price_minor BETWEEN 0 AND 100000000000);
ALTER TABLE invoice_items ADD COLUMN unit_discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (
  unit_discount_minor >= 0 AND ((original_unit_price_minor IS NULL AND unit_discount_minor = 0)
    OR (original_unit_price_minor IS NOT NULL AND original_unit_price_minor - unit_discount_minor = unit_price_minor))
);

CREATE TRIGGER retail_sale_price_immutable BEFORE UPDATE OF original_unit_price_minor, unit_discount_minor, unit_price_minor ON invoice_items
WHEN OLD.original_unit_price_minor IS NOT NEW.original_unit_price_minor OR OLD.unit_discount_minor IS NOT NEW.unit_discount_minor
  OR OLD.unit_price_minor IS NOT NEW.unit_price_minor
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
