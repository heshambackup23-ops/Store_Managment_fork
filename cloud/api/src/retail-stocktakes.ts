import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { retailSerialInventory } from './retail-serial-inventory';
import { toStockQuantity } from './retail-measurement';
import { body, fail, hasPermission, identifier, ok, permit, searchPrefix, searchText, selectPage, timestamp, type ApiContext, type ApiEnv } from './http';

const count = 'inventory.stocktake.count';
const approve = 'inventory.stocktake.approve';
export const stocktakePermissions = [count, approve];

const reason = z.string().trim().max(1000).refine(value => !value.includes('\0')).default('');
const countInput = z.strictObject({
  product_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  branch_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  observed_quantity: z.number().min(0).max(1_000_000_000),
  reason,
});
const approvalInput = z.strictObject({ reason });
const statusFilter = z.enum(['matched', 'pending_approval', 'report_only', 'approved', 'stale']).optional();

async function stocktakeResponse(c: ApiContext, id: number) {
  const row = await c.env.DB.prepare('SELECT * FROM retail_stocktake_records WHERE id = ?').bind(id).first();
  if (!row) throw new Error('Missing stocktake after write');
  return ok(c, row, 201);
}

export function retailStocktakes(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();
  routes.get('/retail/stocktake-products', permit(count), c => {
    const q = searchText.optional().parse(c.req.query('q'));
    const tracking = z.enum(['quantity', 'tracked']).optional().parse(c.req.query('tracking'));
    const scope = tracking === 'quantity' ? " AND tracking = 'quantity'" : tracking === 'tracked' ? " AND tracking <> 'quantity'" : '';
    return selectPage(c, 'id, name, barcode, tracking, quantity_scale', 'products',
      "WHERE active = 1" + scope + (q ? " AND (barcode = ? OR name LIKE ? ESCAPE '\\')" : ''),
      q ? [q, searchPrefix(q)] : [], 'name, id');
  });

  routes.get('/retail/stocktakes', c => {
    const actor = c.get('actor');
    const mayApprove = hasPermission(actor, approve);
    if (!mayApprove && !hasPermission(actor, count)) return fail(403, 'forbidden', 'ليست لديك صلاحية للجرد.');
    const status = statusFilter.parse(c.req.query('status'));
    const product = identifier.optional().parse(c.req.query('product_id'));
    return selectPage(c, 's.*', 'retail_stocktake_records s', 'WHERE 1 = 1'
      + (mayApprove ? '' : ' AND s.actor_id = ?') + (status ? ' AND s.status = ?' : '') + (product ? ' AND s.product_id = ?' : ''),
    [...(mayApprove ? [] : [actor.id]), ...(status ? [status] : []), ...(product ? [product] : [])], 's.id DESC');
  });

  routes.post('/retail/stocktakes', permit(count), async c => {
    const data = await body(c, countInput);
    const branch = data.branch_id ?? 1;
    const scale = await c.env.DB.prepare('SELECT quantity_scale FROM products WHERE id = ?').bind(data.product_id).first<number>('quantity_scale');
    if (scale === null) return fail(422, 'RETAIL_MEASUREMENT_PRODUCT', 'الصنف المحدد غير موجود.');
    const observed = toStockQuantity(data.observed_quantity, scale, 1_000_000_000);
    return writeOperation(c, 'inventory.stocktake.count', data, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_stocktakes (id, product_id, product_name, tracking, expected_quantity,
        observed_quantity, last_movement_id, reason, actor_id, actor_name, created_at, branch_id, last_transfer_id)
        VALUES (${op}, ?, (SELECT name FROM products WHERE id = ? AND active = 1),
          (SELECT tracking FROM products WHERE id = ? AND active = 1),
          COALESCE((SELECT stock FROM retail_branch_stock WHERE product_id = ? AND branch_id = ?), 0), ?,
          COALESCE((SELECT MAX(id) FROM inventory_movements WHERE product_id = ?), 0), ?, ?, ?, ${timestamp}, ?,
          COALESCE((SELECT MAX(id) FROM retail_branch_transfers WHERE product_id = ?), 0))`)
        .bind(...binds, data.product_id, data.product_id, data.product_id, data.product_id,
          branch, observed, data.product_id, data.reason, actor, c.get('actor').name, branch, data.product_id),
    ], id => stocktakeResponse(c, id));
  });

  routes.post('/retail/stocktakes/:id/approve', permit(approve), async c => {
    const countId = identifier.parse(c.req.param('id'));
    const data = await body(c, approvalInput);
    return writeOperation(c, 'inventory.stocktake.approve', { countId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_stocktake_approvals (stocktake_id, id, approved_by, approval_reason, approved_at)
        VALUES (?, ${op}, ?, ?, ${timestamp})`).bind(countId, ...binds, actor, data.reason),
    ], () => stocktakeResponse(c, countId));
  });
  routes.route('/', retailSerialInventory(writeOperation));
  return routes;
}
