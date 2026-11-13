CREATE INDEX wallet_transactions_business_day_idx ON wallet_transactions(business_day, id);
CREATE INDEX wallet_debt_payments_created_at_idx ON wallet_debt_payments(created_at, id);
CREATE INDEX wallet_profit_cash_business_day_idx ON wallet_profit_withdrawals(business_day, id) WHERE wallet_id IS NULL;
CREATE INDEX audit_logs_action_idx ON audit_logs(action, id DESC);
