import { z } from 'zod';
import { fail, ok, type ApiContext } from './http';
import { cairoDayBoundary, cairoRetailDay } from './retail-shifts';

const date = z.iso.date();
const dayMillis = 86_400_000;

export function retailDateRange(c: ApiContext) {
  const today = cairoRetailDay();
  const prior = new Date(Date.parse(today) - 29 * dayMillis).toISOString().slice(0, 10);
  const from = date.parse(c.req.query('from') ?? prior);
  const to = date.parse(c.req.query('to') ?? today);
  const days = (Date.parse(to) - Date.parse(from)) / dayMillis;
  if (days < 0 || days > 365) return fail(400, 'INVALID_REPORT_DATES', 'اختر فترة تقرير لا تتجاوز 366 يومًا.');
  return { from, to, days };
}

export async function retailSalesReport(c: ApiContext) {
  const { from, to, days } = retailDateRange(c);
  const boundaries = Array.from({ length: days + 2 }, (_, index) => {
    const day = new Date(Date.parse(from) + index * dayMillis).toISOString().slice(0, 10);
    return { day, start: cairoDayBoundary(day) };
  });
  const first = new Date(boundaries[0].start * 1000).toISOString().slice(0, 10);
  const last = new Date(boundaries[days + 1].start * 1000 + dayMillis).toISOString().slice(0, 10);
  const bounds = [first, last];

  const daily = await c.env.DB.prepare(`
    WITH boundaries AS (
      SELECT json_extract(value, '$.day') AS day, json_extract(value, '$.start') AS start FROM json_each(?)
    ), periods AS (SELECT day, start, lead(start) OVER (ORDER BY start) AS stop FROM boundaries),
    refunds AS (
      SELECT id, total_minor, returned_minor, created_at, 'full_refund' AS source FROM invoice_refunds
      WHERE created_at >= ? AND created_at < ?
      UNION ALL
      SELECT id, total_minor, returned_minor, created_at, 'partial_refund' FROM retail_returns
      WHERE created_at >= ? AND created_at < ?
    ), events AS (
      SELECT unixepoch(created_at) AS time, 1 AS invoices, 0 AS refunds, total_minor AS gross_minor,
        0 AS refunded_minor, 0 AS paid, 0 AS returned, 0 AS cash_in, 0 AS cash_out, 0 AS unknown_in, 0 AS unknown_out
      FROM invoices WHERE created_at >= ? AND created_at < ?
      UNION ALL
      SELECT unixepoch(r.created_at), 0, 1, 0, r.total_minor, 0, r.returned_minor, 0,
        COALESCE((SELECT SUM(t.amount_minor) FROM retail_tenders t
          WHERE t.operation_id = r.id AND t.source = r.source AND t.method = 'cash'), 0),
        0, CASE WHEN b.shift_id IS NULL THEN r.returned_minor ELSE 0 END
      FROM refunds r LEFT JOIN retail_tender_batches b ON b.operation_id = r.id AND b.source = r.source
      UNION ALL
      SELECT unixepoch(p.created_at), 0, 0, 0, 0, p.amount_minor, 0,
        COALESCE((SELECT SUM(t.amount_minor) FROM retail_tenders t
          WHERE t.operation_id = p.id AND t.source = b.source AND t.method = 'cash'), 0),
        0, CASE WHEN b.shift_id IS NULL THEN p.amount_minor ELSE 0 END, 0
      FROM invoice_payments p LEFT JOIN retail_tender_batches b ON b.operation_id = p.id
        AND b.source = CASE WHEN p.source_type = 'installment' THEN 'installment_payment' ELSE 'invoice_payment' END
      WHERE p.created_at >= ? AND p.created_at < ?
    )
    SELECT day, SUM(invoices) AS invoices, SUM(refunds) AS refunds, SUM(gross_minor) AS gross_minor,
      SUM(refunded_minor) AS refunded_minor, SUM(gross_minor - refunded_minor) AS net_minor,
      SUM(paid) AS received_minor, SUM(returned) AS returned_minor,
      SUM(cash_in) AS cash_received_minor, SUM(cash_out) AS cash_returned_minor,
      SUM(unknown_in) AS unclassified_received_minor, SUM(unknown_out) AS unclassified_returned_minor
    FROM periods JOIN events ON time >= start AND time < stop GROUP BY day ORDER BY day DESC
  `).bind(JSON.stringify(boundaries), ...bounds, ...bounds, ...bounds, ...bounds).all();
  return ok(c, { from, to, timezone: 'Africa/Cairo', days: daily.results });
}
