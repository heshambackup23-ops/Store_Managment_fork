import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { body, fail, identifier, ok, permit, selectPage, type ApiEnv } from './http';

const opening = z.strictObject({
  expected_stock: z.number().int().min(1).max(1_000_000_000),
  expected_movement_id: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  value_minor: z.number().int().min(0).max(900_000_000_000_000),
  reason: z.string().trim().min(1).max(1000),
});

export function retailQuantityCosts(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();

  routes.get('/retail/quantity-costs/:id', permit('inventory.view'), permit('products.cost.view'), async c => {
    const productId = identifier.parse(c.req.param('id'));
    const db = c.env.DB;
    const [products, openings] = await db.batch([
      db.prepare(`
        SELECT id, name, stock, active,
          CASE WHEN stock = 0 THEN 0 ELSE inventory_value_minor END AS inventory_value_minor,
          COALESCE((SELECT MAX(id) FROM inventory_movements WHERE product_id = p.id), 0) AS last_movement_id
        FROM products p WHERE id = ? AND tracking = 'quantity'
      `).bind(productId),
      db.prepare('SELECT * FROM retail_quantity_opening_valuations WHERE product_id = ? ORDER BY id DESC LIMIT 20')
        .bind(productId),
    ]);
    if (!products.results[0]) return fail(404, 'not_found', 'الصنف الكمي غير موجود.');
    return ok(c, { ...products.results[0], opening_valuations: openings.results });
  });

  routes.get('/retail/quantity-costs/:id/movements', permit('inventory.view'), permit('products.cost.view'), c =>
    selectPage(c, '*', 'retail_quantity_movement_costs', 'WHERE product_id = ?', [identifier.parse(c.req.param('id'))],
      'movement_id DESC'));

  routes.post('/retail/quantity-costs/:id/opening', permit('inventory.manage'), permit('products.cost.manage'), async c => {
    const productId = identifier.parse(c.req.param('id'));
    const data = await body(c, opening);
    return writeOperation(c, 'inventory.quantity_cost.opening', { productId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`
        INSERT INTO retail_quantity_opening_valuations(id, product_id, expected_stock, expected_movement_id, value_minor, reason, actor_id)
        VALUES (${op}, ?, ?, ?, ?, ?, ?)
      `).bind(...binds, productId, data.expected_stock, data.expected_movement_id, data.value_minor, data.reason, actor),
    ]);
  });

  return routes;
}
