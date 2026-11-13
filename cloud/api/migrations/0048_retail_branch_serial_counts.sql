ALTER TABLE retail_device_inventory_reviews ADD COLUMN branch_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE retail_device_inventory_reviews ADD COLUMN expected_transfer_id INTEGER NOT NULL DEFAULT 0;
DROP TRIGGER retail_branch_serial_count_scope;
DROP TRIGGER retail_branch_serial_approval_scope;

-- The company-wide revision still invalidates stale counts. The transfer revision
-- also catches location changes that do not alter company totals.
CREATE TRIGGER retail_branch_serial_review_validate BEFORE INSERT ON retail_device_inventory_reviews
WHEN NOT EXISTS (SELECT 1 FROM retail_used_phone_acquisitions a WHERE a.inspection_id = NEW.id)
BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_branches b WHERE b.id = NEW.branch_id AND b.active = 1)
    OR NEW.expected_transfer_id <> COALESCE((SELECT MAX(t.id) FROM retail_branch_transfers t WHERE t.product_id = NEW.product_id),0)
    OR EXISTS (
      SELECT 1 FROM json_each(NEW.scanned_json) j JOIN retail_devices d
        ON d.serial_number = j.value OR d.imei1 = j.value OR d.imei2 = j.value
      WHERE d.product_id = NEW.product_id AND d.status IN ('available','stocktake_missing') AND d.branch_id <> NEW.branch_id
    ) THEN RAISE(ABORT, 'RETAIL_BRANCH_SERIAL_COUNT') END;
  SELECT CASE WHEN NEW.source_product_id IS NOT NULL AND (NEW.branch_id <> 1 OR NOT EXISTS (
    SELECT 1 FROM products p JOIN retail_branch_stock s ON s.product_id = p.id AND s.branch_id = 1
    WHERE p.id = NEW.source_product_id AND p.quantity_scale = 1 AND s.stock >= json_array_length(NEW.additions_json)
  )) THEN RAISE(ABORT, 'RETAIL_BRANCH_SERIAL_COUNT') END;
END;

CREATE TRIGGER retail_branch_serial_approval_validate BEFORE INSERT ON retail_device_inventory_approvals
WHEN EXISTS (
  SELECT 1 FROM retail_device_inventory_reviews r WHERE r.id = NEW.review_id
    AND NOT EXISTS (SELECT 1 FROM retail_used_phone_acquisitions a WHERE a.inspection_id = r.id AND a.id = NEW.id)
    AND r.expected_transfer_id <> COALESCE((SELECT MAX(t.id) FROM retail_branch_transfers t WHERE t.product_id = r.product_id),0)
)
BEGIN SELECT RAISE(ABORT, 'RETAIL_SERIAL_STALE'); END;

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
    WHERE d.product_id = NEW.product_id AND d.branch_id = NEW.branch_id
      AND (d.status = 'available' OR (d.status = 'stocktake_missing' AND j.value IS NOT NULL));
END;

DROP TRIGGER retail_serial_approval_post;
CREATE TRIGGER retail_serial_approval_post AFTER INSERT ON retail_device_inventory_approvals
BEGIN
  INSERT INTO retail_device_count_adjustments(approval_id, device_id, from_status, to_status)
    SELECT NEW.id, device_id,
      CASE disposition WHEN 'missing' THEN 'available' ELSE 'stocktake_missing' END,
      CASE disposition WHEN 'missing' THEN 'stocktake_missing' ELSE 'available' END
    FROM retail_device_inventory_observations WHERE review_id = NEW.review_id AND disposition <> 'present';
  UPDATE retail_devices SET status = (SELECT x.to_status FROM retail_device_count_adjustments x
    WHERE x.approval_id = NEW.id AND x.device_id = retail_devices.id)
    WHERE id IN (SELECT x.device_id FROM retail_device_count_adjustments x WHERE x.approval_id = NEW.id);
  INSERT INTO retail_devices(product_id, serial_number, imei1, imei2, inventory_intake_id, intake_cost_minor, branch_id)
    SELECT r.product_id, json_extract(j.value, '$.serial_number'), json_extract(j.value, '$.imei1'),
      json_extract(j.value, '$.imei2'), r.id, json_extract(j.value, '$.unit_cost_minor'), r.branch_id
    FROM retail_device_inventory_reviews r CROSS JOIN json_each(r.additions_json) j WHERE r.id = NEW.review_id;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id, branch_hint_id)
    SELECT source_product_id, -json_array_length(additions_json), 'adjustment', NEW.id,
      'نقل رصيد افتتاحي للأجهزة · ' || source_reference, NEW.actor_id, 1
    FROM retail_device_inventory_reviews WHERE id = NEW.review_id AND source_product_id IS NOT NULL;
  INSERT INTO inventory_movements(product_id, delta, source_type, source_id, note, actor_id, branch_hint_id)
    SELECT v.product_id, v.added_count + v.recovered_count - v.missing_count, 'adjustment', NEW.id,
      CASE v.kind WHEN 'opening' THEN 'افتتاح أجهزة متتبعة · ' ELSE 'تسوية جرد الأجهزة · ' END || v.source_reference,
      NEW.actor_id, r.branch_id FROM retail_device_inventory_records v
      JOIN retail_device_inventory_reviews r ON r.id = v.id
      WHERE v.id = NEW.review_id AND v.added_count + v.recovered_count <> v.missing_count;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM retail_device_inventory_reviews r JOIN products p ON p.id = r.product_id
    LEFT JOIN retail_branch_stock s ON s.product_id = p.id AND s.branch_id = r.branch_id WHERE r.id = NEW.review_id
      AND (p.stock <> (SELECT COUNT(*) FROM retail_devices d WHERE d.product_id = p.id AND d.status = 'available')
        OR COALESCE(s.stock,0) <> (SELECT COUNT(*) FROM retail_devices d
          WHERE d.product_id = p.id AND d.status = 'available' AND d.branch_id = r.branch_id))
  ) THEN RAISE(ABORT, 'RETAIL_SERIAL_STALE') END;
END;
