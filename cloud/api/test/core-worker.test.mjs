import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, readdir, rmdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
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

test('Hilal migration preserves custom settings and defaults future inserts to Hilal', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(await readFile(new URL('../migrations/0001_core.sql', import.meta.url), 'utf8'))
    db.exec(`UPDATE settings SET store_name = 'متجر محلي', store_phone = '01000000000',
      receipt_footer = 'شكرًا', updated_at = '2026-11-11T00:00:00.000Z' WHERE id = 1`)
    db.exec(await readFile(new URL('../migrations/0004_hilal_default_settings.sql', import.meta.url), 'utf8'))
    const settings = db.prepare('SELECT store_name, store_phone, receipt_footer, updated_at FROM settings').get()
    assert.deepEqual({ ...settings }, {
      store_name: 'متجر محلي', store_phone: '01000000000', receipt_footer: 'شكرًا', updated_at: '2026-11-11T00:00:00.000Z',
    })
    db.exec('DELETE FROM settings WHERE id = 1; INSERT INTO settings (id) VALUES (1)')
    assert.equal(db.prepare('SELECT store_name FROM settings WHERE id = 1').get().store_name, 'هلال لإدارة المتجر')
  } finally {
    db.close()
  }
})

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
  for (const migration of (await readdir(new URL('../migrations/', import.meta.url))).filter((file) => file.endsWith('.sql')).sort()) {
    await runSql(await readFile(new URL('../migrations/' + migration, import.meta.url), 'utf8'))
  }

  const folder = await mkdtemp(join(tmpdir(), 'henra-store-core-test-'))
  const provisioned = join(folder, 'admin.generated.sql')
  const keyProvisioned = join(folder, 'key-admin.generated.sql')
  const generatedKeyFile = join(folder, 'admin.generated.key')
  t.after(async () => {
    for (const file of [provisioned, keyProvisioned, generatedKeyFile]) {
      await unlink(file).catch((error) => { if (error.code !== 'ENOENT') throw error })
    }
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
    const byName = await raw('/api/v1/auth/login', 'POST', {
      username: ' ' + env.STORE_USER_USERNAME.toUpperCase() + ' ', password: env.STORE_USER_PASSWORD,
    })
    assert.equal(byName.status, 200)
    assert.equal((await byName.json()).data.user.id, payload.data.user.id)
    assert.match(byName.headers.get('Set-Cookie'), /HttpOnly/i)
    await request('/auth/login', 'POST', { username: env.STORE_USER_USERNAME, password: 'incorrect' }, undefined, 401)
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
    assert.equal(product.data.image_url, null)
    assert.deepEqual(product.data.category, { id: categoryId, name: 'تصنيف تجريبي' })
    assert.equal((await request('/products?q=منتج', 'GET', undefined, staffToken)).data[0].id, productId)
    assert.equal((await request('/customers/' + customerId, 'GET', undefined, staffToken)).data.address, 'عنوان افتراضي')
    assert.equal((await request('/customers/' + customerId, 'PUT', { name: 'عميل محدث' }, token)).data.name, 'عميل محدث')
    await request('/products/' + productId, 'PATCH', { stock: 20 }, token, 422)
    await request('/categories/' + categoryId, 'DELETE', undefined, token, 409)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==', 'base64')
    const upload = await raw('/api/v1/products/' + productId + '/image', 'PUT', png, token)
    assert.equal(upload.status, 200, await upload.text())
    const withImage = await request('/products/' + productId, 'GET', undefined, staffToken)
    const imagePath = '/api/v1/products/' + productId + '/image'
    assert.equal(withImage.data.image_url, imagePath)
    assert.equal((await raw(imagePath)).status, 401)
    const image = await raw(imagePath, 'GET', undefined, staffToken)
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

  await t.test('customer ledger shows only visible domains and counts a linked installment once', async () => {
    await runSql(`
      INSERT INTO invoices (id, customer_id, total_minor, paid_minor, actor_id) VALUES (200, ${customerId}, 55000, 10000, 1);
      INSERT INTO installments (customer_id, invoice_id, principal_minor, due_date, actor_id)
        VALUES (${customerId}, 200, 45000, '2027-01-01', 1);
      INSERT INTO personal_debts (customer_id, person_name, principal_minor, direction, actor_id)
        VALUES (${customerId}, 'Test customer', 2700, 'receivable', 1);
    `)
    const ledger = await request('/customers/' + customerId + '/ledger?per_page=2', 'GET', undefined, token)
    assert.equal(ledger.data.balances.invoices_due_minor, 0)
    assert.equal(ledger.data.balances.installments_due_minor, 45000)
    assert.equal(ledger.data.balances.personal_receivables_minor, 2700)
    assert.equal(ledger.meta.total, 3)
    assert.equal(ledger.meta.last_page, 2)
    assert.equal(ledger.data.entries.length, 2)

    await request('/staff/' + staffId, 'PATCH', { active: true }, token)
    const response = await raw('/api/v1/auth/token', 'POST', {
      username: staff.username, password: staff.password, device_name: 'ledger test',
    })
    assert.equal(response.status, 201)
    const scopedToken = (await response.json()).data.access_token
    const empty = await request('/customers/' + customerId + '/ledger', 'GET', undefined, scopedToken)
    assert.deepEqual(empty.data.balances, {})
    assert.deepEqual(empty.data.entries, [])
    await request('/roles/' + roleId, 'PATCH', { name: 'Test cashier', permissions: ['customers.view', 'invoices.view'] }, token)
    const scoped = await request('/customers/' + customerId + '/ledger', 'GET', undefined, scopedToken)
    assert.deepEqual(scoped.data.balances, { invoices_due_minor: 45000 })
    assert.deepEqual(scoped.data.entries.map(({ kind }) => kind), ['invoice'])
    await request('/customers/999999/ledger', 'GET', undefined, scopedToken, 404)
    await request('/roles/' + roleId, 'PATCH', { name: 'Test cashier', permissions: ['invoices.view'] }, token)
    await request('/customers/' + customerId + '/ledger', 'GET', undefined, scopedToken, 403)
  })

  await t.test('generated access keys support staff provisioning, rotation, browser and mobile sign-in', async () => {
    const created = await request('/staff', 'POST', {
      name: 'Access-key cashier', role_id: roleId, email: 'key@store.example.test',
      username: 'cashier-key', credential_mode: 'access_key',
    }, token, 201)
    const key = created.data.access_key
    assert.match(key, /^hilal-ak1_[A-Za-z0-9_-]{43}$/)
    assert.equal(created.data.credential_mode, 'access_key')
    const stored = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(created.data.id).first()
    assert.match(stored.password_hash, /^hmac-sha256\$1\$/)
    assert.ok(!stored.password_hash.includes(key))
    const credentials = { username: 'cashier-key', password: key, device_name: 'key test' }
    const native = await raw('/api/v1/auth/token', 'POST', credentials)
    assert.equal(native.status, 201)
    const previous = (await native.json()).data.access_token
    const login = await request('/auth/login', 'POST', { email: 'key@store.example.test', password: key })
    assert.equal(login.data.user.credential_mode, 'access_key')
    await request('/staff/' + created.data.id + '/access-key', 'POST', undefined, previous, 403)
    const rotated = await request('/staff/' + created.data.id + '/access-key', 'POST', undefined, token)
    assert.notEqual(rotated.data.access_key, key)
    await request('/auth/me', 'GET', undefined, previous, 401)
    assert.equal((await raw('/api/v1/auth/token', 'POST', credentials)).status, 401)
    const nativeAfter = await raw('/api/v1/auth/token', 'POST', { ...credentials, password: rotated.data.access_key })
    assert.equal(nativeAfter.status, 201)
    const nativeAfterToken = (await nativeAfter.json()).data.access_token
    const self = await request('/profile/access-key', 'POST', { current_password: rotated.data.access_key }, nativeAfterToken)
    assert.match(self.data.access_key, /^hilal-ak1_[A-Za-z0-9_-]{43}$/)
    assert.notEqual(self.data.access_key, rotated.data.access_key)
    await request('/auth/me', 'GET', undefined, nativeAfterToken)
    assert.equal((await raw('/api/v1/auth/token', 'POST', { ...credentials, password: rotated.data.access_key })).status, 401)
    const list = await request('/staff', 'GET', undefined, token)
    assert.equal(list.data.find(({ id }) => id === created.data.id).access_key, undefined)
  })

  await t.test('settings use Hilal default and CLI can provision an access key without emitting the secret', async () => {
    const settings = await request('/settings', 'GET', undefined, token)
    assert.equal(settings.data.store_name, 'هلال لإدارة المتجر')
    const script = fileURLToPath(new URL('../scripts/provision-user.mjs', import.meta.url))
    const output = execFileSync(process.execPath, [script, keyProvisioned, '--access-key-file', generatedKeyFile], {
      env: { ...process.env, ...env, STORE_USER_EMAIL: 'keyadmin@store.example.test', STORE_USER_USERNAME: 'keyadmin', STORE_USER_PASSWORD: '' },
      encoding: 'utf8',
    })
    const key = (await readFile(generatedKeyFile, 'utf8')).trim()
    const sql = await readFile(keyProvisioned, 'utf8')
    assert.match(key, /^hilal-ak1_[A-Za-z0-9_-]{43}$/)
    assert.ok(!output.includes(key))
    assert.ok(!sql.includes(key))
    await runSql(sql)
    await request('/auth/login', 'POST', { email: 'keyadmin@store.example.test', password: key })
  })

  await t.test('logout invalidates the corresponding opaque session', async () => {
    await request('/auth/logout', 'POST', undefined, token)
    await request('/auth/me', 'GET', undefined, token, 401)
    await request('/auth/me', 'GET', undefined, undefined, 401, { Cookie: cookie })
  })
})
