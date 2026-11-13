CREATE TABLE retail_settlement_batches (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  method TEXT NOT NULL CHECK (method IN ('card','wallet','bank_transfer')),
  statement_reference TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(statement_reference)) BETWEEN 1 AND 100),
  statement_date TEXT NOT NULL,
  fee_minor INTEGER NOT NULL CHECK (fee_minor BETWEEN 0 AND 900000000000000),
  observed_minor INTEGER NOT NULL CHECK (observed_minor BETWEEN -900000000000000 AND 900000000000000),
  items_json TEXT NOT NULL CHECK (json_valid(items_json) AND json_type(items_json) = 'array' AND json_array_length(items_json) BETWEEN 1 AND 40),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE TABLE retail_settlement_reversals (
  id INTEGER PRIMARY KEY REFERENCES business_operations(id),
  settlement_id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;

CREATE VIEW retail_active_tender_matches AS
SELECT m.operation_id, m.source, m.position, m.match_operation_id AS settlement_id,
  'single' AS settlement_type, m.observed_delta_minor, m.statement_reference, m.statement_date, m.matched_by, m.matched_at
FROM retail_tender_matches m WHERE NOT EXISTS (SELECT 1 FROM retail_settlement_reversals r WHERE r.settlement_id = m.match_operation_id)
UNION ALL
SELECT t.operation_id, t.source, t.position, b.id, 'batch', t.delta_minor, b.statement_reference, b.statement_date, b.actor_id, b.created_at
FROM retail_settlement_batches b JOIN json_each(b.items_json) j
JOIN retail_tender_ledger t ON t.operation_id = json_extract(j.value,'$.operation_id')
  AND t.source = json_extract(j.value,'$.source') AND t.position = json_extract(j.value,'$.position')
WHERE NOT EXISTS (SELECT 1 FROM retail_settlement_reversals r WHERE r.settlement_id = b.id);

CREATE TRIGGER retail_settlement_batch_validate BEFORE INSERT ON retail_settlement_batches BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM retail_settlement_batches b WHERE b.method = NEW.method AND b.statement_reference = NEW.statement_reference
      AND b.statement_date = NEW.statement_date AND NOT EXISTS (SELECT 1 FROM retail_settlement_reversals r WHERE r.settlement_id = b.id)
  ) THEN RAISE(ABORT, 'RETAIL_SETTLEMENT_REFERENCE') END;
  SELECT CASE WHEN (SELECT count(*) FROM (
    SELECT json_extract(value,'$.operation_id'), json_extract(value,'$.source'), json_extract(value,'$.position')
    FROM json_each(NEW.items_json) GROUP BY 1, 2, 3
  )) <> json_array_length(NEW.items_json) THEN RAISE(ABORT, 'RETAIL_TENDER_ALREADY_MATCHED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.items_json) j LEFT JOIN retail_tender_ledger t
      ON t.operation_id = json_extract(j.value,'$.operation_id') AND t.source = json_extract(j.value,'$.source')
      AND t.position = json_extract(j.value,'$.position')
    LEFT JOIN retail_active_tender_matches m ON m.operation_id = t.operation_id AND m.source = t.source AND m.position = t.position
    WHERE t.operation_id IS NULL OR t.method <> NEW.method OR m.operation_id IS NOT NULL
  ) THEN RAISE(ABORT, 'RETAIL_TENDER_ALREADY_MATCHED') END;
  SELECT CASE WHEN (
    SELECT COALESCE(sum(t.delta_minor),0) FROM json_each(NEW.items_json) j JOIN retail_tender_ledger t
      ON t.operation_id = json_extract(j.value,'$.operation_id') AND t.source = json_extract(j.value,'$.source')
      AND t.position = json_extract(j.value,'$.position')
  ) - NEW.fee_minor <> NEW.observed_minor THEN RAISE(ABORT, 'RETAIL_SETTLEMENT_NET') END;
END;

CREATE TRIGGER retail_settlement_reversal_validate BEFORE INSERT ON retail_settlement_reversals BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_settlement_batches WHERE id = NEW.settlement_id)
    AND NOT EXISTS (SELECT 1 FROM retail_tender_matches WHERE match_operation_id = NEW.settlement_id)
    THEN RAISE(ABORT, 'RETAIL_SETTLEMENT_NOT_FOUND') END;
END;

-- Existing single matches remain immutable. Corrected matches are re-entered using the batch path, including a single item.
CREATE TRIGGER retail_tender_match_cross_check BEFORE INSERT ON retail_tender_matches BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_active_tender_matches m WHERE m.operation_id = NEW.operation_id
    AND m.source = NEW.source AND m.position = NEW.position) THEN RAISE(ABORT, 'RETAIL_TENDER_ALREADY_MATCHED') END;
END;

CREATE TRIGGER retail_settlement_batch_no_update BEFORE UPDATE ON retail_settlement_batches BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_settlement_batch_no_delete BEFORE DELETE ON retail_settlement_batches BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_settlement_reversal_no_update BEFORE UPDATE ON retail_settlement_reversals BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_settlement_reversal_no_delete BEFORE DELETE ON retail_settlement_reversals BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
