CREATE TABLE retail_tender_matches (
  operation_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  position INTEGER NOT NULL,
  match_operation_id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id),
  observed_delta_minor INTEGER NOT NULL CHECK (observed_delta_minor <> 0),
  statement_reference TEXT NOT NULL CHECK (length(trim(statement_reference)) BETWEEN 1 AND 100),
  statement_date TEXT NOT NULL,
  matched_by INTEGER NOT NULL REFERENCES users(id),
  matched_at TEXT NOT NULL,
  PRIMARY KEY (operation_id, source, position),
  FOREIGN KEY (operation_id, source, position) REFERENCES retail_tenders(operation_id, source, position)
) STRICT;

CREATE TRIGGER retail_tender_match_validate BEFORE INSERT ON retail_tender_matches BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_tender_ledger t WHERE t.operation_id = NEW.operation_id
    AND t.source = NEW.source AND t.position = NEW.position AND t.method <> 'cash')
    THEN RAISE(ABORT, 'RETAIL_TENDER_NOT_FOUND') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_tender_matches m WHERE m.operation_id = NEW.operation_id
    AND m.source = NEW.source AND m.position = NEW.position)
    THEN RAISE(ABORT, 'RETAIL_TENDER_ALREADY_MATCHED') END;
  SELECT CASE WHEN (SELECT t.delta_minor FROM retail_tender_ledger t WHERE t.operation_id = NEW.operation_id
    AND t.source = NEW.source AND t.position = NEW.position) <> NEW.observed_delta_minor
    THEN RAISE(ABORT, 'RETAIL_TENDER_MATCH_AMOUNT') END;
END;

CREATE TRIGGER retail_tender_match_no_update BEFORE UPDATE ON retail_tender_matches BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_tender_match_no_delete BEFORE DELETE ON retail_tender_matches BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
