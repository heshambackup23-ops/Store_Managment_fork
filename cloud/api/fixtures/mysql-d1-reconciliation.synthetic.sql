SELECT
  (SELECT count(*) FROM invoices) AS invoices,
  (SELECT sum(total_minor) FROM invoices) AS invoice_total_minor,
  (SELECT sum(paid_minor) FROM invoices) AS invoice_paid_minor,
  (SELECT sum(returned_minor) FROM invoice_refunds) AS refund_minor,
  (SELECT sum(principal_minor-paid_minor) FROM installments) AS installment_due_minor,
  (SELECT sum(principal_minor-paid_minor) FROM personal_debts) AS personal_debt_due_minor,
  (SELECT sum(stock) FROM products) AS stock_units,
  (SELECT barcode FROM products WHERE id=42) AS barcode,
  (SELECT sum(quantity) FROM damaged_stock) AS damage_units,
  (SELECT sum(quantity*unit_cost_minor) FROM damaged_stock) AS damage_minor,
  (SELECT balance_minor FROM supplier_balances WHERE id=501) AS supplier_due_minor,
  (SELECT amount_minor FROM supplier_receipts WHERE id=503) AS supplier_receipt_minor,
  (SELECT group_concat(entry) FROM (
    SELECT purchase_id || ':' || amount_minor AS entry FROM supplier_receipt_allocations WHERE receipt_id=503 ORDER BY purchase_id
  )) AS supplier_allocations,
  provider_balance_minor, drawer_minor, receivables_minor, transfer_margin_minor,
  drawer_expense_minor, profit_available_minor, working_capital_minor,
  (SELECT count(*) FROM pragma_foreign_key_check) AS foreign_key_violations
FROM wallet_financial_totals;
