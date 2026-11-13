import { Hono } from 'hono';
import { fail, permit, type ApiEnv } from './http';

export const retailMargin = new Hono<ApiEnv>();

retailMargin.get('/reports/retail-margin', permit('reports.view'), permit('products.cost.view'), async c => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const today = ['year', 'month', 'day'].map(part => parts.find(entry => entry.type === part)?.value).join('-');
  const from = c.req.query('from') || today.slice(0, 7) + '-01';
  const to = c.req.query('to') || today;
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || to < from || (Date.parse(to) - Date.parse(from)) / 86_400_000 > 365) {
    return fail(422, 'INVALID_REPORT_DATES', 'اختر فترة صحيحة لا تتجاوز ٣٦٦ يومًا.');
  }
  // Device costs come from priced receipts. Other lines are shown as missing verified cost, including imported zeros.
  // This is a sales-cohort report: later returns are reflected against the original sales, not dated as ledger journals.
  const { results } = await c.env.DB.prepare(`
    WITH sold AS (
      SELECT i.id AS invoice_id, l.product_id, p.category_id, l.unit_price_minor, l.quantity,
        l.quantity - COALESCE((SELECT SUM(r.quantity) FROM retail_return_items r
          WHERE r.invoice_id = i.id AND r.product_id = l.product_id), 0) AS net_quantity
      FROM invoices i JOIN invoice_items l ON l.invoice_id = i.id JOIN products p ON p.id = l.product_id
      WHERE i.refunded_at IS NULL AND COALESCE(i.invoice_date, date(i.created_at)) BETWEEN ? AND ?
    ), device_cost AS (
      SELECT s.invoice_id, s.product_id,
        COUNT(d.unit_cost_minor) AS costed_quantity, COALESCE(SUM(d.unit_cost_minor), 0) AS verified_cost_minor
      FROM sold s JOIN retail_device_sales d ON d.invoice_id = s.invoice_id AND d.product_id = s.product_id
      WHERE NOT EXISTS (SELECT 1 FROM retail_return_devices r WHERE r.invoice_id = d.invoice_id AND r.device_id = d.device_id)
      GROUP BY s.invoice_id, s.product_id
    )
    SELECT c.id AS category_id, COALESCE(c.name, 'بدون تصنيف') AS category,
      SUM(s.net_quantity) AS net_quantity, SUM(s.net_quantity * s.unit_price_minor) AS net_sales_minor,
      SUM(COALESCE(d.costed_quantity, 0)) AS verified_quantity,
      SUM(COALESCE(d.costed_quantity, 0) * s.unit_price_minor) AS verified_sales_minor,
      SUM(COALESCE(d.verified_cost_minor, 0)) AS verified_cost_minor,
      SUM(COALESCE(d.costed_quantity, 0) * s.unit_price_minor - COALESCE(d.verified_cost_minor, 0)) AS verified_margin_minor,
      SUM(s.net_quantity - COALESCE(d.costed_quantity, 0)) AS unverified_quantity
    FROM sold s LEFT JOIN device_cost d ON d.invoice_id = s.invoice_id AND d.product_id = s.product_id
    LEFT JOIN categories c ON c.id = s.category_id WHERE s.net_quantity > 0
    GROUP BY c.id, c.name ORDER BY net_sales_minor DESC, c.id
  `).bind(from, to).all();
  return c.json({ success: true, data: { from, to, items: results } });
});
