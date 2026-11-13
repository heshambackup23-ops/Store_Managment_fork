import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'

test('Android product and invoice writes preserve stock, permissions and safe retry', async t => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
  })
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-01-01',
    d1Databases: { DB: 'mobile-write-test-d1' },
  }))
  t.after(() => mf.dispose())
  const db = await mf.getD1Database('DB')
  const migrations = new URL('../migrations/', import.meta.url)
  for (const filename of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    const statements = unstable_splitSqlQuery(readFileSync(new URL(filename, migrations), 'utf8'))
    await db.batch(statements.map(statement => db.prepare(statement)))
  }
  await db.batch([
    db.prepare("INSERT INTO roles(id,name) VALUES (2,'catalog editor')"),
    db.prepare("INSERT INTO role_permissions(role_id,permission) VALUES (2,'products.create'),(2,'products.update')"),
    db.prepare(`INSERT INTO users(id,name,email,password_hash,role_id) VALUES
      (1,'Demo admin','admin@example.invalid','unused',1), (2,'Demo editor','editor@example.invalid','unused',2)`),
    db.prepare("INSERT INTO categories(id,name) VALUES (1,'تجريبي')"),
    db.prepare("INSERT INTO customers(id,name) VALUES (1,'عميل تجريبي')"),
  ])
  const tokens = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')]
  await db.batch(tokens.map((token, index) => db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), index + 1, Math.floor(Date.now() / 1000) + 300)))

  async function call(path, { method = 'GET', data, key = randomUUID(), editor = false, android = true } = {}) {
    const headers = { Authorization: 'Bearer ' + tokens[Number(editor)], 'Idempotency-Key': key }
    if (android) headers['X-Store-Client'] = 'android'
    const multipart = data instanceof FormData ? new Request('http://localhost', { method: 'POST', body: data }) : undefined
    if (multipart) headers['Content-Type'] = multipart.headers.get('content-type')
    else if (data) headers['Content-Type'] = 'application/json'
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method, headers, body: multipart ? await multipart.arrayBuffer() : data === undefined ? undefined : JSON.stringify(data),
    })
    if (response.headers.get('content-type')?.includes('json')) return { status: response.status, body: await response.json() }
    return { status: response.status, body: new Uint8Array(await response.arrayBuffer()) }
  }

  function check(result, status) {
    assert.equal(result.status, status, JSON.stringify(result.body))
    return result.body.data
  }

  const data = { name: 'منتج تجريبي', price: '١٢٫٣٤', stock: 5, barcode: 'LEGACY-5', category_id: 1 }
  const key = randomUUID()
  check(await call('/products', { method: 'POST', data, editor: true }), 403)
  const [first, repeated] = await Promise.all([
    call('/products', { method: 'POST', data, key }),
    call('/products', { method: 'POST', data, key }),
  ])
  const product = check(first, 201)
  assert.equal(check(repeated, 201).id, product.id)
  assert.equal(product.price, '12.34')
  assert.equal(product.stock, 5)
  assert.equal(product.category.name, 'تجريبي')
  assert.equal(await db.prepare('SELECT count(*) AS count FROM inventory_movements WHERE product_id = ?').bind(product.id).first('count'), 1)
  check(await call('/products', { method: 'POST', data: { ...data, stock: 7 }, key }), 409)

  const update = { ...data, stock: 8, expected_stock: 5 }
  check(await call('/products/' + product.id, { method: 'PUT', data: update, editor: true }), 403)
  assert.equal(check(await call('/products/' + product.id, { method: 'PUT', data: { ...data, name: 'updated' }, editor: true }), 200).name, 'updated')
  assert.equal(check(await call('/products/' + product.id, { method: 'PUT', data: update }), 200).stock, 8)
  check(await call('/products/' + product.id, { method: 'PUT', data: { ...update, stock: 9 } }), 409)
  check(await call('/products/' + product.id, { method: 'PUT', data: { ...data, stock: 5 } }), 409)
  assert.equal(await db.prepare('SELECT count(*) AS count FROM inventory_movements WHERE product_id = ?').bind(product.id).first('count'), 2)

  const imageBytes = Uint8Array.of(137,80,78,71,13,10,26,10,0)
  const image = new FormData()
  image.append('image', new Blob([imageBytes], { type: 'image/png' }), 'sample.png')
  const imageResult = check(await call('/products/' + product.id + '/image', { method: 'POST', data: image }), 200)
  assert.equal(imageResult.image_url, '/api/v1/products/' + product.id + '/image')
  const savedImage = await call('/products/' + product.id + '/image')
  assert.equal(savedImage.status, 200)
  assert.deepEqual(savedImage.body, imageBytes)

  const invoice = check(await call('/invoices', {
    method: 'POST', android: false, data: { customer_id: 1, items: [{ product_id: product.id, quantity: 2 }], paid_minor: 234 },
  }), 201)
  const payPath = '/invoices/' + invoice.id + '/pay'
  const payKey = randomUUID()
  check(await call(payPath, { method: 'POST', data: {}, editor: true }), 403)
  const paid = check(await call(payPath, { method: 'POST', data: {}, key: payKey }), 200)
  assert.equal(paid.status, 'paid')
  assert.equal(paid.paid_amount, '24.68')
  assert.equal(check(await call(payPath, { method: 'POST', data: {}, key: payKey }), 200).remaining_amount, '0.00')
  check(await call(payPath, { method: 'POST', data: { amount: '0.01' } }), 409)
  const refundPath = '/invoices/' + invoice.id + '/refund'
  const refundKey = randomUUID()
  assert.equal(check(await call(refundPath, { method: 'POST', key: refundKey }), 200).status, 'refunded')
  assert.equal(check(await call(refundPath, { method: 'POST', key: refundKey }), 200).status, 'refunded')
  assert.equal(await db.prepare('SELECT stock FROM products WHERE id = ?').bind(product.id).first('stock'), 8)
  assert.equal(await db.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'mobile.invoice.refund'").first('count'), 1)
})
