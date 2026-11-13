import { Hono } from 'hono';
import { z } from 'zod';
import { identifier, page, permit, type ApiEnv } from './http';
import { cairoRetailDay } from './retail-shifts';

export const retailInventoryValuation = new Hono<ApiEnv>();

// Aggregate quantities per SKU before combining them with device-level cost. The available value
// and the isolated/repair value are separate so a quarantined unit never inflates saleable stock.
const valuation = `
  WITH devices AS (
    SELECT d.product_id, d.status, a.effective_status,
      COALESCE(d.intake_cost_minor, o.unit_cost_minor + o.landed_unit_minor) AS verified_cost
    FROM retail_devices d
    LEFT JOIN purchase_stock_receipts r ON r.id = d.receipt_id
    LEFT JOIN purchase_order_items o ON o.purchase_id = r.purchase_id AND o.product_id = d.product_id
    LEFT JOIN retail_active_device_dispositions a ON a.device_id = d.id
    WHERE d.status IN ('available','quarantined','stocktake_missing')
  ), tracked AS (
    SELECT product_id,
      SUM(status = 'available') AS available_devices,
      SUM(status = 'available' AND verified_cost IS NULL) AS unvalued_available_devices,
      SUM(CASE WHEN status = 'available' THEN COALESCE(verified_cost, 0) ELSE 0 END) AS available_device_value,
      SUM(status = 'quarantined' AND effective_status IS NOT 'written_off') AS held_devices,
      SUM(status = 'quarantined' AND effective_status IS NOT 'written_off' AND verified_cost IS NULL) AS unvalued_held_devices,
      SUM(CASE WHEN status = 'quarantined' AND effective_status IS NOT 'written_off' THEN COALESCE(verified_cost, 0) ELSE 0 END) AS held_device_value,
      SUM(status = 'stocktake_missing') AS missing_devices
    FROM devices GROUP BY product_id
  ), items AS (
    SELECT p.category_id, COALESCE(c.name, 'بدون تصنيف') AS category,
      SUM(CASE WHEN p.tracking = 'quantity' THEN p.stock ELSE 0 END) AS quantity_units,
      SUM(CASE WHEN p.tracking = 'quantity' AND p.inventory_value_minor IS NULL THEN p.stock ELSE 0 END) AS unvalued_quantity_units,
      SUM(CASE WHEN p.tracking = 'quantity' AND p.stock > 0 THEN COALESCE(p.inventory_value_minor, 0) ELSE 0 END) AS quantity_value,
      SUM(COALESCE(t.available_devices, 0)) AS available_devices,
      SUM(COALESCE(t.unvalued_available_devices, 0)) AS unvalued_available_devices,
      SUM(COALESCE(t.available_device_value, 0)) AS available_device_value,
      SUM(COALESCE(t.held_devices, 0)) AS held_devices,
      SUM(COALESCE(t.unvalued_held_devices, 0)) AS unvalued_held_devices,
      SUM(COALESCE(t.held_device_value, 0)) AS held_device_value,
      SUM(COALESCE(t.missing_devices, 0)) AS missing_devices
    FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN tracked t ON t.product_id = p.id
    WHERE (p.stock > 0 OR COALESCE(t.held_devices, 0) > 0 OR COALESCE(t.missing_devices, 0) > 0)
      AND (? IS NULL OR p.category_id = ?)
    GROUP BY p.category_id, c.name
  )
`;
const counts = ['quantity_units', 'unvalued_quantity_units', 'available_devices', 'unvalued_available_devices',
  'held_devices', 'unvalued_held_devices', 'missing_devices'];
const values = ['quantity_value', 'available_device_value', 'held_device_value'];
const totalColumns = [...counts.map(column => `COALESCE(SUM(${column}), 0) AS ${column}`),
  ...values.map(column => `CAST(COALESCE(SUM(${column}), 0) AS TEXT) AS ${column}`)].join(', ');
const rowColumns = [...counts, ...values.map(column => `CAST(${column} AS TEXT) AS ${column}`)].join(', ');

retailInventoryValuation.get('/reports/inventory-valuation', permit('reports.view'), permit('products.cost.view'), async c => {
  const { category_id } = z.object({ category_id: identifier.optional() }).parse(c.req.query());
  const paging = page(c);
  const category = category_id ?? null;
  const [rows, totals] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(valuation + `SELECT category_id, category, ${rowColumns} FROM items ORDER BY category, category_id LIMIT ? OFFSET ?`)
      .bind(category, category, paging.limit, paging.offset),
    c.env.DB.prepare(valuation + `SELECT COUNT(*) AS total_rows, ${totalColumns} FROM items`).bind(category, category),
  ]);
  const { total_rows, ...summary } = totals.results[0];
  return c.json({ success: true, data: { as_of: cairoRetailDay(), items: rows.results, totals: summary }, meta: {
    page: paging.page, per_page: paging.limit, total: Number(total_rows),
  } });
});
