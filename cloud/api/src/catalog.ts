import { Hono } from 'hono'
import { z } from 'zod'
import {
  auditedWrite, body, fail, identifier, notFoundIfUnchanged, ok, patchStatement,
  permit, readBytes, searchPrefix, searchText, selectPage, timestamp,
} from './http'
import type { ApiContext, ApiEnv } from './http'
import { emailSchema } from './auth'

export const catalog = new Hono<ApiEnv>()
export const catalogPermissions = ['categories', 'products', 'customers']
  .flatMap((module) => ['view', 'create', 'update', 'delete'].map((operation) => `${module}.${operation}`))

const title = z.string().trim().min(1).max(200)
const description = z.string().trim().max(2000).nullable().optional()
const phone = z.string().trim().max(60).nullable().optional()
const minorUnits = z.number().int().min(0).max(100000000000)

const category = z.object({ name: title, description }).strict()
const customer = z.object({ name: title, phone, email: emailSchema.nullable().optional(), address: description, notes: description }).strict()
const product = z.object({
  name: title,
  description,
  notes: description,
  category_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  barcode: z.string().trim().min(1).max(120).nullable().optional(),
  price_minor: minorUnits,
  cost_minor: minorUnits.optional(),
  low_stock_threshold: z.number().int().min(0).max(1000000000).optional(),
  active: z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Number).optional(),
}).strict()

const categoryColumns = `categories.id, name, description, created_at, updated_at,
  (SELECT count(*) FROM products p WHERE p.category_id = categories.id AND p.active = 1) AS products_count`
const customerColumns = 'id, name, phone, email, address, notes, created_at, updated_at'
const productColumns = `p.id, p.name, p.description, p.notes, p.category_id, c.name AS category_name,
  p.barcode, p.price_minor, p.cost_minor, p.stock, p.low_stock_threshold, p.active,
  EXISTS(SELECT 1 FROM product_images i WHERE i.product_id = p.id) AS has_image,
  printf('%d.%02d', p.price_minor / 100, p.price_minor % 100) AS price, p.created_at, p.updated_at`
const productTable = 'products p LEFT JOIN categories c ON p.category_id = c.id'
const prefixOperator = "LIKE ? ESCAPE '\\'"

function productView(row: Record<string, unknown>) {
  return {
    ...row,
    category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
    image_url: row.has_image ? `/api/v1/products/${row.id}/image` : null,
  }
}

async function find(c: ApiContext, columns: string, table: string, id: number, field = 'id') {
  const record = await c.env.DB.prepare(`SELECT ${columns} FROM ${table} WHERE ${field} = ?`).bind(id).first()
  if (!record) fail(404, 'not_found', 'السجل غير موجود.')
  return record
}

for (const resource of [
  { table: 'categories', entity: 'category', columns: categoryColumns, input: category },
  { table: 'customers', entity: 'customer', columns: customerColumns, input: customer },
] as const) {
  const { table, entity, columns, input } = resource
  const route = '/' + table
  catalog.get(route, permit(`${table}.view`), (c) => {
    const q = searchText.optional().parse(c.req.query('q'))
    const searchFields = table === 'customers' ? ['name', 'phone', 'email'] : ['name']
    return selectPage(c, columns, table,
      q ? 'WHERE ' + searchFields.map((field) => `${field} ${prefixOperator}`).join(' OR ') : '',
      q ? searchFields.map(() => searchPrefix(q)) : [], 'id DESC')
  })
  catalog.get(route + '/:id', permit(`${table}.view`), async (c) =>
    ok(c, await find(c, columns, table, identifier.parse(c.req.param('id')))))
  catalog.post(route, permit(`${table}.create`), async (c) => {
    const values = await body(c, input)
    const keys = Object.keys(values)
    const db = c.env.DB
    const saved = await auditedWrite(c,
      db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
        .bind(...Object.values(values)), 'create', entity, null)
    return ok(c, await find(c, columns, table, saved.meta.last_row_id), 201)
  })
  catalog.on(['PATCH', 'PUT'], route + '/:id', permit(`${table}.update`), async (c) => {
    const id = identifier.parse(c.req.param('id'))
    const values = await body(c, input.partial())
    const result = await auditedWrite(c, patchStatement(c.env.DB, table, values, id), 'update', entity, id)
    notFoundIfUnchanged(result)
    return ok(c, await find(c, columns, table, id))
  })
  catalog.delete(route + '/:id', permit(`${table}.delete`), async (c) => {
    const id = identifier.parse(c.req.param('id'))
    const result = await auditedWrite(c, c.env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id), 'delete', entity, id)
    notFoundIfUnchanged(result)
    return ok(c, { id })
  })
}

catalog.get('/products', permit('products.view'), async (c) => {
  const filter = z.object({
    q: searchText.optional(),
    barcode: z.string().trim().min(1).max(120).optional(),
    category_id: identifier.optional(),
    active: z.enum(['true', 'false', 'all']).default('true'),
    in_stock: z.enum(['true', 'false']).optional(),
  }).parse(c.req.query())
  const predicates = []
  const parameters = []
  if (filter.active !== 'all') {
    predicates.push('p.active = ?')
    parameters.push(Number(filter.active === 'true'))
  }
  if (filter.barcode) {
    predicates.push('p.barcode = ?')
    parameters.push(filter.barcode)
  }
  if (filter.category_id) {
    predicates.push('p.category_id = ?')
    parameters.push(filter.category_id)
  }
  if (filter.in_stock !== undefined) {
    predicates.push(filter.in_stock === 'true' ? 'p.stock > 0' : 'p.stock = 0')
  }
  if (filter.q) {
    predicates.push(`(p.name ${prefixOperator} OR p.barcode = ?)`)
    parameters.push(searchPrefix(filter.q), filter.q)
  }
  return selectPage(c, productColumns, productTable, predicates.length ? 'WHERE ' + predicates.join(' AND ') : '', parameters, 'p.id DESC', productView)
})

catalog.get('/products/:id', permit('products.view'), async (c) =>
  ok(c, productView(await find(c, productColumns, productTable, identifier.parse(c.req.param('id')), 'p.id'))))

catalog.post('/products', permit('products.create'), async (c) => {
  const values = await body(c, product)
  const keys = Object.keys(values)
  const db = c.env.DB
  const saved = await auditedWrite(c,
    db.prepare(`INSERT INTO products (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...Object.values(values)),
    'create', 'product', null)
  return ok(c, productView(await find(c, productColumns, productTable, saved.meta.last_row_id, 'p.id')), 201)
})

catalog.patch('/products/:id', permit('products.update'), async (c) => {
  const id = identifier.parse(c.req.param('id'))
  const values = await body(c, product.partial())
  const result = await auditedWrite(c, patchStatement(c.env.DB, 'products', values, id), 'update', 'product', id)
  notFoundIfUnchanged(result)
  return ok(c, productView(await find(c, productColumns, productTable, id, 'p.id')))
})

catalog.delete('/products/:id', permit('products.delete'), async (c) => {
  const id = identifier.parse(c.req.param('id'))
  const result = await auditedWrite(c,
    c.env.DB.prepare(`UPDATE products SET active = 0, updated_at = ${timestamp} WHERE id = ? AND active = 1`).bind(id),
    'archive', 'product', id)
  notFoundIfUnchanged(result)
  return ok(c, { id })
})

export function imageType(bytes: ArrayBuffer) {
  const view = new Uint8Array(bytes)
  if (view.length >= 4 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return 'image/jpeg'
  if (view.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => view[i] === byte)) return 'image/png'
  if (view.length >= 12 && String.fromCharCode(...view.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...view.subarray(8, 12)) === 'WEBP') return 'image/webp'
  fail(415, 'invalid_image', 'استخدم صورة JPEG أو PNG أو WebP.')
}

catalog.get('/products/:id/image', permit('products.view'), async (c) => {
  const id = identifier.parse(c.req.param('id'))
  const row = await c.env.DB.prepare('SELECT content, media_type FROM product_images WHERE product_id = ?')
    .bind(id).first<{ content: number[] | ArrayBuffer; media_type: string }>()
  if (!row) fail(404, 'not_found', 'لا توجد صورة لهذا المنتج.')
  const data = Array.isArray(row.content) ? Uint8Array.from(row.content) : row.content
  return new Response(data, { headers: { 'content-type': row.media_type, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } })
})

catalog.put('/products/:id/image', permit('products.update'), async (c) => {
  const id = identifier.parse(c.req.param('id'))
  const content = await readBytes(c, 131072)
  const mediaType = imageType(content)
  const result = await auditedWrite(c, c.env.DB.prepare(`
    INSERT INTO product_images (product_id, media_type, content)
    SELECT id, ?, ? FROM products WHERE id = ?
    ON CONFLICT(product_id) DO UPDATE SET media_type = excluded.media_type,
      content = excluded.content, updated_at = ${timestamp}
  `).bind(mediaType, content, id), 'update_image', 'product', id)
  notFoundIfUnchanged(result)
  return ok(c, { id })
})

catalog.delete('/products/:id/image', permit('products.update'), async (c) => {
  const id = identifier.parse(c.req.param('id'))
  const result = await auditedWrite(c, c.env.DB.prepare('DELETE FROM product_images WHERE product_id = ?').bind(id),
    'delete_image', 'product', id)
  notFoundIfUnchanged(result)
  return ok(c, { id })
})
