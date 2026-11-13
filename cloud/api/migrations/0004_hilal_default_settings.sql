CREATE TABLE settings_hilal (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT 'هلال لإدارة المتجر',
  currency TEXT NOT NULL DEFAULT 'EGP',
  store_phone TEXT,
  store_address TEXT,
  receipt_footer TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

INSERT INTO settings_hilal (id, store_name, currency, store_phone, store_address, receipt_footer, updated_at)
SELECT id,
  CASE WHEN store_name = 'HENRA Store Management' THEN 'هلال لإدارة المتجر' ELSE store_name END,
  currency, store_phone, store_address, receipt_footer,
  CASE WHEN store_name = 'HENRA Store Management' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE updated_at END
FROM settings;

DROP TABLE settings;
ALTER TABLE settings_hilal RENAME TO settings;
