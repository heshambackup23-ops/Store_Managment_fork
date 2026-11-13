import { Hono } from 'hono'
import { z } from 'zod'
import { write } from './business'
import { imageType } from './catalog'
import { auditedWrite, body, fail, hasPermission, identifier, notFoundIfUnchanged, ok, readBytes, timestamp } from './http'
import type { ApiContext, ApiEnv } from './http'
import { legacyInvoice } from './mobile-compat'

export const mobileWriteCompatibility = new Hono<ApiEnv>()
const isAndroid = (c: ApiContext) => c.get('credential') === 'bearer' && c.req.header('X-Store-Client') === 'android'
const text = z.string().trim().max(2000).nullish()
const stockCount = z.number().int().min(0).max(1_000_000_000)

function decimalMinor(max: number) {
  return z.string().trim().max(20)
    .transform(value => value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15)).replace('٫', '.'))
    .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/))
    .transform(value => {
      const [whole, fraction = ''] = value.split('.')
      return Number(whole + fraction.padEnd(2, '0'))
    })
    .pipe(z.number().int().min(0).max(max))
}

const productInput = z.object({
  name: z.string().trim().min(1).max(200),
  price: decimalMinor(100_000_000_000),
  description: text,
  notes: text,
  barcode: z.string().trim().min(1).max(120).nullish(),
  category_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullish(),
  stock: stockCount,
  expected_stock: stockCount.optional(),
}).strict()

function requirePermission(c: ApiContext, permission: string) {
  if (!hasPermission(c.get('actor'), permission)) fail(403, 'forbidden', 'ليست لديك صلاحية لتنفيذ هذه العملية.')
}

async function mobileProduct(c: ApiContext, id: number, status: 200 | 201 = 200) {
  const row = await c.env.DB.prepare(`
    SELECT p.id, p.name, p.description, p.notes, p.barcode, p.stock, p.category_id, c.name AS category_name,
      printf('%d.%02d', p.price_minor / 100, p.price_minor % 100) AS price, p.updated_at,
      EXISTS(SELECT 1 FROM product_images WHERE product_id = p.id) AS has_image
    FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?
  `).bind(id).first()
  if (!row) fail(404, 'not_found', 'المنتج غير موجود.')
  return ok(c, {
    ...row,
    category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
    image_url: row.has_image ? '/api/v1/products/' + id + '/image' : null,
  }, status)
}

mobileWriteCompatibility.post('/products', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'products.create')
  const data = await body(c, productInput)
  if (data.stock !== 0) requirePermission(c, 'inventory.manage')
  const db = c.env.DB
  return write(c, 'mobile.product.create', data, (op, binds, actor) => [
    db.prepare('INSERT INTO products (name, price_minor, description, notes, barcode, category_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(data.name, data.price, data.description ?? null, data.notes ?? null, data.barcode ?? null, data.category_id ?? null),
    db.prepare(`INSERT INTO mobile_product_operations (operation_id, product_id) VALUES (${op}, last_insert_rowid())`)
      .bind(...binds),
    db.prepare(`
      INSERT INTO inventory_movements (product_id, delta, source_type, source_id, note, actor_id)
      SELECT product_id, ?, 'adjustment', operation_id, 'Android opening stock', ?
      FROM mobile_product_operations WHERE operation_id = ${op} AND ? <> 0
    `).bind(data.stock, actor, ...binds, data.stock),
  ], async operationId => {
    const id = await db.prepare('SELECT product_id FROM mobile_product_operations WHERE operation_id = ?')
      .bind(operationId).first<number>('product_id')
    if (id === null) throw new Error('Missing created product reference')
    return mobileProduct(c, id, 201)
  })
})

mobileWriteCompatibility.put('/products/:id', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'products.update')
  const id = identifier.parse(c.req.param('id'))
  const data = await body(c, productInput)
  const delta = data.expected_stock === undefined ? 0 : data.stock - data.expected_stock
  if (delta) requirePermission(c, 'inventory.manage')
  const db = c.env.DB
  const expected = data.expected_stock === undefined || delta !== 0 ? data.expected_stock ?? data.stock : null
  return write(c, 'mobile.product.update', { id, ...data }, (op, binds, actor) => [
    db.prepare(`
      INSERT INTO mobile_product_operations (operation_id, product_id)
      VALUES (${op}, (SELECT id FROM products WHERE id = ? AND (? IS NULL OR stock = ?)))
    `).bind(...binds, id, expected, expected),
    db.prepare(`
      UPDATE products SET name = ?, price_minor = ?, description = ?, notes = ?, barcode = ?, category_id = ?, updated_at = ${timestamp}
      WHERE id = ?
    `).bind(data.name, data.price, data.description ?? null, data.notes ?? null, data.barcode ?? null, data.category_id ?? null, id),
    db.prepare(`
      INSERT INTO inventory_movements (product_id, delta, source_type, source_id, note, actor_id)
      SELECT ?, ?, 'adjustment', ${op}, 'Android stock adjustment', ? WHERE ? <> 0
    `).bind(id, delta, ...binds, actor, delta),
  ], () => mobileProduct(c, id))
})

mobileWriteCompatibility.post('/products/:id/image', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'products.update')
  const id = identifier.parse(c.req.param('id'))
  const bytes = await readBytes(c, 131072 + 4096)
  const mediaType = c.req.header('Content-Type') ?? ''
  const form = await new Response(bytes, { headers: { 'Content-Type': mediaType } }).formData().catch(() => null)
  const file = form?.get('image')
  if (!(file instanceof File) || file.size > 131072) fail(422, 'invalid_image', 'أرسل صورة لا تتجاوز 128 كيلوبايت.')
  const content = await file.arrayBuffer()
  const format = imageType(content)
  const db = c.env.DB
  const saved = await auditedWrite(c, db.prepare(`
    INSERT INTO product_images (product_id, media_type, content)
    SELECT id, ?, ? FROM products WHERE id = ?
    ON CONFLICT(product_id) DO UPDATE SET media_type = excluded.media_type, content = excluded.content, updated_at = ${timestamp}
  `).bind(format, content, id), 'update_image', 'product', id)
  notFoundIfUnchanged(saved)
  return mobileProduct(c, id)
})

const invoicePayment = z.object({
  amount: decimalMinor(900_000_000_000_000).nullish(),
  notes: z.string().trim().max(1000).nullish(),
}).strict()

mobileWriteCompatibility.post('/invoices/:id/pay', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'invoices.pay')
  requirePermission(c, 'invoices.view')
  const id = identifier.parse(c.req.param('id'))
  const data = await body(c, invoicePayment)
  const db = c.env.DB
  return write(c, 'mobile.invoice.payment', { id, ...data }, (op, binds, actor) => [
    db.prepare(`
      INSERT INTO invoice_payments (id, invoice_id, amount_minor, source_type, actor_id)
      VALUES (${op}, ?, COALESCE(?, (SELECT total_minor - paid_minor FROM invoices WHERE id = ?)), 'payment', ?)
    `).bind(...binds, id, data.amount ?? null, id, actor),
  ], async () => ok(c, await legacyInvoice(c, id)))
})

mobileWriteCompatibility.post('/invoices/:id/refund', async (c, next) => {
  if (!isAndroid(c)) return next()
  requirePermission(c, 'invoices.refund')
  requirePermission(c, 'invoices.view')
  const id = identifier.parse(c.req.param('id'))
  const reason = 'استرجاع عبر تطبيق أندرويد'
  const db = c.env.DB
  return write(c, 'mobile.invoice.refund', { id }, (op, binds, actor) => [
    db.prepare(`
      INSERT INTO invoice_refunds (id, invoice_id, total_minor, returned_minor, reason, actor_id)
      VALUES (${op}, ?, (SELECT total_minor FROM invoices WHERE id = ?),
        (SELECT paid_minor FROM invoices WHERE id = ?), ?, ?)
    `).bind(...binds, id, id, id, reason, actor),
  ], async () => ok(c, await legacyInvoice(c, id)))
})
