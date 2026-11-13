import { Hono } from 'hono';
import { z } from 'zod';
import { body, fail, hasPermission, identifier, ok, permit, selectPage, type ApiEnv } from './http';
import type { write } from './business';

export const approveRetailDiscount = 'retail.discounts.approve';
const discountReason = z.string().trim().min(1).max(1000);
const discountItem = z.strictObject({ product_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  quantity: z.number().int().min(1).max(1_000_000), unit_discount_minor: z.number().int().min(0).max(100_000_000_000) });
const discountRequest = z.strictObject({ items: z.array(discountItem).min(1).max(40)
  .refine(items => new Set(items.map(item => item.product_id)).size === items.length && items.some(item => item.unit_discount_minor > 0)),
  total_minor: z.number().int().min(0).max(900_000_000_000_000), reason: discountReason });

export function retailDiscounts(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();
  routes.get('/retail/discounts', c => {
    const actor = c.get('actor');
    const approve = hasPermission(actor, approveRetailDiscount);
    if (!approve && !hasPermission(actor, 'invoices.discount')) return fail(403, 'forbidden', 'ليست لديك صلاحية عرض طلبات الخصم.');
    return selectPage(c, `r.id, r.cashier_id, u.name AS cashier_name, r.total_minor, r.discount_minor, r.reason,
      r.created_at, a.supervisor_id, a.reason AS approval_reason, d.invoice_id,
      CASE WHEN d.invoice_id IS NOT NULL THEN 'used' WHEN julianday(r.created_at) < julianday('now','-1 hour') THEN 'expired'
        WHEN a.request_id IS NOT NULL THEN 'approved' ELSE 'pending' END AS status`,
    `retail_discount_requests r JOIN users u ON u.id = r.cashier_id LEFT JOIN retail_discount_approvals a ON a.request_id = r.id
      LEFT JOIN retail_invoice_discount_controls d ON d.request_id = r.id`, approve ? '' : 'WHERE r.cashier_id = ?', approve ? [] : [actor.id], 'r.id DESC');
  });
  routes.get('/retail/discount-policy', permit('invoices.create'), async c =>
    ok(c, { limit_bps: await c.env.DB.prepare('SELECT retail_discount_limit_bps FROM settings WHERE id = 1').first<number>('retail_discount_limit_bps') }));
  routes.patch('/retail/discount-policy', permit('settings.update'), async c => {
    const data = await body(c, z.strictObject({ limit_bps: z.number().int().min(0).max(10000) }));
    return writeOperation(c, 'retail.discount.policy', data, (op, binds) => [
      c.env.DB.prepare('UPDATE settings SET retail_discount_limit_bps = ? WHERE id = 1 AND ' + op + ' IS NOT NULL').bind(data.limit_bps, ...binds),
    ], () => ok(c, data));
  });
  routes.post('/retail/discounts', permit('invoices.create'), permit('invoices.discount'), async c => {
    const data = await body(c, discountRequest);
    const db = c.env.DB;
    return writeOperation(c, 'retail.discount.request', data, (op, binds, actor) => [
      db.prepare(`WITH basket AS (
        SELECT count(*) AS matched, sum((p.price_minor - json_extract(j.value,'$.unit_discount_minor')) * json_extract(j.value,'$.quantity')) AS total,
          sum(json_extract(j.value,'$.unit_discount_minor') * json_extract(j.value,'$.quantity')) AS discount,
          min(p.price_minor - json_extract(j.value,'$.unit_discount_minor')) AS min_price
        FROM json_each(?) j JOIN products p ON p.id = json_extract(j.value,'$.product_id') AND p.active = 1
      ) INSERT INTO retail_discount_requests (id, cashier_id, items_json, total_minor, discount_minor, reason)
      SELECT ${op}, ?, ?, CASE WHEN matched = ? AND total = ? AND min_price >= 0 THEN total END, discount, ? FROM basket`)
        .bind(JSON.stringify(data.items), ...binds, actor, JSON.stringify(data.items), data.items.length, data.total_minor, data.reason),
    ]);
  });
  routes.post('/retail/discounts/:id/approve', permit(approveRetailDiscount), async c => {
    const id = identifier.parse(c.req.param('id'));
    const { reason } = await body(c, z.strictObject({ reason: discountReason }));
    return writeOperation(c, 'retail.discount.approve', { id, reason }, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_discount_approvals(request_id,operation_id,supervisor_id,reason) VALUES (?,${op},?,?)`)
        .bind(id, ...binds, actor, reason),
    ]);
  });
  return routes;
}
