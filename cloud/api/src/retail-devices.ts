import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { body, fail, hasPermission, identifier, ok, permit, searchPrefix, selectPage, type ApiEnv } from './http';
import { cairoRetailDay } from './retail-shifts';

export const retailTracking = z.enum(['quantity', 'serial', 'imei']);
export const retailDeviceStatuses = z.enum(['available', 'sold', 'quarantined', 'voided', 'returned_to_supplier']);
export const retailDeviceEvents = z.enum(['delivered', 'installed', 'warranty_claim']);
export const warrantyBasis = z.enum(['sale', 'delivery', 'installation']);
export const warrantyGuarantor = z.string().trim().min(1).max(160).regex(/^[^\p{Cc}]+$/u);
const imei = z.string().trim().regex(/^[0-9]{15}$/).refine(value => value !== '000000000000000' &&
  Array.from(value).reduce((sum, digit, index) => {
    const n = Number(digit);
    const doubled = index % 2 === 0 ? n : n * 2;
    return sum + (doubled > 9 ? doubled - 9 : doubled);
  }, 0) % 10 === 0);
export const retailDeviceInput = z.strictObject({
  serial_number: z.string().trim().min(1).max(100).regex(/^[^\p{Cc}\p{Cf}]+$/u).optional(),
  imei1: imei.optional(),
  imei2: imei.optional(),
}).refine(device => Boolean(device.serial_number || device.imei1) &&
  (device.imei2 === undefined || (device.imei1 !== undefined && device.imei2 !== device.imei1)));

export const retailDeviceErrors: ReadonlyArray<readonly [string, string]> = [
  ['RETAIL_TRACKING_HAS_STOCK', 'أنشئ صنفًا جديدًا لتغيير نوع التتبع بعد تسجيل حركة مخزون.'],
  ['RETAIL_DEVICE_IDENTITY_REQUIRED', 'أدخل رقمًا تسلسليًا أو IMEI صالحًا حسب نوع تتبع الصنف.'],
  ['RETAIL_DEVICE_IDENTITY_DUPLICATE', 'الرقم التسلسلي أو IMEI مسجل على قطعة أخرى.'],
  ['RETAIL_DEVICE_RECEIPT_COUNT', 'عدد الأجهزة المسجلة يجب أن يطابق كمية الاستلام للصنف المتتبع.'],
  ['RETAIL_RECEIPT_DEVICE_HISTORY', 'تعذر عكس الاستلام لأن قطعة مرتبطة به لها حركة بيع أو مرتجع.'],
  ['RETAIL_DEVICE_SALE_COUNT', 'حدد جهازًا متاحًا لكل قطعة من الأصناف المتتبعة.'],
  ['RETAIL_DEVICE_UNAVAILABLE', 'أحد الأجهزة غير متاح للبيع أو لا يطابق الصنف.'],
  ['RETAIL_DEVICE_RETURN_REQUIRED', 'سجّل استرجاع الأجهزة من شاشة مرتجعات البنود.'],
  ['RETAIL_DEVICE_MOVEMENT_REQUIRED', 'حركة مخزون هذا الصنف تتطلب تحديد الأجهزة المسجلة.'],
  ['RETAIL_DEVICE_EVENT_STATE', 'أضف هذا الحدث لقطعة مبيعة وفي تاريخ لا يسبق الفاتورة.'],
  ['RETAIL_DEVICE_MILESTONE_ORDER', 'يجب أن يسبق التسليم التركيب أو يوافقه في التاريخ.'],
  ['RETAIL_QUARANTINE_STATE', 'القطعة ليست معزولة للفحص أو تغيّر المرتجع المرتبط بها.'],
];

const deviceColumns = 'd.*, p.name AS product_name, p.tracking';
const devicesTable = 'retail_devices d JOIN products p ON p.id = d.product_id';

export function deviceWarrantyView(row: Record<string, unknown>, today: string, canReadCost: boolean) {
  const { unit_cost_minor, warranty_returned, ...data } = row;
  let status = 'none';
  if (Number(row.warranty_months) > 0) {
    if (warranty_returned) status = 'returned';
    else if (typeof row.warranty_starts_on !== 'string' || row.warranty_starts_on > today ||
      typeof row.warranty_expires_on !== 'string') status = 'pending';
    else status = today > row.warranty_expires_on ? 'expired' : 'active';
  }
  return { ...data, warranty_status: status, ...(canReadCost ? { unit_cost_minor } : {}) };
}

export function retailDevices(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();

  routes.get('/retail/devices', c => {
    const query = z.object({
      product_id: identifier.optional(),
      purchase_id: identifier.optional(),
      status: retailDeviceStatuses.optional(),
      q: z.string().trim().max(100).optional(),
    }).parse(c.req.query());
    const clauses: string[] = [];
    const parameters: (number | string)[] = [];
    const actor = c.get('actor');
    if (!hasPermission(actor, 'inventory.view')) {
      if (!hasPermission(actor, 'invoices.create') || query.product_id === undefined || query.purchase_id !== undefined ||
        query.status !== 'available') {
        return fail(403, 'forbidden', 'ليست لديك صلاحية لعرض سجل الأجهزة.');
      }
      clauses.push('p.active = 1');
    }
    if (query.product_id !== undefined) { clauses.push('d.product_id = ?'); parameters.push(query.product_id); }
    if (query.purchase_id !== undefined) {
      clauses.push('d.receipt_id IN (SELECT id FROM purchase_stock_receipts WHERE purchase_id = ?)');
      parameters.push(query.purchase_id);
    }
    if (query.status !== undefined) { clauses.push('d.status = ?'); parameters.push(query.status); }
    if (query.q) {
      const prefix = searchPrefix(query.q);
      clauses.push("(d.serial_number LIKE ? ESCAPE '\\' OR d.imei1 LIKE ? ESCAPE '\\' OR d.imei2 LIKE ? ESCAPE '\\')");
      parameters.push(prefix, prefix, prefix);
    }
    return selectPage(c, deviceColumns, devicesTable, clauses.length ? 'WHERE ' + clauses.join(' AND ') : '',
      parameters, 'd.id DESC');
  });

  routes.get('/retail/devices/:id', permit('inventory.view'), async c => {
    const id = identifier.parse(c.req.param('id'));
    const db = c.env.DB;
    const actor = c.get('actor');
    const [devices, sales, events, returns, quarantine, repairs] = await db.batch<Record<string, unknown>>([
      db.prepare(`SELECT ${deviceColumns}, r.purchase_id FROM ${devicesTable}
        JOIN purchase_stock_receipts r ON r.id = d.receipt_id WHERE d.id = ?`).bind(id),
      db.prepare(`SELECT w.*, i.invoice_date FROM retail_device_sale_warranty w JOIN invoices i ON i.id = w.invoice_id
        WHERE w.device_id = ? ORDER BY w.invoice_id DESC LIMIT 100`).bind(id),
      db.prepare('SELECT * FROM retail_device_events WHERE device_id = ? ORDER BY id DESC LIMIT 100').bind(id),
      db.prepare('SELECT * FROM retail_return_devices WHERE device_id = ? ORDER BY return_id DESC LIMIT 100').bind(id),
      db.prepare('SELECT * FROM retail_quarantine_resolutions WHERE device_id = ? ORDER BY id DESC LIMIT 100').bind(id),
      ...(hasPermission(actor, 'maintenance.view') ? [db.prepare(`
        SELECT id, item, status, requested_date, completed_date, archived_at
        FROM maintenance_requests WHERE retail_device_id = ? ORDER BY id DESC LIMIT 100
      `).bind(id)] : []),
    ]);
    if (!devices.results[0]) return fail(404, 'not_found', 'الجهاز غير موجود.');
    const canReadCost = hasPermission(actor, 'products.cost.view') || hasPermission(actor, 'products.cost.manage');
    const today = cairoRetailDay();
    const history = sales.results.map(row => deviceWarrantyView(row, today, canReadCost));
    return ok(c, { ...devices.results[0], sales: history, events: events.results, returns: returns.results,
      quarantine_resolutions: quarantine.results, ...(repairs ? { repairs: repairs.results } : {}) });
  });

  routes.post('/retail/devices/:id/quarantine-resolution', permit('inventory.manage'), async c => {
    const deviceId = identifier.parse(c.req.param('id'));
    const data = await body(c, z.strictObject({
      disposition: z.literal('restock'),
      reason: z.string().trim().min(1).max(1000),
      return_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    }));
    const db = c.env.DB;
    if (!await db.prepare('SELECT 1 FROM retail_devices WHERE id = ?').bind(deviceId).first()) {
      return fail(404, 'not_found', 'الجهاز غير موجود.');
    }
    return writeOperation(c, 'retail.device.quarantine.resolve', { deviceId, ...data }, (op, binds, actor) => [
      db.prepare(`
        INSERT INTO retail_quarantine_resolutions (id, return_id, device_id, disposition, reason, actor_id)
        VALUES (${op}, ?, ?, ?, ?, ?)
      `).bind(...binds, data.return_id, deviceId, data.disposition, data.reason, actor),
    ]);
  });

  routes.post('/retail/devices/:id/events', permit('inventory.manage'), async c => {
    const deviceId = identifier.parse(c.req.param('id'));
    const data = await body(c, z.strictObject({
      kind: retailDeviceEvents,
      occurred_on: z.iso.date().optional(),
      note: z.string().trim().max(1000).default(''),
      proof_reference: z.string().trim().min(1).max(120).regex(/^[^\p{Cc}]+$/u).nullish(),
    }));
    const today = cairoRetailDay();
    if (data.occurred_on && data.occurred_on > today) return fail(422, 'future_device_event', 'تاريخ الحدث لا يمكن أن يكون في المستقبل.');
    const occurredOn = data.occurred_on ?? today;
    return writeOperation(c, 'retail.device.event', { deviceId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`
        WITH last_sale AS (
          SELECT s.invoice_id, s.product_id, i.invoice_date
          FROM retail_device_sales s JOIN invoices i ON i.id = s.invoice_id JOIN retail_devices d ON d.id = s.device_id
          WHERE s.device_id = ? AND d.status = 'sold' ORDER BY s.rowid DESC LIMIT 1
        )
        INSERT INTO retail_device_events (id, invoice_id, product_id, device_id, kind, occurred_on, note, actor_id, proof_reference)
        VALUES (${op}, (SELECT invoice_id FROM last_sale), (SELECT product_id FROM last_sale),
          ?, ?, ?, ?, ?, ?)
      `).bind(deviceId, ...binds, deviceId, data.kind, occurredOn, data.note, actor, data.proof_reference ?? null),
    ]);
  });

  return routes;
}
