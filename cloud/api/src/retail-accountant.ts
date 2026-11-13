import { Hono } from 'hono';
import { z } from 'zod';
import { csvCell } from './csv';
import { fail, permit, searchPrefix, selectPage, type ApiEnv } from './http';
import { retailDateRange } from './retail-sales-report';
import { cairoDayBoundary } from './retail-shifts';

export const retailAccountantPermissions = ['retail.audit.view', 'retail.accountant.export'];
export const retailAccountant = new Hono<ApiEnv>();

function bounds(from: string, to: string) {
  const stop = new Date(Date.parse(to) + 86_400_000).toISOString().slice(0, 10);
  const timestamp = (date: string) => new Date(cairoDayBoundary(date) * 1000).toISOString().slice(0, 19);
  return [timestamp(from), timestamp(stop)];
}

retailAccountant.get('/retail/audit', permit('retail.audit.view'), c => {
  const { from, to } = retailDateRange(c);
  const query = z.string().trim().max(100).parse(c.req.query('q') ?? '');
  const range = bounds(from, to);
  const conditions = ["substr(replace(a.created_at, ' ', 'T'), 1, 19) >= ?", "substr(replace(a.created_at, ' ', 'T'), 1, 19) < ?"];
  if (query) {
    conditions.push("(u.name LIKE ? ESCAPE '\\' OR a.action LIKE ? ESCAPE '\\' OR a.entity_type LIKE ? ESCAPE '\\' OR CAST(a.entity_id AS TEXT) = ?)");
    range.push(searchPrefix(query), searchPrefix(query), searchPrefix(query), query.replace(/^#/, ''));
  }
  return selectPage(c, 'a.id, a.actor_id, u.name AS actor_name, a.action, a.entity_type, a.entity_id, a.created_at',
    'audit_logs a LEFT JOIN users u ON u.id = a.actor_id', 'WHERE ' + conditions.join(' AND '), range, 'a.id DESC');
});

retailAccountant.get('/retail/accountant.csv', permit('retail.accountant.export'), async c => {
  const { from, to } = retailDateRange(c);
  const [start, stop] = bounds(from, to);
  const db = c.env.DB;
  type Movement = { record_type: string; record_id: number; kind: string; method: string | null; delta_minor: number;
    shift_id: number | null; invoice_id: number | null; reference: string | null; created_at: string };
  const tender = `
      SELECT 'tender' AS record_type, operation_id AS record_id, source AS kind, method, delta_minor,
        shift_id, invoice_id, reference, created_at FROM retail_tender_ledger
      UNION ALL SELECT 'manual_drawer', m.id, m.kind, 'cash', m.delta_minor, m.shift_id, NULL, m.reference, m.created_at
        FROM retail_cash_movements m WHERE NOT EXISTS (SELECT 1 FROM retail_used_phone_acquisitions a WHERE a.id = m.id)
      UNION ALL SELECT 'shared_drawer', operation_id, source, 'cash', delta_minor, shift_id, NULL, NULL, created_at
        FROM retail_drawer_service_ledger
      UNION ALL SELECT 'shift_open', id, 'opening_float', 'cash', opening_minor, id, NULL, register_name, opened_at
        FROM retail_shifts`;
  const documents = `
      SELECT 'sales_document' AS record_type, id AS record_id, 'invoice' AS kind, NULL AS method, total_minor AS delta_minor,
        NULL AS shift_id, id AS invoice_id, NULL AS reference, created_at FROM invoices
      UNION ALL SELECT 'sales_document', id, 'full_refund', NULL, -total_minor, NULL, invoice_id, NULL, created_at FROM invoice_refunds
      UNION ALL SELECT 'sales_document', id, 'partial_refund', NULL, -total_minor, NULL, invoice_id, NULL, created_at FROM retail_returns
      UNION ALL SELECT 'supplier_document', id, 'purchase', NULL, total_minor, NULL, NULL, reference, created_at FROM purchases
      UNION ALL SELECT 'supplier_document', id, 'supplier_credit', NULL, -credit_minor, NULL, NULL,
        COALESCE(vendor_reference, CAST(purchase_id AS TEXT)), created_at FROM supplier_stock_returns`;
  const usedAcquisitions = `SELECT 'inventory_acquisition' AS record_type, id AS record_id, 'used_phone_purchase' AS kind,
    payment_method AS method, -acquisition_cost_minor AS delta_minor, shift_id, NULL AS invoice_id,
    COALESCE(payment_reference, 'USED-' || id) AS reference, created_at FROM retail_used_phone_acquisitions`;
  const dispositions = `
      SELECT 'supplier_credit_allocation' AS record_type, id AS record_id, 'unapplied_vendor_credit' AS kind, NULL AS method,
        unapplied_credit_minor AS delta_minor, NULL AS shift_id, NULL AS invoice_id,
        vendor_reference, created_at FROM supplier_stock_returns WHERE unapplied_credit_minor > 0
      UNION ALL SELECT 'inventory_loss', a.id,
        CASE WHEN a.loss_minor IS NULL THEN 'device_write_off_cost_unknown' ELSE 'device_write_off' END,
        NULL, -COALESCE(a.loss_minor, 0), NULL, r.invoice_id, CAST(q.device_id AS TEXT), a.created_at
        FROM retail_device_disposition_reviews a JOIN retail_device_dispositions q ON q.id = a.request_id
        JOIN retail_return_devices r USING (return_id, device_id)
        WHERE a.decision = 'approve' AND q.disposition = 'write_off'`;
  const legacy = `
      SELECT 'legacy_tender' AS record_type, p.id AS record_id, 'invoice_payment' AS kind, 'unclassified' AS method,
        p.amount_minor AS delta_minor, NULL AS shift_id, p.invoice_id, NULL AS reference, p.created_at
        FROM invoice_payments p WHERE NOT EXISTS (SELECT 1 FROM retail_tender_ledger t WHERE t.operation_id = p.id
          AND t.source = CASE WHEN p.source_type = 'installment' THEN 'installment_payment' ELSE 'invoice_payment' END)
      UNION ALL SELECT 'legacy_tender', r.id, 'full_refund', 'unclassified', -r.returned_minor, NULL, r.invoice_id, NULL, r.created_at
        FROM invoice_refunds r WHERE r.returned_minor > 0 AND NOT EXISTS (SELECT 1 FROM retail_tender_ledger t WHERE t.operation_id = r.id AND t.source = 'full_refund')
      UNION ALL SELECT 'legacy_tender', r.id, 'partial_refund', 'unclassified', -r.returned_minor, NULL, r.invoice_id, NULL, r.created_at
        FROM retail_returns r WHERE r.returned_minor > 0 AND NOT EXISTS (SELECT 1 FROM retail_tender_ledger t WHERE t.operation_id = r.id AND t.source = 'partial_refund')`;
  // D1 caps terms per compound SELECT. Keep bounded reads in the same snapshot.
  const settlements = `SELECT 'tender_settlement' AS record_type, b.id AS record_id, 'settlement_fee' AS kind, b.method,
      -b.fee_minor AS delta_minor, NULL AS shift_id, NULL AS invoice_id, b.statement_reference AS reference, b.created_at
      FROM retail_settlement_batches b WHERE b.fee_minor > 0
    UNION ALL SELECT 'tender_settlement', r.id, 'settlement_fee_reversal', b.method, b.fee_minor, NULL, NULL, b.statement_reference, r.created_at
      FROM retail_settlement_reversals r JOIN retail_settlement_batches b ON b.id = r.settlement_id WHERE b.fee_minor > 0`;
  const groups = await db.batch<Movement>([tender, documents, usedAcquisitions, legacy, dispositions, settlements].map(query => db.prepare(`
    SELECT * FROM (${query})
    WHERE substr(replace(created_at, ' ', 'T'), 1, 19) >= ? AND substr(replace(created_at, ' ', 'T'), 1, 19) < ?
    ORDER BY created_at, record_type, record_id, method LIMIT 5001
  `).bind(start, stop)));
  const results = groups.flatMap(group => group.results).sort((a, b) => a.created_at.localeCompare(b.created_at) ||
    a.record_type.localeCompare(b.record_type) || a.record_id - b.record_id || (a.method ?? '').localeCompare(b.method ?? ''));
  if (results.length > 5000) return fail(422, 'RETAIL_EXPORT_LIMIT', 'اختر فترة أصغر لتصدير ٥٬٠٠٠ سجل أو أقل.');
  const header = 'record_type,record_id,kind,method,amount_egp,shift_id,invoice_id,reference,posted_at_utc';
  const format = (amount: number) => {
    const value = BigInt(amount); const absolute = value < 0n ? -value : value;
    return (value < 0n ? '-' : '') + String(absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0');
  };
  const lines = results.map(row => [csvCell(row.record_type), csvCell(row.record_id), csvCell(row.kind), csvCell(row.method),
    format(row.delta_minor), csvCell(row.shift_id), csvCell(row.invoice_id), csvCell(row.reference), csvCell(row.created_at)].join(','));
  return new Response('\uFEFF' + [header, ...lines].join('\r\n') + '\r\n', { headers: {
    'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="hilal-retail-accountant-${from}-${to}.csv"`,
  } });
});
