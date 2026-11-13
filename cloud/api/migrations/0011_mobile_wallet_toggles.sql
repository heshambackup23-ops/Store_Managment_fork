CREATE TABLE mobile_wallet_toggles (
  operation_id INTEGER PRIMARY KEY REFERENCES business_operations(id) ON DELETE RESTRICT,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id) ON DELETE RESTRICT,
  active INTEGER NOT NULL CHECK(active IN (0, 1))
) STRICT;
CREATE INDEX mobile_wallet_toggles_wallet_idx ON mobile_wallet_toggles(wallet_id);
