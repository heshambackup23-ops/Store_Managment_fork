import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { body, fail, hasPermission, identifier, ok, permit, selectPage, type ApiContext, type ApiEnv } from './http';
import { retailDeviceInput } from './retail-devices';

const count = 'inventory.stocktake.count';
const approve = 'inventory.stocktake.approve';
const intake = 'inventory.manage';
const cost = 'products.cost.manage';
const recordId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const key = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}\p{Cf}]+$/u);
const snapshot = z.strictObject({ stock: z.number().int().min(0).max(1_000_000_000), movement_id: key, review_id: key });
const unitCost = z.number().int().min(0).max(900_000_000_000_000);
const registeredDevice = z.strictObject({
  ...retailDeviceInput.shape, unit_cost_minor: unitCost,
}).refine(({ unit_cost_minor: _cost, ...device }) => retailDeviceInput.safeParse(device).success);
const common = {
  product_id: recordId, position: snapshot, source_reference: text(120), reason: text(1000),
  additions: z.array(registeredDevice).max(200).default([]),
};
const review = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('opening'), source: z.strictObject({ product_id: recordId, position: snapshot }).optional() }),
  z.strictObject({ ...common, kind: z.literal('count'), scanned: z.array(text(100)).max(2000) }),
]).superRefine((data, context) => {
  if (data.kind === 'opening' && !data.additions.length) context.addIssue({ code: 'custom', path: ['additions'], message: 'Add at least one device' });
  const known = new Set<string>();
  let total = 0;
  for (const item of data.additions) {
    total += item.unit_cost_minor;
    for (const identity of [item.serial_number, item.imei1, item.imei2]) {
      if (!identity) continue;
      const normalized = identity.toUpperCase();
      if (known.has(normalized)) context.addIssue({ code: 'custom', path: ['additions'], message: 'Device identifier repeated' });
      known.add(normalized);
    }
  }
  if (total > 900_000_000_000_000) context.addIssue({ code: 'custom', path: ['additions'], message: 'Total intake value exceeds ledger limit' });
});

export const retailSerialInventoryErrors: ReadonlyArray<readonly [string, string]> = [
  ['RETAIL_SERIAL_STALE', 'تغير المخزون أو سجل الاعتماد. حدّث الرصيد وأعد العد قبل الاعتماد.'],
  ['RETAIL_SERIAL_SCAN_INVALID', 'يوجد رقم مكرر لنفس القطعة أو رقم لا يطابق جهازًا متاحًا أو مفقودًا لهذا الصنف. راجع قائمة المسح.'],
  ['RETAIL_SERIAL_INTAKE_INVALID', 'رقم افتتاح مكرر أو غير مطابق لنوع تتبع الصنف.'],
  ['RETAIL_SERIAL_TRANSFER_COST', 'إجمالي تكلفة القطع المنقولة يجب أن يطابق قيمة الرصيد المنقولة من الصنف الكمي.'],
];

async function showReview(c: ApiContext, id: number, status: 200 | 201 = 200) {
  const actor = c.get('actor');
  const mayApprove = hasPermission(actor, approve);
  const mayReadCost = hasPermission(actor, 'products.cost.view') || hasPermission(actor, cost);
  const db = c.env.DB;
  const [records, observations] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT * FROM retail_device_inventory_records WHERE id = ? AND (? = 1 OR actor_id = ?)').bind(id, Number(mayApprove), actor.id),
    db.prepare(`SELECT d.id, d.serial_number, d.imei1, d.imei2, o.disposition
      FROM retail_device_inventory_observations o JOIN retail_devices d ON d.id = o.device_id
      WHERE o.review_id = ? ORDER BY o.disposition, d.id`).bind(id),
  ]);
  const row = records.results[0];
  if (!row) return fail(404, 'not_found', 'سجل جرد الأجهزة غير موجود.');
  const { additions_json, scanned_json, ...header } = row;
  const additions = (JSON.parse(String(additions_json)) as z.infer<typeof registeredDevice>[])
    .map(({ unit_cost_minor, ...device }) => ({ ...device, ...(mayReadCost ? { unit_cost_minor } : {}) }));
  return ok(c, { ...header, additions, observations: observations.results }, status);
}

export function retailSerialInventory(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();
  routes.get('/retail/serial-stocktakes/positions/:id', permit(count), async c => {
    const actor = c.get('actor');
    const id = identifier.parse(c.req.param('id'));
    const mayReadCost = hasPermission(actor, 'products.cost.view') || hasPermission(actor, cost);
    const row = await c.env.DB.prepare(`SELECT product_id, product_name, barcode, tracking, stock, movement_id, review_id${mayReadCost ? ', inventory_value_minor' : ''}
      FROM retail_device_inventory_positions WHERE product_id = ?`).bind(id).first();
    if (!row) return fail(404, 'not_found', 'الصنف غير موجود أو مؤرشف.');
    return ok(c, row);
  });

  routes.get('/retail/serial-stocktakes', c => {
    const actor = c.get('actor');
    const mayApprove = hasPermission(actor, approve);
    if (!mayApprove && !hasPermission(actor, count)) return fail(403, 'forbidden', 'ليست لديك صلاحية لجرد الأجهزة.');
    return selectPage(c, `id, kind, product_id, product_name, source_reference, actor_id, status, created_at, missing_count,
      recovered_count, added_count, expected_stock, approval_id, approved_by`, 'retail_device_inventory_records',
      mayApprove ? '' : 'WHERE actor_id = ?', mayApprove ? [] : [actor.id], 'id DESC');
  });

  routes.get('/retail/serial-stocktakes/:id', c => {
    const actor = c.get('actor');
    if (!hasPermission(actor, approve) && !hasPermission(actor, count)) return fail(403, 'forbidden', 'ليست لديك صلاحية لجرد الأجهزة.');
    return showReview(c, identifier.parse(c.req.param('id')));
  });

  routes.post('/retail/serial-stocktakes', permit(count), async c => {
    const data = await body(c, review);
    const actor = c.get('actor');
    if ((data.kind === 'opening' || data.additions.length) && (!hasPermission(actor, intake) || !hasPermission(actor, cost))) {
      return fail(403, 'forbidden', 'إضافة أجهزة وتثبيت تكلفتها يتطلبان صلاحية المخزون والتكلفة.');
    }
    const source = data.kind === 'opening' ? data.source : undefined;
    return writeOperation(c, 'inventory.serial.review', data, (operation, binds, actorId) => [
      c.env.DB.prepare(`INSERT INTO retail_device_inventory_reviews(id, kind, product_id, source_product_id,
        expected_stock, expected_movement, expected_review, source_expected_stock, source_expected_movement,
        source_reference, reason, scanned_json, additions_json, actor_id)
        VALUES (${operation}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(...binds,
        data.kind, data.product_id, source?.product_id ?? null, data.position.stock, data.position.movement_id, data.position.review_id,
        source?.position.stock ?? null, source?.position.movement_id ?? null, data.source_reference, data.reason,
        JSON.stringify(data.kind === 'count' ? data.scanned : []), JSON.stringify(data.additions), actorId),
    ], id => showReview(c, id, 201));
  });

  routes.post('/retail/serial-stocktakes/:id/approve', permit(approve), async c => {
    const id = identifier.parse(c.req.param('id'));
    const data = await body(c, z.strictObject({ reason: text(1000) }));
    const actor = c.get('actor');
    const proposed = await c.env.DB.prepare('SELECT kind, added_count FROM retail_device_inventory_records WHERE id = ?').bind(id)
      .first<{ kind: string; added_count: number }>();
    if (!proposed) return fail(404, 'not_found', 'سجل جرد الأجهزة غير موجود.');
    if ((proposed.kind === 'opening' || proposed.added_count > 0) && (!hasPermission(actor, intake) || !hasPermission(actor, cost))) {
      return fail(403, 'forbidden', 'اعتماد افتتاح أجهزة أو تثبيت تكلفتها يتطلب صلاحية المخزون والتكلفة.');
    }
    return writeOperation(c, 'inventory.serial.approve', { id, ...data }, (operation, binds, actorId) => [
      c.env.DB.prepare(`INSERT INTO retail_device_inventory_approvals(review_id, id, actor_id, reason)
        VALUES (?, ${operation}, ?, ?)`).bind(id, ...binds, actorId, data.reason),
    ], () => showReview(c, id, 201));
  });
  return routes;
}
