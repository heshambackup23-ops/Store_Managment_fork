import { Hono } from 'hono'
import { fail, hasPermission, ok } from './http'
import type { ApiEnv } from './http'

const cairoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })

function dateKey(value: Date) {
  const parts = cairoDate.formatToParts(value)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${year}-${month}-${day}`
}

function cairoPeriodStart(now: Date, daysAgo: number) {
  const utcMidnight = Date.parse(dateKey(now) + 'T00:00:00.000Z') - daysAgo * 86400000
  const target = new Date(utcMidnight).toISOString().slice(0, 10)
  let low = utcMidnight - 12 * 3600000
  let high = utcMidnight + 12 * 3600000
  while (high - low > 60000) {
    const mid = Math.floor((low + high) / 120000) * 60000
    if (dateKey(new Date(mid)) < target) low = mid
    else high = mid
  }
  return new Date(high).toISOString().slice(0, 19).replace('T', ' ')
}

function asNumber(value: unknown) {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) fail(409, 'aggregate_range', 'مجموع التقرير خارج النطاق الرقمي المدعوم.')
  return number
}

export const dashboard = new Hono<ApiEnv>()

dashboard.get('/dashboard', async (c) => {
  const user = c.get('actor')
  const db = c.env.DB
  const queries: D1PreparedStatement[] = []
  if (hasPermission(user, 'products.view')) {
    queries.push(db.prepare(`SELECT count(*) AS products,
      coalesce(sum(stock > 0 AND stock <= low_stock_threshold), 0) AS low_stock,
      coalesce(sum(stock = 0), 0) AS out_of_stock FROM products WHERE active = 1`))
  }
  if (hasPermission(user, 'customers.view')) {
    queries.push(db.prepare('SELECT count(*) AS customers FROM customers'))
  }
  if (hasPermission(user, 'invoices.view') || hasPermission(user, 'reports.view')) {
    const now = new Date()
    const daily = cairoPeriodStart(now, 0)
    const weekly = cairoPeriodStart(now, 6)
    queries.push(db.prepare(`
      SELECT
        (SELECT count(*) FROM invoices WHERE refunded_at IS NULL) AS invoices,
        CAST((SELECT coalesce(sum(total_minor), 0) FROM invoices WHERE refunded_at IS NULL) AS TEXT) AS sales_minor,
        CAST((SELECT coalesce(sum(total_minor), 0) FROM invoices WHERE created_at >= ?)
          - (SELECT coalesce(sum(total_minor), 0) FROM invoice_refunds WHERE created_at >= ?) AS TEXT) AS daily_sales_minor,
        CAST((SELECT coalesce(sum(total_minor), 0) FROM invoices WHERE created_at >= ?)
          - (SELECT coalesce(sum(total_minor), 0) FROM invoice_refunds WHERE created_at >= ?) AS TEXT) AS weekly_sales_minor
    `).bind(daily, daily, weekly, weekly))
  }
  if (hasPermission(user, 'wallets.view')) {
    queries.push(db.prepare(`SELECT count(*) AS wallets, CAST(coalesce(sum(balance_minor), 0) AS TEXT)
      AS wallet_balance_minor FROM wallets WHERE active = 1`))
  }
  if (hasPermission(user, 'installments.view')) {
    queries.push(db.prepare('SELECT count(*) AS installments FROM installments WHERE status = \'open\''))
  }
  if (hasPermission(user, 'debts.view')) {
    queries.push(db.prepare(`SELECT CAST(coalesce(sum(principal_minor - paid_minor), 0) AS TEXT)
      AS personal_debt_minor FROM personal_debts d WHERE direction = 'receivable'
        AND NOT EXISTS (SELECT 1 FROM debt_voids WHERE debt_id = d.id)`))
  }
  if (hasPermission(user, 'maintenance.view')) {
    queries.push(db.prepare(`SELECT count(*) AS maintenance FROM maintenance_requests
      WHERE archived_at IS NULL AND status IN ('received', 'in_progress', 'completed')`))
  }
  if (queries.length === 0) return ok(c, {})
  const rows = await db.batch(queries)
  const metrics = Object.fromEntries(rows.flatMap((row) => Object.entries(row.results[0] ?? {}))
    .map(([key, value]) => [key, asNumber(value)]))
  return ok(c, metrics)
})
