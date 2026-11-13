import { Hono } from 'hono'
import { fail, hasPermission, identifier, ok, page, paginated, searchPrefix, searchText } from './http'
import type { ApiContext, ApiEnv } from './http'

const legacy = new Hono<ApiEnv>()
const isAndroid = (c: ApiContext) => c.get('credential') === 'bearer' && c.req.header('X-Store-Client') === 'android'

type ReadContract = { permission: string; fields: string; from: string; search: string; details?: boolean; where?: string }

function check(c: ApiContext, permission: string) {
  if (!hasPermission(c.get('actor'), permission)) fail(403, 'forbidden', 'ليست لديك صلاحية لتنفيذ هذه العملية.')
}

// SQLite integer division keeps the JSON decimal string exact, including large amounts.
function decimal(column: string) {
  return `printf('%d.%02d', (${column}) / 100, (${column}) % 100)`
}

const itemJson = `(SELECT json_group_array(json_object('product_id', product_id, 'name', product_name,
    'price', ${decimal('unit_price_minor')}, 'quantity', quantity, 'line_total', ${decimal('unit_price_minor * quantity')}))
    FROM invoice_items WHERE invoice_id = r.id)`
const invoiceAmounts = `r.id, COALESCE(r.legacy_invoice_number, CAST(r.id AS TEXT)) AS invoice_number, COALESCE(r.legacy_customer_name, c.name, 'عميل نقدي') AS customer,
  COALESCE(r.invoice_date, date(r.created_at)) AS invoice_date, NULLIF(r.notes, '') AS notes, r.created_at,
  CASE WHEN r.refunded_at IS NOT NULL THEN 'refunded' WHEN r.total_minor = r.paid_minor THEN 'paid'
       WHEN r.paid_minor = 0 THEN 'unpaid' ELSE 'partial' END AS status,
  COALESCE((SELECT sum(quantity) FROM invoice_items WHERE invoice_id = r.id), 0) AS quantity,
  ${decimal('r.total_minor')} AS total_amount, ${decimal('r.paid_minor')} AS paid_amount,
  ${decimal('CASE WHEN r.refunded_at IS NOT NULL THEN 0 ELSE r.total_minor - r.paid_minor END')} AS remaining_amount`

export async function legacyInvoice(c: ApiContext, id: number) {
  const record = await c.env.DB.prepare(`SELECT ${invoiceAmounts}, ${itemJson} AS items_json
    FROM invoices r LEFT JOIN customers c ON c.id = r.customer_id WHERE r.id = ?`).bind(id).first()
  if (!record) fail(404, 'not_found', 'الفاتورة غير موجودة.')
  const { items_json, ...rest } = record
  return { ...rest, items: JSON.parse(String(items_json)) }
}

const reads: Record<string, ReadContract> = {
  invoices: { permission: 'invoices.view', fields: invoiceAmounts, from: 'invoices r LEFT JOIN customers c ON c.id = r.customer_id', search: "COALESCE(r.legacy_customer_name, c.name, '')", details: true },
  installments: { permission: 'installments.view', from: 'installments r JOIN customers c ON c.id = r.customer_id', search: 'c.name', details: true, fields: `
    r.id, r.invoice_id, r.customer_id, c.name AS customer,
    COALESCE(NULLIF(r.product_name, ''), (SELECT group_concat(product_name, '، ') FROM invoice_items WHERE invoice_id = r.invoice_id), '') AS product_name,
    ${decimal('r.principal_minor')} AS product_price, r.due_date AS next_payment_date, r.payment_date,
    ${decimal('r.paid_minor')} AS paid_amount, ${decimal('r.principal_minor - r.paid_minor')} AS remaining,
    COALESCE((SELECT sum(quantity) FROM invoice_items WHERE invoice_id = r.invoice_id),
      (SELECT sum(json_extract(value, '$.quantity')) FROM json_each(r.items_json)), 1) AS quantity,
    r.items_json, CASE WHEN r.voided_at IS NOT NULL THEN 'refunded' WHEN r.paid_minor = r.principal_minor THEN 'complete'
         WHEN r.marked_overdue = 1 OR r.due_date < date('now') THEN 'overdue' ELSE 'pending' END AS status` },
  maintenance: { permission: 'maintenance.view', from: 'maintenance_requests r', search: 'r.item', details: true, where: 'r.archived_at IS NULL',
    fields: `r.id, r.item AS name, r.customer_name AS owner, r.phone, r.address, r.problem AS description,
    CASE r.status WHEN 'received' THEN 'قيد الانتظار' WHEN 'in_progress' THEN 'قيد الصيانة' WHEN 'completed' THEN 'مكتمل'
      WHEN 'delivered' THEN 'تم التسليم' WHEN 'cancelled' THEN 'مرفوض' END AS status, r.requested_date, r.completed_date` },
  suppliers: { permission: 'suppliers.view', from: 'supplier_balances r', search: 'r.name', details: true, fields: `
    r.id, r.name, r.phone, r.address, r.email, ${decimal('r.opening_minor')} AS opening_balance,
    ${decimal('r.balance_minor')} AS balance, r.purchases_count` },
  sales: { permission: 'reports.view', search: 'r.name', where: 'r.sold_quantity > 0',
    from: `(SELECT p.id,p.name,SUM(x.quantity) AS sold_quantity FROM products p JOIN invoice_items x ON x.product_id=p.id
      JOIN invoices i ON i.id=x.invoice_id AND i.refunded_at IS NULL GROUP BY p.id,p.name) r`,
    fields: 'r.id, r.name, r.sold_quantity' },
  'personal-debts': { permission: 'debts.view', from: 'personal_debts r LEFT JOIN debt_voids v ON v.debt_id = r.id',
    search: 'r.person_name', details: true, where: "r.direction = 'payable' AND v.id IS NULL", fields: `
    r.id, r.person_name AS creditor, r.description, ${decimal('r.principal_minor')} AS total_amount,
    ${decimal('r.paid_minor')} AS paid_amount, ${decimal('r.principal_minor - r.paid_minor')} AS remaining,
    r.due_date, r.status, r.note AS notes` },
}

function mapRecord(name: string, row: Record<string, unknown>) {
  if (name !== 'installments') return row
  const { items_json, ...fields } = row
  const basket = JSON.parse(String(items_json || '[]')) as { product_id: number; name: string; quantity: number
    unit_price_minor: number; line_total_minor: number }[]
  const decimalText = (amount: number) => {
    const minor = BigInt(amount)
    return (minor / 100n) + '.' + (minor % 100n).toString().padStart(2, '0')
  }
  return { ...fields, items: basket.map(item => ({
    product_id: item.product_id, name: item.name, quantity: item.quantity,
    price: decimalText(item.unit_price_minor), line_total: decimalText(item.line_total_minor),
  })) }
}

export async function legacyRecord(c: ApiContext, name: 'installments' | 'maintenance' | 'suppliers' | 'personal-debts', id: number) {
  const config = reads[name]
  const record = await c.env.DB.prepare(`SELECT ${config.fields} FROM ${config.from} WHERE r.id = ?${config.where ? ` AND ${config.where}` : ''}`)
    .bind(id).first()
  if (!record) fail(404, 'not_found', 'السجل المطلوب غير موجود.')
  if (name === 'personal-debts') {
    const result = await c.env.DB.prepare(`SELECT id, ${decimal('amount_minor')} AS amount, date(created_at) AS paid_on,
      note AS notes FROM personal_debt_payments WHERE debt_id = ? ORDER BY id DESC LIMIT 100`).bind(id).all()
    return { ...record, payments: result.results }
  }
  return mapRecord(name, record)
}

function contract(name: string, config: ReadContract) {
  legacy.get(`/${name}`, async (c, next) => {
    if (!isAndroid(c)) return next()
    check(c, config.permission)
    const paging = page(c)
    const query = searchText.optional().parse(c.req.query('q'))
    const terms = config.where ? [config.where] : []
    const binds: string[] = []
    if (query) {
      terms.push(`(${config.search} LIKE ? ESCAPE '\\' OR CAST(r.id AS TEXT) = ?${name === 'invoices' ? ' OR r.legacy_invoice_number = ?' : ''})`)
      binds.push(searchPrefix(query), query, ...(name === 'invoices' ? [query] : []))
    }
    const where = terms.length ? `WHERE ${terms.join(' AND ')}` : ''
    const db = c.env.DB
    const [rows, count] = await db.batch([
      db.prepare(`SELECT ${config.fields} FROM ${config.from} ${where} ORDER BY r.id DESC LIMIT ? OFFSET ?`).bind(...binds, paging.limit, paging.offset),
      db.prepare(`SELECT count(*) AS total FROM ${config.from} ${where}`).bind(...binds),
    ])
    return paginated(c, rows.results.map(row => mapRecord(name, row as Record<string, unknown>)), Number((count.results[0] as { total: number }).total), paging)
  })
  if (!config.details) return
  legacy.get(`/${name}/:id`, async (c, next) => {
    if (!isAndroid(c)) return next()
    check(c, config.permission)
    const id = identifier.parse(c.req.param('id'))
    if (name === 'invoices') return ok(c, await legacyInvoice(c, id))
    return ok(c, await legacyRecord(c, name as 'installments' | 'maintenance' | 'suppliers' | 'personal-debts', id))
  })
}

for (const [name, config] of Object.entries(reads)) contract(name, config)

export { legacy as mobileCompatibility }
