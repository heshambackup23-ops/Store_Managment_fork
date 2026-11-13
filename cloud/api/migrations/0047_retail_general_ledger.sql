CREATE TABLE retail_ledger_accounts (
  code TEXT PRIMARY KEY CHECK (code GLOB '[0-9][0-9][0-9][0-9]'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  account_type TEXT NOT NULL CHECK (account_type IN ('asset','liability','equity','income','expense'))
) STRICT;

INSERT INTO retail_ledger_accounts(code, name, account_type) VALUES
  ('1000','نقدية أدراج البيع','asset'), ('1005','نقدية نشاط المحافظ','asset'),
  ('1010','الخزنة','asset'), ('1020','البنك','asset'), ('1030','أرصدة مزوّدي المحافظ','asset'),
  ('1040','بطاقات قيد التسوية','asset'), ('1050','مدفوعات محفظة قيد التسوية','asset'),
  ('1060','تحويلات قيد التسوية','asset'), ('1090','وسائل سداد بانتظار التصنيف','asset'),
  ('1100','ذمم العملاء','asset'), ('1110','ذمم خدمات المحافظ','asset'), ('1120','أرصدة دائنة لدى الموردين','asset'),
  ('1200','المخزون المتاح','asset'), ('1210','مخزون معزول للفحص','asset'), ('1220','مشتريات قيد الاستلام','asset'),
  ('2000','ذمم الموردين','liability'), ('2010','تكاليف استلام قيد التسوية','liability'),
  ('2020','دفعات صيانة مقدمة','liability'), ('2030','التزامات ضريبية','liability'), ('2090','تسويات مخزون قيد المراجعة','liability'),
  ('3000','رأس المال والأرصدة الافتتاحية','equity'), ('3010','مسحوبات المالك','equity'),
  ('4000','مبيعات البضاعة','income'), ('4010','مرتجعات المبيعات','income'), ('4020','إيرادات خدمات المحافظ','income'),
  ('4030','إيرادات الصيانة','income'), ('4040','إيرادات أخرى','income'),
  ('5000','تكلفة البضاعة المباعة','expense'), ('5010','الهالك وفروق المخزون','expense'),
  ('5020','مصروفات تشغيل','expense'), ('5030','رسوم التسوية والمحافظ','expense'), ('5040','فروق الدرج والخزنة','expense');

CREATE TABLE retail_ledger_books (
  book TEXT PRIMARY KEY CHECK (book IN ('operating','practice')),
  first_period TEXT NOT NULL CHECK (date(first_period || '-01') IS first_period || '-01'),
  start_operation_id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE retail_ledger_entries (
  id INTEGER PRIMARY KEY,
  book TEXT NOT NULL REFERENCES retail_ledger_books(book),
  posting_day TEXT NOT NULL CHECK (date(posting_day,'+0 days') IS posting_day),
  period TEXT GENERATED ALWAYS AS (substr(posting_day,1,7)) VIRTUAL,
  kind TEXT NOT NULL CHECK (kind IN ('source','manual','reversal','resolution')),
  source TEXT,
  source_ref TEXT,
  reverses_id INTEGER UNIQUE REFERENCES retail_ledger_entries(id),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 1000),
  lines_json TEXT NOT NULL CHECK (json_valid(lines_json) AND json_type(lines_json) = 'array'
    AND json_array_length(lines_json) BETWEEN 2 AND 30),
  operation_id INTEGER NOT NULL REFERENCES business_operations(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((kind = 'source') = (source IS NOT NULL AND source_ref IS NOT NULL)),
  CHECK ((kind = 'reversal') = (reverses_id IS NOT NULL)),
  UNIQUE (book, source, source_ref)
) STRICT;
CREATE INDEX retail_ledger_entry_period ON retail_ledger_entries(book, period, posting_day, id);

CREATE VIEW retail_ledger_lines AS
SELECT e.id AS entry_id, e.book, e.posting_day, e.period, e.kind, e.source, e.source_ref,
  e.description, j.key AS position, json_extract(j.value, '$.account') AS account,
  json_extract(j.value, '$.debit_minor') AS debit_minor, json_extract(j.value, '$.credit_minor') AS credit_minor
FROM retail_ledger_entries e JOIN json_each(e.lines_json) j;

CREATE TABLE retail_ledger_source_reviews (
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  posting_day TEXT NOT NULL CHECK (date(posting_day,'+0 days') IS posting_day),
  period TEXT GENERATED ALWAYS AS (substr(posting_day,1,7)) VIRTUAL,
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 1000),
  issue TEXT CHECK (issue IN ('cost_unknown','payment_unknown','account_required')),
  unclassified_minor INTEGER NOT NULL DEFAULT 0,
  operation_id INTEGER NOT NULL REFERENCES business_operations(id),
  PRIMARY KEY (source, source_ref),
  CHECK ((issue IS 'payment_unknown') = (unclassified_minor <> 0))
) STRICT;
CREATE INDEX retail_ledger_source_period ON retail_ledger_source_reviews(period, issue);

CREATE TABLE retail_ledger_issue_resolutions (
  book TEXT NOT NULL REFERENCES retail_ledger_books(book) CHECK (book = 'operating'),
  period TEXT NOT NULL CHECK (date(period || '-01') IS period || '-01'),
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  code TEXT NOT NULL,
  resolution_entry_id INTEGER UNIQUE REFERENCES retail_ledger_entries(id),
  operation_id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 1000),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (book, source, source_ref, code),
  FOREIGN KEY (source, source_ref) REFERENCES retail_ledger_source_reviews(source, source_ref)
) STRICT;

CREATE TABLE retail_ledger_closures (
  book TEXT NOT NULL REFERENCES retail_ledger_books(book),
  period TEXT NOT NULL CHECK (date(period || '-01') IS period || '-01'),
  operation_id INTEGER NOT NULL UNIQUE REFERENCES business_operations(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 1000),
  entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
  expected_operation_id INTEGER NOT NULL,
  expected_audit_id INTEGER NOT NULL,
  trial_balance_json TEXT NOT NULL CHECK (json_valid(trial_balance_json) AND json_type(trial_balance_json) = 'array'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (book, period)
) STRICT;

CREATE TRIGGER retail_ledger_entry_validate BEFORE INSERT ON retail_ledger_entries BEGIN
  SELECT CASE WHEN substr(NEW.posting_day,1,7) < (SELECT first_period FROM retail_ledger_books WHERE book = NEW.book)
    THEN RAISE(ABORT, 'LEDGER_BEFORE_START') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_ledger_closures WHERE book = NEW.book AND period >= substr(NEW.posting_day,1,7))
    THEN RAISE(ABORT, 'LEDGER_PERIOD_CLOSED') END;
  SELECT CASE WHEN NEW.kind = 'source' AND NEW.book <> 'operating' THEN RAISE(ABORT, 'LEDGER_BOOK_SOURCE') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.lines_json) j LEFT JOIN retail_ledger_accounts a ON a.code = json_extract(j.value,'$.account')
    WHERE j.type <> 'object' OR a.code IS NULL
      OR json_type(j.value,'$.debit_minor') IS NOT 'integer' OR json_type(j.value,'$.credit_minor') IS NOT 'integer'
      OR json_extract(j.value,'$.debit_minor') NOT BETWEEN 0 AND 900000000000000
      OR json_extract(j.value,'$.credit_minor') NOT BETWEEN 0 AND 900000000000000
      OR (json_extract(j.value,'$.debit_minor') = 0) = (json_extract(j.value,'$.credit_minor') = 0)
  ) THEN RAISE(ABORT, 'LEDGER_INVALID_LINE') END;
  SELECT CASE WHEN (
    SELECT COUNT(DISTINCT json_extract(j.value,'$.account')) FROM json_each(NEW.lines_json) j
  ) < 2 OR (
    SELECT sum(json_extract(j.value,'$.debit_minor') - json_extract(j.value,'$.credit_minor')) FROM json_each(NEW.lines_json) j
  ) <> 0 THEN RAISE(ABORT, 'LEDGER_UNBALANCED') END;
  SELECT CASE WHEN NEW.reverses_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM retail_ledger_entries e WHERE e.id = NEW.reverses_id AND e.book = NEW.book
      AND e.kind IN ('manual','resolution') AND e.posting_day <= NEW.posting_day
      AND NOT EXISTS (SELECT 1 FROM retail_ledger_issue_resolutions i WHERE i.resolution_entry_id = e.id)
      AND json_array_length(e.lines_json) = json_array_length(NEW.lines_json)
      AND NOT EXISTS (
        SELECT 1 FROM json_each(e.lines_json) original JOIN json_each(NEW.lines_json) reversal USING (key)
        WHERE json_extract(original.value,'$.account') <> json_extract(reversal.value,'$.account')
          OR json_extract(original.value,'$.debit_minor') <> json_extract(reversal.value,'$.credit_minor')
          OR json_extract(original.value,'$.credit_minor') <> json_extract(reversal.value,'$.debit_minor')
      )
  ) THEN RAISE(ABORT, 'LEDGER_INVALID_REVERSAL') END;
END;

CREATE TRIGGER retail_ledger_issue_validate BEFORE INSERT ON retail_ledger_issue_resolutions BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_ledger_closures WHERE book = NEW.book AND period >= NEW.period)
    THEN RAISE(ABORT, 'LEDGER_PERIOD_CLOSED') END;
  SELECT CASE WHEN NEW.resolution_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM retail_ledger_entries WHERE id = NEW.resolution_entry_id AND book = NEW.book AND period = NEW.period
      AND kind = 'resolution' AND operation_id = NEW.operation_id
  ) THEN RAISE(ABORT, 'LEDGER_INVALID_RESOLUTION') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM retail_ledger_source_reviews s WHERE s.source = NEW.source AND s.source_ref = NEW.source_ref
      AND s.period = NEW.period AND s.issue = NEW.code AND (s.issue <> 'payment_unknown' OR s.unclassified_minor = -(
        SELECT COALESCE(SUM(l.debit_minor - l.credit_minor), 0) FROM retail_ledger_lines l
        WHERE l.entry_id = NEW.resolution_entry_id AND l.account = '1090'
      ))
  ) THEN RAISE(ABORT, 'LEDGER_INVALID_RESOLUTION') END;
END;

CREATE TRIGGER retail_ledger_source_validate BEFORE INSERT ON retail_ledger_source_reviews BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM retail_ledger_books WHERE book = 'operating' AND first_period <= substr(NEW.posting_day,1,7))
    THEN RAISE(ABORT, 'LEDGER_BEFORE_START') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM retail_ledger_closures WHERE book = 'operating' AND period >= substr(NEW.posting_day,1,7))
    THEN RAISE(ABORT, 'LEDGER_PERIOD_CLOSED') END;
END;

CREATE TRIGGER retail_ledger_close_validate BEFORE INSERT ON retail_ledger_closures BEGIN
  SELECT CASE WHEN NEW.period <> COALESCE(
    (SELECT strftime('%Y-%m', MAX(period) || '-01', '+1 month') FROM retail_ledger_closures WHERE book = NEW.book),
    (SELECT first_period FROM retail_ledger_books WHERE book = NEW.book)
  ) THEN RAISE(ABORT, 'LEDGER_CLOSE_SEQUENCE') END;
  SELECT CASE WHEN NEW.entry_count <> (
    SELECT COUNT(*) FROM retail_ledger_entries WHERE book = NEW.book AND period = NEW.period
  ) THEN RAISE(ABORT, 'LEDGER_CLOSE_STALE') END;
  SELECT CASE WHEN NEW.book = 'operating' AND (NEW.expected_operation_id <> COALESCE((
    SELECT MAX(id) FROM business_operations WHERE id < NEW.operation_id
  ), 0) OR NEW.expected_audit_id <> COALESCE((SELECT MAX(id) FROM audit_logs), 0))
    THEN RAISE(ABORT, 'LEDGER_CLOSE_STALE') END;
  SELECT CASE WHEN NEW.book = 'operating' AND EXISTS (
    SELECT 1 FROM retail_ledger_source_reviews s WHERE s.period = NEW.period AND s.issue IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM retail_ledger_issue_resolutions r WHERE r.book = NEW.book AND r.source = s.source AND r.source_ref = s.source_ref AND r.code = s.issue)
  ) THEN RAISE(ABORT, 'LEDGER_CLOSE_ISSUES') END;
END;

CREATE TRIGGER retail_ledger_account_no_update BEFORE UPDATE ON retail_ledger_accounts BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_account_no_delete BEFORE DELETE ON retail_ledger_accounts BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_book_no_update BEFORE UPDATE ON retail_ledger_books BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_book_no_delete BEFORE DELETE ON retail_ledger_books BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_entry_no_update BEFORE UPDATE ON retail_ledger_entries BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_entry_no_delete BEFORE DELETE ON retail_ledger_entries BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_source_no_update BEFORE UPDATE ON retail_ledger_source_reviews BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_source_no_delete BEFORE DELETE ON retail_ledger_source_reviews BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_issue_no_update BEFORE UPDATE ON retail_ledger_issue_resolutions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_issue_no_delete BEFORE DELETE ON retail_ledger_issue_resolutions BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_close_no_update BEFORE UPDATE ON retail_ledger_closures BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER retail_ledger_close_no_delete BEFORE DELETE ON retail_ledger_closures BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
