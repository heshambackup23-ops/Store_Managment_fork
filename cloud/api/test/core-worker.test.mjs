import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { build } from 'esbuild'
import { Miniflare, convertV4MiniflareOptions } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'

const base = 'https://store.example.test'
const origin = base
const env = {
  AUTH_PEPPER: 'test-only synthetic provisioning pepper of 32+ characters',
  STORE_USER_EMAIL: 'admin@store.example.test',
  STORE_USER_USERNAME: 'admin-test',
  STORE_USER_PASSWORD: 'local admin password for tests',
}
const appPath = fileURLToPath(new URL('../src/index.ts', import.meta.url))

test('Worker core runs against isolated D1 with real sessions, permissions and catalog storage', async (t) => {
  const app = await build({ entryPoints: [appPath], bundle: true, write: false, format: 'esm', target: 'es2022' })
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: app.outputFiles[0].text,
    compatibilityDate: '2026-01-01',
    bindings: { AUTH_PEPPER: env.AUTH_PEPPER, WEB_ORIGIN: origin },
    d1Databases: ['DB'],
  }))
  t.after(() => worker.dispose())

  const db = await worker.getD1Database('DB')
  async function runSql(sql) {
    await db.batch(unstable_splitSqlQuery(sql).map((statement) => db.prepare(statement)))
  }
  for (const migration of ['0001_core.sql', '0002_business.sql']) {
    await runSql(await readFile(new URL('../migrations/' + migration, import.meta.url), 'utf8'))
  }

  const folder = await mkdtemp(join(tmpdir(), 'henra-store-core-test-'))
  const provisioned = join(folder, 'admin.generated.sql')
  t.after(async () => {
    await unlink(provisioned).catch((error) => { if (error.code !== 'ENOENT') throw error })
    await rmdir(folder)
  })
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/provision-user.mjs', import.meta.url)), provisioned], {
    env: { ...process.env, ...env },
  })
  await runSql(await readFile(provisioned, 'utf8'))

  let token
  let cookie
  let roleId
  let staffId
  let staffToken
  let categoryId
  let productId
  let customerId
  const staff = {
    email: 'cashier@store.example.test',
    username: 'cashier-test',
    password: 'local cashier password for tests',
  }

  async function raw(path, method = 'GET', data, auth, headers = {}) {
    const requestHeaders = new Headers(headers)
    if (auth) requestHeaders.set('Authorization', 'Bearer ' + auth)
    let body
    if (data instanceof Uint8Array) body = data
    else if (data !== undefined) {
      requestHeaders.set('Content-Type', 'application/json')
      body = JSON.stringify(data)
    }
    return worker.dispatchFetch(base + path, { method, headers: requestHeaders, body })
  }
  async function request(path, method, data, auth, status = 200, headers) {
    const response = await raw('/api/v1' + path, method, data, auth, headers)
    const result = await response.json()
    assert.equal(response.status, status, JSON.stringify(result))
    assert.equal(result.success, status < 400)
    return result
  }

  await t.test('health, public login, CSRF and forbidden origins', async () => {
    assert.equal((await raw('/health')).status, 200)
    await request('/auth/me', 'GET', undefined, undefined, 401)
    const login = await raw('/api/v1/auth/login', 'POST', { email: env.STORE_USER_EMAIL, password: env.STORE_USER_PASSWORD })
    const payload = await login.json()
    assert.equal(login.status, 200, JSON.stringify(payload))
    assert.deepEqual(payload.data.user.permissions, ['*'])
    assert.equal(payload.data.token, undefined)
    const setCookie = login.headers.get('Set-Cookie')
    assert.match(setCookie, /HttpOnly/i)
    assert.match(setCookie, /Secure/i)
    assert.match(setCookie, /SameSite=Lax/i)
    cookie = setCookie.split(';')[0]
    token = cookie.slice(cookie.indexOf('=') + 1)
    await request('/profile', 'PATCH', { name: 'Invalid request' }, undefined, 403, { Cookie: cookie, Origin: origin })
    await request('/profile', 'PATCH', { name: 'Updated profile' }, undefined, 200,
      { Cookie: cookie, Origin: origin, 'X-CSRF': '1' })
    await request('/auth/me', 'GET', undefined, token, 403, { Origin: 'https://invalid.example.test' })
  })

  await t.test('staff, role enforcement and mobile bearer contract', async () => {
    const role = await request('/roles', 'POST', { name: 'Test cashier', permissions: ['products.view', 'customers.view'] }, token, 201)
    roleId = role.data.id
    const saved = await request('/staff', 'POST', { name: 'Test cashier', role_id: roleId, ...staff }, token, 201)
    staffId = saved.data.id
    assert.equal(saved.data.password_hash, undefined)
    const login = await raw('/api/v1/auth/token', 'POST', {
      username: staff.username, password: staff.password, device_name: 'local test',
    })
    const payload = await login.json()
    assert.equal(login.status, 201, JSON.stringify(payload))
    assert.equal(payload.data.token_type, 'Bearer')
    staffToken = payload.data.access_token
    assert.equal((await raw('/api/v1/me', 'GET', undefined, staffToken)).status, 200)
    await request('/products', 'GET', undefined, staffToken)
    assert.equal((await request('/auth/me', 'GET', undefined, staffToken)).data.username, staff.username)
    await request('/products', 'POST', { name: 'Blocked', price_minor: 101 }, staffToken, 403)
    await request('/staff/1', 'PATCH', { active: 0 }, token, 409)
    await request('/backup/catalog.csv', 'GET', undefined, staffToken, 403)
    await request('/reports/sales', 'GET', undefined, staffToken, 403)
    const metrics = await request('/dashboard', 'GET', undefined, staffToken)
    assert.deepEqual(Object.keys(metrics.data).sort(), ['customers', 'low_stock', 'out_of_stock', 'products'])
  })

  await t.test('real category, customer, stock protection, products and exact image bytes', async () => {
    const category = await request('/categories', 'POST', { name: 'تصنيف تجريبي' }, token, 201)
    categoryId = category.data.id
    const customer = await request('/customers', 'POST', { name: 'عميل تجريبي', address: 'عنوان افتراضي', phone: '01000000000' }, token, 201)
    customerId = customer.data.id
    const product = await request('/products', 'POST', {
      name: 'منتج تجريبي', notes: 'وصف داخلي', barcode: '01000', category_id: categoryId, price_minor: 11001,
    }, token, 201)
    productId = product.data.id
    assert.equal(product.data.stock, 0)
    assert.equal(product.data.category_name, 'تصنيف تجريبي')
    assert.equal(product.data.price, '110.01')
    assert.deepEqual(product.data.category, { id: categoryId, name: 'تصنيف تجريبي' })
    assert.equal((await request('/products?q=منتج', 'GET', undefined, staffToken)).data[0].id, productId)
    assert.equal((await request('/customers/' + customerId, 'GET', undefined, staffToken)).data.address, 'عنوان افتراضي')
    assert.equal((await request('/customers/' + customerId, 'PUT', { name: 'عميل محدث' }, token)).data.name, 'عميل محدث')
    await request('/products/' + productId, 'PATCH', { stock: 20 }, token, 422)
    await request('/categories/' + categoryId, 'DELETE', undefined, token, 409)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==', 'base64')
    const upload = await raw('/api/v1/products/' + productId + '/image', 'PUT', png, token)
    assert.equal(upload.status, 200, await upload.text())
    const image = await raw('/api/v1/products/' + productId + '/image', 'GET', undefined, staffToken)
    assert.equal(image.headers.get('Content-Type'), 'image/png')
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png)
    const counts = await db.prepare('SELECT count(*) AS count FROM audit_logs WHERE entity_type = ? AND entity_id = ?')
      .bind('product', productId).first()
    assert.equal(counts.count, 2)
  })

  await t.test('notifications are scoped, permissions revoke immediately and sessions can be disabled', async () => {
    const result = await request('/notifications', 'POST', { user_id: staffId, title: 'عنوان', body: 'إشعار خاص' }, token, 201)
    assert.equal((await request('/notifications', 'GET', undefined, token)).data.length, 0)
    assert.equal((await request('/notifications', 'GET', undefined, staffToken)).data[0].id, result.data.id)
    await request('/notifications/' + result.data.id + '/read', 'POST', undefined, staffToken)
    const marked = (await request('/notifications', 'GET', undefined, staffToken)).data[0]
    assert.ok(marked.read_at)
    assert.equal(marked.is_read, true)
    await request('/roles/' + roleId, 'PATCH', { name: 'Test cashier', permissions: ['customers.view'] }, token)
    await request('/products', 'GET', undefined, staffToken, 403)
    await request('/staff/' + staffId, 'PATCH', { active: false }, token)
    await request('/auth/me', 'GET', undefined, staffToken, 401)
    const dashboard = await request('/dashboard', 'GET', undefined, token)
    assert.equal(dashboard.data.customers, 1)
    assert.equal(dashboard.data.products, 1)
    assert.equal(dashboard.data.sales_minor, 0)
  })

  await t.test('password changes rotate credentials and revoke older bearer sessions', async () => {
    const oldMobile = await raw('/api/v1/auth/token', 'POST', {
      username: env.STORE_USER_USERNAME, password: env.STORE_USER_PASSWORD, device_name: 'test device',
    })
    assert.equal(oldMobile.status, 201)
    const olderToken = (await oldMobile.json()).data.access_token
    const rotatedPassword = 'test-only newly rotated password'
    await request('/profile/password', 'POST', {
      current_password: env.STORE_USER_PASSWORD, new_password: rotatedPassword,
    }, token)
    await request('/auth/me', 'GET', undefined, olderToken, 401)
    await request('/auth/login', 'POST', { email: env.STORE_USER_EMAIL, password: env.STORE_USER_PASSWORD }, undefined, 401)
    const newMobile = await raw('/api/v1/auth/token', 'POST', {
      username: env.STORE_USER_USERNAME, password: rotatedPassword, device_name: 'test device',
    })
    assert.equal(newMobile.status, 201)
    const newToken = (await newMobile.json()).data.access_token
    assert.equal((await raw('/api/v1/auth/token', 'DELETE', undefined, newToken)).status, 204)
    await request('/auth/me', 'GET', undefined, newToken, 401)
  })

  await t.test('authentication limits repeated failures', async () => {
    const payload = { email: 'absent@store.example.test', password: 'wrong-password' }
    for (let attempt = 0; attempt < 10; attempt++) await request('/auth/login', 'POST', payload, undefined, 401)
    await request('/auth/login', 'POST', payload, undefined, 429)
  })

  await t.test('logout invalidates the corresponding opaque session', async () => {
    await request('/auth/logout', 'POST', undefined, token)
    await request('/auth/me', 'GET', undefined, token, 401)
    await request('/auth/me', 'GET', undefined, undefined, 401, { Cookie: cookie })
  })
})
