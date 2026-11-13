import { Hono } from 'hono'
import { fail, hasPermission, identifier, page, permit } from './http'
import type { ApiEnv } from './http'

export const customerLedger = new Hono<ApiEnv>()

const sources = [
  {
    permission: 'invoices.view',
    key: 'invoices_due_minor',
    sql: `
      SELECT 'invoice' AS kind, i.id AS record_id, i.total_minor AS amount_minor, i.paid_minor,
        CASE WHEN i.refunded_at IS NULL THEN i.total_minor - i.paid_minor ELSE 0 END AS remaining_minor,
        i.status, i.created_at, NULL AS due_date, NULL AS related_invoice_id, NULL AS direction,
        CASE WHEN i.refunded_at IS NULL AND ((SELECT visible FROM visible_installments) = 0 OR NOT EXISTS (
          SELECT 1 FROM installments a WHERE a.invoice_id = i.id AND a.voided_at IS NULL
        )) THEN i.total_minor - i.paid_minor ELSE 0 END AS balance_minor,
        'invoices_due_minor' AS balance_key
      FROM invoices i WHERE i.customer_id = ?1
    `,
  },
  {
    permission: 'installments.view',
    key: 'installments_due_minor',
    sql: `
      SELECT 'installment', a.id, a.principal_minor, a.paid_minor,
        CASE WHEN a.voided_at IS NULL THEN a.principal_minor - a.paid_minor ELSE 0 END,
        a.status, a.created_at, a.due_date, a.invoice_id, NULL,
        CASE WHEN a.voided_at IS NULL THEN a.principal_minor - a.paid_minor ELSE 0 END, 'installments_due_minor'
      FROM installments a WHERE a.customer_id = ?1
    `,
  },
  {
    permission: 'debts.view',
    key: 'personal_receivables_minor',
    secondKey: 'personal_payables_minor',
    sql: `
      SELECT 'personal_debt', d.id, d.principal_minor, d.paid_minor,
        CASE WHEN v.debt_id IS NULL THEN d.principal_minor - d.paid_minor ELSE 0 END,
        CASE WHEN v.debt_id IS NULL THEN d.status ELSE 'voided' END, d.created_at, d.due_date, NULL, d.direction,
        CASE WHEN v.debt_id IS NULL THEN d.principal_minor - d.paid_minor ELSE 0 END,
        CASE WHEN d.direction = 'receivable' THEN 'personal_receivables_minor' ELSE 'personal_payables_minor' END
      FROM personal_debts d LEFT JOIN debt_voids v ON v.debt_id = d.id WHERE d.customer_id = ?1
    `,
  },
  {
    permission: 'wallets.view',
    key: 'wallet_receivables_minor',
    secondKey: 'wallet_payables_minor',
    sql: `
      SELECT 'wallet_debt', w.id, w.principal_minor, w.paid_minor,
        CASE WHEN w.voided_at IS NULL THEN w.principal_minor - w.paid_minor ELSE 0 END,
        w.status, w.created_at, w.due_date, NULL, w.direction,
        CASE WHEN w.voided_at IS NULL THEN w.principal_minor - w.paid_minor ELSE 0 END,
        CASE WHEN w.direction = 'receivable' THEN 'wallet_receivables_minor' ELSE 'wallet_payables_minor' END
      FROM wallet_debts w WHERE w.customer_id = ?1
    `,
  },
  {
    permission: 'maintenance.view',
    key: 'maintenance_due_minor',
    sql: `
      SELECT 'maintenance', m.id, m.price_minor, m.paid_minor,
        CASE WHEN m.status = 'cancelled' OR m.archived_at IS NOT NULL THEN 0 ELSE m.price_minor - m.paid_minor END,
        CASE WHEN m.archived_at IS NULL THEN m.status ELSE 'archived' END,
        m.created_at, NULL, NULL, NULL,
        CASE WHEN m.status = 'cancelled' OR m.archived_at IS NOT NULL THEN 0 ELSE m.price_minor - m.paid_minor END,
        'maintenance_due_minor'
      FROM maintenance_requests m WHERE m.customer_id = ?1
    `,
  },
] as const

customerLedger.get('/customers/:id/ledger', permit('customers.view'), async (c) => {
  const id = identifier.parse(c.req.param('id'))
  const paging = page(c)
  const actor = c.get('actor')
  const db = c.env.DB
  const customerQuery = db.prepare(`
    SELECT id, name, phone, email, address, notes, created_at, updated_at
    FROM customers WHERE id = ?
  `).bind(id)
  const visible = sources.filter(({ permission }) => hasPermission(actor, permission))
  const combinedInstallments = Number(hasPermission(actor, 'installments.view'))
  const balances: Record<string, number> = Object.fromEntries(visible
    .flatMap((source) => 'secondKey' in source ? [source.key, source.secondKey] : [source.key])
    .map((key) => [key, 0]))
  if (!visible.length) {
    const customer = await customerQuery.first()
    if (!customer) fail(404, 'not_found', 'العميل غير موجود.')
    return c.json({
      success: true, data: { customer, balances, entries: [] },
      meta: { page: paging.page, per_page: paging.limit, total: 0, last_page: 1 },
    })
  }

  const combine = `WITH visible_installments AS (SELECT ?2 AS visible), ledger (
    kind, record_id, amount_minor, paid_minor, remaining_minor,
    status, created_at, due_date, related_invoice_id, direction, balance_minor, balance_key
  ) AS (${visible.map(({ sql }) => sql).join(' UNION ALL ')})`
  const [customers, entries, totals] = await db.batch<Record<string, unknown>>([
    customerQuery,
    db.prepare(`${combine}
      SELECT kind, record_id, amount_minor, paid_minor, remaining_minor, status, created_at,
        due_date, related_invoice_id, direction
      FROM ledger ORDER BY julianday(created_at) DESC, kind, record_id DESC LIMIT ?3 OFFSET ?4
    `).bind(id, combinedInstallments, paging.limit, paging.offset),
    db.prepare(`${combine}
      SELECT balance_key, CAST(SUM(balance_minor) AS TEXT) AS balance_minor, COUNT(*) AS count
      FROM ledger GROUP BY balance_key
    `).bind(id, combinedInstallments),
  ])
  const customer = customers.results[0]
  if (!customer) fail(404, 'not_found', 'العميل غير موجود.')
  let total = 0
  for (const row of totals.results) {
    const balance = Number(row.balance_minor)
    if (!Number.isSafeInteger(balance)) fail(409, 'aggregate_range', 'مجموع الرصيد خارج النطاق الرقمي المدعوم.')
    balances[String(row.balance_key)] = balance
    total += Number(row.count)
  }
  return c.json({
    success: true, data: { customer, balances, entries: entries.results },
    meta: { page: paging.page, per_page: paging.limit, total, last_page: Math.max(1, Math.ceil(total / paging.limit)) },
  })
})
