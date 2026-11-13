import { Hono } from 'hono'
import { z } from 'zod'
import { checkoutInvoice, write } from './business'
import { body, fail, identifier, ok, timestamp } from './http'
import type { ApiContext, ApiEnv } from './http'
import { legacyInvoice, legacyRecord } from './mobile-compat'
import { canonicalWrite, decimalMinor, isAndroid, requirePermission } from './mobile-wallet-damage'

export const mobileModuleWrites = new Hono<ApiEnv>()
const text = z.string().trim().max(1000).nullish()
const name = z.string().trim().min(1).max(200)
const date = z.iso.date()
const itemId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const quantities = z.array(z.number().int().min(1).max(1_000_000)).min(1).max(40)
const productIds = z.array(itemId).min(1).max(40)
const payment = z.object({ amount: decimalMinor().nullish(), notes: text }).strict()

function lineItems(ids: number[], amounts: number[]) {
  if (ids.length !== amounts.length || new Set(ids).size !== ids.length) {
    fail(422, 'invalid_items', 'أرسل كمية واحدة لكل منتج دون تكرار.')
  }
  return ids.map((product_id, index) => ({ product_id, quantity: amounts[index] }))
}

const invoice = z.object({
  customer: z.string().trim().max(200), product_ids: productIds, quantities,
  invoice_date: date, paid_amount: decimalMinor(), notes: text,
}).strict()
for (const [method, path] of [['POST', '/invoices'], ['PUT', '/invoices/:id']] as const) {
  mobileModuleWrites.on(method, path, async (c, next) => {
    if (!isAndroid(c)) return next()
    requirePermission(c, 'invoices.create')
    if (method === 'PUT') {
      requirePermission(c, 'invoices.refund')
      requirePermission(c, 'invoices.view')
    }
    const data = await body(c, invoice)
    const original = method === 'PUT' ? {
      id: identifier.parse(c.req.param('id')), reason: 'إعادة إصدار الفاتورة من تطبيق Android',
    } : undefined
    return checkoutInvoice(c, {
      items: lineItems(data.product_ids, data.quantities), paid_minor: data.paid_amount,
      invoice_date: data.invoice_date, notes: data.notes ?? undefined,
    }, original, {
      customer: data.customer.replace(/\s+/gu, ' '), receivedMinor: null, exactPaid: true,
    }, async id => ok(c, await legacyInvoice(c, id), original ? 200 : 201))
  })
}

const supplier = z.object({
  name, phone: text, email: z.email().nullish(), address: text, opening_balance: decimalMinor().nullish(),
}).strict()
for (const [method, path] of [['POST', '/suppliers'], ['PUT', '/suppliers/:id']] as const) {
  mobileModuleWrites.on(method, path, async (c, next) => {
    if (!isAndroid(c)) return next()
    requirePermission(c, 'suppliers.manage')
    const data = await body(c, supplier)
    const values = { name: data.name, phone: data.phone ?? '', email: data.email ?? null,
      address: data.address ?? '', opening_minor: data.opening_balance ?? undefined }
    if (method === 'POST') {
      const result = await canonicalWrite(c, '/suppliers', values)
      return ok(c, await legacyRecord(c, 'suppliers', Number(result.id)), 201)
    }
    const id = identifier.parse(c.req.param('id'))
    const db = c.env.DB
    return write(c, 'mobile.supplier.update', { id, values }, (op, binds, actor) => [
      db.prepare(`UPDATE suppliers SET name = ?, phone = ?, email = ?, address = ?,
        opening_minor = COALESCE(?, opening_minor), updated_at = ${timestamp} WHERE id = ?`)
        .bind(values.name, values.phone, values.email, values.address, values.opening_minor ?? null, id),
      db.prepare(`INSERT INTO mobile_edit_operations(operation_id, target_id)
        VALUES (${op}, (SELECT id FROM suppliers WHERE id = ? AND changes() = 1))`).bind(...binds, id),
      db.prepare("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES (?,'update','supplier',?)").bind(actor, id),
    ], async () => ok(c, await legacyRecord(c, 'suppliers', id)))
  })
}

const maintenanceStates = {
  'قيد الانتظار': 'received', 'قيد الصيانة': 'in_progress', 'مكتمل': 'completed',
  'تم التسليم': 'delivered', 'مرفوض': 'cancelled',
} as const
const maintenance = z.object({
  name, owner: name, phone: text, address: text, description: text,
  status: z.enum(['قيد الانتظار', 'قيد الصيانة', 'مكتمل', 'تم التسليم', 'مرفوض']).transform(status => maintenanceStates[status]), requested_date: date,
}).strict()
const transitionFilter = `(status = ? OR ? = 'cancelled' OR
  (status = 'received' AND ? = 'in_progress') OR (status = 'in_progress' AND ? = 'completed')
  OR (status = 'completed' AND ? = 'delivered'))`
for (const [method, path] of [['POST', '/maintenance'], ['PUT', '/maintenance/:id']] as const) {
  mobileModuleWrites.on(method, path, async (c, next) => {
    if (!isAndroid(c)) return next()
    requirePermission(c, 'maintenance.manage')
    const data = await body(c, maintenance)
    if (method === 'POST') {
      if (!['received', 'in_progress'].includes(data.status)) {
        fail(422, 'invalid_initial_status', 'ابدأ الطلب في حالة قيد الانتظار أو قيد الصيانة.')
      }
      const db = c.env.DB
      return write(c, 'mobile.maintenance.create', data, (op, binds, actor) => [
        db.prepare(`INSERT INTO maintenance_requests
          (id,customer_name,item,phone,address,problem,status,requested_date,actor_id)
          VALUES (${op}, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(...binds, data.owner, data.name, data.phone ?? '', data.address ?? '', data.description || 'بدون وصف',
            data.status, data.requested_date, actor),
      ], async id => ok(c, await legacyRecord(c, 'maintenance', id), 201))
    }
    const id = identifier.parse(c.req.param('id'))
    const db = c.env.DB
    return write(c, 'mobile.maintenance.update', { id, ...data }, (op, binds, actor) => [
      db.prepare(`UPDATE maintenance_requests SET customer_name = ?, item = ?, phone = ?, address = ?, problem = ?,
        status = ?, requested_date = ?, updated_at = ${timestamp},
        completed_date = CASE WHEN status = 'in_progress' AND ? = 'completed' THEN ? ELSE completed_date END
        WHERE id = ? AND archived_at IS NULL AND status NOT IN ('delivered','cancelled') AND ${transitionFilter}`)
        .bind(data.owner, data.name, data.phone ?? '', data.address ?? '', data.description || 'بدون وصف',
          data.status, data.requested_date, data.status, new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date()), id, ...Array(5).fill(data.status)),
      db.prepare(`INSERT INTO mobile_edit_operations(operation_id, target_id)
        VALUES (${op}, (SELECT id FROM maintenance_requests WHERE id = ? AND changes() = 1))`).bind(...binds, id),
      db.prepare("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id) VALUES (?,'update','maintenance',?)").bind(actor, id),
    ], async () => ok(c, await legacyRecord(c, 'maintenance', id)))
  })
}

const installment = z.object({
  customer: name, product_ids: productIds.nullish(), quantities: quantities.nullish(), product_name: name.nullish(),
  total_amount: decimalMinor().nullish(), payment_date: date.nullish(), next_payment_date: date.nullish(),
  paid_amount: decimalMinor(), notes: text,
}).strict().refine(data => Boolean(data.product_ids && data.quantities) !== Boolean(data.product_name && data.total_amount))
function installmentDetails(data: z.infer<typeof installment>) {
  if (!data.next_payment_date) fail(422, 'due_date_required', 'حدد تاريخ استحقاق القسط.')
  return {
    items: data.product_ids && data.quantities ? lineItems(data.product_ids, data.quantities) : undefined,
    product_name: data.product_name ?? undefined, principal_minor: data.total_amount ?? undefined,
    payment_date: data.payment_date ?? null, due_date: data.next_payment_date, note: data.notes ?? '',
  }
}

async function namedCustomer(c: ApiContext, displayName: string) {
  const rows = await c.env.DB.prepare('SELECT id FROM customers WHERE name = ? COLLATE NOCASE LIMIT 2')
    .bind(displayName).all<{ id: number }>()
  if (rows.results.length !== 1) fail(422, 'customer_lookup', 'استخدم اسم عميل مسجل وفريد.')
  return rows.results[0].id
}
mobileModuleWrites.post('/installments', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'installments.manage')
  const data = await body(c, installment)
  const result = await canonicalWrite(c, '/installments', {
    ...installmentDetails(data), customer_id: await namedCustomer(c, data.customer), paid_minor: data.paid_amount,
  })
  return ok(c, await legacyRecord(c, 'installments', Number(result.id)), 201)
})
mobileModuleWrites.put('/installments/:id', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'installments.manage')
  const id = identifier.parse(c.req.param('id'))
  const data = await body(c, installment)
  const current = await c.env.DB.prepare(`SELECT i.invoice_id,i.paid_minor, c.name AS customer_name
    FROM installments i JOIN customers c ON c.id=i.customer_id WHERE i.id=?`).bind(id)
    .first<{ invoice_id: number | null; paid_minor: number; customer_name: string }>()
  if (!current) fail(404, 'not_found', 'القسط غير موجود.')
  if (current.customer_name !== data.customer) fail(409, 'different_customer', 'يحتفظ القسط بالعميل الأصلي.')
  if (current.paid_minor !== data.paid_amount) fail(409, 'use_payment', 'سجّل الدفعات من زر السداد.')
  const details = installmentDetails(data)
  const patch = current.invoice_id ? { due_date: details.due_date, payment_date: details.payment_date, note: details.note } : details
  await canonicalWrite(c, '/installments/' + id, patch, 'PATCH')
  return ok(c, await legacyRecord(c, 'installments', id))
})
mobileModuleWrites.post('/installments/:id/status', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'installments.manage')
  const id = identifier.parse(c.req.param('id'))
  const data = await body(c, z.object({ status: z.enum(['غير مكتمل', 'متأخر', 'مكتمل']) }).strict())
  const status = { 'غير مكتمل': 'open', 'متأخر': 'overdue', 'مكتمل': 'paid' }[data.status]
  await canonicalWrite(c, '/installments/' + id + '/status', { status })
  return ok(c, await legacyRecord(c, 'installments', id))
})

const debt = z.object({
  creditor: name, description: text, total_amount: decimalMinor(), paid_amount: decimalMinor().nullish(),
  due_date: date.nullish(), notes: text,
}).strict()
mobileModuleWrites.post('/personal-debts', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'debts.manage')
  const data = await body(c, debt)
  const result = await canonicalWrite(c, '/debts', {
    person_name: data.creditor, direction: 'payable', principal_minor: data.total_amount, paid_minor: data.paid_amount ?? 0,
    description: data.description ?? '', due_date: data.due_date ?? null, note: data.notes ?? '',
  })
  return ok(c, await legacyRecord(c, 'personal-debts', Number(result.id)), 201)
})
async function payableDebt(c: ApiContext, id: number) {
  const record = await c.env.DB.prepare(`SELECT paid_minor FROM personal_debts WHERE id = ? AND direction = 'payable'
    AND NOT EXISTS (SELECT 1 FROM debt_voids WHERE debt_id = ?)`).bind(id, id).first<{ paid_minor: number }>()
  if (!record) fail(404, 'not_found', 'الدين الشخصي غير موجود.')
  return record
}
mobileModuleWrites.put('/personal-debts/:id', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'debts.manage')
  const id = identifier.parse(c.req.param('id'))
  const data = await body(c, debt)
  const current = await payableDebt(c, id)
  if (data.paid_amount != null && current.paid_minor !== data.paid_amount) fail(409, 'use_payment', 'سجّل الدفعات من زر السداد.')
  await canonicalWrite(c, '/debts/' + id, {
    person_name: data.creditor, principal_minor: data.total_amount,
    description: data.description ?? '', due_date: data.due_date ?? null, note: data.notes ?? '',
  }, 'PATCH')
  return ok(c, await legacyRecord(c, 'personal-debts', id))
})
for (const route of [
  { path: 'installments', table: 'installments', payments: 'installment_payments', fk: 'installment_id', permission: 'installments' },
  { path: 'personal-debts', table: 'personal_debts', payments: 'personal_debt_payments', fk: 'debt_id', permission: 'debts' },
] as const) {
  mobileModuleWrites.post('/' + route.path + '/:id/pay', async (c, next) => {
    if (!isAndroid(c)) return next()
    requirePermission(c, route.permission + '.pay')
    requirePermission(c, route.permission + '.view')
    const id = identifier.parse(c.req.param('id'))
    const data = await body(c, payment)
    const db = c.env.DB
    return write(c, 'mobile.' + route.permission + '.pay', { id, ...data }, (op, binds, actor) => [
      db.prepare(`INSERT INTO ${route.payments} (id,${route.fk},amount_minor,actor_id${route.path === 'personal-debts' ? ',note' : ''})
        VALUES (${op}, (SELECT id FROM ${route.table} WHERE id = ?${route.path === 'personal-debts' ? " AND direction = 'payable'" : ''}),
          COALESCE(?, (SELECT principal_minor - paid_minor FROM ${route.table} WHERE id = ?)), ?${route.path === 'personal-debts' ? ',?' : ''})`)
        .bind(...binds, id, data.amount ?? null, id, actor, ...(route.path === 'personal-debts' ? [data.notes ?? ''] : [])),
    ], async () => ok(c, await legacyRecord(c, route.path, id)))
  })
  mobileModuleWrites.delete('/' + route.path + '/:id', async (c, next) => {
    if (!isAndroid(c)) return next()
    requirePermission(c, route.permission + '.manage')
    const id = identifier.parse(c.req.param('id'))
    if (route.path === 'personal-debts') {
      const match = await c.env.DB.prepare("SELECT id FROM personal_debts WHERE id = ? AND direction = 'payable'").bind(id).first()
      if (!match) fail(404, 'not_found', 'الدين الشخصي غير موجود.')
    }
    await canonicalWrite(c, '/' + route.permission + '/' + id + '/void', { reason: 'إلغاء القيد من تطبيق Android' })
    return c.body(null, 204)
  })
}
