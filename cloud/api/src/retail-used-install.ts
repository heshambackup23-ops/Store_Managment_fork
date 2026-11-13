import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { body, fail, hasPermission, identifier, ok, permit, searchPrefix, searchText, selectPage, type ApiContext, type ApiEnv } from './http';
import { retailDeviceInput } from './retail-devices';
import { cairoRetailDay } from './retail-shifts';

const acquirePermission = 'retail.used_phones.acquire';
const viewInstallations = 'retail.installations.view';
const manageInstallations = 'retail.installations.manage';
const performInstallations = 'retail.installations.perform';
export const retailUsedInstallPermissions = [acquirePermission, viewInstallations, manageInstallations, performInstallations];

export const retailUsedInstallErrors: ReadonlyArray<readonly [string, string]> = [
  ['RETAIL_USED_PHONE_PRODUCT', 'اختر صنفًا جديدًا للمستعمل بتتبع IMEI، أو صنفًا مُخصصًا للمستعمل بالفعل.'],
  ['RETAIL_USED_PHONE_INSPECTION', 'استخدم آخر فحص ناجح للجهاز قبل الشراء. قد يكون الجهاز مشتَرى بالفعل.'],
  ['RETAIL_USED_PHONE_ORIGIN', 'سجّل شراء هذا الصنف من شاشة الموبايلات المستعملة.'],
  ['RETAIL_INSTALLATION_SALE', 'اختر قطعة مبيعة في فاتورة سارية. قد يكون للقطعة موعد مفتوح أو إثبات تركيب.'],
  ['RETAIL_INSTALLATION_ASSIGNEE', 'اختر فنيًا نشطًا لديه صلاحيتا عرض التركيب وتنفيذه.'],
  ['RETAIL_INSTALLATION_CONFLICT', 'للفني موعد تركيب آخر في نفس الوقت. اختر وقتًا مختلفًا أو فنيًا آخر.'],
  ['RETAIL_INSTALLATION_STATE', 'تغيّرت حالة الموعد. راجع سجله وتأكد من إسناد التركيب للفني الذي ينفّذه.'],
  ['RETAIL_INSTALLATION_DELIVERY_EXISTS', 'التسليم مسجّل بالفعل، أو أن أمر التركيب لم يعد مفتوحًا.'],
  ['RETAIL_INSTALLATION_DELIVERY', 'سجّل إثبات التسليم بتاريخ يوافق تاريخ التركيب أو يسبقه.'],
  ['RETAIL_INSTALLATION_USE_JOB', 'أكمل التركيب من أمر التركيب المفتوح لهذه القطعة.'],
];

const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const shortText = (length: number) => z.string().trim().min(1).max(length).regex(/^[^\p{Cc}\p{Cf}]+$/u);
const note = (length: number) => z.string().trim().max(length).refine(value => !value.includes('\0'));
const inspection = z.strictObject({
  product_id: id,
  device: retailDeviceInput.refine(value => value.imei1 !== undefined),
  ownership_reference: shortText(100),
  grade: z.enum(['excellent', 'good', 'fair']),
  battery_percent: z.number().int().min(0).max(100).nullish(),
  accessories: note(200).default(''),
  defects: note(1000).default(''),
  functional: z.boolean(),
  reset_verified: z.boolean(),
  lock_cleared: z.boolean(),
});
const acquisitionCost = z.number().int().min(1).max(100_000_000_000);
const acquisition = z.discriminatedUnion('payment_method', [
  z.strictObject({ payment_method: z.literal('cash'), acquisition_cost_minor: acquisitionCost, shift_id: id }),
  z.strictObject({ payment_method: z.literal('bank_transfer'), acquisition_cost_minor: acquisitionCost, payment_reference: shortText(100) }),
]);
const scheduleFields = {
  scheduled_on: z.iso.date(),
  scheduled_time: z.string().regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/),
  assignee_id: id.nullish(),
  note: note(1000).default(''),
};
const installation = z.strictObject({
  ...scheduleFields,
  device_id: id,
  invoice_id: id,
  service_address: shortText(500),
});
const schedule = z.strictObject(scheduleFields);
const proof = z.strictObject({
  occurred_on: z.iso.date(),
  proof_reference: shortText(120),
  note: note(1000).default(''),
});
const cancel = z.strictObject({ note: shortText(1000) });
const installationStatus = z.enum(['scheduled', 'assigned', 'completed', 'canceled', 'returned']);

function installationScope(c: ApiContext) {
  const actor = c.get('actor');
  return hasPermission(actor, manageInstallations) ? { where: '', values: [] } : {
    where: ' AND (j.assignee_id = ? OR EXISTS (SELECT 1 FROM retail_installation_actions e WHERE e.installation_id = j.id AND e.kind = \'complete\' AND e.actor_id = ?))',
    values: [actor.id, actor.id],
  };
}

async function installationDetail(c: ApiContext, id: number, status: 200 | 201 = 200) {
  const db = c.env.DB;
  const scope = installationScope(c);
  const [positions, actions] = await db.batch([
    db.prepare('SELECT j.* FROM retail_installation_positions j WHERE j.id = ?' + scope.where).bind(id, ...scope.values),
    db.prepare(`SELECT a.*, u.name AS actor_name, tech.name AS assignee_name
      FROM retail_installation_actions a JOIN users u ON u.id = a.actor_id LEFT JOIN users tech ON tech.id = a.assignee_id
      JOIN retail_installation_positions j ON j.id = a.installation_id WHERE j.id = ?${scope.where} ORDER BY a.id DESC LIMIT 100`)
      .bind(id, ...scope.values),
  ]);
  const position = positions.results[0];
  if (!position) return fail(404, 'not_found', 'أمر التركيب غير موجود.');
  return ok(c, { ...position, history: actions.results }, status);
}

function checkAppointment(day: string) {
  if (day < cairoRetailDay()) fail(422, 'RETAIL_INSTALLATION_DATE', 'اختر موعد اليوم أو تاريخًا لاحقًا بتوقيت القاهرة.');
}

function checkProofDate(day: string) {
  if (day > cairoRetailDay()) fail(422, 'RETAIL_INSTALLATION_DATE', 'لا يمكن تسجيل إثبات بتاريخ مستقبلي.');
}

export function retailUsedInstall(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();
  routes.get('/retail/used-phones/products', permit('inventory.view'), permit('inventory.manage'), c => {
    const q = searchText.optional().parse(c.req.query('q'));
    return selectPage(c, 'p.id, p.name, p.barcode', 'products p LEFT JOIN retail_used_phone_products u ON u.product_id = p.id',
      `WHERE p.active = 1 AND p.tracking = 'imei' AND (u.product_id IS NOT NULL OR (
        p.stock = 0 AND NOT EXISTS (SELECT 1 FROM retail_devices d WHERE d.product_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m.product_id = p.id)
      ))${q ? " AND (p.name LIKE ? ESCAPE '\\' OR p.barcode = ?)" : ''}`,
      q ? [searchPrefix(q), q] : [], 'p.name, p.id');
  });
  routes.get('/retail/used-phones/open-shifts', permit(acquirePermission), permit('retail.shifts.operate'), permit('retail.cash.manage'), c => {
    return selectPage(c, 's.id, s.register_name', 'retail_shifts s', `WHERE s.actor_id = ? AND s.business_day = ? AND s.branch_id = 1
      AND NOT EXISTS (SELECT 1 FROM retail_shift_closures a WHERE a.shift_id = s.id)`, [c.get('actor').id, cairoRetailDay()], 's.id DESC');
  });
  routes.get('/retail/used-phones', permit('inventory.view'), c => {
    const q = searchText.optional().parse(c.req.query('q'));
    const actor = c.get('actor');
    const cost = hasPermission(actor, 'products.cost.view') || hasPermission(actor, 'products.cost.manage');
    const source = hasPermission(actor, 'inventory.manage') || hasPermission(actor, acquirePermission);
    return selectPage(c, `i.id, i.product_id, p.name AS product_name, i.serial_number, i.imei1, i.imei2, i.grade, i.battery_percent,
      i.accessories, i.defects, i.functional, i.reset_verified, i.lock_cleared, i.created_at, a.id AS acquisition_id,
      a.acquired_on, d.id AS device_id, COALESCE(disposition.effective_status, d.status) AS device_status,
      ${cost ? 'a.acquisition_cost_minor, a.payment_method, a.payment_reference,' : ''}
      ${source ? 'i.ownership_reference,' : ''}
      CASE WHEN a.id IS NOT NULL THEN 'acquired'
        WHEN EXISTS (SELECT 1 FROM retail_used_phone_inspections newer WHERE newer.id > i.id
          AND (newer.imei1 IN (i.imei1, i.imei2) OR newer.imei2 IN (i.imei1, i.imei2))) THEN 'superseded'
        WHEN i.functional = 1 AND i.reset_verified = 1 AND i.lock_cleared = 1 THEN 'passed' ELSE 'failed' END AS status`,
      `retail_used_phone_inspections i JOIN products p ON p.id = i.product_id
        LEFT JOIN retail_used_phone_acquisitions a ON a.inspection_id = i.id
        LEFT JOIN retail_devices d ON d.inventory_intake_id = i.id
        LEFT JOIN retail_active_device_dispositions disposition ON disposition.device_id = d.id`,
      q ? "WHERE (i.imei1 LIKE ? ESCAPE '\\' OR i.imei2 LIKE ? ESCAPE '\\' OR i.serial_number LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')" : '',
      q ? Array(4).fill(searchPrefix(q)) : [], 'i.id DESC');
  });
  routes.post('/retail/used-phones', permit('inventory.view'), permit('inventory.manage'), async c => {
    const data = await body(c, inspection);
    return writeOperation(c, 'retail.used_phone.inspect', data, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_used_phone_inspections(id, product_id, serial_number, imei1, imei2,
        ownership_reference, grade, battery_percent, accessories, defects, functional, reset_verified, lock_cleared, actor_id, created_at)
        VALUES (${op}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...binds, data.product_id, data.device.serial_number ?? null, data.device.imei1 ?? null, data.device.imei2 ?? null,
          data.ownership_reference, data.grade, data.battery_percent ?? null, data.accessories, data.defects, Number(data.functional),
          Number(data.reset_verified), Number(data.lock_cleared), actor, new Date().toISOString()),
    ]);
  });
  routes.post('/retail/used-phones/:id/acquire', permit('inventory.view'), permit('products.cost.manage'), permit(acquirePermission), async c => {
    const inspectionId = identifier.parse(c.req.param('id'));
    const data = await body(c, acquisition);
    const actor = c.get('actor');
    if (data.payment_method === 'cash' && (!hasPermission(actor, 'retail.shifts.operate') || !hasPermission(actor, 'retail.cash.manage'))) {
      return fail(403, 'forbidden', 'الشراء نقدًا يتطلب صلاحية تشغيل الوردية وإدارة الدرج.');
    }
    const db = c.env.DB;
    const now = new Date();
    return writeOperation(c, 'retail.used_phone.acquire', { inspectionId, ...data }, (op, binds, actorId) => [
      db.prepare(`INSERT INTO retail_used_phone_products(product_id)
        SELECT i.product_id FROM retail_used_phone_inspections i WHERE i.id = ?
          AND NOT EXISTS (SELECT 1 FROM retail_used_phone_products u WHERE u.product_id = i.product_id)`).bind(inspectionId),
      db.prepare(`INSERT INTO retail_used_phone_acquisitions(id, inspection_id, product_id, acquisition_cost_minor,
        acquired_on, payment_method, shift_id, payment_reference, actor_id, created_at)
        VALUES (${op}, ?, (SELECT product_id FROM retail_used_phone_inspections WHERE id = ?), ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...binds, inspectionId, inspectionId, data.acquisition_cost_minor, cairoRetailDay(now), data.payment_method,
          data.payment_method === 'cash' ? data.shift_id : null,
          data.payment_method === 'bank_transfer' ? data.payment_reference : null, actorId, now.toISOString()),
    ], async id => ok(c, await db.prepare(`SELECT a.*, d.id AS device_id
        FROM retail_used_phone_acquisitions a JOIN retail_devices d ON d.inventory_intake_id = a.inspection_id WHERE a.id = ?`)
      .bind(id).first(), 201));
  });

  routes.get('/retail/installations/technicians', permit(viewInstallations), permit(manageInstallations), c => selectPage(c,
    'u.id, u.name', 'users u', `WHERE u.active = 1
      AND EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = u.role_id AND p.permission IN ('*','retail.installations.perform'))
      AND EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = u.role_id AND p.permission IN ('*','retail.installations.view'))`,
    [], 'u.name, u.id'));
  routes.get('/retail/installations/sales', permit(viewInstallations), permit(manageInstallations), c => {
    const q = searchText.optional().parse(c.req.query('q'));
    return selectPage(c, `s.device_id AS id, s.invoice_id, s.product_id, i.invoice_date, p.name AS product_name,
      d.imei1, d.serial_number, 'فاتورة ' || s.invoice_id || ' · ' || p.name || ' · ' || COALESCE(d.serial_number, d.imei1) AS name`,
      `retail_device_sales s JOIN retail_devices d ON d.id = s.device_id
        JOIN invoices i ON i.id = s.invoice_id JOIN products p ON p.id = s.product_id`,
      `WHERE d.status = 'sold' AND i.status <> 'refunded'
        AND s.rowid = (SELECT MAX(old.rowid) FROM retail_device_sales old WHERE old.device_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM retail_return_devices r WHERE r.device_id = d.id AND r.invoice_id = i.id)
        AND NOT EXISTS (SELECT 1 FROM retail_device_events e WHERE e.device_id = d.id AND e.invoice_id = i.id AND e.kind = 'installed')
        AND NOT EXISTS (SELECT 1 FROM retail_installation_positions j WHERE j.device_id = d.id AND j.invoice_id = i.id AND j.status IN ('scheduled','assigned'))
        ${q ? "AND (CAST(i.id AS TEXT) = ? OR d.imei1 LIKE ? ESCAPE '\\' OR d.imei2 LIKE ? ESCAPE '\\' OR d.serial_number LIKE ? ESCAPE '\\')" : ''}`,
      q ? [q, ...Array(3).fill(searchPrefix(q))] : [], 's.invoice_id DESC, d.id');
  });
  routes.get('/retail/installations', permit(viewInstallations), c => {
    const scope = installationScope(c);
    const status = installationStatus.optional().parse(c.req.query('status'));
    const due = z.enum(['today', 'overdue']).optional().parse(c.req.query('due'));
    const q = searchText.optional().parse(c.req.query('q'));
    const dueFilter = due ? ` AND j.status IN ('scheduled','assigned') AND j.scheduled_on ${due === 'today' ? '=' : '<'} ?` : '';
    return selectPage(c, 'j.*', 'retail_installation_positions j', 'WHERE 1 = 1' + scope.where +
      (status ? ' AND j.status = ?' : '') + dueFilter +
      (q ? " AND (CAST(j.invoice_id AS TEXT) = ? OR j.imei1 LIKE ? ESCAPE '\\' OR j.serial_number LIKE ? ESCAPE '\\' OR j.customer_name LIKE ? ESCAPE '\\')" : ''),
      [...scope.values, ...(status ? [status] : []), ...(due ? [cairoRetailDay()] : []), ...(q ? [q, ...Array(3).fill(searchPrefix(q))] : [])],
      "CASE WHEN j.status IN ('scheduled','assigned') THEN 0 ELSE 1 END, j.scheduled_on, j.scheduled_time, j.id DESC");
  });
  routes.get('/retail/installations/:id', permit(viewInstallations), c => installationDetail(c, identifier.parse(c.req.param('id'))));
  routes.post('/retail/installations', permit(viewInstallations), permit(manageInstallations), async c => {
    const data = await body(c, installation);
    checkAppointment(data.scheduled_on);
    return writeOperation(c, 'retail.installation.create', data, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_installations(id, invoice_id, product_id, device_id, service_address, scheduled_on,
        scheduled_time, assignee_id, note, actor_id, created_at)
        VALUES (${op}, ?, (SELECT product_id FROM retail_devices WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(...binds, data.invoice_id, data.device_id, data.device_id, data.service_address, data.scheduled_on,
          data.scheduled_time, data.assignee_id ?? null, data.note, actor, new Date().toISOString()),
    ], id => installationDetail(c, id, 201));
  });
  routes.post('/retail/installations/:id/reschedule', permit(viewInstallations), permit(manageInstallations), async c => {
    const jobId = identifier.parse(c.req.param('id'));
    const data = await body(c, schedule);
    checkAppointment(data.scheduled_on);
    return writeOperation(c, 'retail.installation.schedule', { jobId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_installation_actions(id, installation_id, kind, scheduled_on, scheduled_time,
        assignee_id, note, actor_id, created_at) VALUES (${op}, ?, 'schedule', ?, ?, ?, ?, ?, ?)`)
        .bind(...binds, jobId, data.scheduled_on, data.scheduled_time, data.assignee_id ?? null, data.note, actor, new Date().toISOString()),
    ], () => installationDetail(c, jobId, 201));
  });
  routes.post('/retail/installations/:id/deliver', permit(viewInstallations), async c => {
    const jobId = identifier.parse(c.req.param('id'));
    const data = await body(c, proof);
    checkProofDate(data.occurred_on);
    const actor = c.get('actor');
    const manages = hasPermission(actor, manageInstallations);
    if (!manages && !hasPermission(actor, performInstallations)) return fail(403, 'forbidden', 'ليست لديك صلاحية لإثبات التسليم.');
    return writeOperation(c, 'retail.installation.deliver', { jobId, ...data }, (op, binds, actorId) => [
      c.env.DB.prepare(`WITH job AS (SELECT invoice_id, product_id, device_id FROM retail_installations WHERE id = ?)
        INSERT INTO retail_device_events(id, invoice_id, product_id, device_id, kind, occurred_on, note, actor_id,
          proof_reference, created_at, installation_id)
        VALUES (${op}, (SELECT invoice_id FROM job), (SELECT product_id FROM job), (SELECT device_id FROM job),
          'delivered', ?, ?, ?, ?, ?, ?)`)
        .bind(jobId, ...binds, data.occurred_on, data.note, actorId, data.proof_reference, new Date().toISOString(), jobId),
    ], () => installationDetail(c, jobId, 201));
  });
  routes.post('/retail/installations/:id/complete', permit(viewInstallations), permit(performInstallations), async c => {
    const jobId = identifier.parse(c.req.param('id'));
    const data = await body(c, proof);
    checkProofDate(data.occurred_on);
    return writeOperation(c, 'retail.installation.complete', { jobId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_installation_actions(id, installation_id, kind, occurred_on,
        proof_reference, note, actor_id, created_at) VALUES (${op}, ?, 'complete', ?, ?, ?, ?, ?)`)
        .bind(...binds, jobId, data.occurred_on, data.proof_reference, data.note, actor, new Date().toISOString()),
    ], () => installationDetail(c, jobId, 201));
  });
  routes.post('/retail/installations/:id/cancel', permit(viewInstallations), permit(manageInstallations), async c => {
    const jobId = identifier.parse(c.req.param('id'));
    const data = await body(c, cancel);
    return writeOperation(c, 'retail.installation.cancel', { jobId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`INSERT INTO retail_installation_actions(id, installation_id, kind, note, actor_id, created_at)
        VALUES (${op}, ?, 'cancel', ?, ?, ?)`).bind(...binds, jobId, data.note, actor, new Date().toISOString()),
    ], () => installationDetail(c, jobId, 201));
  });
  return routes;
}
