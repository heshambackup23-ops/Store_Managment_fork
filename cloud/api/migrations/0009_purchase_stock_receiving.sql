CREATE TABLE purchase_stock_receipts (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  reference TEXT NOT NULL COLLATE NOCASE CHECK (length(reference) BETWEEN 1 AND 100),
  received_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (purchase_id, reference)
) STRICT;
CREATE INDEX purchase_stock_receipts_purchase_idx ON purchase_stock_receipts(purchase_id, id DESC);

CREATE TABLE purchase_stock_receipt_items (
  receipt_id INTEGER NOT NULL REFERENCES purchase_stock_receipts(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  product_barcode TEXT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  PRIMARY KEY (receipt_id, product_id)
) STRICT;

CREATE TABLE purchase_stock_reversals (
  id INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL UNIQUE REFERENCES purchase_stock_receipts(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

ALTER TABLE inventory_movements ADD COLUMN purchase_stock_receipt_id INTEGER REFERENCES purchase_stock_receipts(id) ON DELETE RESTRICT;
ALTER TABLE inventory_movements ADD COLUMN purchase_stock_reversal_id INTEGER REFERENCES purchase_stock_reversals(id) ON DELETE RESTRICT;

CREATE TRIGGER purchase_stock_apply_receipt_item AFTER INSERT ON purchase_stock_receipt_items
BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM purchase_stock_reversals WHERE receipt_id = NEW.receipt_id)
    THEN RAISE(ABORT, 'RECORD_VOIDED') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND active = 1)
    THEN RAISE(ABORT, 'PURCHASE_PRODUCT_UNAVAILABLE') END;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id, purchase_stock_receipt_id)
    SELECT NEW.product_id, NEW.quantity, 'adjustment', r.id, r.note, r.actor_id, r.id
    FROM purchase_stock_receipts r WHERE r.id = NEW.receipt_id;
END;

CREATE TRIGGER purchase_stock_apply_reversal AFTER INSERT ON purchase_stock_reversals
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM purchase_stock_receipt_items WHERE receipt_id = NEW.receipt_id)
    THEN RAISE(ABORT, 'PURCHASE_RECEIPT_EMPTY') END;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id, purchase_stock_reversal_id)
    SELECT product_id, -quantity, 'adjustment', NEW.id, NEW.reason, NEW.actor_id, NEW.id
    FROM purchase_stock_receipt_items WHERE receipt_id = NEW.receipt_id;
END;

CREATE TRIGGER purchase_stock_receipt_no_update BEFORE UPDATE ON purchase_stock_receipts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
CREATE TRIGGER purchase_stock_receipt_no_delete BEFORE DELETE ON purchase_stock_receipts
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
CREATE TRIGGER purchase_stock_receipt_item_no_update BEFORE UPDATE ON purchase_stock_receipt_items
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
CREATE TRIGGER purchase_stock_receipt_item_no_delete BEFORE DELETE ON purchase_stock_receipt_items
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
CREATE TRIGGER purchase_stock_reversal_no_update BEFORE UPDATE ON purchase_stock_reversals
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
CREATE TRIGGER purchase_stock_reversal_no_delete BEFORE DELETE ON purchase_stock_reversals
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
