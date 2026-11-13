CREATE TABLE business_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_id, request_key)
);

CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  delta INTEGER NOT NULL CHECK (delta BETWEEN -1000000000 AND 1000000000 AND delta <> 0),
  source_type TEXT NOT NULL CHECK (source_type IN ('adjustment', 'invoice', 'refund', 'damage', 'damage_reversal', 'import')),
  source_id INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_type, source_id, product_id)
);
CREATE INDEX inventory_movements_product_idx ON inventory_movements(product_id, id DESC);

CREATE TRIGGER apply_inventory_movement AFTER INSERT ON inventory_movements
BEGIN
  UPDATE products SET stock = stock + NEW.delta, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.product_id AND stock + NEW.delta BETWEEN 0 AND 1000000000;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'INSUFFICIENT_STOCK') END;
END;

CREATE TRIGGER inventory_movement_no_update BEFORE UPDATE ON inventory_movements
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
CREATE TRIGGER inventory_movement_no_delete BEFORE DELETE ON inventory_movements
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
  total_minor INTEGER NOT NULL CHECK (total_minor BETWEEN 0 AND 900000000000000),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor BETWEEN 0 AND total_minor),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  refunded_at TEXT,
  status TEXT GENERATED ALWAYS AS (
    CASE WHEN refunded_at IS NOT NULL THEN 'refunded'
         WHEN paid_minor = total_minor THEN 'paid'
         ELSE 'open' END
  ) VIRTUAL,
  CHECK (paid_minor = total_minor OR customer_id IS NOT NULL)
);
CREATE INDEX invoices_customer_idx ON invoices(customer_id, id DESC);
CREATE INDEX invoices_date_idx ON invoices(created_at);

CREATE TABLE invoice_items (
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
  PRIMARY KEY (invoice_id, product_id)
);

CREATE TRIGGER invoice_item_stock AFTER INSERT ON invoice_items
BEGIN
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, actor_id)
    SELECT NEW.product_id, -NEW.quantity, 'invoice', NEW.invoice_id, actor_id
    FROM invoices WHERE id = NEW.invoice_id;
END;

CREATE TABLE invoice_payments (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  source_type TEXT NOT NULL CHECK (source_type IN ('checkout', 'payment', 'installment')),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX invoice_payments_invoice_idx ON invoice_payments(invoice_id, id);
CREATE INDEX invoice_payments_date_idx ON invoice_payments(created_at);

CREATE TABLE invoice_refunds (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  returned_minor INTEGER NOT NULL CHECK (returned_minor BETWEEN 0 AND total_minor),
  reason TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX invoice_refunds_date_idx ON invoice_refunds(created_at);

CREATE TABLE installments (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_id INTEGER UNIQUE REFERENCES invoices(id) ON DELETE RESTRICT,
  principal_minor INTEGER NOT NULL CHECK (principal_minor BETWEEN 1 AND 900000000000000),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor BETWEEN 0 AND principal_minor),
  due_date TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT,
  status TEXT GENERATED ALWAYS AS (
    CASE WHEN voided_at IS NOT NULL THEN 'voided'
         WHEN paid_minor = principal_minor THEN 'paid' ELSE 'open' END
  ) VIRTUAL
);
CREATE INDEX installments_customer_idx ON installments(customer_id, id DESC);
CREATE INDEX installments_due_idx ON installments(due_date);

CREATE TABLE installment_payments (
  id INTEGER PRIMARY KEY,
  installment_id INTEGER NOT NULL REFERENCES installments(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX installment_payments_installment_idx ON installment_payments(installment_id, id);

CREATE TRIGGER installment_requires_invoice_balance BEFORE INSERT ON installments WHEN NEW.invoice_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM invoices
      WHERE id = NEW.invoice_id AND customer_id = NEW.customer_id AND refunded_at IS NULL
        AND total_minor - paid_minor = NEW.principal_minor
  ) THEN RAISE(ABORT, 'INSTALLMENT_BALANCE_MISMATCH') END;
END;

CREATE TRIGGER apply_invoice_payment AFTER INSERT ON invoice_payments
BEGIN
  SELECT CASE WHEN NEW.source_type = 'checkout' AND NOT EXISTS (
    SELECT 1 FROM invoices WHERE id = NEW.invoice_id AND paid_minor = NEW.amount_minor AND refunded_at IS NULL
  ) THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
  SELECT CASE WHEN NEW.source_type = 'payment' AND EXISTS (
    SELECT 1 FROM installments WHERE invoice_id = NEW.invoice_id AND voided_at IS NULL
  ) THEN RAISE(ABORT, 'USE_INSTALLMENT_PAYMENT') END;
  UPDATE invoices SET paid_minor = paid_minor + NEW.amount_minor, updated_at = CURRENT_TIMESTAMP
    WHERE NEW.source_type <> 'checkout' AND id = NEW.invoice_id AND refunded_at IS NULL
      AND paid_minor + NEW.amount_minor <= total_minor;
  SELECT CASE WHEN NEW.source_type <> 'checkout' AND changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
END;

CREATE TRIGGER apply_installment_payment AFTER INSERT ON installment_payments
BEGIN
  UPDATE installments SET paid_minor = paid_minor + NEW.amount_minor, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.installment_id AND voided_at IS NULL AND paid_minor + NEW.amount_minor <= principal_minor;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
  INSERT INTO invoice_payments(id, invoice_id, amount_minor, source_type, actor_id)
    SELECT NEW.id, invoice_id, NEW.amount_minor, 'installment', NEW.actor_id
      FROM installments WHERE id = NEW.installment_id AND invoice_id IS NOT NULL;
END;

CREATE TRIGGER apply_invoice_refund AFTER INSERT ON invoice_refunds
BEGIN
  UPDATE invoices SET refunded_at = NEW.created_at, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.invoice_id AND refunded_at IS NULL
      AND total_minor = NEW.total_minor AND paid_minor = NEW.returned_minor;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'INVOICE_NOT_REFUNDABLE') END;
  UPDATE installments SET voided_at = NEW.created_at, updated_at = CURRENT_TIMESTAMP WHERE invoice_id = NEW.invoice_id;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id)
    SELECT product_id, quantity, 'refund', NEW.id, NEW.reason, NEW.actor_id
      FROM invoice_items WHERE invoice_id = NEW.invoice_id;
END;

CREATE TABLE damaged_stock (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
  unit_cost_minor INTEGER NOT NULL CHECK (unit_cost_minor >= 0),
  reason TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE damaged_stock_reversals (
  id INTEGER PRIMARY KEY,
  damage_id INTEGER NOT NULL UNIQUE REFERENCES damaged_stock(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER apply_damaged_stock AFTER INSERT ON damaged_stock
BEGIN
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id)
    VALUES (NEW.product_id, -NEW.quantity, 'damage', NEW.id, NEW.reason, NEW.actor_id);
END;

CREATE TRIGGER reverse_damaged_stock AFTER INSERT ON damaged_stock_reversals
BEGIN
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id)
    SELECT product_id, quantity, 'damage_reversal', NEW.id, NEW.reason, NEW.actor_id
      FROM damaged_stock WHERE id = NEW.damage_id;
END;

CREATE TABLE personal_debts (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
  person_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL CHECK (direction IN ('receivable', 'payable')),
  principal_minor INTEGER NOT NULL CHECK (principal_minor BETWEEN 1 AND 900000000000000),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor BETWEEN 0 AND principal_minor),
  due_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT GENERATED ALWAYS AS (CASE WHEN paid_minor = principal_minor THEN 'paid' ELSE 'open' END) VIRTUAL
);
CREATE INDEX personal_debts_customer_idx ON personal_debts(customer_id);

CREATE TABLE personal_debt_payments (
  id INTEGER PRIMARY KEY,
  debt_id INTEGER NOT NULL REFERENCES personal_debts(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX personal_debt_payments_debt_idx ON personal_debt_payments(debt_id, id);

CREATE TRIGGER apply_personal_debt_payment AFTER INSERT ON personal_debt_payments
BEGIN
  UPDATE personal_debts SET paid_minor = paid_minor + NEW.amount_minor, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.debt_id AND paid_minor + NEW.amount_minor <= principal_minor;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
END;

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  reference TEXT,
  description TEXT NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor BETWEEN 1 AND 900000000000000),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor BETWEEN 0 AND total_minor),
  purchase_date TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (supplier_id, reference)
);
CREATE INDEX purchases_supplier_idx ON purchases(supplier_id, id DESC);
CREATE INDEX purchases_date_idx ON purchases(purchase_date);

CREATE TABLE supplier_payments (
  id INTEGER PRIMARY KEY,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  note TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX supplier_payments_purchase_idx ON supplier_payments(purchase_id, id);

CREATE TRIGGER apply_supplier_payment AFTER INSERT ON supplier_payments
BEGIN
  UPDATE purchases SET paid_minor = paid_minor + NEW.amount_minor
    WHERE id = NEW.purchase_id AND paid_minor + NEW.amount_minor <= total_minor;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
END;

CREATE TABLE wallets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  provider TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  balance_minor INTEGER NOT NULL DEFAULT 0 CHECK (balance_minor BETWEEN 0 AND 900000000000000),
  transaction_limit_minor INTEGER CHECK (transaction_limit_minor BETWEEN 1 AND 900000000000000),
  daily_send_limit_minor INTEGER CHECK (daily_send_limit_minor BETWEEN 1 AND 900000000000000),
  daily_receive_limit_minor INTEGER CHECK (daily_receive_limit_minor BETWEEN 1 AND 900000000000000),
  monthly_send_limit_minor INTEGER CHECK (monthly_send_limit_minor BETWEEN 1 AND 900000000000000),
  monthly_receive_limit_minor INTEGER CHECK (monthly_receive_limit_minor BETWEEN 1 AND 900000000000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE wallet_transactions (
  id INTEGER PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'receive', 'send', 'expense', 'settlement_in', 'settlement_out', 'reversal')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  commission_minor INTEGER NOT NULL DEFAULT 0 CHECK (commission_minor BETWEEN 0 AND amount_minor),
  fee_minor INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor BETWEEN 0 AND amount_minor),
  delta_minor INTEGER NOT NULL CHECK (delta_minor BETWEEN -900000000000000 AND 900000000000000),
  cash_delta_minor INTEGER NOT NULL DEFAULT 0 CHECK (cash_delta_minor BETWEEN -900000000000000 AND 900000000000000),
  business_day TEXT NOT NULL DEFAULT CURRENT_DATE,
  reversal_of INTEGER UNIQUE REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (kind = 'send' AND delta_minor = -(amount_minor + fee_minor)
      AND cash_delta_minor IN (0, amount_minor + commission_minor) AND reversal_of IS NULL)
    OR (kind = 'receive' AND delta_minor = amount_minor - fee_minor
      AND cash_delta_minor = -(amount_minor - commission_minor) AND reversal_of IS NULL)
    OR (kind IN ('opening', 'settlement_in') AND delta_minor = amount_minor AND cash_delta_minor = 0
      AND commission_minor = 0 AND fee_minor = 0 AND reversal_of IS NULL)
    OR (kind IN ('expense', 'settlement_out') AND delta_minor = -amount_minor AND cash_delta_minor = 0
      AND commission_minor = 0 AND fee_minor = 0 AND reversal_of IS NULL)
    OR (kind = 'reversal' AND reversal_of IS NOT NULL)
  )
);
CREATE INDEX wallet_transactions_wallet_idx ON wallet_transactions(wallet_id, id DESC);
CREATE INDEX wallet_transactions_date_idx ON wallet_transactions(created_at);
CREATE INDEX wallet_transactions_period_idx ON wallet_transactions(wallet_id, kind, business_day);
CREATE UNIQUE INDEX wallet_opening_idx ON wallet_transactions(wallet_id) WHERE kind = 'opening';

CREATE TRIGGER wallet_reversal_must_match BEFORE INSERT ON wallet_transactions WHEN NEW.kind = 'reversal'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM wallet_transactions WHERE id = NEW.reversal_of AND wallet_id = NEW.wallet_id
      AND kind <> 'reversal' AND delta_minor = -NEW.delta_minor
      AND amount_minor = NEW.amount_minor AND fee_minor = NEW.fee_minor
      AND commission_minor = NEW.commission_minor AND cash_delta_minor = -NEW.cash_delta_minor
  ) THEN RAISE(ABORT, 'INVALID_WALLET_REVERSAL') END;
END;

CREATE TRIGGER enforce_wallet_period_limit BEFORE INSERT ON wallet_transactions WHEN NEW.kind IN ('send', 'receive')
BEGIN
  SELECT CASE WHEN
    CASE NEW.kind WHEN 'send' THEN daily_send_limit_minor ELSE daily_receive_limit_minor END IS NOT NULL
    AND NEW.amount_minor + (
      SELECT COALESCE(SUM(t.amount_minor), 0) FROM wallet_transactions t
      WHERE t.wallet_id = NEW.wallet_id AND t.kind = NEW.kind AND t.business_day = NEW.business_day
        AND NOT EXISTS (SELECT 1 FROM wallet_transactions r WHERE r.reversal_of = t.id)
    ) > CASE NEW.kind WHEN 'send' THEN daily_send_limit_minor ELSE daily_receive_limit_minor END
    THEN RAISE(ABORT, 'WALLET_BALANCE_OR_LIMIT') END
    FROM wallets WHERE id = NEW.wallet_id;
  SELECT CASE WHEN
    CASE NEW.kind WHEN 'send' THEN monthly_send_limit_minor ELSE monthly_receive_limit_minor END IS NOT NULL
    AND NEW.amount_minor + (
      SELECT COALESCE(SUM(t.amount_minor), 0) FROM wallet_transactions t
      WHERE t.wallet_id = NEW.wallet_id AND t.kind = NEW.kind
        AND t.business_day >= date(NEW.business_day, 'start of month')
        AND t.business_day < date(NEW.business_day, 'start of month', '+1 month')
        AND NOT EXISTS (SELECT 1 FROM wallet_transactions r WHERE r.reversal_of = t.id)
    ) > CASE NEW.kind WHEN 'send' THEN monthly_send_limit_minor ELSE monthly_receive_limit_minor END
    THEN RAISE(ABORT, 'WALLET_BALANCE_OR_LIMIT') END
    FROM wallets WHERE id = NEW.wallet_id;
END;

CREATE TRIGGER apply_wallet_transaction AFTER INSERT ON wallet_transactions
BEGIN
  UPDATE wallets SET balance_minor = balance_minor + NEW.delta_minor, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.wallet_id AND (active = 1 OR NEW.kind = 'reversal')
      AND balance_minor + NEW.delta_minor BETWEEN 0 AND 900000000000000
      AND (NEW.kind IN ('opening', 'reversal') OR transaction_limit_minor IS NULL OR NEW.amount_minor <= transaction_limit_minor);
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'WALLET_BALANCE_OR_LIMIT') END;
END;

CREATE TRIGGER wallet_transaction_no_update BEFORE UPDATE ON wallet_transactions
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
CREATE TRIGGER wallet_transaction_no_delete BEFORE DELETE ON wallet_transactions
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TABLE wallet_debts (
  id INTEGER PRIMARY KEY,
  wallet_transaction_id INTEGER NOT NULL UNIQUE REFERENCES wallet_transactions(id) ON DELETE RESTRICT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('receivable', 'payable')),
  principal_minor INTEGER NOT NULL CHECK (principal_minor BETWEEN 1 AND 900000000000000),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor BETWEEN 0 AND principal_minor),
  due_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT,
  status TEXT GENERATED ALWAYS AS (
    CASE WHEN voided_at IS NOT NULL THEN 'voided'
         WHEN paid_minor = principal_minor THEN 'paid' ELSE 'open' END
  ) VIRTUAL
);
CREATE INDEX wallet_debts_customer_idx ON wallet_debts(customer_id);

CREATE TRIGGER wallet_debt_matches_transaction BEFORE INSERT ON wallet_debts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM wallet_transactions WHERE id = NEW.wallet_transaction_id
      AND kind = 'send' AND cash_delta_minor = 0 AND NEW.direction = 'receivable'
      AND NEW.principal_minor = amount_minor + commission_minor
  ) THEN RAISE(ABORT, 'WALLET_DEBT_MISMATCH') END;
END;

CREATE TABLE wallet_debt_payments (
  id INTEGER PRIMARY KEY,
  wallet_debt_id INTEGER NOT NULL REFERENCES wallet_debts(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX wallet_debt_payments_idx ON wallet_debt_payments(wallet_debt_id, id);

CREATE TRIGGER apply_wallet_debt_payment AFTER INSERT ON wallet_debt_payments
BEGIN
  UPDATE wallet_debts SET paid_minor = paid_minor + NEW.amount_minor
    WHERE id = NEW.wallet_debt_id AND voided_at IS NULL AND paid_minor + NEW.amount_minor <= principal_minor;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
END;

CREATE TRIGGER reverse_wallet_debt BEFORE INSERT ON wallet_transactions WHEN NEW.kind = 'reversal'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM wallet_debts WHERE wallet_transaction_id = NEW.reversal_of AND paid_minor > 0
  ) THEN RAISE(ABORT, 'WALLET_DEBT_SETTLED') END;
  UPDATE wallet_debts SET voided_at = NEW.created_at WHERE wallet_transaction_id = NEW.reversal_of;
END;

CREATE TABLE wallet_cash_entries (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('opening', 'owner_deposit', 'owner_withdraw', 'correction', 'expense', 'expense_reversal')),
  delta_minor INTEGER NOT NULL CHECK (delta_minor BETWEEN -900000000000000 AND 900000000000000 AND delta_minor <> 0),
  business_day TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL,
  reversal_of INTEGER UNIQUE REFERENCES wallet_cash_entries(id) ON DELETE RESTRICT,
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (kind IN ('opening', 'owner_deposit') AND delta_minor > 0 AND reversal_of IS NULL)
    OR (kind IN ('owner_withdraw', 'expense') AND delta_minor < 0 AND reversal_of IS NULL)
    OR (kind = 'correction' AND reversal_of IS NULL)
    OR (kind = 'expense_reversal' AND delta_minor > 0 AND reversal_of IS NOT NULL)
  )
);
CREATE INDEX wallet_cash_entries_date_idx ON wallet_cash_entries(business_day);
CREATE UNIQUE INDEX wallet_cash_opening_idx ON wallet_cash_entries(kind) WHERE kind = 'opening';

CREATE TRIGGER wallet_cash_expense_reversal BEFORE INSERT ON wallet_cash_entries WHEN NEW.kind = 'expense_reversal'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM wallet_cash_entries
    WHERE id = NEW.reversal_of AND kind = 'expense' AND delta_minor = -NEW.delta_minor
  ) THEN RAISE(ABORT, 'INVALID_WALLET_REVERSAL') END;
END;

CREATE TRIGGER wallet_cash_no_update BEFORE UPDATE ON wallet_cash_entries
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;
CREATE TRIGGER wallet_cash_no_delete BEFORE DELETE ON wallet_cash_entries
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER');
END;

CREATE TABLE maintenance_requests (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE RESTRICT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  item TEXT NOT NULL,
  problem TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  requested_date TEXT NOT NULL DEFAULT CURRENT_DATE,
  completed_date TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'in_progress', 'completed', 'delivered', 'cancelled')),
  price_minor INTEGER NOT NULL DEFAULT 0 CHECK (price_minor BETWEEN 0 AND 900000000000000),
  paid_minor INTEGER NOT NULL DEFAULT 0 CHECK (paid_minor BETWEEN 0 AND price_minor),
  notes TEXT NOT NULL DEFAULT '',
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (status <> 'cancelled' OR paid_minor = 0),
  CHECK (status <> 'delivered' OR paid_minor = price_minor)
);
CREATE INDEX maintenance_requests_status_idx ON maintenance_requests(status, id DESC);
CREATE INDEX maintenance_requests_customer_idx ON maintenance_requests(customer_id);

CREATE TABLE maintenance_payments (
  id INTEGER PRIMARY KEY,
  maintenance_id INTEGER NOT NULL REFERENCES maintenance_requests(id) ON DELETE RESTRICT,
  amount_minor INTEGER NOT NULL CHECK (amount_minor BETWEEN 1 AND 900000000000000),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX maintenance_payments_request_idx ON maintenance_payments(maintenance_id, id);

CREATE TRIGGER apply_maintenance_payment AFTER INSERT ON maintenance_payments
BEGIN
  UPDATE maintenance_requests SET paid_minor = paid_minor + NEW.amount_minor, updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.maintenance_id AND status NOT IN ('delivered', 'cancelled') AND paid_minor + NEW.amount_minor <= price_minor;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'PAYMENT_EXCEEDS_BALANCE') END;
END;
