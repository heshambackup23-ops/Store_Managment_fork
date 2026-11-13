import { Hono } from 'hono'
import { z } from 'zod'
import { business, write } from './business'
import { body, fail, hasPermission, identifier, ok, searchPrefix, searchText, selectPage, timestamp } from './http'
import type { ApiContext, ApiEnv } from './http'

export const mobileWalletDamage = new Hono<ApiEnv>()
const canonical = new Hono<ApiEnv & { Bindings: { source: ApiContext } }>()
canonical.use('*', async (c, next) => {
  const source = c.env.source
  c.set('actor', source.get('actor'))
  c.set('credential', source.get('credential'))
  c.set('sessionHash', source.get('sessionHash'))
  await next()
})
canonical.route('/', business)
canonical.onError(error => { throw error })

// All paths are selected by this adapter; canonical handlers recheck their own permissions.
export async function canonicalWrite(c: ApiContext, path: string, data: Record<string, unknown>, method = 'POST') {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  const key = c.req.header('Idempotency-Key')
  if (key) headers.set('Idempotency-Key', key)
  const response = await canonical.request(path, { method, headers, body: JSON.stringify(data) }, { ...c.env, source: c })
  if (!response.ok) throw new Error('Unexpected canonical response')
  return (await response.json<{ data: Record<string, unknown> }>()).data
}

export const isAndroid = (c: ApiContext) => c.get('credential') === 'bearer' && c.req.header('X-Store-Client') === 'android'
export function requirePermission(c: ApiContext, permission: string) {
  if (!hasPermission(c.get('actor'), permission)) fail(403, 'forbidden', 'ليست لديك صلاحية لتنفيذ هذه العملية.')
}

const date = z.iso.date()
const recordId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const name = z.string().trim().min(1).max(200)
const note = z.string().trim().max(1000).nullish()
const reason = z.string().trim().min(1).max(1000)
const moneyLimit = 900_000_000_000_000
export function decimalMinor(signed = false, max = moneyLimit) {
  return z.string().trim().max(20)
    .transform(value => value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15)).replace('٫', '.'))
    .pipe(z.string().regex(signed ? /^-?\d+(\.\d{1,2})?$/ : /^\d+(\.\d{1,2})?$/))
    .transform(value => {
      const [whole, fraction = ''] = value.split('.')
      return Number(whole + fraction.padEnd(2, '0'))
    })
    .pipe(z.number().int().min(signed ? -max : 0).max(max))
}

export function asDecimal(minor: number | null | undefined) {
  if (minor == null) return null
  if (!Number.isSafeInteger(minor)) fail(409, 'aggregate_range', 'مجموع التقرير خارج النطاق الرقمي المدعوم.')
  const amount = BigInt(Math.abs(minor))
  return (minor < 0 ? '-' : '') + amount / 100n + '.' + (amount % 100n).toString().padStart(2, '0')
}

const cairoCalendar = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
function today() { return cairoCalendar.format(new Date()) }

const damageFrom = `damaged_stock d JOIN products p ON p.id = d.product_id
  LEFT JOIN damaged_stock_reversals reversal ON reversal.damage_id = d.id
  LEFT JOIN inventory_movements m ON m.id = COALESCE((
    SELECT MAX(im.id) FROM damaged_stock_corrections correction JOIN inventory_movements im
      ON im.source_type = 'adjustment' AND im.source_id = correction.id AND im.product_id = d.product_id
    WHERE correction.damage_id = d.id
  ), (SELECT im.id FROM inventory_movements im WHERE im.source_type = 'damage' AND im.source_id = d.id AND im.product_id = d.product_id))`
const damageSelect = `d.id, d.product_id, COALESCE(d.legacy_product_name, p.name) AS product_name,
  CASE WHEN d.legacy_damage_fingerprint IS NULL THEN p.barcode ELSE d.legacy_product_barcode END AS product_barcode, d.quantity, d.reason,
  CASE WHEN reversal.id IS NULL THEN 'recorded' ELSE 'voided' END AS status,
  COALESCE(d.damaged_on, date(d.created_at)) AS damaged_on, d.notes, reversal.reason AS void_reason,
  d.unit_cost_minor, d.quantity * d.unit_cost_minor AS total_minor, COALESCE(m.delta, -d.legacy_quantity) AS delta,
  CASE WHEN m.id IS NULL THEN d.legacy_stock_after
    ELSE p.stock - COALESCE((SELECT SUM(im.delta) FROM inventory_movements im WHERE im.product_id = p.id AND im.id > m.id), 0)
  END AS stock_after`
type Damage = Record<string, unknown> & { unit_cost_minor: number; total_minor: number; delta: number; stock_after: number; reason: string }
const damageReasons: Record<string, string> = {
  broken: 'كسر', water: 'تلف بالمياه', defective: 'عيب تصنيع', not_working: 'لا يعمل',
  lost: 'فقد / سرقة', expired: 'منتهي الصلاحية', returned: 'مرتجع تالف', other: 'أخرى',
}
function damageView({ unit_cost_minor, total_minor, delta, ...row }: Damage) {
  return {
    ...row, unit_value: asDecimal(unit_cost_minor), total_value: asDecimal(total_minor),
    reason_label: damageReasons[row.reason] ?? row.reason, stock_before: row.stock_after - delta,
  }
}
async function damageDetail(c: ApiContext, id: number, status: 200 | 201 = 200) {
  const row = await c.env.DB.prepare(`SELECT ${damageSelect} FROM ${damageFrom} WHERE d.id = ?`).bind(id).first<Damage>()
  if (!row) fail(404, 'not_found', 'سجل الهالك غير موجود.')
  return ok(c, damageView(row), status)
}
mobileWalletDamage.get('/damaged', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'damaged.view')
  const query = searchText.optional().parse(c.req.query('q'))
  const status = z.enum(['recorded', 'voided']).optional().parse(c.req.query('status'))
  const predicates = []
  if (query) predicates.push(`(COALESCE(d.legacy_product_name, p.name) LIKE ? ESCAPE '\\'
    OR CASE WHEN d.legacy_damage_fingerprint IS NULL THEN p.barcode ELSE d.legacy_product_barcode END = ?)`)
  if (status) predicates.push('reversal.id IS ' + (status === 'recorded' ? 'NULL' : 'NOT NULL'))
  return selectPage(c, damageSelect, damageFrom, predicates.length ? 'WHERE ' + predicates.join(' AND ') : '',
    query ? [searchPrefix(query), query] : [], 'damaged_on DESC, d.id DESC', row => damageView(row as Damage))
})
mobileWalletDamage.get('/damaged/products', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'damaged.view')
  const query = searchText.optional().parse(c.req.query('q'))
  const match = query ? " AND (name LIKE ? ESCAPE '\\' OR barcode = ?)" : ''
  const rows = await c.env.DB.prepare(`SELECT id, name, barcode, price_minor, stock
    FROM products WHERE active = 1 AND stock > 0${match} ORDER BY name, id LIMIT 30`)
    .bind(...(query ? [searchPrefix(query), query] : [])).all<{ price_minor: number }>()
  return ok(c, rows.results.map(({ price_minor, ...row }) => ({ ...row, price: asDecimal(price_minor) })))
})
mobileWalletDamage.get('/damaged/:id', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'damaged.view')
  return damageDetail(c, identifier.parse(c.req.param('id')))
})
const damageBody = z.object({
  product_id: recordId, quantity: z.number().int().min(1).max(1_000_000), reason,
  unit_value: decimalMinor().nullish(), damaged_on: date.refine(value => value <= today()), notes: note,
}).strict()
mobileWalletDamage.post('/damaged', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'damaged.manage')
  const { unit_value, notes, ...data } = await body(c, damageBody)
  const result = await canonicalWrite(c, '/damaged', { ...data, unit_value_minor: unit_value ?? undefined, notes: notes ?? undefined })
  return damageDetail(c, Number(result.id), 201)
})
mobileWalletDamage.put('/damaged/:id', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'damaged.manage')
  const id = identifier.parse(c.req.param('id'))
  const { product_id, unit_value, notes, ...data } = await body(c, damageBody)
  const product = await c.env.DB.prepare('SELECT product_id FROM damaged_stock WHERE id = ?').bind(id).first<number>('product_id')
  if (product === null) fail(404, 'not_found', 'سجل الهالك غير موجود.')
  if (product !== product_id) fail(409, 'different_product', 'لعلاج تسجيل هالك على منتج آخر، ألغِ القيد وسجّل المنتج الصحيح.')
  await canonicalWrite(c, '/damaged/' + id + '/correct', { ...data, unit_value_minor: unit_value ?? undefined, notes: notes ?? '' })
  return damageDetail(c, id)
})
mobileWalletDamage.post('/damaged/:id/void', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'damaged.manage')
  const id = identifier.parse(c.req.param('id'))
  const data = await body(c, z.object({ reason }).strict())
  await canonicalWrite(c, '/damaged/' + id + '/reverse', data)
  return damageDetail(c, id)
})

type Wallet = {
  id: number; name: string; provider: string; phone: string; balance_minor: number; active: number; warn_at_percent: number
  transaction_limit_minor: number | null; daily_send_limit_minor: number | null; daily_receive_limit_minor: number | null
  monthly_send_limit_minor: number | null; monthly_receive_limit_minor: number | null
  default_commission_bps: number; default_commission_min_minor: number; default_fee_bps: number
  default_fee_min_minor: number; default_fee_max_minor: number | null
}
function cashierWallet(row: Wallet) {
  return {
    id: row.id, name: row.name, provider: row.provider, identifier: row.phone || null, balance: asDecimal(row.balance_minor),
    per_transaction_limit: asDecimal(row.transaction_limit_minor),
    default_commission_percent: asDecimal(row.default_commission_bps), default_commission_min: asDecimal(row.default_commission_min_minor),
    default_fee_percent: asDecimal(row.default_fee_bps), default_fee_min: asDecimal(row.default_fee_min_minor),
    default_fee_max: asDecimal(row.default_fee_max_minor),
  }
}
type WalletUsage = { wallet_id: number; kind: string; daily: number; monthly: number }
function limitRows(wallet: Wallet, usage: Map<string, WalletUsage>) {
  const send = usage.get(wallet.id + ':send')
  const receive = usage.get(wallet.id + ':receive')
  const limits = [
    { label: 'حد المعاملة', limit: wallet.transaction_limit_minor, used: 0 },
    { label: 'الإرسال اليومي', limit: wallet.daily_send_limit_minor, used: send?.daily ?? 0 },
    { label: 'الاستقبال اليومي', limit: wallet.daily_receive_limit_minor, used: receive?.daily ?? 0 },
    { label: 'الإرسال الشهري', limit: wallet.monthly_send_limit_minor, used: send?.monthly ?? 0 },
    { label: 'الاستقبال الشهري', limit: wallet.monthly_receive_limit_minor, used: receive?.monthly ?? 0 },
  ]
  return limits.filter(row => row.limit != null).map(({ label, limit, used }) => {
    const percent = limit ? Math.floor(100 * used / limit) : 0
    return { label, used: asDecimal(used), limit: asDecimal(limit), remaining: asDecimal(Math.max(0, (limit ?? 0) - used)),
      percent, level: percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : 'normal' }
  })
}
mobileWalletDamage.get('/wallets', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'wallets.view')
  const db = c.env.DB
  const day = today()
  const [wallets, usage, totals] = await db.batch([
    db.prepare('SELECT * FROM wallets ORDER BY active DESC, name, id'),
    db.prepare(`SELECT wallet_id, kind, SUM(CASE WHEN business_day = ? THEN amount_minor ELSE 0 END) AS daily,
      SUM(amount_minor) AS monthly FROM wallet_transactions WHERE kind IN ('send','receive') AND business_day BETWEEN ? AND ?
      AND NOT EXISTS(SELECT 1 FROM wallet_transactions r WHERE r.reversal_of = wallet_transactions.id)
      GROUP BY wallet_id, kind`).bind(day, day.slice(0, 7) + '-01', day),
    hasPermission(c.get('actor'), 'wallets.cash') ? db.prepare(`
      SELECT *, COALESCE((SELECT SUM(commission_minor - fee_minor) FROM wallet_transactions t
        WHERE kind IN ('send','receive') AND business_day = ?
          AND NOT EXISTS(SELECT 1 FROM wallet_transactions r WHERE r.reversal_of = t.id)), 0)
        + COALESCE((SELECT SUM(delta_minor) FROM wallet_cash_entries WHERE business_day = ? AND kind IN ('expense','expense_reversal')), 0) AS profit_today
      FROM wallet_financial_totals`).bind(day, day) : db.prepare('SELECT provider_balance_minor, receivables_minor FROM wallet_financial_totals'),
  ])
  const sums = totals.results[0] as Record<string, number>
  const byWallet = new Map((usage.results as WalletUsage[]).map(row => [row.wallet_id + ':' + row.kind, row]))
  return ok(c, {
    summary: {
      wallets_total: asDecimal(sums.provider_balance_minor), cash: asDecimal(sums.drawer_minor),
      profit_today: asDecimal(sums.profit_today), profit_available: asDecimal(sums.profit_available_minor),
      receivables: asDecimal(sums.receivables_minor), capital: asDecimal(sums.working_capital_minor),
    },
    wallets: (wallets.results as Wallet[]).map(row => ({
      ...cashierWallet(row), is_active: Boolean(row.active), warn_at_percent: row.warn_at_percent ?? 80, limits: limitRows(row, byWallet),
    })),
  })
})
mobileWalletDamage.post('/wallets', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'wallets.manage')
  const data = await body(c, z.object({ name, provider: z.string().trim().min(1).max(150),
    identifier: z.string().trim().max(50).nullish(), opening_balance: decimalMinor() }).strict())
  const result = await canonicalWrite(c, '/wallets', { name: data.name, provider: data.provider,
    phone: data.identifier ?? '', opening_minor: data.opening_balance })
  return ok(c, result, 201)
})
mobileWalletDamage.post('/wallets/:id/toggle', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'wallets.manage')
  const id = identifier.parse(c.req.param('id'))
  const db = c.env.DB
  return write(c, 'mobile.wallet.toggle', { id }, (op, binds, actor) => [
    db.prepare(`UPDATE wallets SET active = NOT active, updated_at = ${timestamp} WHERE id = ?`).bind(id),
    db.prepare(`INSERT INTO mobile_wallet_toggles(operation_id, wallet_id, active)
      VALUES (${op}, ?, (SELECT active FROM wallets WHERE id = ?))`).bind(...binds, id, id),
    db.prepare(`INSERT INTO audit_logs(actor_id, action, entity_type, entity_id)
      SELECT ?, CASE active WHEN 1 THEN 'activate' ELSE 'deactivate' END, 'wallet', id FROM wallets WHERE id = ?`).bind(actor, id),
  ], async op => {
    const result = await db.prepare('SELECT active FROM mobile_wallet_toggles WHERE operation_id = ?').bind(op).first<number>('active')
    if (result === null) throw new Error('Missing wallet toggle')
    return ok(c, { id, is_active: Boolean(result) })
  })
})
mobileWalletDamage.post('/wallets/:id/adjust', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'wallets.manage')
  const id = identifier.parse(c.req.param('id'))
  const data = await body(c, z.object({ amount: decimalMinor(true), reason }).strict())
  const result = await canonicalWrite(c, '/wallets/' + id + '/adjustments', { delta_minor: data.amount, reason: data.reason })
  return ok(c, result, 201)
})

mobileWalletDamage.get('/wallet-cashier', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'wallets.view')
  const db = c.env.DB
  const [wallets, tx, outstanding] = await db.batch([
    db.prepare('SELECT * FROM wallets WHERE active = 1 ORDER BY name, id'),
    db.prepare(`SELECT CAST(t.id AS TEXT) AS uuid, t.wallet_id, w.name AS wallet_name, t.kind AS type,
      CASE WHEN r.id IS NOT NULL THEN 'reversed' ELSE 'completed' END AS status, t.amount_minor, t.commission_minor, t.fee_minor,
      NULLIF(t.counterparty, '') AS counterparty, c.name AS customer_name, t.created_at AS occurred_at,
      CASE WHEN d.id IS NOT NULL THEN 'deferred' ELSE 'cash' END AS payment_method,
      CASE WHEN d.voided_at IS NULL THEN COALESCE(d.principal_minor - d.paid_minor, 0) ELSE 0 END AS receivable_minor,
      (d.id IS NOT NULL AND d.status = 'open') AS open_debt,
      (r.id IS NULL AND COALESCE(d.paid_minor, 0) = 0) AS reversible
      FROM wallet_transactions t JOIN wallets w ON w.id = t.wallet_id
      LEFT JOIN wallet_transactions r ON r.reversal_of = t.id LEFT JOIN wallet_debts d ON d.wallet_transaction_id = t.id
      LEFT JOIN customers c ON c.id = d.customer_id WHERE t.kind IN ('send','receive') ORDER BY t.id DESC LIMIT 50`),
    db.prepare('SELECT receivables_minor FROM wallet_financial_totals'),
  ])
  const actor = c.get('actor')
  type Transfer = Record<string, unknown> & { amount_minor: number; commission_minor: number; fee_minor: number
    receivable_minor: number; open_debt: number; reversible: number }
  return ok(c, {
    wallets: (wallets.results as Wallet[]).map(cashierWallet),
    transactions: (tx.results as Transfer[]).map(({ amount_minor, commission_minor, fee_minor, receivable_minor, open_debt, reversible, ...row }) => ({
      ...row, amount: asDecimal(Number(amount_minor)), commission: asDecimal(Number(commission_minor)),
      fee: asDecimal(Number(fee_minor)), receivable: asDecimal(Number(receivable_minor)),
      can_settle: Boolean(open_debt) && hasPermission(actor, 'wallets.transact'),
      can_reverse: Boolean(reversible) && hasPermission(actor, 'wallets.reverse'),
    })),
    outstanding: asDecimal((outstanding.results[0] as { receivables_minor: number }).receivables_minor),
  })
})
const walletTransfer = z.object({
  wallet_id: recordId, type: z.enum(['send', 'receive']), amount: decimalMinor(),
  counterparty: z.string().trim().max(50), commission: decimalMinor().nullish(), fee: decimalMinor().nullish(),
  payment_method: z.enum(['cash', 'deferred']).nullish(), customer_name: name.nullish(), notes: note,
}).strict()
mobileWalletDamage.post('/wallet-cashier', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'wallets.transact')
  const data = await body(c, walletTransfer)
  let customerId: number | undefined
  if (data.payment_method === 'deferred') {
    if (data.type !== 'send' || !data.customer_name) fail(422, 'invalid_deferred', 'السداد الآجل متاح عند إرسال مبلغ لعميل مسجل.')
    const customers = await c.env.DB.prepare('SELECT id FROM customers WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 2')
      .bind(data.customer_name).all<{ id: number }>()
    if (customers.results.length !== 1) fail(422, 'customer_lookup', 'اختر اسم عميل مسجل وفريد لإتمام العملية الآجلة.')
    customerId = customers.results[0].id
  }
  const result = await canonicalWrite(c, '/wallets/' + data.wallet_id + '/transactions', {
    kind: data.type, amount_minor: data.amount, commission_minor: data.commission ?? undefined, fee_minor: data.fee ?? undefined,
    counterparty: data.counterparty, note: data.notes ?? '', deferred: customerId ? { customer_id: customerId } : undefined,
  })
  return ok(c, { uuid: String(result.id) }, 201)
})
mobileWalletDamage.post('/wallet-cashier/:id/settle', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'wallets.transact')
  const id = identifier.parse(c.req.param('id'))
  const data = await body(c, z.object({ amount: decimalMinor().nullish() }).strict())
  const db = c.env.DB
  return write(c, 'mobile.wallet.settle', { id, amount: data.amount ?? null }, (op, binds, actor) => [
    db.prepare(`INSERT INTO wallet_debt_payments (id, wallet_debt_id, amount_minor, actor_id)
      VALUES (${op}, (SELECT id FROM wallet_debts WHERE wallet_transaction_id = ?),
        COALESCE(?, (SELECT principal_minor - paid_minor FROM wallet_debts WHERE wallet_transaction_id = ?)), ?)`)
      .bind(...binds, id, data.amount ?? null, id, actor),
  ], op => ok(c, { uuid: String(op) }, 201))
})
mobileWalletDamage.post('/wallet-cashier/:id/reverse', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'wallets.reverse')
  const id = identifier.parse(c.req.param('id'))
  const data = await body(c, z.object({ reason }).strict())
  const original = await c.env.DB.prepare("SELECT 1 FROM wallet_transactions WHERE id = ? AND kind IN ('send','receive')").bind(id).first()
  if (!original) fail(404, 'not_found', 'معاملة التحويل غير موجودة.')
  const result = await canonicalWrite(c, '/wallet-transactions/' + id + '/reverse', data)
  return ok(c, { uuid: String(result.id) }, 201)
})
