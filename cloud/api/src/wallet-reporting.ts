import { Hono } from 'hono';
import { z } from 'zod';
import { fail, ok, permit, searchPrefix, selectPage, type ApiEnv } from './http';

export const walletReporting = new Hono<ApiEnv>();
const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
});
const date = z.iso.date();

function businessDate(time: number) {
  const parts = calendar.formatToParts(time);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-');
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function utcBoundary(day: string) {
  const nominal = Date.parse(day + 'T00:00:00.000Z');
  // Cairo's offset can shift at midnight. Find the first UTC minute in the business day.
  let first = -720;
  let last = 720;
  while (last - first > 1) {
    const center = Math.floor((first + last) / 2);
    if (businessDate(nominal + center * 60_000) < day) first = center;
    else last = center;
  }
  return new Date(nominal + last * 60_000).toISOString().slice(0, 19).replace('T', ' ');
}

const transferColumns = [
  'transactions', 'sent_minor', 'received_minor', 'commission_minor', 'fee_minor', 'new_deferred_minor',
] as const;
type TransferColumn = typeof transferColumns[number];
type Totals = Record<TransferColumn, number>;

const transferSum = `
  COUNT(*) AS transactions,
  CAST(COALESCE(SUM(CASE WHEN t.kind = 'send' THEN t.amount_minor END), 0) AS TEXT) AS sent_minor,
  CAST(COALESCE(SUM(CASE WHEN t.kind = 'receive' THEN t.amount_minor END), 0) AS TEXT) AS received_minor,
  CAST(COALESCE(SUM(t.commission_minor), 0) AS TEXT) AS commission_minor,
  CAST(COALESCE(SUM(t.fee_minor), 0) AS TEXT) AS fee_minor,
  CAST(COALESCE(SUM(d.principal_minor), 0) AS TEXT) AS new_deferred_minor
`;
const completedTransfers = `
  FROM wallet_transactions t
  LEFT JOIN wallet_debts d ON d.wallet_transaction_id = t.id AND d.voided_at IS NULL
  WHERE t.business_day >= ? AND t.business_day < ?
    AND t.kind IN ('send', 'receive')
    AND NOT EXISTS (SELECT 1 FROM wallet_transactions r WHERE r.reversal_of = t.id)
`;
const moneyColumns = ['cash_movement_minor', 'cash_collections_minor'] as const;

function number(value: unknown) {
  const result = Number(value ?? 0);
  if (!Number.isSafeInteger(result)) return fail(409, 'aggregate_range', 'مجموع التقرير خارج النطاق الرقمي المدعوم.');
  return result;
}

function transferTotals(row: Record<string, unknown> | undefined): Totals {
  return Object.fromEntries(transferColumns.map(key => [key, number(row?.[key])])) as Totals;
}

function reportRow(row: Record<string, unknown> | undefined, expense = 0) {
  const totals = transferTotals(row);
  const profit_minor = number(totals.commission_minor - totals.fee_minor);
  return { ...totals, profit_minor, expense_minor: expense, net_minor: number(profit_minor - expense) };
}

const reportQuery = z.object({
  mode: z.enum(['daily', 'monthly']).default('daily'),
  date: date.optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
});
walletReporting.get('/reports/wallets/period', permit('wallets.cash'), async c => {
  const query = reportQuery.parse(c.req.query());
  const today = businessDate(Date.now());
  const from = query.mode === 'daily' ? query.date ?? today : (query.month ?? today.slice(0, 7)) + '-01';
  if (from < '1900-01-01' || from > '9998-12-31') return fail(422, 'invalid_dates', 'التاريخ خارج نطاق التقرير المدعوم.');
  const next = new Date(from + 'T00:00:00.000Z');
  if (query.mode === 'daily') next.setUTCDate(next.getUTCDate() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  const until = isoDate(next);
  if (!date.safeParse(until).success) return fail(422, 'invalid_dates', 'التاريخ خارج نطاق التقرير المدعوم.');
  const to = isoDate(new Date(next.valueOf() - 86_400_000));
  const utcFrom = utcBoundary(from);
  const utcUntil = utcBoundary(until);
  const db = c.env.DB;
  const [totals, wallets, byDay, expenses, cash] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${transferSum} ${completedTransfers}`).bind(from, until),
    db.prepare(`
      SELECT t.wallet_id, (SELECT name FROM wallets WHERE id = t.wallet_id) AS name, ${transferSum}
      ${completedTransfers} GROUP BY t.wallet_id ORDER BY name, t.wallet_id
    `).bind(from, until),
    db.prepare(`SELECT t.business_day AS day, ${transferSum} ${completedTransfers}
      GROUP BY t.business_day ORDER BY t.business_day`).bind(from, until),
    db.prepare(`
      SELECT e.business_day AS day, CAST(SUM(-e.delta_minor) AS TEXT) AS expense_minor
      FROM wallet_cash_entries e
      WHERE e.kind = 'expense' AND e.business_day >= ? AND e.business_day < ?
        AND NOT EXISTS (SELECT 1 FROM wallet_cash_entries r WHERE r.reversal_of = e.id)
      GROUP BY e.business_day ORDER BY e.business_day
    `).bind(from, until),
    db.prepare(`
      WITH cash_entries AS (
        SELECT COALESCE(SUM(cash_delta_minor), 0) AS cash FROM wallet_transactions WHERE business_day >= ? AND business_day < ?
        UNION ALL SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_debt_payments WHERE created_at >= ? AND created_at < ?
        UNION ALL SELECT COALESCE(SUM(delta_minor), 0) FROM wallet_cash_entries WHERE business_day >= ? AND business_day < ?
        UNION ALL SELECT -COALESCE(SUM(amount_minor), 0) FROM wallet_profit_withdrawals
          WHERE wallet_id IS NULL AND business_day >= ? AND business_day < ?
      )
      SELECT CAST(SUM(cash) AS TEXT) AS cash_movement_minor,
        CAST((SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_debt_payments WHERE created_at >= ? AND created_at < ?) AS TEXT) AS cash_collections_minor
      FROM cash_entries
    `).bind(from, until, utcFrom, utcUntil, from, until, from, until, utcFrom, utcUntil),
  ]);

  const activity = new Map(byDay.results.map(row => [String(row.day), row]));
  const costs = new Map(expenses.results.map(row => [String(row.day), number(row.expense_minor)]));
  const days = [...new Set([...activity.keys(), ...costs.keys()])].sort();
  const expenseTotal = [...costs.values()].reduce((total, cost) => number(total + cost), 0);
  const cashTotals = Object.fromEntries(moneyColumns.map(key => [key, number(cash.results[0]?.[key])]));
  return ok(c, {
    mode: query.mode, timezone: 'Africa/Cairo', from, to,
    totals: { ...reportRow(totals.results[0], expenseTotal), ...cashTotals },
    wallets: wallets.results.map(row => ({ wallet_id: row.wallet_id, name: row.name, ...reportRow(row) })),
    days: days.map(day => ({ day, ...reportRow(activity.get(day), costs.get(day)) })),
  });
});

const auditQuery = z.object({
  q: z.string().trim().max(80).optional(),
  action: z.string().trim().max(100).optional(),
  from: date.optional(),
  to: date.optional(),
});
walletReporting.get('/wallet-audit', async c => {
  if (c.get('actor').role !== 'superadmin') return fail(403, 'forbidden', 'سجل تدقيق المحافظ متاح للمسؤول العام.');
  const filters = auditQuery.parse(c.req.query());
  if (filters.from && filters.to && filters.from > filters.to) {
    return fail(422, 'invalid_dates', 'تاريخ بداية الفترة يأتي بعد نهايتها.');
  }
  const predicates = ["(a.action LIKE 'wallet.%' OR a.action GLOB 'wallet_debt_payments.*')"];
  const values: (string | number)[] = [];
  if (filters.q) {
    predicates.push("(u.name LIKE ? ESCAPE '\\' OR a.action LIKE ? ESCAPE '\\' OR CAST(a.entity_id AS TEXT) = ?)");
    values.push(searchPrefix(filters.q), searchPrefix(filters.q), filters.q.replace(/^#/, ''));
  }
  if (filters.action) {
    predicates.push('a.action = ?');
    values.push(filters.action);
  }
  if (filters.from) {
    predicates.push('a.created_at >= ?');
    values.push(filters.from);
  }
  if (filters.to) {
    predicates.push("a.created_at < date(?, '+1 day')");
    values.push(filters.to);
  }
  return selectPage(c, 'a.id, a.actor_id, u.name AS actor_name, a.action, a.entity_type, a.entity_id, a.created_at',
    'audit_logs a LEFT JOIN users u ON u.id = a.actor_id', 'WHERE ' + predicates.join(' AND '), values, 'a.id DESC');
});
