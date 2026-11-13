import { Hono, type MiddlewareHandler } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { body, fail, hasPermission, ok, permit, selectPage, type ApiEnv } from './http';
import { cairoRetailDay } from './retail-shifts';

export const retailSafePermission = 'retail.safe.manage';
const money = z.number().int().min(0).max(900_000_000_000_000);
const reason = z.string().trim().max(1000).refine(value => !value.includes('\0'));
const openingInput = z.strictObject({ opening_minor: money, reason: reason.refine(value => value.length > 0) });
const countInput = z.strictObject({
  observed_minor: money,
  expected_minor: z.number().int().min(0).max(8_000_000_000_000_000).optional(),
  reason: reason.default(''),
});
const safePositionColumns = 'opening_minor, expected_minor, opening_reason, opened_by, opened_by_name, opened_at';
const canReadSafe: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const actor = c.get('actor');
  if (!hasPermission(actor, retailSafePermission) && !hasPermission(actor, 'retail.shifts.approve')) {
    return fail(403, 'forbidden', 'ليست لديك صلاحية لعرض الخزنة.');
  }
  await next();
};

export function retailSafe(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();
  routes.get('/retail/safe', canReadSafe, async c => {
    const db = c.env.DB;
    const [positions, counts] = await db.batch<Record<string, unknown>>([
      db.prepare(`SELECT ${safePositionColumns} FROM retail_safe_position`),
      db.prepare('SELECT * FROM retail_safe_counts ORDER BY id DESC LIMIT 1'),
    ]);
    const position = positions.results[0];
    return ok(c, {
      active: Boolean(position),
      opening_minor: null, expected_minor: null, opening_reason: null,
      opened_by: null, opened_by_name: null, opened_at: null,
      ...position, latest_count: counts.results[0] ?? null,
    });
  });

  routes.get('/retail/safe/counts', canReadSafe, c => selectPage(c, '*', 'retail_safe_counts', '', [], 'id DESC'));
  routes.get('/retail/safe/movements', canReadSafe, c => selectPage(c, '*', 'retail_safe_ledger', '', [], 'id DESC'));

  routes.post('/retail/safe/open', permit(retailSafePermission), async c => {
    const data = await body(c, openingInput);
    const db = c.env.DB;
    const now = new Date().toISOString();
    return writeOperation(c, 'retail.safe.open', data, (op, binds, actor) => [
      db.prepare(`INSERT INTO retail_safe_opening(id, operation_id, opening_minor, opening_reason, opened_by, opened_by_name, opened_at)
        VALUES (1, ${op}, ?, ?, ?, ?, ?)`)
        .bind(...binds, data.opening_minor, data.reason, actor, c.get('actor').name, now),
    ], async id => ok(c, await db.prepare(`SELECT opening_minor, opening_minor AS expected_minor, opening_reason,
      opened_by, opened_by_name, opened_at FROM retail_safe_opening WHERE operation_id = ?`)
      .bind(id).first(), 201));
  });

  routes.post('/retail/safe/count', permit(retailSafePermission), async c => {
    const data = await body(c, countInput);
    const db = c.env.DB;
    const now = new Date();
    return writeOperation(c, 'retail.safe.count', data, (op, binds, actor) => [
      db.prepare(`INSERT INTO retail_safe_counts(id, expected_minor, observed_minor, reason, actor_id, actor_name, created_at, business_day)
        VALUES (${op}, COALESCE(?, (SELECT expected_minor FROM retail_safe_position), 0), ?, ?, ?, ?, ?, ?)`)
        .bind(...binds, data.expected_minor ?? null, data.observed_minor, data.reason, actor, c.get('actor').name,
          now.toISOString(), cairoRetailDay(now)),
    ], async id => ok(c, await db.prepare('SELECT * FROM retail_safe_counts WHERE id = ?').bind(id).first(), 201));
  });

  return routes;
}
