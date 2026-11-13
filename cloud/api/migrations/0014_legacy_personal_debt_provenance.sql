ALTER TABLE personal_debts ADD COLUMN legacy_created_by INTEGER;
ALTER TABLE personal_debt_payments ADD COLUMN legacy_created_by INTEGER;
ALTER TABLE personal_debt_payments ADD COLUMN legacy_paid_on TEXT;
