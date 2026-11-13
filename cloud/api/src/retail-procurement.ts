import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { body, fail, identifier, permit, selectPage, type ApiEnv } from './http';
import { roundedLineSql, saleQuantity, withStockQuantities } from './retail-measurement';

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const unitCost = z.number().int().min(0).max(100_000_000_000);
const orderItem = z.strictObject({
  product_id: id,
  quantity: saleQuantity,
  unit_cost_minor: unitCost,
  landed_unit_minor: unitCost.optional(),
});
export const purchaseOrderItems = z.array(orderItem).min(1).max(40)
  .refine(items => new Set(items.map(item => item.product_id)).size === items.length);
const returnInput = z.strictObject({
  reason: z.string().trim().min(1).max(1000),
  branch_id: id.optional(),
  items: z.array(z.strictObject({ product_id: id, quantity: saleQuantity, device_ids: z.array(id).max(200).optional() }))
    .min(1).max(40).refine(items => {
      const devices = items.flatMap(item => item.device_ids ?? []);
      return new Set(items.map(item => item.product_id)).size === items.length &&
        devices.length <= 200 && new Set(devices).size === devices.length;
    }),
});

export const procurementErrors: ReadonlyArray<readonly [string, string]> = [
  ['PURCHASE_RECEIPT_ORDER_QUANTITY', 'الصنف غير مدرج في الطلب أو تتجاوز الكمية المتبقي للاستلام.'],
  ['PURCHASE_RECEIPT_HAS_RETURNS', 'يتعذر عكس سند الاستلام بعد تسجيل مرتجع مرتبط بكمياته.'],
  ['SUPPLIER_RETURN_QUANTITY', 'الكمية تتجاوز المستلم الصافي لهذا الصنف.'],
  ['SUPPLIER_RETURN_DEVICE', 'اختر الأجهزة المتاحة المستلمة من فاتورة الشراء هذه.'],
  ['SUPPLIER_RETURN_BALANCE', 'قيمة المرتجع تتجاوز المتبقي للمورد. تتطلب الزيادة تسوية منفصلة.'],
];

export function purchaseOrderStatements(db: D1Database, op: string, binds: (string | number | null)[],
  items: z.infer<typeof purchaseOrderItems> | undefined) {
  if (!items) return [];
  return [db.prepare(`
    INSERT INTO purchase_order_items(purchase_id, product_id, product_name, quantity, unit_cost_minor, landed_unit_minor)
    SELECT ${op}, json_extract(j.value, '$.product_id'), p.name, json_extract(j.value, '$.quantity'),
      json_extract(j.value, '$.unit_cost_minor'), COALESCE(json_extract(j.value, '$.landed_unit_minor'), 0)
    FROM json_each(?) j LEFT JOIN products p ON p.id = json_extract(j.value, '$.product_id')
  `).bind(...binds, JSON.stringify(items))];
}

export function purchaseOrderDetail(db: D1Database, purchaseId: number) {
  return db.prepare('SELECT *, quantity - received_quantity AS remaining_quantity FROM purchase_order_progress WHERE purchase_id = ? ORDER BY product_id')
    .bind(purchaseId);
}

export function retailProcurement(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();

  routes.get('/purchases/:id/returns', permit('suppliers.view'), c => {
    const purchaseId = identifier.parse(c.req.param('id'));
    return selectPage(c, `r.id, r.purchase_id, r.branch_id, r.credit_minor, r.unapplied_credit_minor, r.vendor_reference,
      r.reason, r.actor_id, r.created_at,
      (SELECT json_group_array(json_object('product_id', i.product_id, 'product_name', o.product_name, 'quantity', i.quantity,
        'quantity_scale', p.quantity_scale,
        'unit_cost_minor', i.unit_cost_minor, 'device_ids', json((SELECT json_group_array(d.device_id)
        FROM supplier_stock_return_devices d WHERE d.return_id = i.return_id AND d.product_id = i.product_id))))
      FROM supplier_stock_return_items i JOIN purchase_order_items o ON o.purchase_id = i.purchase_id AND o.product_id = i.product_id
      JOIN products p ON p.id = i.product_id
      WHERE i.return_id = r.id) AS items_json`, 'supplier_stock_returns r', 'WHERE r.purchase_id = ?', [purchaseId],
    'r.id DESC', ({ items_json, ...row }) => ({ ...row, items: JSON.parse(String(items_json)) }));
  });

  routes.post('/purchases/:id/returns', permit('suppliers.manage'), permit('inventory.manage'), async c => {
    const purchaseId = identifier.parse(c.req.param('id'));
    const data = await body(c, returnInput);
    const items = data.items.sort((a, b) => a.product_id - b.product_id);
    const db = c.env.DB;
    if (!await db.prepare('SELECT 1 FROM purchases WHERE id = ?').bind(purchaseId).first()) {
      return fail(404, 'not_found', 'فاتورة الشراء غير موجودة.');
    }
    const rows = JSON.stringify(await withStockQuantities(db, items));
    return writeOperation(c, 'purchase.stock.return', { purchaseId, ...data, items }, (op, binds, actor) => [
      db.prepare(`
        WITH credit AS (
          SELECT COALESCE(SUM(
            ${roundedLineSql('o.unit_cost_minor', "o.returned_quantity + json_extract(j.value, '$.quantity')", 'o.quantity_scale')}
            - ${roundedLineSql('o.unit_cost_minor', 'o.returned_quantity', 'o.quantity_scale')}
          ), 0) AS amount
          FROM json_each(?) j JOIN purchase_order_progress o ON o.purchase_id = ? AND o.product_id = json_extract(j.value, '$.product_id')
        )
        INSERT INTO supplier_stock_returns (id, purchase_id, credit_minor, reason, requested_items, actor_id, branch_id)
        SELECT ${op}, ?, amount, ?, ?, ?, ? FROM credit
      `).bind(rows, purchaseId, ...binds, purchaseId, data.reason, rows, actor, data.branch_id ?? 1),
    ]);
  });

  return routes;
}
