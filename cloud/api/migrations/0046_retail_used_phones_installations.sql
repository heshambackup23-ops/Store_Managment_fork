CREATE TABLE retail_used_phone_products (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE RESTRICT
) STRICT;

CREATE TABLE retail_used_phone_inspections (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  serial_number TEXT,
  imei1 TEXT NOT NULL,
  imei2 TEXT,
  ownership_reference TEXT NOT NULL CHECK (length(trim(ownership_reference)) BETWEEN 1 AND 100),
  grade TEXT NOT NULL CHECK (grade IN ('excellent','good','fair')),
  battery_percent INTEGER CHECK (battery_percent BETWEEN 0 AND 100),
  accessories TEXT NOT NULL CHECK (length(accessories) <= 200),
  defects TEXT NOT NULL CHECK (length(defects) <= 1000),
  functional INTEGER NOT NULL CHECK (functional IN (0,1)),
  reset_verified INTEGER NOT NULL CHECK (reset_verified IN (0,1)),
  lock_cleared INTEGER NOT NULL CHECK (lock_cleared IN (0,1)),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX retail_used_phone_inspections_imei ON retail_used_phone_inspections(imei1, id DESC);

CREATE TABLE retail_used_phone_acquisitions (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  inspection_id INTEGER NOT NULL UNIQUE REFERENCES retail_used_phone_inspections(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES retail_used_phone_products(product_id) ON DELETE RESTRICT,
  acquisition_cost_minor INTEGER NOT NULL CHECK (acquisition_cost_minor BETWEEN 1 AND 100000000000),
  acquired_on TEXT NOT NULL CHECK (date(acquired_on) IS acquired_on),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash','bank_transfer')),
  shift_id INTEGER REFERENCES retail_shifts(id) ON DELETE RESTRICT,
  payment_reference TEXT COLLATE NOCASE CHECK (payment_reference IS NULL OR length(trim(payment_reference)) BETWEEN 1 AND 100),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK ((payment_method = 'cash' AND shift_id IS NOT NULL AND payment_reference IS NULL)
    OR (payment_method = 'bank_transfer' AND shift_id IS NULL AND payment_reference IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX retail_used_phone_payment_reference ON retail_used_phone_acquisitions(payment_reference)
WHERE payment_reference IS NOT NULL;

CREATE TRIGGER retail_used_phone_product_validate BEFORE INSERT ON retail_used_phone_products
WHEN NOT EXISTS (
  SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.active = 1 AND p.tracking = 'imei'
    AND p.stock = 0 AND NOT EXISTS (SELECT 1 FROM retail_devices d WHERE d.product_id = p.id)
    AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id)
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_USED_PHONE_PRODUCT'); END;

CREATE TRIGGER retail_used_phone_inspection_validate BEFORE INSERT ON retail_used_phone_inspections
WHEN NOT EXISTS (
  SELECT 1 FROM products p WHERE p.id = NEW.product_id AND p.active = 1 AND p.tracking = 'imei'
    AND (EXISTS (SELECT 1 FROM retail_used_phone_products u WHERE u.product_id = p.id)
      OR (p.stock = 0 AND NOT EXISTS (SELECT 1 FROM retail_devices d WHERE d.product_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id)))
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_USED_PHONE_PRODUCT'); END;

CREATE TRIGGER retail_used_phone_acquire_validate BEFORE INSERT ON retail_used_phone_acquisitions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM retail_used_phone_inspections i JOIN products p ON p.id = i.product_id
    WHERE i.id = NEW.inspection_id AND i.product_id = NEW.product_id AND p.active = 1 AND p.tracking = 'imei'
      AND i.functional = 1 AND i.reset_verified = 1 AND i.lock_cleared = 1
      AND NOT EXISTS (SELECT 1 FROM retail_used_phone_acquisitions a WHERE a.inspection_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM retail_used_phone_inspections newer WHERE newer.id > i.id
        AND (newer.imei1 IN (i.imei1, i.imei2) OR newer.imei2 IN (i.imei1, i.imei2)))
  ) THEN RAISE(ABORT, 'RETAIL_USED_PHONE_INSPECTION') END;
  SELECT CASE WHEN NEW.payment_method = 'cash' AND NOT EXISTS (
    SELECT 1 FROM retail_shifts s WHERE s.id = NEW.shift_id AND s.actor_id = NEW.actor_id
      AND s.business_day = NEW.acquired_on AND s.branch_id = 1
  ) THEN RAISE(ABORT, 'RETAIL_SHIFT_UNAVAILABLE') END;
END;

-- Keep used stock and the normal purchasing/intake channels distinct, even if a stale catalog client submits a receipt.
CREATE TRIGGER retail_used_phone_device_origin BEFORE INSERT ON retail_devices
WHEN EXISTS (SELECT 1 FROM retail_used_phone_products u WHERE u.product_id = NEW.product_id)
  AND NOT EXISTS (
    SELECT 1 FROM retail_used_phone_acquisitions a JOIN retail_used_phone_inspections i ON i.id = a.inspection_id
    WHERE i.id = NEW.inventory_intake_id AND i.product_id = NEW.product_id AND i.imei1 = NEW.imei1
      AND i.imei2 IS NEW.imei2 AND i.serial_number IS NEW.serial_number COLLATE BINARY
      AND a.acquisition_cost_minor = NEW.intake_cost_minor
  )
BEGIN SELECT RAISE(ABORT, 'RETAIL_USED_PHONE_ORIGIN'); END;

DROP TRIGGER retail_serial_approval_validate;
CREATE TRIGGER retail_serial_approval_validate BEFORE INSERT ON retail_device_inventory_approvals
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_device_inventory_records WHERE id = NEW.review_id AND status = 'pending_approval')
    THEN RAISE(ABORT, 'RETAIL_SERIAL_STALE') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_device_inventory_reviews WHERE id = NEW.review_id AND actor_id = NEW.actor_id)
    AND NOT EXISTS (SELECT 1 FROM retail_used_phone_acquisitions a
      WHERE a.id = NEW.id AND a.inspection_id = NEW.review_id AND a.actor_id = NEW.actor_id)
    THEN RAISE(ABORT, 'RETAIL_STOCKTAKE_SEPARATION') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM retail_device_inventory_reviews r JOIN products p ON p.id = r.source_product_id
    WHERE r.id = NEW.review_id AND p.inventory_value_minor IS NOT NULL AND p.stock > 0
      AND (SELECT SUM(json_extract(j.value, '$.unit_cost_minor')) FROM json_each(r.additions_json) j)
        <> (p.inventory_value_minor / p.stock) * json_array_length(r.additions_json)
          + (p.inventory_value_minor % p.stock) * json_array_length(r.additions_json) / p.stock
  ) THEN RAISE(ABORT, 'RETAIL_SERIAL_TRANSFER_COST') END;
END;

-- A used purchase is an addition, so no existing device is treated as absent from this inspection.
DROP TRIGGER retail_serial_review_snapshot;
CREATE TRIGGER retail_serial_review_snapshot AFTER INSERT ON retail_device_inventory_reviews
WHEN NEW.kind = 'count' AND NOT EXISTS (
  SELECT 1 FROM retail_used_phone_acquisitions a WHERE a.inspection_id = NEW.id
)
BEGIN
  INSERT INTO retail_device_inventory_observations(review_id, device_id, disposition)
    SELECT NEW.id, d.id,
      CASE WHEN d.status = 'stocktake_missing' THEN 'recovered' WHEN j.value IS NULL THEN 'missing' ELSE 'present' END
    FROM retail_devices d LEFT JOIN json_each(NEW.scanned_json) j
      ON d.serial_number = j.value OR d.imei1 = j.value OR d.imei2 = j.value
    WHERE d.product_id = NEW.product_id AND (d.status = 'available' OR (d.status = 'stocktake_missing' AND j.value IS NOT NULL));
END;

CREATE TRIGGER retail_used_phone_acquire_post AFTER INSERT ON retail_used_phone_acquisitions
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM retail_devices d JOIN retail_used_phone_inspections i ON i.id = NEW.inspection_id
    WHERE d.status <> 'voided' AND (d.serial_number = i.serial_number
      OR d.imei1 IN (i.imei1, i.imei2) OR d.imei2 IN (i.imei1, i.imei2))
  ) THEN RAISE(ABORT, 'RETAIL_DEVICE_IDENTITY_DUPLICATE') END;
  INSERT INTO retail_device_inventory_reviews
    (id, kind, product_id, expected_stock, expected_movement, expected_review, source_reference, reason,
      scanned_json, additions_json, actor_id, created_at)
  SELECT i.id, 'count', i.product_id, p.stock, p.movement_id, p.review_id, 'USED-' || NEW.id,
    'شراء هاتف مستعمل بعد الفحص', '[]',
    json_array(json_object('serial_number', i.serial_number, 'imei1', i.imei1, 'imei2', i.imei2,
      'unit_cost_minor', NEW.acquisition_cost_minor)), i.actor_id, NEW.created_at
  FROM retail_used_phone_inspections i JOIN retail_device_inventory_positions p ON p.product_id = i.product_id
  WHERE i.id = NEW.inspection_id;

  INSERT INTO retail_device_inventory_approvals (review_id, id, actor_id, reason, created_at)
  VALUES (NEW.inspection_id, NEW.id, NEW.actor_id, 'استلام شراء هاتف مستعمل', NEW.created_at);

  INSERT INTO retail_cash_movements(id, shift_id, kind, amount_minor, reason, reference, actor_id, actor_name, created_at)
  SELECT NEW.id, NEW.shift_id, 'general_expense', NEW.acquisition_cost_minor, 'شراء هاتف مستعمل', 'USED-' || NEW.id,
    NEW.actor_id, u.name, NEW.created_at
  FROM users u WHERE NEW.payment_method = 'cash' AND u.id = NEW.actor_id;
END;

CREATE TRIGGER retail_used_phone_inspection_no_update BEFORE UPDATE ON retail_used_phone_inspections BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_used_phone_inspection_no_delete BEFORE DELETE ON retail_used_phone_inspections BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_used_phone_product_no_update BEFORE UPDATE ON retail_used_phone_products BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_used_phone_product_no_delete BEFORE DELETE ON retail_used_phone_products BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_used_phone_acquisition_no_update BEFORE UPDATE ON retail_used_phone_acquisitions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_used_phone_acquisition_no_delete BEFORE DELETE ON retail_used_phone_acquisitions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;

CREATE TABLE retail_installations (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  invoice_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL,
  service_address TEXT NOT NULL CHECK (length(trim(service_address)) BETWEEN 1 AND 500),
  scheduled_on TEXT NOT NULL CHECK (date(scheduled_on) IS scheduled_on),
  scheduled_time TEXT NOT NULL CHECK (length(scheduled_time) = 5 AND substr(scheduled_time, 1, 2) BETWEEN '00' AND '23'
    AND time(scheduled_time) IS scheduled_time || ':00'),
  assignee_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  note TEXT NOT NULL CHECK (length(note) <= 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (invoice_id, product_id, device_id) REFERENCES retail_device_sales(invoice_id, product_id, device_id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX retail_installations_sale ON retail_installations(invoice_id, product_id, device_id);
CREATE INDEX retail_installations_device ON retail_installations(device_id, id DESC);

ALTER TABLE retail_device_events ADD COLUMN installation_id INTEGER REFERENCES retail_installations(id);

CREATE TABLE retail_installation_actions (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  installation_id INTEGER NOT NULL REFERENCES retail_installations(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('schedule','complete','cancel')),
  scheduled_on TEXT CHECK (scheduled_on IS NULL OR date(scheduled_on) IS scheduled_on),
  scheduled_time TEXT CHECK (scheduled_time IS NULL OR (length(scheduled_time) = 5
    AND substr(scheduled_time, 1, 2) BETWEEN '00' AND '23' AND time(scheduled_time) IS scheduled_time || ':00')),
  assignee_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  occurred_on TEXT CHECK (occurred_on IS NULL OR date(occurred_on) IS occurred_on),
  proof_reference TEXT CHECK (proof_reference IS NULL OR length(trim(proof_reference)) BETWEEN 1 AND 120),
  note TEXT NOT NULL CHECK (length(note) <= 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK ((kind = 'schedule' AND scheduled_on IS NOT NULL AND scheduled_time IS NOT NULL
    AND occurred_on IS NULL AND proof_reference IS NULL)
    OR (kind = 'complete' AND scheduled_on IS NULL AND scheduled_time IS NULL AND assignee_id IS NULL
      AND occurred_on IS NOT NULL AND proof_reference IS NOT NULL)
    OR (kind = 'cancel' AND scheduled_on IS NULL AND scheduled_time IS NULL AND assignee_id IS NULL
      AND occurred_on IS NULL AND proof_reference IS NULL AND length(trim(note)) > 0))
) STRICT;
CREATE INDEX retail_installation_actions_job ON retail_installation_actions(installation_id, id DESC);
CREATE INDEX retail_installation_actions_schedule ON retail_installation_actions(installation_id, id DESC) WHERE kind = 'schedule';

CREATE VIEW retail_installation_positions AS
WITH latest AS (
  SELECT j.*, a.kind AS latest_kind, a.note AS latest_note, a.occurred_on AS completed_on,
    a.proof_reference, COALESCE(schedule.scheduled_on, j.scheduled_on) AS current_day,
    COALESCE(schedule.scheduled_time, j.scheduled_time) AS current_time,
    CASE WHEN schedule.id IS NULL THEN j.assignee_id ELSE schedule.assignee_id END AS current_assignee_id
  FROM retail_installations j
  LEFT JOIN retail_installation_actions a ON a.id = (SELECT MAX(x.id) FROM retail_installation_actions x WHERE x.installation_id = j.id)
  LEFT JOIN retail_installation_actions schedule ON schedule.id = (
    SELECT MAX(x.id) FROM retail_installation_actions x WHERE x.installation_id = j.id AND x.kind = 'schedule'
  )
)
SELECT l.id, l.invoice_id, l.product_id, l.device_id, l.service_address, l.current_day AS scheduled_on,
  l.current_time AS scheduled_time, l.current_assignee_id AS assignee_id, tech.name AS assignee_name,
  l.note, l.latest_note, l.completed_on, l.proof_reference, l.actor_id, l.created_at,
  p.name AS product_name, d.imei1, d.serial_number, i.invoice_date, c.name AS customer_name,
  delivery.occurred_on AS delivered_on, delivery.proof_reference AS delivery_proof_reference,
  CASE l.latest_kind WHEN 'complete' THEN 'completed' WHEN 'cancel' THEN 'canceled'
    ELSE CASE WHEN r.return_id IS NOT NULL OR i.status = 'refunded' OR d.status <> 'sold' THEN 'returned'
      WHEN l.current_assignee_id IS NOT NULL THEN 'assigned' ELSE 'scheduled' END END AS status
FROM latest l JOIN products p ON p.id = l.product_id JOIN retail_devices d ON d.id = l.device_id
JOIN invoices i ON i.id = l.invoice_id LEFT JOIN customers c ON c.id = i.customer_id
LEFT JOIN users tech ON tech.id = l.current_assignee_id
LEFT JOIN retail_device_events delivery ON delivery.invoice_id = l.invoice_id AND delivery.product_id = l.product_id
  AND delivery.device_id = l.device_id AND delivery.kind = 'delivered'
LEFT JOIN retail_return_devices r ON r.invoice_id = l.invoice_id AND r.product_id = l.product_id AND r.device_id = l.device_id;

CREATE TRIGGER retail_installation_validate BEFORE INSERT ON retail_installations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM retail_device_sales s JOIN invoices i ON i.id = s.invoice_id JOIN retail_devices d ON d.id = s.device_id
    WHERE s.device_id = NEW.device_id AND s.product_id = NEW.product_id AND s.invoice_id = NEW.invoice_id
      AND s.rowid = (SELECT MAX(s2.rowid) FROM retail_device_sales s2 WHERE s2.device_id = d.id)
      AND d.status = 'sold' AND i.status <> 'refunded' AND i.invoice_date <= NEW.scheduled_on
      AND NOT EXISTS (SELECT 1 FROM retail_return_devices r WHERE r.device_id = d.id AND r.invoice_id = i.id)
      AND NOT EXISTS (SELECT 1 FROM retail_device_events e WHERE e.device_id = d.id AND e.invoice_id = i.id AND e.kind = 'installed')
      AND NOT EXISTS (SELECT 1 FROM retail_installation_positions j WHERE j.device_id = d.id AND j.invoice_id = i.id AND j.status IN ('scheduled','assigned'))
  ) THEN RAISE(ABORT, 'RETAIL_INSTALLATION_SALE') END;
  SELECT CASE WHEN NEW.assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u JOIN role_permissions p ON p.role_id = u.role_id
    WHERE u.id = NEW.assignee_id AND u.active = 1 AND p.permission IN ('*','retail.installations.perform')
      AND EXISTS (SELECT 1 FROM role_permissions v WHERE v.role_id = u.role_id AND v.permission IN ('*','retail.installations.view'))
  ) THEN RAISE(ABORT, 'RETAIL_INSTALLATION_ASSIGNEE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM retail_installation_positions j WHERE j.assignee_id = NEW.assignee_id AND j.status = 'assigned'
      AND j.scheduled_on = NEW.scheduled_on AND j.scheduled_time = NEW.scheduled_time
  ) THEN RAISE(ABORT, 'RETAIL_INSTALLATION_CONFLICT') END;
END;

CREATE TRIGGER retail_installation_action_validate BEFORE INSERT ON retail_installation_actions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM retail_installation_positions j WHERE j.id = NEW.installation_id
      AND (j.status IN ('scheduled','assigned') OR (j.status = 'returned' AND NEW.kind = 'cancel'))
      AND (NEW.kind <> 'schedule' OR NEW.scheduled_on >= j.invoice_date)
      AND (NEW.kind <> 'complete' OR (j.status = 'assigned' AND j.assignee_id = NEW.actor_id))
  ) THEN RAISE(ABORT, 'RETAIL_INSTALLATION_STATE') END;
  SELECT CASE WHEN NEW.assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u JOIN role_permissions p ON p.role_id = u.role_id
    WHERE u.id = NEW.assignee_id AND u.active = 1 AND p.permission IN ('*','retail.installations.perform')
      AND EXISTS (SELECT 1 FROM role_permissions v WHERE v.role_id = u.role_id AND v.permission IN ('*','retail.installations.view'))
  ) THEN RAISE(ABORT, 'RETAIL_INSTALLATION_ASSIGNEE') END;
  SELECT CASE WHEN NEW.kind = 'schedule' AND EXISTS (
    SELECT 1 FROM retail_installation_positions j WHERE j.assignee_id = NEW.assignee_id AND j.status = 'assigned'
      AND j.scheduled_on = NEW.scheduled_on AND j.scheduled_time = NEW.scheduled_time AND j.id <> NEW.installation_id
  ) THEN RAISE(ABORT, 'RETAIL_INSTALLATION_CONFLICT') END;
  SELECT CASE WHEN NEW.kind = 'complete' AND NOT EXISTS (
    SELECT 1 FROM retail_installations j JOIN retail_device_events e USING (invoice_id, product_id, device_id)
    WHERE j.id = NEW.installation_id AND e.kind = 'delivered' AND e.occurred_on <= NEW.occurred_on
  ) THEN RAISE(ABORT, 'RETAIL_INSTALLATION_DELIVERY') END;
END;

CREATE TRIGGER retail_installation_complete AFTER INSERT ON retail_installation_actions WHEN NEW.kind = 'complete'
BEGIN
  INSERT INTO retail_device_events(id, invoice_id, product_id, device_id, kind, occurred_on, note, actor_id, proof_reference,
    created_at, installation_id)
  SELECT NEW.id, j.invoice_id, j.product_id, j.device_id, 'installed', NEW.occurred_on, NEW.note,
    NEW.actor_id, NEW.proof_reference, NEW.created_at, j.id
  FROM retail_installations j WHERE j.id = NEW.installation_id;
END;

CREATE TRIGGER retail_installation_deliver_validate BEFORE INSERT ON retail_device_events
WHEN NEW.installation_id IS NOT NULL AND NEW.kind = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM retail_installation_positions j JOIN users actor ON actor.id = NEW.actor_id
    WHERE j.id = NEW.installation_id AND j.invoice_id = NEW.invoice_id AND j.product_id = NEW.product_id
      AND j.device_id = NEW.device_id AND j.status IN ('scheduled','assigned') AND j.delivered_on IS NULL
      AND (j.assignee_id = NEW.actor_id OR EXISTS (
        SELECT 1 FROM role_permissions p WHERE p.role_id = actor.role_id AND p.permission IN ('*','retail.installations.manage')
      ))
  )
BEGIN SELECT RAISE(ABORT, 'RETAIL_INSTALLATION_DELIVERY_EXISTS'); END;

CREATE TRIGGER retail_installation_event_requires_job BEFORE INSERT ON retail_device_events
WHEN NEW.kind = 'installed' AND EXISTS (
  SELECT 1 FROM retail_installation_positions j WHERE j.invoice_id = NEW.invoice_id AND j.product_id = NEW.product_id
    AND j.device_id = NEW.device_id AND j.status IN ('scheduled','assigned')
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_INSTALLATION_USE_JOB'); END;

CREATE TRIGGER retail_installation_no_update BEFORE UPDATE ON retail_installations BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_installation_no_delete BEFORE DELETE ON retail_installations BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_installation_action_no_update BEFORE UPDATE ON retail_installation_actions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_installation_action_no_delete BEFORE DELETE ON retail_installation_actions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
