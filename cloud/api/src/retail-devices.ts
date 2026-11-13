import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { body, fail, hasPermission, identifier, ok, permit, searchPrefix, selectPage, type ApiEnv } from './http';
import { cairoRetailDay } from './retail-shifts';

export const retailTracking = z.enum(['quantity', 'serial', 'imei']);
export const retailDeviceStatuses = z.enum(['available', 'sold', 'quarantined', 'voided', 'returned_to_supplier',
  'stocktake_missing', 'in_repair', 'written_off']);
export const deviceDispositionApprove = 'retail.devices.disposition.approve';
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
  ['RETAIL_DISPOSITION_SUPPLIER_SOURCE', 'رد الجهاز للمورد يتطلب استلامًا مرتبطًا ببند شراء مسعّر.'],
  ['RETAIL_DISPOSITION_SEPARATION', 'يجب أن يراجع هذا القرار موظف آخر.'],
  ['RETAIL_DISPOSITION_COST', 'تغيّرت تكلفة الجهاز المرتبطة بالبيع الأصلي.'],
  ['RETAIL_DISPOSITION_OPEN', 'أكمل مراجعة القرار أو الصيانة قبل إعادة الجهاز للبيع.'],
  ['RETAIL_DISPOSITION_INTERNAL_REPAIR', 'يحافظ أمر الصيانة الداخلي على الجهاز وتكلفة الخدمة الصفرية ولا ينشئ مديونية عميل.'],
];

const deviceStatus = 'COALESCE(a.effective_status, d.status)';
const deviceColumns = `d.id, d.product_id, d.receipt_id, d.inventory_intake_id, d.serial_number, d.imei1, d.imei2, d.branch_id,
  d.created_at, ${deviceStatus} AS status, p.name AS product_name, p.tracking,
  u.id AS used_acquisition_id, inspection.grade AS used_grade, inspection.battery_percent AS used_battery_percent,
  inspection.accessories AS used_accessories, inspection.defects AS used_defects`;
const devicesTable = `retail_devices d JOIN products p ON p.id = d.product_id
  LEFT JOIN retail_active_device_dispositions a ON a.device_id = d.id
  LEFT JOIN retail_used_phone_acquisitions u ON u.inspection_id = d.inventory_intake_id
  LEFT JOIN retail_used_phone_inspections inspection ON inspection.id = u.inspection_id`;

const dispositionReason = z.string().trim().min(1).max(1000);
const dispositionReturnId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const deviceDispositionInput = z.discriminatedUnion('disposition', [
  z.strictObject({ disposition: z.enum(['repair', 'write_off']), reason: dispositionReason, return_id: dispositionReturnId }),
  z.strictObject({ disposition: z.literal('supplier'), reason: dispositionReason, return_id: dispositionReturnId,
    supplier_reference: z.string().trim().min(1).max(100).regex(/^[^\p{Cc}\p{Cf}]+$/u) }),
]);

function canDispose(actor: Parameters<typeof hasPermission>[0], disposition: string) {
  const permissions: Record<string, string> = { repair: 'maintenance.manage', supplier: 'suppliers.manage', write_off: 'damaged.manage' };
  const permission = permissions[disposition];
  return Boolean(permission && hasPermission(actor, permission));
}

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
      branch_id: identifier.optional(),
      status: retailDeviceStatuses.optional(),
      q: z.string().trim().max(100).optional(),
    }).parse(c.req.query());
    const clauses: string[] = [];
    const parameters: (number | string)[] = [];
    const actor = c.get('actor');
    if (!hasPermission(actor, 'inventory.view')) {
      if (!(hasPermission(actor, 'invoices.create') || hasPermission(actor, 'retail.branches.transfer')) || query.product_id === undefined || query.purchase_id !== undefined ||
        query.status !== 'available') {
        return fail(403, 'forbidden', 'ليست لديك صلاحية لعرض سجل الأجهزة.');
      }
      clauses.push('p.active = 1');
    }
    if (query.product_id !== undefined) { clauses.push('d.product_id = ?'); parameters.push(query.product_id); }
    if (query.branch_id !== undefined) { clauses.push('d.branch_id = ?'); parameters.push(query.branch_id); }
    if (query.purchase_id !== undefined) {
      clauses.push('d.receipt_id IN (SELECT id FROM purchase_stock_receipts WHERE purchase_id = ?)');
      parameters.push(query.purchase_id);
    }
    if (query.status !== undefined) { clauses.push(`${deviceStatus} = ?`); parameters.push(query.status); }
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
    const canReadCost = hasPermission(actor, 'products.cost.view') || hasPermission(actor, 'products.cost.manage');
    const canReadSupplier = hasPermission(actor, 'suppliers.view') || hasPermission(actor, 'suppliers.manage');
    const [devices, sales, events, returns, quarantine, dispositions, repairs] = await db.batch<Record<string, unknown>>([
      db.prepare(`SELECT ${deviceColumns}, r.purchase_id, d.intake_cost_minor, v.source_reference AS intake_source_reference,
        ${hasPermission(actor, 'retail.installations.manage') && hasPermission(actor, 'retail.installations.view')
          ? '(SELECT j.id FROM retail_installation_positions j WHERE j.device_id = d.id ORDER BY j.id DESC LIMIT 1)'
          : 'NULL'} AS installation_id
        FROM ${devicesTable}
        LEFT JOIN purchase_stock_receipts r ON r.id = d.receipt_id
        LEFT JOIN retail_device_inventory_reviews v ON v.id = d.inventory_intake_id WHERE d.id = ?`).bind(id),
      db.prepare(`SELECT w.*, i.invoice_date FROM retail_device_sale_warranty w JOIN invoices i ON i.id = w.invoice_id
        WHERE w.device_id = ? ORDER BY w.invoice_id DESC LIMIT 100`).bind(id),
      db.prepare('SELECT * FROM retail_device_events WHERE device_id = ? ORDER BY id DESC LIMIT 100').bind(id),
      db.prepare('SELECT * FROM retail_return_devices WHERE device_id = ? ORDER BY return_id DESC LIMIT 100').bind(id),
      db.prepare('SELECT * FROM retail_quarantine_resolutions WHERE device_id = ? ORDER BY id DESC LIMIT 100').bind(id),
      db.prepare(`SELECT q.id, q.return_id, q.disposition, q.reason, q.actor_id, requestor.name AS requested_by,
          q.created_at, r.id AS review_id, r.decision, r.reason AS review_reason, reviewer.name AS reviewed_by,
          r.decided_on, m.status AS repair_status, m.archived_at AS repair_archived_at,
          ${canReadCost ? 'r.loss_minor' : 'NULL'} AS loss_minor,
          ${canReadSupplier ? 'q.supplier_reference' : 'NULL'} AS supplier_reference,
          ${canReadSupplier ? 's.credit_minor' : 'NULL'} AS credit_minor,
          ${canReadSupplier ? 's.unapplied_credit_minor' : 'NULL'} AS unapplied_credit_minor
        FROM retail_device_dispositions q JOIN users requestor ON requestor.id = q.actor_id
        LEFT JOIN retail_device_disposition_reviews r ON r.request_id = q.id
        LEFT JOIN users reviewer ON reviewer.id = r.actor_id
        LEFT JOIN maintenance_requests m ON m.id = r.id AND q.disposition = 'repair' AND r.decision = 'approve'
        LEFT JOIN supplier_stock_returns s ON s.disposition_review_id = r.id
        WHERE q.device_id = ? ORDER BY q.id DESC LIMIT 100`).bind(id),
      ...(hasPermission(actor, 'maintenance.view') ? [db.prepare(`
        SELECT id, item, status, requested_date, completed_date, archived_at
        FROM maintenance_requests WHERE retail_device_id = ? ORDER BY id DESC LIMIT 100
      `).bind(id)] : []),
    ]);
    if (!devices.results[0]) return fail(404, 'not_found', 'الجهاز غير موجود.');
    const today = cairoRetailDay();
    const history = sales.results.map(row => deviceWarrantyView(row, today, canReadCost));
    const { intake_cost_minor, ...device } = devices.results[0];
    return ok(c, { ...device, ...(canReadCost ? { intake_cost_minor } : {}), sales: history, events: events.results, returns: returns.results,
      quarantine_resolutions: quarantine.results, dispositions: dispositions.results, can_read_cost: canReadCost,
      ...(repairs ? { repairs: repairs.results } : {}) });
  });

  routes.post('/retail/devices/:id/dispositions', permit('inventory.manage'), async c => {
    const deviceId = identifier.parse(c.req.param('id'));
    const data = await body(c, deviceDispositionInput);
    if (!canDispose(c.get('actor'), data.disposition)) return fail(403, 'forbidden', 'تحتاج صلاحية إدارة القسم المختص بهذا القرار.');
    return writeOperation(c, 'retail.device.disposition.request', { deviceId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_device_dispositions (id, return_id, device_id, disposition, reason, supplier_reference, actor_id)
        VALUES (${op}, ?, ?, ?, ?, ?, ?)`)
        .bind(...binds, data.return_id, deviceId, data.disposition, data.reason,
          data.disposition === 'supplier' ? data.supplier_reference : null, actor),
    ]);
  });

  routes.post('/retail/devices/:id/dispositions/:requestId/review', permit('inventory.view'), permit(deviceDispositionApprove), async c => {
    const deviceId = identifier.parse(c.req.param('id'));
    const requestId = identifier.parse(c.req.param('requestId'));
    const data = await body(c, z.strictObject({ decision: z.enum(['approve', 'reject']), reason: dispositionReason }));
    const db = c.env.DB;
    const request = await db.prepare('SELECT disposition, actor_id FROM retail_device_dispositions WHERE id = ? AND device_id = ?')
      .bind(requestId, deviceId).first<{ disposition: string; actor_id: number }>();
    if (!request) return fail(404, 'not_found', 'طلب الإجراء غير موجود.');
    if (request.actor_id === c.get('actor').id) return fail(403, 'RETAIL_DISPOSITION_SEPARATION', 'يجب أن يراجع هذا القرار موظف آخر.');
    if (data.decision === 'approve' && !canDispose(c.get('actor'), request.disposition)) {
      return fail(403, 'forbidden', 'تحتاج صلاحية إدارة القسم المختص بهذا القرار.');
    }
    const day = cairoRetailDay();
    return writeOperation(c, 'retail.device.disposition.review', { deviceId, requestId, ...data }, (op, binds, actor) => [
      db.prepare(`INSERT INTO retail_device_disposition_reviews (id, request_id, decision, reason, actor_id, decided_on, loss_minor)
        VALUES (${op}, ?, ?, ?, ?, ?, (
          SELECT s.unit_cost_minor FROM retail_device_dispositions q
          JOIN retail_return_devices r USING (return_id, device_id)
          JOIN retail_device_sales s USING (invoice_id, product_id, device_id)
          WHERE q.id = ? AND q.disposition = 'write_off' AND ? = 'approve'
        ))`).bind(...binds, requestId, data.decision, data.reason, actor, day, requestId, data.decision),
    ]);
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
