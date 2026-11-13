import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { body, fail, hasPermission, identifier, ok, permit, searchPrefix, searchText, selectPage, type ApiEnv } from './http';
import { toStockQuantity } from './retail-measurement';

const manage = 'retail.branches.manage';
const transfer = 'retail.branches.transfer';
export const retailBranchPermissions = [manage, transfer];
export const retailBranchErrors = [
  ['RETAIL_BRANCH_STOCK', 'الرصيد المتاح في الفرع المحدد لا يكفي لهذه الحركة.'],
  ['RETAIL_BRANCH_UNAVAILABLE', 'الفرع غير متاح أو الصنف مؤرشف.'],
  ['RETAIL_BRANCH_DEVICE', 'اختر القطع المتاحة في فرع العملية فقط.'],
  ['RETAIL_BRANCH_SHIFT', 'اختر وردية من نفس فرع الفاتورة.'],
  ['RETAIL_BRANCH_SUPPLIER_QUANTITY', 'الكمية تتجاوز ما استلمه هذا الفرع من أمر الشراء بعد المرتجعات السابقة.'],
  ['RETAIL_BRANCH_SERIAL_COUNT', 'راجع فرع العد، ومواقع الأرقام الممسوحة، وأحدث تحويلات الصنف. تحويل الرصيد الافتتاحي من صنف كمي متاح في الفرع الرئيسي فقط.'],
] as const;

const positiveId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const printable = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}\p{Cf}]+$/u);
const branchInput = z.strictObject({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,23}$/), name: printable(100) });
const transferInput = z.strictObject({
  from_branch_id: positiveId, to_branch_id: positiveId, product_id: positiveId,
  quantity: z.number().positive().max(1_000_000_000), device_ids: z.array(positiveId).max(100).default([]),
  reason: printable(500),
});
const branchReaders = ['inventory.view', 'inventory.manage', 'inventory.stocktake.count', 'damaged.manage', 'suppliers.manage',
  'invoices.create', 'retail.shifts.operate', 'retail.shifts.approve', ...retailBranchPermissions];

export function retailBranches(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();
  routes.get('/retail/branches', async c => {
    if (!branchReaders.some(permission => hasPermission(c.get('actor'), permission))) return fail(403, 'forbidden', 'عرض الفروع يتطلب صلاحية تشغيلية.');
    const { results } = await c.env.DB.prepare('SELECT id, code, name, active FROM retail_branches ORDER BY id').all();
    return ok(c, results);
  });

  routes.post('/retail/branches', permit(manage), async c => {
    const data = await body(c, branchInput);
    return writeOperation(c, 'retail.branch.create', data, (op, binds) => [
      c.env.DB.prepare(`INSERT INTO retail_branches(id, code, name) VALUES (${op} + 1, ?, ?)`).bind(...binds, data.code, data.name),
    ], async id => ok(c, await c.env.DB.prepare('SELECT id, code, name, active FROM retail_branches WHERE id = ?').bind(id + 1).first(), 201));
  });

  routes.get('/retail/branches/:id/stock', async c => {
    const actor = c.get('actor');
    if (!['inventory.view', 'inventory.manage', 'invoices.create', transfer, manage].some(permission => hasPermission(actor, permission))) {
      return fail(403, 'forbidden', 'ليست لديك صلاحية عرض مخزون الفروع.');
    }
    const branch = identifier.parse(c.req.param('id'));
    if (!await c.env.DB.prepare('SELECT 1 FROM retail_branches WHERE id = ? AND active = 1').bind(branch).first()) {
      return fail(404, 'not_found', 'الفرع غير موجود.');
    }
    const { q, product_id, in_stock } = z.object({ q: searchText.optional(), product_id: identifier.optional(),
      in_stock: z.enum(['true','false']).optional() }).parse(c.req.query());
    const forCheckout = hasPermission(actor, 'invoices.create');
    const literal = product_id ? '?3' : '?2';
    const exact = `(p.barcode = ${literal} OR p.pack_barcode = ${literal})`;
    // Prefix matches use the existing catalog search rules; exact barcodes always sort first.
    return selectPage(c, `p.id, p.name, p.barcode, p.pack_barcode, p.units_per_pack, p.tracking, p.measurement_unit, p.quantity_scale,
      ${forCheckout ? 'p.price_minor,' : ''} COALESCE(s.stock,0) AS stock, 1 AS active, ?1 AS branch_id`,
      'products p LEFT JOIN retail_branch_stock s ON s.product_id = p.id AND s.branch_id = ?1',
      "WHERE p.active = 1" + (product_id ? ' AND p.id = ?2' : '') + (in_stock === 'true' ? ' AND s.stock > 0' : in_stock === 'false' ? ' AND COALESCE(s.stock,0) = 0' : '')
      + (q ? ` AND (${exact} OR p.name LIKE ? ESCAPE '\\' OR p.variant_group LIKE ? ESCAPE '\\'
        OR instr(lower(p.compatible_models), lower(${literal})) > 0)` : ''),
      [branch, ...(product_id ? [product_id] : []), ...(q ? [q, searchPrefix(q), searchPrefix(q)] : [])],
      (q ? exact + ' DESC, ' : '')
      + '(COALESCE(s.stock,0) = 0), p.name, p.id');
  });

  routes.get('/retail/branch-transfers', async c => {
    if (!['inventory.view', transfer, manage].some(permission => hasPermission(c.get('actor'), permission))) return fail(403, 'forbidden', 'ليست لديك صلاحية عرض التحويلات.');
    const branch = identifier.optional().parse(c.req.query('branch_id'));
    return selectPage(c, 't.*, p.name AS product_name, p.measurement_unit, p.quantity_scale, f.name AS from_name, d.name AS to_name, u.name AS actor_name',
      'retail_branch_transfers t JOIN products p ON p.id = t.product_id JOIN retail_branches f ON f.id = t.from_branch_id JOIN retail_branches d ON d.id = t.to_branch_id JOIN users u ON u.id = t.actor_id',
      branch ? 'WHERE t.from_branch_id = ? OR t.to_branch_id = ?' : '', branch ? [branch, branch] : [], 't.id DESC',
      ({ device_ids_json, ...row }) => ({ ...row, device_ids: JSON.parse(String(device_ids_json)) }));
  });

  routes.post('/retail/branch-transfers', permit(transfer), async c => {
    const data = await body(c, transferInput);
    if (data.from_branch_id === data.to_branch_id) return fail(422, 'branch_same', 'اختر فرعين مختلفين.');
    if (new Set(data.device_ids).size !== data.device_ids.length) return fail(422, 'branch_duplicate_device', 'لا تكرر رقم القطعة في التحويل.');
    const scale = await c.env.DB.prepare('SELECT quantity_scale FROM products WHERE id = ?').bind(data.product_id).first<number>('quantity_scale');
    if (!scale) return fail(404, 'not_found', 'الصنف غير موجود.');
    const quantity = toStockQuantity(data.quantity, scale, 1_000_000_000);
    return writeOperation(c, 'retail.branch.transfer', data, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_branch_transfers(id,from_branch_id,to_branch_id,product_id,quantity,device_ids_json,reason,actor_id)
        VALUES(${op},?,?,?,?,?,?,?)`).bind(...binds, data.from_branch_id, data.to_branch_id, data.product_id, quantity, JSON.stringify(data.device_ids), data.reason, actor),
    ]);
  });
  return routes;
}
