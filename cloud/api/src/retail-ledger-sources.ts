export type LedgerLine = { account: string; debit_minor: number; credit_minor: number };
export type LedgerIssue = 'cost_unknown' | 'payment_unknown' | 'account_required';

type Draft = { lines: LedgerLine[]; issue: LedgerIssue | null; unclassified: number };
type SourceRow = { source: string; ref: string; occurred: number; amount: number | null; secondary: number | null;
  kind: string | null; details: string | null; count: number | null };
type SourceRule = { description: string; query: string; draft: (row: SourceRow) => Draft };

export type LedgerSource = Draft & { source: string; source_ref: string; posting_day: string; description: string };

const account = {
  cash: '1000', walletCash: '1005', safe: '1010', bank: '1020', provider: '1030', card: '1040', wallet: '1050',
  bank_transfer: '1060', unclassified: '1090', receivable: '1100', walletDue: '1110', supplierCredit: '1120',
  stock: '1200', held: '1210', ordered: '1220', payable: '2000', freight: '2010', maintenanceDeposit: '2020', costPending: '2090',
  capital: '3000', ownerDraw: '3010', sales: '4000', returns: '4010', walletIncome: '4020',
  maintenanceIncome: '4030', cogs: '5000', stockLoss: '5010', operatingExpense: '5020', fees: '5030', cashDifference: '5040',
};

const amount = (value: number | null) => value ?? 0;

function line(code: string, signedAmount: number): LedgerLine {
  if (!Number.isSafeInteger(signedAmount)) throw new Error('LEDGER_VALUE_LIMIT');
  return { account: code, debit_minor: Math.max(0, signedAmount), credit_minor: Math.max(0, -signedAmount) };
}

function draft(lines: LedgerLine[], issue: LedgerIssue | null = null): Draft {
  const byAccount = new Map<string, bigint>();
  for (const row of lines) byAccount.set(row.account, (byAccount.get(row.account) ?? 0n) + BigInt(row.debit_minor) - BigInt(row.credit_minor));
  const unclassified = byAccount.get(account.unclassified) ?? 0n;
  return { lines: [...byAccount].filter(([, balance]) => balance !== 0n).map(([code, balance]) => line(code, Number(balance))),
    issue: unclassified !== 0n ? 'payment_unknown' : issue, unclassified: Number(unclassified) };
}

function pair(debit: string, credit: string, value: number | null) {
  return value === null ? draft([], 'cost_unknown') : draft([line(debit, value), line(credit, -value)]);
}

function reviewedCost(lines: LedgerLine[], row: SourceRow) {
  return draft(lines, row.count ? 'cost_unknown' : null);
}

function tenderAccount(method: string | null) {
  switch (method) {
    case 'cash': return account.cash;
    case 'card': return account.card;
    case 'wallet': return account.wallet;
    case 'bank_transfer': return account.bank_transfer;
    default: return account.unclassified;
  }
}

function payment(row: SourceRow, offset: string, direction: 1 | -1) {
  const tenders = JSON.parse(row.details ?? '[]') as { method: string; amount_minor: number }[];
  const paid = amount(row.amount);
  const remaining = paid - tenders.reduce((total, tender) => total + tender.amount_minor, 0);
  if (remaining < 0) throw new Error('LEDGER_PAYMENT_MISMATCH');
  return draft([
    line(offset, -direction * paid),
    ...tenders.map(tender => line(tenderAccount(tender.method), direction * tender.amount_minor)),
    line(account.unclassified, direction * remaining),
  ]);
}

const source = (
  description: string, table: string, ref: string, occurred: string,
  fields: { amount?: string; secondary?: string; kind?: string; details?: string; count?: string },
  where: string, makeDraft: SourceRule['draft'],
): SourceRule => ({ description, draft: makeDraft, query: `
  SELECT ? AS source, s.* FROM (
    SELECT CAST(${ref} AS TEXT) AS ref, unixepoch(${occurred}) AS occurred, ${fields.amount ?? 'NULL'} AS amount,
      ${fields.secondary ?? 'NULL'} AS secondary, ${fields.kind ?? 'NULL'} AS kind,
      ${fields.details ?? 'NULL'} AS details, ${fields.count ?? 'NULL'} AS count
    FROM ${table} WHERE ${where || '1 = 1'}
  ) s
  WHERE occurred >= ? AND occurred < ? AND NOT EXISTS (
    SELECT 1 FROM retail_ledger_source_reviews r WHERE r.source = ? AND r.source_ref = s.ref
  )
  ORDER BY occurred, ref LIMIT ?`,
});

const tenders = (id: string, tenderSource: string) => `(SELECT json_group_array(json_object('method', t.method, 'amount_minor', t.amount_minor))
  FROM retail_tender_ledger t WHERE t.operation_id = ${id} AND t.source = ${tenderSource})`;

const saleLine = `invoice_items i LEFT JOIN retail_quantity_sale_costs c ON c.invoice_id = i.invoice_id AND c.product_id = i.product_id`;
const saleCost = `CASE WHEN json_array_length(i.device_ids_json) > 0 THEN
  (SELECT SUM(d.unit_cost_minor) FROM retail_device_sales d WHERE d.invoice_id = i.invoice_id AND d.product_id = i.product_id)
  ELSE c.cost_minor END`;
const saleUnknown = `CASE WHEN json_array_length(i.device_ids_json) > 0 THEN
  (SELECT COUNT(d.unit_cost_minor) FROM retail_device_sales d WHERE d.invoice_id = i.invoice_id AND d.product_id = i.product_id) <> json_array_length(i.device_ids_json)
  ELSE c.cost_minor IS NULL END`;

const returnCosts = `(
  SELECT i.return_id, i.disposition, CASE WHEN p.tracking = 'quantity' THEN q.cost_minor ELSE
    (SELECT SUM(d.unit_cost_minor) FROM retail_return_devices r JOIN retail_device_sales d USING (invoice_id, product_id, device_id)
      WHERE r.return_id = i.return_id AND r.product_id = i.product_id AND r.disposition = i.disposition) END AS value,
    CASE WHEN p.tracking = 'quantity' THEN q.cost_minor IS NULL ELSE
      (SELECT COUNT(d.unit_cost_minor) FROM retail_return_devices r JOIN retail_device_sales d USING (invoice_id, product_id, device_id)
        WHERE r.return_id = i.return_id AND r.product_id = i.product_id AND r.disposition = i.disposition) <> i.quantity END AS missing
  FROM retail_return_items i JOIN products p ON p.id = i.product_id
  LEFT JOIN retail_quantity_return_costs q USING (return_id, product_id, disposition)
)`;

const receiptCost = `(
  SELECT i.receipt_id, i.product_id, o.unit_cost_minor, o.landed_unit_minor, p.tracking, c.cost_delta_minor,
    p.quantity_scale, i.quantity,
    (SELECT COALESCE(SUM(previous.quantity), 0) FROM purchase_stock_receipt_items previous
      JOIN purchase_stock_receipts earlier ON earlier.id = previous.receipt_id
      WHERE earlier.purchase_id = r.purchase_id AND earlier.id < r.id AND previous.product_id = i.product_id
        AND NOT EXISTS (SELECT 1 FROM purchase_stock_reversals rr WHERE rr.receipt_id = earlier.id AND rr.id < r.id)
    ) AS earlier_quantity
  FROM purchase_stock_receipt_items i JOIN purchase_stock_receipts r ON r.id = i.receipt_id
  JOIN products p ON p.id = i.product_id
  LEFT JOIN purchase_order_items o ON o.purchase_id = r.purchase_id AND o.product_id = i.product_id
  LEFT JOIN retail_quantity_movement_costs c ON c.movement_id = (SELECT m.id FROM inventory_movements m
    WHERE m.purchase_stock_receipt_id = r.id AND m.product_id = i.product_id)
)`;

const roundedReceived = `((i.unit_cost_minor * (i.earlier_quantity + i.quantity) + i.quantity_scale / 2) / i.quantity_scale
  - (i.unit_cost_minor * i.earlier_quantity + i.quantity_scale / 2) / i.quantity_scale)`;
const receiptDetails = (receipt: string) => `(
  SELECT json_group_array(json_object('value', CASE WHEN i.tracking = 'quantity' THEN i.cost_delta_minor
      ELSE (i.unit_cost_minor + i.landed_unit_minor) * i.quantity END,
    'merchandise', ${roundedReceived})) FROM ${receiptCost} i WHERE i.receipt_id = ${receipt}
)`;

function receiptDraft(row: SourceRow, direction: 1 | -1) {
  const items = JSON.parse(row.details ?? '[]') as { value: number | null; merchandise: number | null }[];
  const known = items.filter(item => item.value !== null && item.merchandise !== null);
  const value = known.reduce((total, item) => total + amount(item.value), 0) * direction;
  const merchandise = known.reduce((total, item) => total + amount(item.merchandise), 0) * direction;
  return draft([line(account.stock, value), line(account.ordered, -merchandise), line(account.freight, merchandise - value)],
    items.length === known.length ? null : 'cost_unknown');
}

const purchasePayments = {
  supplier_payment: source('دفعة فاتورة مورد', 'supplier_payments p', 'p.id', 'p.created_at',
    { amount: 'p.amount_minor', details: tenders('p.id', "'supplier_payment'") }, '', row => payment(row, account.payable, -1)),
  supplier_receipt: source('سند دفع مورد', 'supplier_receipts p', 'p.id', 'p.created_at',
    { amount: 'p.amount_minor', details: tenders('p.id', "'supplier_receipt'") }, '', row => payment(row, account.payable, -1)),
};

function settlement(row: SourceRow, direction: 1 | -1) {
  const gross = amount(row.amount) * direction;
  const fee = amount(row.secondary) * direction;
  return draft([line(account.bank, gross - fee), line(account.fees, fee), line(tenderAccount(row.kind), -gross)]);
}

const walletOriginal = 'COALESCE(o.kind, t.kind)';
const walletShared = `(SELECT EXISTS(SELECT 1 FROM retail_service_cash s WHERE s.operation_id = t.id AND s.source = 'wallet_cash'))`;
const walletDetails = `json_object('fee',t.fee_minor,'commission',t.commission_minor,'reverse',t.kind = 'reversal',
  'shared',${walletShared},'deferred',d.principal_minor)`;

function walletTransaction(row: SourceRow) {
  const details = JSON.parse(row.details ?? '{}') as { fee: number; commission: number; reverse: number; shared: number;
    deferred: number | null };
  const cash = details.shared ? account.cash : account.walletCash;
  const value = amount(row.amount);
  const cashDelta = amount(row.secondary);
  if (row.kind === 'opening') return pair(account.provider, account.capital, value);
  if (row.kind === 'expense') return pair(account.provider, account.operatingExpense, value);
  if (row.kind === 'settlement_in' || row.kind === 'settlement_out') return draft([line(account.provider, value), line(account.unclassified, -value)]);
  const direction = details.reverse ? -1 : 1;
  return draft([line(account.provider, value), line(cash, cashDelta), line(account.walletDue, amount(details.deferred) * direction),
    line(account.fees, details.fee * direction), line(account.walletIncome, -details.commission * direction)]);
}

function walletCashEntry(row: SourceRow) {
  const asset = row.count ? account.cash : account.walletCash;
  switch (row.kind) {
    case 'expense': case 'expense_reversal': return pair(asset, account.operatingExpense, row.amount);
    case 'owner_withdraw': return pair(asset, account.ownerDraw, row.amount);
    case 'opening': case 'owner_deposit': return pair(asset, account.capital, row.amount);
    default: return draft([line(asset, amount(row.amount)), line(account.unclassified, -amount(row.amount))]);
  }
}

const sourceRules: Record<string, SourceRule> = {
  sale: source('فاتورة بيع', 'invoices s', 's.id', 's.created_at', { amount: 's.total_minor' }, '',
    row => pair(account.receivable, account.sales, row.amount)),
  sale_cost: source('تكلفة البضاعة المباعة', 'invoices s', 's.id', 's.created_at', {
    amount: `(SELECT SUM(${saleCost}) FROM ${saleLine} WHERE i.invoice_id = s.id)`,
    count: `(SELECT SUM(${saleUnknown}) FROM ${saleLine} WHERE i.invoice_id = s.id)`,
  }, '', row => reviewedCost([line(account.cogs, amount(row.amount)), line(account.stock, -amount(row.amount))], row)),
  invoice_payment: source('تحصيل فاتورة', 'invoice_payments p', 'p.id', 'p.created_at', {
    amount: 'p.amount_minor', details: tenders('p.id', "CASE WHEN p.source_type = 'installment' THEN 'installment_payment' ELSE 'invoice_payment' END"),
  }, '', row => payment(row, account.receivable, 1)),
  historical_invoice_payment: source('مدفوع مثبت في الفاتورة المستوردة', 'invoices p', 'p.id', 'p.created_at',
    { amount: 'p.historical_paid_minor' }, 'p.historical_paid_minor > 0 AND NOT EXISTS (SELECT 1 FROM invoice_payments i WHERE i.invoice_id = p.id AND i.source_type = \'checkout\')',
    row => payment(row, account.receivable, 1)),
  partial_return: source('مرتجع بيع من البنود', 'retail_returns r', 'r.id', 'r.created_at', { amount: 'r.total_minor' }, '',
    row => pair(account.returns, account.receivable, row.amount)),
  partial_return_payment: source('مبلغ مردود من البنود', 'retail_returns r', 'r.id', 'r.created_at',
    { amount: 'r.returned_minor', details: tenders('r.id', "'partial_refund'") }, 'r.returned_minor > 0', row => payment(row, account.receivable, -1)),
  partial_return_cost: source('تكلفة الأصناف المرتجعة', 'retail_returns r', 'r.id', 'r.created_at', {
    amount: `(SELECT SUM(value) FROM ${returnCosts} i WHERE i.return_id = r.id AND i.disposition = 'resale')`,
    secondary: `(SELECT SUM(value) FROM ${returnCosts} i WHERE i.return_id = r.id AND i.disposition = 'quarantine')`,
    count: `(SELECT SUM(missing) FROM ${returnCosts} i WHERE i.return_id = r.id)`,
  }, '', row => reviewedCost([line(account.stock, amount(row.amount)), line(account.held, amount(row.secondary)),
    line(account.cogs, -amount(row.amount) - amount(row.secondary))], row)),
  full_return: source('مرتجع كامل', 'invoice_refunds r', 'r.id', 'r.created_at', { amount: 'r.total_minor' }, '',
    row => pair(account.returns, account.receivable, row.amount)),
  full_return_payment: source('مبلغ مردود للفاتورة', 'invoice_refunds r', 'r.id', 'r.created_at',
    { amount: 'r.returned_minor', details: tenders('r.id', "'full_refund'") }, 'r.returned_minor > 0', row => payment(row, account.receivable, -1)),
  full_return_cost: source('تكلفة المرتجع الكامل', 'invoice_refunds r', 'r.id', 'r.created_at', {
    amount: `(SELECT SUM(${saleCost}) FROM ${saleLine} WHERE i.invoice_id = r.invoice_id)`,
    count: `(SELECT SUM(${saleUnknown}) FROM ${saleLine} WHERE i.invoice_id = r.invoice_id)`,
  }, '', row => reviewedCost([line(account.stock, amount(row.amount)), line(account.cogs, -amount(row.amount))], row)),
  purchase: source('فاتورة شراء', 'purchases p', 'p.id', 'p.created_at', { amount: 'p.total_minor' }, '',
    row => pair(account.ordered, account.payable, row.amount)),
  ...purchasePayments,
  receipt: source('استلام مشتريات', 'purchase_stock_receipts r', 'r.id', 'r.created_at',
    { details: receiptDetails('r.id') }, '', row => receiptDraft(row, 1)),
  receipt_reversal: source('عكس استلام مشتريات', 'purchase_stock_reversals r', 'r.id', 'r.created_at',
    { details: receiptDetails('r.receipt_id') }, '', row => receiptDraft(row, -1)),
  vendor_return: source('إشعار دائن ومرتجع مورد', 'supplier_stock_returns r', 'r.id', 'r.created_at', {
    amount: 'r.credit_minor', secondary: 'r.unapplied_credit_minor', kind: "CASE WHEN r.disposition_review_id IS NOT NULL THEN 'held' ELSE 'stock' END",
    details: `(SELECT json_group_array(json_object('value', CASE WHEN p.tracking = 'quantity' THEN -c.cost_delta_minor
      ELSE (o.unit_cost_minor + o.landed_unit_minor) * i.quantity END))
      FROM supplier_stock_return_items i JOIN purchase_order_items o USING (purchase_id, product_id) JOIN products p ON p.id = i.product_id
      LEFT JOIN inventory_movements m ON m.supplier_stock_return_id = i.return_id AND m.product_id = i.product_id
      LEFT JOIN retail_quantity_movement_costs c ON c.movement_id = m.id WHERE i.return_id = r.id)`,
  }, '', row => {
    const values = JSON.parse(row.details ?? '[]') as { value: number | null }[];
    const value = values.reduce((total, item) => total + amount(item.value), 0);
    const credit = amount(row.amount);
    const unallocated = amount(row.secondary);
    const incomplete = values.some(item => item.value === null);
    return draft([line(account.payable, credit - unallocated), line(account.supplierCredit, unallocated),
      line(row.kind === 'held' ? account.held : account.stock, -value),
      line(incomplete ? account.costPending : account.stockLoss, value - credit)], incomplete ? 'cost_unknown' : null);
  }),
  used_acquisition: source('شراء موبايل مستعمل', 'retail_used_phone_acquisitions r', 'r.id', 'r.created_at',
    { amount: 'r.acquisition_cost_minor', kind: 'r.payment_method' }, '',
    row => pair(account.stock, row.kind === 'cash' ? account.cash : account.bank, row.amount)),
  device_restock: source('إعادة جهاز مفحوص إلى المخزون', 'retail_quarantine_resolutions r JOIN retail_return_devices q USING (return_id, device_id) JOIN retail_device_sales d USING (invoice_id, product_id, device_id)',
    'r.id', 'r.created_at', { amount: 'd.unit_cost_minor' }, '', row => pair(account.stock, account.held, row.amount)),
  device_writeoff: source('إعدام جهاز معزول', 'retail_device_disposition_reviews r JOIN retail_device_dispositions d ON d.id = r.request_id',
    'r.id', 'r.created_at', { amount: 'r.loss_minor' }, "r.decision = 'approve' AND d.disposition = 'write_off'",
    row => pair(account.stockLoss, account.held, row.amount)),
  quantity_movement: source('فرق أو هالك مخزون', 'inventory_movements m JOIN retail_quantity_movement_costs c ON c.movement_id = m.id',
    'm.id', 'm.created_at', { amount: 'c.cost_delta_minor' }, `m.source_type IN ('adjustment','damage','damage_reversal')
      AND m.purchase_stock_receipt_id IS NULL AND m.purchase_stock_reversal_id IS NULL
      AND m.supplier_stock_return_id IS NULL AND m.quarantine_resolution_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM retail_device_inventory_approvals a WHERE a.id = m.source_id)`,
    row => pair(account.stock, account.stockLoss, row.amount)),
  quantity_opening: source('تقييم رصيد مخزون افتتاحي', 'retail_quantity_opening_valuations r', 'r.id', 'r.created_at',
    { amount: 'r.value_minor' }, '', row => pair(account.stock, account.capital, row.amount)),
  serial_count: source('فرق جرد جهاز', `retail_device_count_adjustments r JOIN retail_device_inventory_approvals a ON a.id = r.approval_id
      JOIN retail_devices d ON d.id = r.device_id LEFT JOIN purchase_stock_receipts p ON p.id = d.receipt_id
      LEFT JOIN purchase_order_items o ON o.purchase_id = p.purchase_id AND o.product_id = d.product_id`,
    "r.approval_id || '/' || r.device_id", 'a.created_at', { amount: "CASE r.to_status WHEN 'available' THEN 1 ELSE -1 END * COALESCE(d.intake_cost_minor, o.unit_cost_minor + o.landed_unit_minor)" },
    '', row => pair(account.stock, account.stockLoss, row.amount)),
  serial_addition: source('إضافة أجهزة من جرد موثق', `retail_device_inventory_approvals a JOIN retail_device_inventory_reviews r ON r.id = a.review_id
      JOIN retail_devices d ON d.inventory_intake_id = r.id`, "a.id || '/' || d.id", 'a.created_at',
    { amount: 'd.intake_cost_minor', kind: 'r.kind' }, `r.source_product_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM retail_used_phone_acquisitions u WHERE u.inspection_id = r.id)`,
    row => pair(account.stock, row.kind === 'opening' ? account.capital : account.stockLoss, row.amount)),
  safe_opening: source('افتتاح خزنة', 'retail_safe_opening r', 'r.operation_id', 'r.opened_at', { amount: 'r.opening_minor' }, '',
    row => pair(account.safe, account.capital, row.amount)),
  cash_movement: source('حركة نقدية للدرج', 'retail_cash_movements m LEFT JOIN retail_safe_transfers s ON s.movement_id = m.id',
    'm.id', 'm.created_at', { amount: 'm.delta_minor', kind: "CASE WHEN s.movement_id IS NOT NULL THEN 'safe' ELSE m.kind END" },
    'NOT EXISTS (SELECT 1 FROM retail_used_phone_acquisitions u WHERE u.id = m.id)', row => {
      if (row.kind === 'safe') return pair(account.cash, account.safe, row.amount);
      if (row.kind === 'general_expense') return pair(account.cash, account.operatingExpense, row.amount);
      return draft([line(account.cash, amount(row.amount)), line(account.unclassified, -amount(row.amount))]);
    }),
  shift_variance: source('فرق درج معتمد', 'retail_shift_approvals a JOIN retail_shift_closures r USING (shift_id)', 'a.operation_id',
    'a.approved_at', { amount: 'r.observed_minor - r.expected_minor' }, '', row => pair(account.cash, account.cashDifference, row.amount)),
  settlement: source('تسوية بنكية مجمعة', 'retail_settlement_batches b', 'b.id', 'b.created_at',
    { amount: 'b.observed_minor + b.fee_minor', secondary: 'b.fee_minor', kind: 'b.method' }, '', row => settlement(row, 1)),
  settlement_single: source('مطابقة تحويل بنكي', 'retail_tender_matches m JOIN retail_tender_ledger t USING (operation_id, source, position)',
    'm.match_operation_id', 'm.matched_at', { amount: 'm.observed_delta_minor', kind: 't.method' }, '', row => settlement(row, 1)),
  settlement_reversal: source('عكس تسوية بنكية', `retail_settlement_reversals r LEFT JOIN retail_settlement_batches b ON b.id = r.settlement_id
    LEFT JOIN retail_tender_matches m ON m.match_operation_id = r.settlement_id
    LEFT JOIN retail_tender_ledger t ON t.operation_id = m.operation_id AND t.source = m.source AND t.position = m.position`,
    'r.id', 'r.created_at', { amount: 'COALESCE(b.observed_minor + b.fee_minor, m.observed_delta_minor)',
      secondary: 'b.fee_minor', kind: 'COALESCE(b.method,t.method)' }, '', row => settlement(row, -1)),
  wallet_transaction: source('حركة مزوّد محفظة', `wallet_transactions t LEFT JOIN wallet_transactions o ON o.id = t.reversal_of
    LEFT JOIN wallet_debts d ON d.wallet_transaction_id = COALESCE(t.reversal_of, t.id)`,
    't.id', 't.created_at', { amount: 't.delta_minor', secondary: 't.cash_delta_minor', kind: walletOriginal, details: walletDetails },
    'NOT EXISTS (SELECT 1 FROM wallet_profit_withdrawals w WHERE w.id = t.id AND w.wallet_id = t.wallet_id)', walletTransaction),
  wallet_payment: source('تحصيل آجل المحفظة', 'wallet_debt_payments t LEFT JOIN retail_wallet_drawer s ON s.operation_id = t.id',
    't.id', 't.created_at', { amount: 't.amount_minor', count: 's.operation_id IS NOT NULL' }, '',
    row => pair(row.count ? account.cash : account.walletCash, account.walletDue, row.amount)),
  wallet_cash: source('حركة نقدية لنشاط المحافظ', 'wallet_cash_entries t LEFT JOIN retail_wallet_drawer s ON s.operation_id = t.id',
    't.id', 't.created_at', { amount: 't.delta_minor', count: 's.operation_id IS NOT NULL', kind: 't.kind' }, '', walletCashEntry),
  wallet_withdrawal: source('مسحوبات من أرباح المحافظ', 'wallet_profit_withdrawals t', 't.id', 't.created_at',
    { amount: 't.amount_minor', count: 't.shared_shift_id IS NOT NULL', kind: "CASE WHEN t.wallet_id IS NOT NULL THEN 'provider' END" }, '',
    row => pair(account.ownerDraw, row.kind === 'provider' ? account.provider : row.count ? account.cash : account.walletCash, row.amount)),
  maintenance_payment: source('دفعة صيانة', 'maintenance_payments t LEFT JOIN retail_service_cash s ON s.operation_id = t.id AND s.source = \'maintenance_cash\'',
    't.id', 't.created_at', { amount: 't.amount_minor', count: 's.operation_id IS NOT NULL' }, '', row => {
      if (row.count) return pair(account.cash, account.maintenanceDeposit, row.amount);
      return draft([line(account.unclassified, amount(row.amount)), line(account.maintenanceDeposit, -amount(row.amount))]);
    }),
  // Delivery freezes price and timestamps in the maintenance state machine.
  maintenance_delivered: source('إيراد صيانة مسلّمة', 'maintenance_requests m', 'm.id', 'm.updated_at',
    { amount: 'm.price_minor' }, "m.status = 'delivered' AND m.price_minor > 0",
    row => pair(account.maintenanceDeposit, account.maintenanceIncome, row.amount)),
};

export const ledgerSourceNames = Object.fromEntries(Object.entries(sourceRules).map(([key, rule]) => [key, rule.description]));

export async function pendingLedgerSources(db: D1Database, start: number, stop: number, limit: number, day: (time: Date) => string) {
  const rules = Object.entries(sourceRules);
  const queries: D1PreparedStatement[] = [];
  // Limit the number of D1 statements per Worker request. Each arm retains its own range and cap.
  for (let offset = 0; offset < rules.length; offset += 4) {
    const group = rules.slice(offset, offset + 4);
    const query = group.map(([, rule]) => `SELECT * FROM (${rule.query})`).join(' UNION ALL ');
    queries.push(db.prepare(`SELECT * FROM (${query}) ORDER BY occurred, source, ref LIMIT ?`)
      .bind(...group.flatMap(([key]) => [key, start, stop, key, limit]), limit));
  }
  const groups = await db.batch<SourceRow>(queries);
  return groups.flatMap(group => group.results)
    .sort((a, b) => a.occurred - b.occurred || a.source.localeCompare(b.source) || a.ref.localeCompare(b.ref))
    .slice(0, limit).map(row => ({
      source: row.source, source_ref: row.ref, posting_day: day(new Date(row.occurred * 1000)),
      description: sourceRules[row.source].description, ...sourceRules[row.source].draft(row),
    }));
}
