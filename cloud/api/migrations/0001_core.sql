CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
) STRICT;

INSERT INTO roles (id, name, is_system) VALUES (1, 'superadmin', 1);
INSERT INTO role_permissions (role_id, permission) VALUES (1, '*');

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  username TEXT COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX users_role_active ON users(role_id, active);

CREATE TRIGGER users_keep_admin_on_update
BEFORE UPDATE OF active, role_id ON users
WHEN OLD.role_id = 1 AND OLD.active = 1 AND (NEW.role_id <> 1 OR NEW.active = 0)
     AND NOT EXISTS (SELECT 1 FROM users WHERE role_id = 1 AND active = 1 AND id <> OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'last_active_superadmin');
END;

CREATE TRIGGER users_keep_admin_on_delete
BEFORE DELETE ON users
WHEN OLD.role_id = 1 AND OLD.active = 1
     AND NOT EXISTS (SELECT 1 FROM users WHERE role_id = 1 AND active = 1 AND id <> OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'last_active_superadmin');
END;

CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX auth_sessions_user_expiry ON auth_sessions(user_id, expires_at);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE auth_attempts (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0)
) STRICT;
CREATE INDEX auth_attempts_window ON auth_attempts(window_start);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  notes TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE RESTRICT,
  barcode TEXT UNIQUE,
  price_minor INTEGER NOT NULL CHECK (price_minor BETWEEN 0 AND 100000000000),
  cost_minor INTEGER NOT NULL DEFAULT 0 CHECK (cost_minor BETWEEN 0 AND 100000000000),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock BETWEEN 0 AND 1000000000),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold BETWEEN 0 AND 1000000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX products_category ON products(category_id, id);
CREATE INDEX products_active_id ON products(active, id);
CREATE INDEX products_name ON products(name COLLATE NOCASE);

CREATE TRIGGER products_archive_empty_stock
BEFORE UPDATE OF active ON products
WHEN OLD.active = 1 AND NEW.active = 0 AND OLD.stock <> 0
BEGIN
  SELECT RAISE(ABORT, 'product_has_stock');
END;

CREATE TABLE product_images (
  product_id INTEGER PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  content BLOB NOT NULL CHECK (length(content) BETWEEN 1 AND 131072),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE TRIGGER product_images_demo_cap
BEFORE INSERT ON product_images
WHEN NOT EXISTS (SELECT 1 FROM product_images WHERE product_id = NEW.product_id)
     AND (SELECT count(*) FROM product_images) >= 100
BEGIN
  SELECT RAISE(ABORT, 'product_images_demo_limit');
END;

CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT COLLATE NOCASE,
  address TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX customers_name ON customers(name COLLATE NOCASE);
CREATE INDEX customers_phone ON customers(phone COLLATE NOCASE);
CREATE INDEX customers_email ON customers(email);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  store_name TEXT NOT NULL DEFAULT 'HENRA Store Management',
  currency TEXT NOT NULL DEFAULT 'EGP',
  store_phone TEXT,
  store_address TEXT,
  receipt_footer TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
INSERT INTO settings (id) VALUES (1);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX notifications_user ON notifications(user_id, id);

CREATE TABLE notification_reads (
  notification_id INTEGER NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (notification_id, user_id)
) STRICT;

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX audit_logs_entity ON audit_logs(entity_type, entity_id, id);
CREATE INDEX audit_logs_actor ON audit_logs(actor_id, id);
