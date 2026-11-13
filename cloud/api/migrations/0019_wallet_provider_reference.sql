-- A provider receipt can identify only one entry in the same store wallet.
ALTER TABLE wallet_transactions ADD COLUMN provider_reference TEXT
  CHECK(provider_reference IS NULL OR length(provider_reference) BETWEEN 1 AND 100);

CREATE UNIQUE INDEX wallet_transactions_provider_reference_unique
  ON wallet_transactions(wallet_id, provider_reference COLLATE NOCASE)
  WHERE provider_reference IS NOT NULL;
