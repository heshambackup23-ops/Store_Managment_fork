import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { auditedWrite, body, fail, hasPermission, identifier, ok, permit, selectPage, type ApiContext, type ApiEnv } from './http';

const maxMinor = 900_000_000_000_000;
const maxBookMinor = 8_000_000_000_000_000;
const amount = z.number().int().min(0).max(maxMinor);
const reason = z.string().trim().max(1000).refine(value => !value.includes('\0'));
const methods = ['cash', 'card', 'wallet', 'bank_transfer'] as const;
const statuses = ['open', 'closed', 'pending_approval', 'approved'] as const;
const operates = 'retail.shifts.operate';
const approves = 'retail.shifts.approve';
const closesInEmergency = 'retail.shifts.emergency_close';
const managesCash = 'retail.cash.manage';
export const retailPermissions = [operates, approves, closesInEmergency, managesCash];
const cashMovementKinds = ['safe_deposit', 'safe_withdrawal', 'general_expense'] as const;

export const retailPayments = z.array(z.strictObject({
  method: z.enum(methods), amount_minor: amount.min(1),
  reference: z.string().trim().max(100).refine(value => !value.includes('\0')).optional(),
})).max(16);
export const retailTenderInput = { shift_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(), payments: retailPayments.optional() };

type TenderData = { shift_id?: number; payments?: z.infer<typeof retailPayments> };
type Bind = string | number | null;
const sources = {
  invoice_payment: { table: 'invoice_payments', amount: 'amount_minor', invoice: 'invoice_id' },
  installment_payment: { table: 'installment_payments', amount: 'amount_minor', invoice: '(SELECT invoice_id FROM installments WHERE id = p.installment_id)' },
  full_refund: { table: 'invoice_refunds', amount: 'returned_minor', invoice: 'invoice_id' },
  partial_refund: { table: 'retail_returns', amount: 'returned_minor', invoice: 'invoice_id' },
  supplier_payment: { table: 'supplier_payments', amount: 'amount_minor', invoice: 'NULL' },
  supplier_receipt: { table: 'supplier_receipts', amount: 'amount_minor', invoice: 'NULL' },
} as const;
type Source = keyof typeof sources;
export const retailTenderSource = z.enum(Object.keys(sources) as Source[]);

const clock = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });
export function cairoRetailDay(time = new Date()) {
  const parts = clock.formatToParts(time);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-');
}

export function cairoDayBoundary(day: string) {
  const midnight = Date.parse(day + 'T00:00:00Z');
  let low = midnight - 12 * 3_600_000;
  let high = midnight + 12 * 3_600_000;
  while (high - low > 60_000) {
    const middle = Math.floor((low + high) / 120_000) * 60_000;
    if (cairoRetailDay(new Date(middle)) < day) low = middle;
    else high = middle;
  }
  return high / 1000;
}

export function retailTenderStatements(db: D1Database, operation: string, binds: Bind[], actor: number, source: Source, data: TenderData) {
  const { table, amount: amountColumn, invoice } = sources[source];
  if (data.payments !== undefined && data.shift_id === undefined) {
    fail(422, 'RETAIL_SHIFT_REQUIRED', 'اختر وردية مفتوحة قبل تسجيل وسائل السداد.');
  }
  return [db.prepare(`
    WITH operation AS (SELECT ${operation} AS id)
    INSERT INTO retail_tender_batches(operation_id, source, shift_id, actor_id, invoice_id, amount_minor, payments_json)
    SELECT operation.id, ?, ?, ?, ${invoice}, COALESCE(p.${amountColumn}, 0), ?
    FROM operation LEFT JOIN ${table} p ON p.id = operation.id
    WHERE p.id IS NOT NULL OR ? IS NOT NULL
  `).bind(...binds, source, data.shift_id ?? null, actor, JSON.stringify(data.payments ?? []), data.shift_id ?? null)];
}

function shiftScope(c: ApiContext) {
  const actor = c.get('actor');
  if (hasPermission(actor, approves) || hasPermission(actor, closesInEmergency)) return { clause: '', values: [] };
  if (hasPermission(actor, operates)) return { clause: ' AND s.actor_id = ?', values: [actor.id] };
  return fail(403, 'forbidden', 'ليست لديك صلاحية لعرض الورديات.');
}

async function shiftDetail(c: ApiContext, id: number, status: 200 | 201 = 200) {
  const scope = shiftScope(c);
  const db = c.env.DB;
  const [shifts, sums, cashMovements] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT s.*, r.branch_id, b.name AS branch_name FROM retail_shift_positions s
      JOIN retail_shifts r ON r.id = s.id JOIN retail_branches b ON b.id = r.branch_id
      WHERE s.id = ?` + scope.clause).bind(id, ...scope.values),
    db.prepare(`SELECT method,
      SUM(CASE WHEN delta_minor > 0 THEN delta_minor ELSE 0 END) AS received_minor,
      SUM(CASE WHEN delta_minor < 0 THEN -delta_minor ELSE 0 END) AS paid_out_minor
      FROM retail_tender_ledger t JOIN retail_shifts s ON s.id = t.shift_id WHERE s.id = ?${scope.clause}
      GROUP BY method`).bind(id, ...scope.values),
    db.prepare(`SELECT m.kind, SUM(m.amount_minor) AS amount_minor
      FROM retail_cash_movements m JOIN retail_shifts s ON s.id = m.shift_id WHERE s.id = ?${scope.clause}
      GROUP BY m.kind`).bind(id, ...scope.values),
  ]);
  const shift = shifts.results[0];
  if (!shift) return fail(404, 'RETAIL_SHIFT_NOT_FOUND', 'الوردية المطلوبة غير موجودة.');
  const totals = methods.map(method => sums.results.find(row => row.method === method) ?? { method, received_minor: 0, paid_out_minor: 0 });
  const cash_movement_totals = cashMovementKinds.map(kind => cashMovements.results.find(row => row.kind === kind) ?? { kind, amount_minor: 0 });
  return ok(c, { ...shift, totals, cash_movement_totals }, status);
}

const openInput = z.strictObject({
  register_name: z.string().trim().min(1).max(80).refine(value => !value.includes('\0')),
  opening_minor: amount,
  branch_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});
const closeInput = z.strictObject({
  observed_minor: amount,
  expected_minor: z.number().int().min(-maxBookMinor).max(maxBookMinor).optional(),
  reason: reason.default(''),
});
const emergencyCloseInput = closeInput.extend({
  expected_minor: z.number().int().min(-maxBookMinor).max(maxBookMinor),
  reason: reason.min(1),
});
const approvalInput = z.strictObject({ reason: reason.refine(value => value.length > 0) });
const movementInput = z.strictObject({
  kind: z.enum(cashMovementKinds),
  amount_minor: amount.min(1),
  reason: reason.refine(value => value.length > 0),
  reference: z.string().trim().min(1).max(100).regex(/^[^\p{Cc}\p{Cf}]+$/u).optional(),
});
const settingsInput = z.strictObject({ require_shift: z.boolean() });

export function retailShifts(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();

  routes.get('/retail/settings', async c => {
    const current = await c.env.DB.prepare('SELECT retail_require_shift FROM settings WHERE id = 1').first<number>('retail_require_shift');
    return ok(c, { require_shift: current === 1 });
  });

  routes.patch('/retail/settings', permit('settings.update'), async c => {
    const data = await body(c, settingsInput);
    const statement = c.env.DB.prepare('UPDATE settings SET retail_require_shift = ? WHERE id = 1').bind(Number(data.require_shift));
    await auditedWrite(c, statement, 'retail.settings.update', 'settings', 1);
    return ok(c, data);
  });

  routes.get('/retail/shifts', c => {
    const scope = shiftScope(c);
    const status = z.enum(statuses).optional().parse(c.req.query('status'));
    return selectPage(c, 's.*, r.branch_id, b.name AS branch_name',
      'retail_shift_positions s JOIN retail_shifts r ON r.id = s.id JOIN retail_branches b ON b.id = r.branch_id',
      'WHERE 1 = 1' + scope.clause + (status ? ' AND s.status = ?' : ''),
      [...scope.values, ...(status ? [status] : [])], 's.id DESC');
  });

  routes.get('/retail/shifts/:id', c => shiftDetail(c, identifier.parse(c.req.param('id'))));

  routes.get('/retail/shifts/:id/cash-movements', async c => {
    const shiftId = identifier.parse(c.req.param('id'));
    const scope = shiftScope(c);
    const values = [shiftId, ...scope.values];
    const where = 'WHERE s.id = ?' + scope.clause;
    const visible = await c.env.DB.prepare(`SELECT s.id FROM retail_shifts s ${where}`).bind(...values).first();
    if (!visible) return fail(404, 'RETAIL_SHIFT_NOT_FOUND', 'الوردية المطلوبة غير موجودة.');
    return selectPage(c, 'm.*', 'retail_cash_movements m JOIN retail_shifts s ON s.id = m.shift_id', where, values, 'm.id DESC');
  });

  routes.post('/retail/shifts/:id/cash-movements', permit(operates), permit(managesCash), async c => {
    const shiftId = identifier.parse(c.req.param('id'));
    const data = await body(c, movementInput);
    const now = new Date().toISOString();
    const db = c.env.DB;
    return writeOperation(c, 'retail.shift.cash.' + data.kind, { shiftId, ...data }, (op, binds, actor) => [
      db.prepare(`INSERT INTO retail_cash_movements(id, shift_id, kind, amount_minor, reason, reference, actor_id, actor_name, created_at)
        VALUES (${op}, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...binds, shiftId, data.kind, data.amount_minor, data.reason, data.reference ?? null, actor, c.get('actor').name, now),
    ], async id => ok(c, await db.prepare('SELECT * FROM retail_cash_movements WHERE id = ?').bind(id).first(), 201));
  });

  routes.post('/retail/shifts', permit(operates), async c => {
    const data = await body(c, openInput);
    data.register_name = data.register_name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (!data.register_name || data.register_name.length > 80) {
      return fail(422, 'RETAIL_REGISTER_NAME', 'أدخل اسم درج صالحًا لا يزيد على ٨٠ حرفًا.');
    }
    const now = new Date();
    return writeOperation(c, 'retail.shift.open', data, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_shifts(id, register_name, actor_id, actor_name, opening_minor, business_day, opened_at, branch_id)
        VALUES (${op}, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...binds, data.register_name, actor, c.get('actor').name, data.opening_minor, cairoRetailDay(now), now.toISOString(), data.branch_id ?? 1),
    ], shiftId => shiftDetail(c, shiftId, 201));
  });

  routes.post('/retail/shifts/:id/close', permit(operates), async c => {
    const shiftId = identifier.parse(c.req.param('id'));
    const data = await body(c, closeInput);
    const now = new Date().toISOString();
    return writeOperation(c, 'retail.shift.close', { shiftId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_shift_closures(shift_id, operation_id, closed_by, expected_minor, observed_minor, close_reason, closed_at)
        VALUES (?, ${op}, ?, COALESCE(?, (SELECT expected_minor FROM retail_shift_positions WHERE id = ?), 0), ?, ?, ?)`)
        .bind(shiftId, ...binds, actor, data.expected_minor ?? null, shiftId, data.observed_minor, data.reason, now),
    ], () => shiftDetail(c, shiftId, 201));
  });

  routes.post('/retail/shifts/:id/emergency-close', permit(closesInEmergency), async c => {
    const shiftId = identifier.parse(c.req.param('id'));
    const data = await body(c, emergencyCloseInput);
    const now = new Date().toISOString();
    return writeOperation(c, 'retail.shift.emergency_close', { shiftId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_shift_closures(shift_id, operation_id, closed_by, expected_minor,
        observed_minor, close_reason, closed_at, emergency_close) VALUES (?, ${op}, ?, ?, ?, ?, ?, 1)`)
        .bind(shiftId, ...binds, actor, data.expected_minor, data.observed_minor, data.reason, now),
    ], () => shiftDetail(c, shiftId, 201));
  });

  routes.post('/retail/shifts/:id/approve', permit(approves), async c => {
    const shiftId = identifier.parse(c.req.param('id'));
    const data = await body(c, approvalInput);
    const now = new Date().toISOString();
    return writeOperation(c, 'retail.shift.approve', { shiftId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_shift_approvals(shift_id, operation_id, approved_by, approval_reason, approved_at)
        VALUES (?, ${op}, ?, ?, ?)`)
        .bind(shiftId, ...binds, actor, data.reason, now),
    ], () => shiftDetail(c, shiftId, 201));
  });

  return routes;
}
