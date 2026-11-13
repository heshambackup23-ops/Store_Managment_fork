import { Hono } from 'hono';
import { z } from 'zod';
import type { write } from './business';
import { body, fail, identifier, ok, permit, timestamp, type ApiContext, type ApiEnv } from './http';
import { retailTenderInput, retailTenderStatements } from './retail-shifts';
import { roundedLineSql, saleQuantity, withStockQuantities } from './retail-measurement';

const recordId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reason = z.string().trim().min(1).max(1000).refine(value => !value.includes('\0'));
const returnInput = z.strictObject({
  reason,
  expected_returned_minor: z.number().int().min(0).max(900_000_000_000_000).optional(),
  items: z.array(z.strictObject({
    product_id: recordId,
    quantity: saleQuantity,
    disposition: z.enum(['resale', 'quarantine']),
    device_ids: z.array(recordId).max(200).default([]),
  })).min(1).max(80),
  ...retailTenderInput,
}).refine(({ items }) => {
  const devices = items.flatMap(item => item.device_ids);
  return devices.length <= 200 && new Set(devices).size === devices.length
    && new Set(items.map(item => item.product_id + ':' + item.disposition)).size === items.length;
}, { path: ['items'], message: 'حدد كل صنف وحالة مرة واحدة، وكل جهاز مرة واحدة.' });

const exchangeInput = z.strictObject({
  replacement_invoice_id: recordId,
  confirm_walk_in: z.literal(true).optional(),
  reason,
});

type ReturnRow = {
  id: number;
  invoice_id: number;
  actor_id: number;
  total_minor: number;
  returned_minor: number;
  debt_reduction_minor: number;
  reason: string;
  created_at: string;
  items_json: string;
  exchange_json: string | null;
};

const returnRows = `
  SELECT r.id, r.invoice_id, r.actor_id, r.total_minor, r.returned_minor, r.debt_reduction_minor,
    r.reason, r.created_at, (
      SELECT json_group_array(json_object('product_id', line.product_id, 'product_name', i.product_name,
        'quantity', line.quantity, 'quantity_scale', i.quantity_scale,
        'disposition', line.disposition, 'unit_price_minor', line.unit_price_minor,
        'devices', json(COALESCE((SELECT json_group_array(json_object('id', d.id, 'serial_number', d.serial_number,
          'imei1', d.imei1, 'imei2', d.imei2)) FROM retail_return_devices rd JOIN retail_devices d ON d.id = rd.device_id
          WHERE rd.return_id = line.return_id AND rd.product_id = line.product_id AND rd.disposition = line.disposition), '[]'))))
      FROM retail_return_items line JOIN invoice_items i ON i.invoice_id = line.invoice_id AND i.product_id = line.product_id
      WHERE line.return_id = r.id
    ) AS items_json,
    CASE WHEN e.id IS NOT NULL THEN json_object('id', e.id, 'replacement_invoice_id', e.replacement_invoice_id,
      'replacement_total_minor', e.replacement_total_minor, 'difference_minor', e.difference_minor,
      'reason', e.reason, 'created_at', e.created_at) END AS exchange_json
  FROM retail_returns r LEFT JOIN retail_exchanges e ON e.return_id = r.id`;

function asReturn({ items_json, exchange_json, ...row }: ReturnRow) {
  return { ...row, items: JSON.parse(items_json) as unknown[], exchange: exchange_json ? JSON.parse(exchange_json) as unknown : null };
}

async function returnResponse(c: ApiContext, returnId: number) {
  const row = await c.env.DB.prepare(returnRows + ' WHERE r.id = ?').bind(returnId).first<ReturnRow>();
  if (!row) throw new Error('Missing return after write');
  return ok(c, asReturn(row), 201);
}

export function retailReturns(writeOperation: typeof write) {
  const router = new Hono<ApiEnv>();
  router.get('/invoices/:id/returns', permit('invoices.view'), async c => {
    const invoiceId = identifier.parse(c.req.param('id'));
    const db = c.env.DB;
    const [invoice, items, returns] = await db.batch<Record<string, unknown>>([
      db.prepare(`SELECT id, net_total_minor AS total_minor, net_paid_minor AS paid_minor, outstanding_minor,
        net_status AS status, retail_return_minor, retail_refunded_minor
        FROM invoices WHERE id = ?`).bind(invoiceId),
      db.prepare(`SELECT i.product_id, i.product_name, i.unit_price_minor, i.quantity AS sold_quantity, i.quantity_scale,
        CASE WHEN h.refunded_at IS NOT NULL THEN i.quantity ELSE COALESCE(SUM(ri.quantity), 0) END AS returned_quantity,
        CASE WHEN h.refunded_at IS NOT NULL THEN 0 ELSE i.quantity - COALESCE(SUM(ri.quantity), 0) END AS refundable_quantity,
        p.tracking, (p.tracking <> 'quantity' AND NOT EXISTS (
          SELECT 1 FROM retail_device_sales WHERE invoice_id = i.invoice_id AND product_id = i.product_id
        )) AS quarantine_only, (SELECT json_group_array(json_object('id', d.id, 'serial_number', d.serial_number,
          'imei1', d.imei1, 'imei2', d.imei2, 'status', d.status)) FROM retail_device_sales s JOIN retail_devices d ON d.id = s.device_id
          WHERE h.refunded_at IS NULL AND s.invoice_id = i.invoice_id AND s.product_id = i.product_id
            AND d.status = 'sold' AND NOT EXISTS (
            SELECT 1 FROM retail_return_devices rd WHERE rd.invoice_id = s.invoice_id AND rd.device_id = s.device_id
          )) AS devices_json
        FROM invoice_items i JOIN invoices h ON h.id = i.invoice_id JOIN products p ON p.id = i.product_id
        LEFT JOIN retail_return_items ri ON ri.invoice_id = i.invoice_id AND ri.product_id = i.product_id
        WHERE i.invoice_id = ? GROUP BY i.product_id ORDER BY i.product_id`).bind(invoiceId),
      db.prepare(returnRows + ' WHERE r.invoice_id = ? ORDER BY r.id DESC LIMIT 100').bind(invoiceId),
    ]);
    if (!invoice.results[0]) return fail(404, 'NOT_FOUND', 'الفاتورة غير موجودة.');
    return ok(c, { ...invoice.results[0], items: items.results.map(({ devices_json, ...item }) => ({
      ...item, devices: JSON.parse(String(devices_json ?? '[]')) as unknown[],
    })), returns: (returns.results as Array<Record<string, unknown> & ReturnRow>).map(asReturn) });
  });

  router.post('/invoices/:id/returns', permit('invoices.view'), permit('invoices.refund'), async c => {
    const invoiceId = identifier.parse(c.req.param('id'));
    const data = await body(c, returnInput);
    const items = data.items.map(item => ({ ...item, device_ids: [...item.device_ids].sort((a, b) => a - b) }))
      .sort((a, b) => a.product_id - b.product_id || a.disposition.localeCompare(b.disposition));
    const db = c.env.DB;
    const requestedItems = JSON.stringify(await withStockQuantities(db, items));
    const prior = 'COALESCE(previous.sum_quantity, 0)';
    return writeOperation(c, 'invoice.return', { invoiceId, ...data, items }, (op, binds, actor) => [
      db.prepare(`
        WITH basket AS (
          SELECT COALESCE(SUM(
            ${roundedLineSql('i.unit_price_minor', prior + ' + MIN(requested.quantity, i.quantity)', 'i.quantity_scale')}
            - ${roundedLineSql('i.unit_price_minor', prior, 'i.quantity_scale')}
          ), 0) AS total
          FROM (SELECT json_extract(value, '$.product_id') AS product_id, SUM(json_extract(value, '$.quantity')) AS quantity
            FROM json_each(?) GROUP BY 1) requested
          JOIN invoice_items i ON i.invoice_id = ? AND i.product_id = requested.product_id
          LEFT JOIN (SELECT invoice_id, product_id, SUM(quantity) AS sum_quantity
            FROM retail_return_items WHERE invoice_id = ? GROUP BY invoice_id, product_id) previous
            ON previous.invoice_id = i.invoice_id AND previous.product_id = i.product_id
        ), debt AS (
          SELECT total, MIN(total, COALESCE((SELECT outstanding_minor FROM invoices WHERE id = ?), 0)) AS reduction FROM basket
        )
        INSERT INTO retail_returns (id, invoice_id, actor_id, total_minor, returned_minor, debt_reduction_minor, expected_returned_minor,
          reason, requested_items, created_at)
        SELECT ${op}, ?, ?, total, total - reduction, reduction, ?, ?, ?, ${timestamp} FROM debt
      `).bind(requestedItems, invoiceId, invoiceId, invoiceId, ...binds, invoiceId, actor,
        data.expected_returned_minor ?? null, data.reason, requestedItems),
      ...retailTenderStatements(db, op, binds, actor, 'partial_refund', data),
    ], returnId => returnResponse(c, returnId));
  });

  router.post('/invoices/:id/returns/:returnId/exchange', permit('invoices.view'), permit('invoices.refund'), async c => {
    const invoiceId = identifier.parse(c.req.param('id'));
    const returnId = identifier.parse(c.req.param('returnId'));
    const data = await body(c, exchangeInput);
    const db = c.env.DB;
    return writeOperation(c, 'invoice.exchange.link', { invoiceId, returnId, ...data }, (op, binds, actor) => [
      db.prepare(`INSERT INTO retail_exchanges (id, return_id, replacement_invoice_id, replacement_total_minor,
        difference_minor, walk_in_confirmed, reason, actor_id, created_at)
        VALUES (${op}, COALESCE((SELECT id FROM retail_returns WHERE id = ? AND invoice_id = ?), 0), ?,
          COALESCE((SELECT total_minor FROM invoices WHERE id = ?), 0),
          COALESCE((SELECT total_minor FROM invoices WHERE id = ?) - (SELECT total_minor FROM retail_returns WHERE id = ?), 0),
          ?, ?, ?, ${timestamp})`)
        .bind(...binds, returnId, invoiceId, data.replacement_invoice_id, data.replacement_invoice_id,
          data.replacement_invoice_id, returnId, Number(data.confirm_walk_in === true), data.reason, actor),
    ], async id => ok(c, await db.prepare(`SELECT id, return_id, replacement_invoice_id, replacement_total_minor,
      difference_minor, reason, created_at FROM retail_exchanges WHERE id = ?`).bind(id).first(), 201));
  });
  return router;
}
