import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { body, fail, identifier, page, paginated, permit, type ApiEnv } from './http';
import { retailDeviceInput } from './retail-devices';

const reference = z.string().trim().min(1).max(100);
const reason = z.string().trim().min(1).max(1000);
const receiptInput = z.object({
  reference,
  items: z.array(z.object({
    product_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    quantity: z.number().int().min(1).max(1_000_000),
    devices: z.array(retailDeviceInput).max(200).optional(),
  }).strict()).min(1).max(40).refine(items => new Set(items.map(item => item.product_id)).size === items.length),
  received_on: z.iso.date().optional(),
  note: z.string().trim().max(1000).default(''),
}).strict();
const cairoCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
});

function cairoDate() {
  const components = cairoCalendar.formatToParts(new Date());
  return ['year', 'month', 'day'].map(part => components.find(value => value.type === part)?.value).join('-');
}

export function purchaseReceiving(writeOperation: typeof write) {
  const routes = new Hono<ApiEnv>();

  routes.get('/purchases/:id/receipts', permit('suppliers.view'), async c => {
    const purchaseId = identifier.parse(c.req.param('id'));
    const paging = page(c);
    const db = c.env.DB;
    const [purchase, rows, total] = await db.batch<Record<string, unknown>>([
      db.prepare('SELECT id FROM purchases WHERE id = ?').bind(purchaseId),
      db.prepare(`
        SELECT r.*, v.id AS reversed_by, v.reason AS reversal_reason, v.created_at AS reversed_at,
          (SELECT json_group_array(json_object(
            'product_id', i.product_id, 'product_name', i.product_name,
            'product_barcode', i.product_barcode, 'quantity', i.quantity, 'devices', json(i.devices_json)))
           FROM purchase_stock_receipt_items i WHERE i.receipt_id = r.id) AS items_json
        FROM purchase_stock_receipts r LEFT JOIN purchase_stock_reversals v ON v.receipt_id = r.id
        WHERE r.purchase_id = ? ORDER BY r.id DESC LIMIT ? OFFSET ?
      `).bind(purchaseId, paging.limit, paging.offset),
      db.prepare('SELECT COUNT(*) AS total FROM purchase_stock_receipts WHERE purchase_id = ?').bind(purchaseId),
    ]);
    if (!purchase.results[0]) return fail(404, 'not_found', 'فاتورة الشراء غير موجودة.');
    const data = rows.results.map(({ items_json, ...row }) => ({ ...row, items: JSON.parse(String(items_json)) }));
    return paginated(c, data, Number(total.results[0]?.total ?? 0), paging);
  });

  routes.post('/purchases/:id/receipts/validate-devices', permit('suppliers.manage'), permit('inventory.manage'), async c => {
    const purchaseId = identifier.parse(c.req.param('id'));
    const { devices } = await body(c, z.strictObject({ devices: z.array(retailDeviceInput).min(1).max(200) }));
    const db = c.env.DB;
    const [purchase, existing] = await db.batch<{ position: number }>([
      db.prepare('SELECT 1 FROM purchases WHERE id = ?').bind(purchaseId),
      db.prepare(`SELECT CAST(j.key AS INTEGER) AS position FROM json_each(?) j
        WHERE EXISTS (SELECT 1 FROM retail_devices d WHERE d.status <> 'voided' AND (
          d.serial_number = json_extract(j.value, '$.serial_number') COLLATE NOCASE
          OR d.imei1 IN (json_extract(j.value, '$.imei1'), json_extract(j.value, '$.imei2'))
          OR d.imei2 IN (json_extract(j.value, '$.imei1'), json_extract(j.value, '$.imei2'))
        )) ORDER BY position`).bind(JSON.stringify(devices)),
    ]);
    if (!purchase.results.length) return fail(404, 'not_found', 'فاتورة الشراء غير موجودة.');
    return c.json({ success: true, data: { duplicate_positions: existing.results.map(row => Number(row.position)) } });
  });

  routes.post('/purchases/:id/receipts', permit('suppliers.manage'), permit('inventory.manage'), async c => {
    const purchaseId = identifier.parse(c.req.param('id'));
    const data = await body(c, receiptInput);
    const today = cairoDate();
    if (data.received_on && data.received_on > today) return fail(422, 'future_receipt', 'تاريخ الاستلام لا يمكن أن يكون في المستقبل.');
    const items = [...data.items].sort((a, b) => a.product_id - b.product_id);
    if (items.reduce((total, item) => total + (item.devices?.length ?? 0), 0) > 200) {
      return fail(422, 'retail_receipt_device_limit', 'سجّل ما يصل إلى 200 جهاز في كل سند استلام.');
    }
    return writeOperation(c, 'purchase.stock.receive', { ...data, purchaseId, items }, (op, binds, actor) => [
      c.env.DB.prepare(`
        INSERT INTO purchase_stock_receipts (id, purchase_id, reference, received_on, note, actor_id)
        VALUES (${op}, ?, ?, ?, ?, ?)
      `).bind(...binds, purchaseId, data.reference, data.received_on ?? today, data.note, actor),
      c.env.DB.prepare(`
        INSERT INTO purchase_stock_receipt_items (receipt_id, product_id, product_name, product_barcode, quantity, devices_json)
        SELECT ${op}, json_extract(j.value, '$.product_id'), p.name, p.barcode, json_extract(j.value, '$.quantity'),
          COALESCE(json_extract(j.value, '$.devices'), '[]')
        FROM json_each(?) j LEFT JOIN products p ON p.id = json_extract(j.value, '$.product_id')
      `).bind(...binds, JSON.stringify(items)),
    ]);
  });

  routes.post('/purchases/:id/receipts/:receiptId/reverse', permit('suppliers.manage'), permit('inventory.manage'), async c => {
    const purchaseId = identifier.parse(c.req.param('id'));
    const receiptId = identifier.parse(c.req.param('receiptId'));
    const data = await body(c, z.object({ reason }).strict());
    return writeOperation(c, 'purchase.stock.reverse', { purchaseId, receiptId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`
        INSERT INTO purchase_stock_reversals (id, receipt_id, reason, actor_id)
        VALUES (${op}, (SELECT id FROM purchase_stock_receipts WHERE id = ? AND purchase_id = ?), ?, ?)
      `).bind(...binds, receiptId, purchaseId, data.reason, actor),
    ]);
  });

  return routes;
}
