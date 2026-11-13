import { Hono } from 'hono';
import { instaPayReferencePrefix } from '../../shared/payment-channel';
import { z } from 'zod';
import { body, fail, hasPermission, identifier, ok, page, permit, type ApiContext, type ApiEnv } from './http';
import type { write } from './business';
import { retailDateRange } from './retail-sales-report';
import { cairoDayBoundary, cairoRetailDay, retailTenderSource } from './retail-shifts';

export const retailFinanceReports = new Hono<ApiEnv>();
const sides = z.enum(['receivable', 'payable']);
type Side = z.infer<typeof sides>;
type Source = { key: string; permission: string; sides: Side[]; sql: string };

function debtSources(seeInstallments: boolean): Source[] {
  return [
    {
      key: 'invoice', permission: 'invoices.view', sides: ['receivable'],
      sql: `SELECT i.id, c.name AS party, COALESCE(i.invoice_date, date(i.created_at)) AS document_date,
        i.due_date, i.outstanding_minor
      FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.outstanding_minor > 0
      ${seeInstallments ? 'AND NOT EXISTS (SELECT 1 FROM installments a WHERE a.invoice_id = i.id AND a.voided_at IS NULL)' : ''}`,
    },
    {
      key: 'installment', permission: 'installments.view', sides: ['receivable'],
      sql: `SELECT a.id, c.name AS party, date(a.created_at) AS document_date, a.due_date,
        a.net_principal_minor - a.paid_minor AS outstanding_minor
      FROM installments a JOIN customers c ON c.id = a.customer_id WHERE a.voided_at IS NULL AND a.net_principal_minor > a.paid_minor`,
    },
    {
      key: 'personal_debt', permission: 'debts.view', sides: ['receivable', 'payable'],
      sql: `SELECT d.id, COALESCE(c.name, d.person_name) AS party, date(d.created_at) AS document_date, d.due_date,
        d.principal_minor - d.paid_minor AS outstanding_minor
      FROM personal_debts d LEFT JOIN customers c ON c.id = d.customer_id
      WHERE d.direction = ?2 AND d.principal_minor > d.paid_minor AND NOT EXISTS (SELECT 1 FROM debt_voids v WHERE v.debt_id = d.id)`,
    },
    {
      key: 'wallet_debt', permission: 'wallets.view', sides: ['receivable', 'payable'],
      sql: `SELECT w.id, c.name AS party, date(w.created_at) AS document_date, w.due_date,
        w.principal_minor - w.paid_minor AS outstanding_minor
      FROM wallet_debts w JOIN customers c ON c.id = w.customer_id
      WHERE w.direction = ?2 AND w.voided_at IS NULL AND w.principal_minor > w.paid_minor`,
    },
    {
      key: 'maintenance', permission: 'maintenance.view', sides: ['receivable'],
      sql: `SELECT m.id, COALESCE(c.name, m.customer_name) AS party, m.requested_date AS document_date, NULL AS due_date,
        m.price_minor - m.paid_minor AS outstanding_minor
      FROM maintenance_requests m LEFT JOIN customers c ON c.id = m.customer_id
      WHERE m.archived_at IS NULL AND m.status <> 'cancelled' AND m.price_minor > m.paid_minor`,
    },
    {
      key: 'purchase', permission: 'suppliers.view', sides: ['payable'],
      sql: `SELECT p.id, s.name AS party, p.purchase_date AS document_date, p.due_date,
        p.net_total_minor - p.paid_minor AS outstanding_minor
      FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE p.net_total_minor > p.paid_minor`,
    },
    {
      key: 'supplier_opening', permission: 'suppliers.view', sides: ['payable'],
      sql: `SELECT id, name AS party, NULL AS document_date, NULL AS due_date,
        opening_minor - opening_paid_minor AS outstanding_minor
      FROM supplier_balances WHERE opening_minor > opening_paid_minor`,
    },
  ];
}

const agingBuckets = ['undated', 'not_due', 'overdue_1_30', 'overdue_31_60', 'overdue_61_90', 'overdue_90_plus'];
function reportPage(c: ApiContext, data: Record<string, unknown>, total: number, paging: ReturnType<typeof page>) {
  return c.json({ success: true, data, meta: {
    page: paging.page, current_page: paging.page, per_page: paging.limit, total, last_page: Math.max(1, Math.ceil(total / paging.limit)),
  } });
}

retailFinanceReports.get('/reports/aging', permit('reports.view'), async c => {
  const actor = c.get('actor');
  const side = sides.parse(c.req.query('side') ?? 'receivable');
  const asOf = cairoRetailDay();
  const paging = page(c);
  const sources = debtSources(hasPermission(actor, 'installments.view'))
    .filter(source => source.sides.includes(side) && hasPermission(actor, source.permission));
  if (!sources.length) return fail(403, 'forbidden', 'لا توجد صلاحية لعرض مصادر الذمم لهذا التقرير.');

  const entries = sources.map(({ key, sql }) => `SELECT '${key}' AS source, x.* FROM (${sql}) x`).join(' UNION ALL ');
  const withBuckets = `WITH params AS (SELECT ?1 AS as_of, ?2 AS side), entries AS (${entries}),
    aged AS (SELECT *, CAST(julianday((SELECT as_of FROM params)) - julianday(due_date) AS INTEGER) AS overdue_days FROM entries),
    grouped AS (SELECT *, CASE WHEN overdue_days IS NULL THEN 'undated' WHEN overdue_days <= 0 THEN 'not_due'
      WHEN overdue_days <= 30 THEN 'overdue_1_30' WHEN overdue_days <= 60 THEN 'overdue_31_60'
      WHEN overdue_days <= 90 THEN 'overdue_61_90' ELSE 'overdue_90_plus' END AS bucket FROM aged)`;
  const db = c.env.DB;
  const [items, sums] = await db.batch<Record<string, unknown>>([
    db.prepare(`${withBuckets} SELECT source, id, party, document_date, due_date, outstanding_minor, bucket
      FROM grouped ORDER BY due_date IS NULL, due_date, outstanding_minor DESC, source, id LIMIT ?3 OFFSET ?4`)
      .bind(asOf, side, paging.limit, paging.offset),
    db.prepare(`${withBuckets} SELECT bucket, SUM(outstanding_minor) AS amount_minor, COUNT(*) AS count FROM grouped GROUP BY bucket`)
      .bind(asOf, side),
  ]);
  const totals = Object.fromEntries(agingBuckets.map(bucket => [bucket, Number(sums.results.find(row => row.bucket === bucket)?.amount_minor ?? 0)]));
  return reportPage(c, { as_of: asOf, side, visible_sources: sources.map(source => source.key), totals, items: items.results },
    sums.results.reduce((total, row) => total + Number(row.count), 0), paging);
});

const nonCashMethods = ['card', 'wallet', 'bank_transfer'] as const;
const settlementQuery = z.object({ method: z.enum(nonCashMethods).optional(), shift_id: identifier.optional(),
  status: z.enum(['pending', 'matched']).optional(), channel: z.literal('instapay').optional(),
}).refine(query => query.channel !== 'instapay' || !query.method || query.method === 'bank_transfer');
const timestampBoundary = (day: string) => new Date(cairoDayBoundary(day) * 1000).toISOString().slice(0, 19).replace('T', ' ');

retailFinanceReports.get('/reports/tender-settlements', permit('reports.view'), permit('retail.shifts.approve'), async c => {
  const { from, to } = retailDateRange(c);
  const stopDay = new Date(Date.parse(to) + 86_400_000).toISOString().slice(0, 10);
  const { method: requestedMethod, shift_id: shiftId, status, channel } = settlementQuery.parse(c.req.query());
  const method = channel === 'instapay' ? 'bank_transfer' : requestedMethod;
  const paging = page(c);
  const clauses = ["t.method <> 'cash'", 't.created_at >= ?', 't.created_at < ?'];
  const values: (number | string)[] = [timestampBoundary(from), timestampBoundary(stopDay)];
  if (method) { clauses.push('t.method = ?'); values.push(method); }
  if (channel === 'instapay') {
    clauses.push('substr(t.reference, 1, ?) = ? AND length(t.reference) > ?');
    values.push(instaPayReferencePrefix.length, instaPayReferencePrefix, instaPayReferencePrefix.length);
  }
  if (shiftId) { clauses.push('t.shift_id = ?'); values.push(shiftId); }
  if (status) clauses.push(status === 'matched' ? 'm.operation_id IS NOT NULL' : 'm.operation_id IS NULL');
  const entries = `FROM retail_tender_ledger t JOIN retail_shifts s ON s.id = t.shift_id
    LEFT JOIN retail_active_tender_matches m USING (operation_id, source, position) WHERE ${clauses.join(' AND ')}`;
  const db = c.env.DB;
  const [items, sums] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT t.operation_id, t.source, t.position, t.method, t.amount_minor, t.delta_minor, t.reference,
      t.shift_id, t.invoice_id, t.actor_id, t.created_at, s.register_name,
      CASE WHEN m.operation_id IS NULL THEN 'pending' ELSE 'matched' END AS settlement_status,
      m.settlement_id, m.settlement_type, m.observed_delta_minor, m.statement_reference, m.statement_date, m.matched_by, m.matched_at ${entries}
      ORDER BY t.operation_id DESC, t.source, t.position LIMIT ? OFFSET ?`).bind(...values, paging.limit, paging.offset),
    db.prepare(`SELECT t.method, SUM(CASE WHEN delta_minor > 0 THEN delta_minor ELSE 0 END) AS received_minor,
      SUM(CASE WHEN delta_minor < 0 THEN -delta_minor ELSE 0 END) AS paid_out_minor, SUM(delta_minor) AS net_minor,
      SUM(CASE WHEN reference IS NULL OR trim(reference) = '' THEN 1 ELSE 0 END) AS unreferenced, COUNT(*) AS count,
      COUNT(m.operation_id) AS matched_count, COUNT(*) - COUNT(m.operation_id) AS pending_count
      ${entries} GROUP BY t.method`).bind(...values),
  ]);
  const totals = (method ? [method] : nonCashMethods).map(name => {
    const row = sums.results.find(row => row.method === name);
    return { method: name, received_minor: Number(row?.received_minor ?? 0), paid_out_minor: Number(row?.paid_out_minor ?? 0),
      net_minor: Number(row?.net_minor ?? 0), unreferenced: Number(row?.unreferenced ?? 0),
      matched_count: Number(row?.matched_count ?? 0), pending_count: Number(row?.pending_count ?? 0) };
  });
  return reportPage(c, { from, to, timezone: 'Africa/Cairo', totals, items: items.results },
    sums.results.reduce((total, row) => total + Number(row.count), 0), paging);
});

const matchInput = z.strictObject({
  operation_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  source: retailTenderSource,
  position: z.number().int().min(0).max(15),
  observed_delta_minor: z.number().int().min(-900_000_000_000_000).max(900_000_000_000_000).refine(amount => amount !== 0),
  statement_reference: z.string().trim().min(1).max(100).regex(/^[^\p{Cc}\p{Cf}]+$/u),
  statement_date: z.iso.date(),
});
const batchInput = matchInput.pick({ statement_reference: true, statement_date: true }).extend({
  method: z.enum(nonCashMethods),
  fee_minor: z.number().int().min(0).max(900_000_000_000_000),
  observed_minor: z.number().int().min(-900_000_000_000_000).max(900_000_000_000_000),
  items: z.array(matchInput.pick({ operation_id: true, source: true, position: true })).min(1).max(40),
});

export function retailTenderMatch(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();
  routes.post('/reports/tender-settlements/batches', permit('reports.view'), permit('retail.shifts.approve'), async c => {
    const data = await body(c, batchInput);
    if (data.statement_date > cairoRetailDay()) return fail(422, 'RETAIL_TENDER_STATEMENT_DATE', 'أدخل تاريخًا من كشف الحساب حتى اليوم.');
    return writeOperation(c, 'retail.tender.batch', data, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_settlement_batches(id, method, statement_reference, statement_date,
        fee_minor, observed_minor, items_json, actor_id) VALUES (${op}, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...binds, data.method, data.statement_reference, data.statement_date, data.fee_minor, data.observed_minor,
          JSON.stringify(data.items), actor),
    ]);
  });
  routes.post('/reports/tender-settlements/:id/reverse', permit('reports.view'), permit('retail.shifts.approve'), async c => {
    const settlement = identifier.parse(c.req.param('id'));
    const { reason } = await body(c, z.strictObject({ reason: z.string().trim().min(1).max(1000) }));
    return writeOperation(c, 'retail.tender.reverse', { settlement, reason }, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_settlement_reversals(id, settlement_id, reason, actor_id) VALUES (${op}, ?, ?, ?)`)
        .bind(...binds, settlement, reason, actor),
    ]);
  });
  routes.post('/reports/tender-settlements/match', permit('reports.view'), permit('retail.shifts.approve'), async c => {
    const data = await body(c, matchInput);
    if (data.statement_date > cairoRetailDay()) return fail(422, 'RETAIL_TENDER_STATEMENT_DATE', 'أدخل تاريخًا من كشف الحساب حتى اليوم.');
    const db = c.env.DB;
    const now = new Date().toISOString();
    return writeOperation(c, 'retail.tender.match', data, (op, binds, actor) => [
      db.prepare(`INSERT INTO retail_tender_matches(operation_id, source, position, match_operation_id,
        observed_delta_minor, statement_reference, statement_date, matched_by, matched_at)
        VALUES (?, ?, ?, ${op}, ?, ?, ?, ?, ?)`)
        .bind(data.operation_id, data.source, data.position, ...binds, data.observed_delta_minor,
          data.statement_reference, data.statement_date, actor, now),
    ], async id => ok(c, await db.prepare('SELECT * FROM retail_tender_matches WHERE match_operation_id = ?').bind(id).first(), 201));
  });
  return routes;
}
