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

test('Android wallet and damaged stock DTOs, permissions and ledger effects', async t => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral',
  })
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-01-01',
    d1Databases: { DB: 'mobile-wallet-damage-d1' },
  }))
  t.after(() => mf.dispose())
  const db = await mf.getD1Database('DB')
  const migrations = new URL('../migrations/', import.meta.url)
  for (const filename of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) {
    const statements = unstable_splitSqlQuery(readFileSync(new URL(filename, migrations), 'utf8'))
    await db.batch(statements.map(statement => db.prepare(statement)))
  }
  await db.batch([
    db.prepare("INSERT INTO roles(id,name) VALUES (2,'wallet viewer')"),
    db.prepare("INSERT INTO role_permissions(role_id,permission) VALUES (2,'wallets.view')"),
    db.prepare(`INSERT INTO users(id,name,email,password_hash,role_id) VALUES
      (1,'Demo admin','admin@example.invalid','unused',1), (2,'Demo viewer','viewer@example.invalid','unused',2)`),
    db.prepare("INSERT INTO products(id,name,price_minor,barcode) VALUES (1,'منتج اختبار',1250,'TEST-7')"),
    db.prepare("INSERT INTO customers(id,name) VALUES (1,'عميل اختبار')"),
  ])
  const tokens = [randomBytes(32).toString('base64url'), randomBytes(32).toString('base64url')]
  await db.batch(tokens.map((token, index) => db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), index + 1, Math.floor(Date.now() / 1000) + 300)))

  async function call(path, expected, { method = 'GET', data, key = randomUUID(), viewer = false, android = true } = {}) {
    const headers = { Authorization: 'Bearer ' + tokens[Number(viewer)], 'Idempotency-Key': key }
    if (android) headers['X-Store-Client'] = 'android'
    if (data !== undefined) headers['Content-Type'] = 'application/json'
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      method, headers, body: data === undefined ? undefined : JSON.stringify(data),
    })
    if (response.status === 204) { assert.equal(response.status, expected); return undefined }
    const json = await response.json()
    assert.equal(response.status, expected, JSON.stringify(json))
    return json.data
  }
  const post = (path, expected, data, options = {}) => call(path, expected, { method: 'POST', data, ...options })

  const walletInput = { name: 'محفظة اختبار', provider: 'vodafone_cash', identifier: '01000000000', opening_balance: '100.00' }
  await post('/wallets', 403, walletInput, { viewer: true })
  const wallet = await post('/wallets', 201, walletInput)
  const toggleKey = randomUUID()
  assert.equal((await post('/wallets/' + wallet.id + '/toggle', 200, undefined, { key: toggleKey })).is_active, false)
  assert.equal((await post('/wallets/' + wallet.id + '/toggle', 200, undefined, { key: toggleKey })).is_active, false)
  assert.equal((await post('/wallets/' + wallet.id + '/toggle', 200)).is_active, true)
  await post('/wallets/' + wallet.id + '/adjust', 201, { amount: '10.00', reason: 'test adjustment' })
  const overview = await call('/wallets', 200)
  assert.equal(overview.summary.wallets_total, '110.00')
  assert.equal((await call('/wallets', 200, { viewer: true })).summary.cash, null)
  const permissions = (await call('/me', 200)).permissions
  assert.ok(permissions.includes('page.wallet_cashier.reverse') && permissions.includes('page.damaged.manage'))

  const data = { wallet_id: wallet.id, type: 'send', amount: '10.00', commission: '1.00', fee: '0.25',
    counterparty: '01000000001', payment_method: 'deferred', customer_name: 'عميل اختبار' }
  const sendKey = randomUUID()
  const send = await post('/wallet-cashier', 201, data, { key: sendKey })
  assert.deepEqual(await post('/wallet-cashier', 201, data, { key: sendKey }), send)
  let cashier = await call('/wallet-cashier', 200)
  assert.equal(cashier.transactions[0].receivable, '11.00')
  assert.equal(cashier.transactions[0].can_settle, true)
  assert.equal((await call('/wallet-cashier', 200, { viewer: true })).transactions[0].can_settle, false)
  await post('/wallet-cashier/' + send.uuid + '/settle', 201, { amount: '4.00' })
  await post('/wallet-cashier/' + send.uuid + '/settle', 201, {})
  cashier = await call('/wallet-cashier', 200)
  assert.equal(cashier.transactions[0].receivable, '0.00')
  assert.equal(cashier.transactions[0].can_reverse, false)
  await post('/wallet-cashier/' + send.uuid + '/reverse', 409, { reason: 'already paid' })
  const cash = await post('/wallet-cashier', 201, { ...data, payment_method: 'cash' })
  await post('/wallet-cashier/' + cash.uuid + '/reverse', 201, { reason: 'reverse cash send' })
  assert.equal((await call('/wallet-cashier', 200)).transactions[0].status, 'reversed')

  await post('/inventory/adjustments', 201, { product_id: 1, delta: 5, note: 'opening stock' }, { android: false })
  assert.equal((await call('/damaged/products?q=TEST-7', 200))[0].price, '12.50')
  const damage = { product_id: 1, quantity: 1, reason: 'broken', unit_value: '4.00', damaged_on: '2026-01-01', notes: 'test' }
  await post('/damaged', 403, damage, { viewer: true })
  const damaged = await post('/damaged', 201, damage)
  assert.equal(damaged.stock_before, 5)
  assert.equal(damaged.stock_after, 4)
  const updateKey = randomUUID()
  const correction = { method: 'PUT', key: updateKey, data: { ...damage, quantity: 2 } }
  assert.equal((await call('/damaged/' + damaged.id, 200, correction)).stock_after, 3)
  assert.equal((await call('/damaged/' + damaged.id, 200, correction)).total_value, '8.00')
  await db.prepare("INSERT INTO role_permissions(role_id,permission) VALUES (2,'damaged.view'), (2,'damaged.manage')").run()
  const nonCostActor = (await call('/me', 200, { viewer: true })).permissions
  assert.ok(nonCostActor.includes('page.damaged.manage'))
  assert.ok(!nonCostActor.includes('page.products.cost.manage'))
  assert.ok(permissions.includes('page.products.cost.manage'))
  const hiddenMobile = await call('/damaged/' + damaged.id, 200, { viewer: true })
  assert.equal(hiddenMobile.unit_value, '')
  assert.equal(hiddenMobile.total_value, '')
  assert.equal((await call('/damaged', 200, { viewer: true }))[0].total_value, '')
  const publicDamage = await call('/damaged/' + damaged.id, 200, { viewer: true, android: false })
  const publicList = await call('/damaged', 200, { viewer: true, android: false })
  for (const row of [publicDamage, publicList[0]]) {
    assert.equal(row.quantity, 2)
    for (const field of ['unit_cost_minor', 'unit_value_minor', 'total_value_minor', 'verified_inventory_loss_minor']) {
      assert.ok(!(field in row), field)
    }
  }
  assert.ok(publicDamage.corrections.length > 0)
  assert.ok(publicDamage.corrections.every(row => !('unit_value_minor' in row) && !('previous_unit_minor' in row)))
  const auditReport = '/reports/damaged?from=2026-01-01&to=2026-01-01'
  const hiddenReport = await call(auditReport, 200, { viewer: true, android: false })
  assert.equal(hiddenReport.units, 2)
  assert.ok(!('total_value_minor' in hiddenReport))
  assert.equal((await call(auditReport, 200, { android: false })).total_value_minor, 800)
  await post('/damaged', 403, damage, { viewer: true })
  await call('/damaged/' + damaged.id, 403, { ...correction, viewer: true })
  const { unit_value: _, ...noCost } = damage
  const ordinaryCorrection = await call('/damaged/' + damaged.id, 200, {
    method: 'PUT', viewer: true, data: { ...noCost, quantity: 2, notes: 'Operational correction' },
  })
  assert.equal(ordinaryCorrection.total_value, '')
  assert.equal((await call('/damaged/' + damaged.id, 200)).total_value, '8.00')
  const reversed = await post('/damaged/' + damaged.id + '/void', 200, { reason: 'test reversal' })
  assert.equal(reversed.status, 'voided')
  assert.equal((await call('/damaged?status=voided&q=TEST-7', 200)).length, 1)
  assert.equal(await db.prepare('SELECT stock FROM products WHERE id = 1').first('stock'), 5)
  const supplierInput = { name: 'مورد اختبار', phone: '01000', opening_balance: '25.50' }
  const supplier = await post('/suppliers', 201, supplierInput)
  assert.equal(supplier.balance, '25.50')
  const supplierEdit = { method: 'PUT', data: { ...supplierInput, address: 'updated' }, key: randomUUID() }
  assert.equal((await call('/suppliers/' + supplier.id, 200, supplierEdit)).address, 'updated')
  assert.equal((await call('/suppliers/' + supplier.id, 200, supplierEdit)).address, 'updated')

  const repair = { name: 'جهاز اختبار', owner: 'عميل اختبار', status: 'قيد الانتظار', requested_date: '2026-01-01' }
  const job = await post('/maintenance', 201, repair)
  assert.equal(job.status, 'قيد الانتظار')
  await call('/maintenance/' + job.id, 409, { method: 'PUT', data: { ...repair, status: 'مكتمل' } })
  await call('/maintenance/' + job.id, 200, { method: 'PUT', data: { ...repair, status: 'قيد الصيانة' } })
  const complete = { method: 'PUT', data: { ...repair, status: 'مكتمل' }, key: randomUUID() }
  assert.equal((await call('/maintenance/' + job.id, 200, complete)).status, 'مكتمل')
  assert.ok((await call('/maintenance/' + job.id, 200, complete)).completed_date)

  const installment = await post('/installments', 201, { customer: 'عميل اختبار', product_ids: [1], quantities: [1],
    next_payment_date: '2029-01-01', paid_amount: '1.00' })
  assert.equal(installment.remaining, '11.50')
  assert.equal(installment.items[0].price, '12.50')
  assert.equal((await post('/installments/' + installment.id + '/status', 200, { status: 'متأخر' })).status, 'overdue')
  assert.equal((await post('/installments/' + installment.id + '/pay', 200, {})).status, 'complete')

  const debt = await post('/personal-debts', 201, { creditor: 'دائن اختبار', total_amount: '12.50', paid_amount: '1.00' })
  assert.equal(debt.remaining, '11.50')
  const payoff = await post('/personal-debts/' + debt.id + '/pay', 200, { notes: 'paid' })
  assert.equal(payoff.status, 'paid')
  assert.equal(payoff.payments[0].notes, 'paid')
  await call('/personal-debts/' + debt.id, 409, { method: 'DELETE' })
  const unpaid = await post('/personal-debts', 201, { creditor: 'دائن آخر', total_amount: '5.00' })
  await call('/personal-debts/' + unpaid.id, 204, { method: 'DELETE' })

  const invoiceInput = { customer: 'عميل اختبار', product_ids: [1], quantities: [1],
    invoice_date: '2026-02-01', paid_amount: '2.50', notes: 'legacy memo' }
  const invoice = await post('/invoices', 201, invoiceInput)
  assert.equal(invoice.status, 'partial')
  assert.equal(invoice.notes, 'legacy memo')
  assert.equal(invoice.invoice_date, '2026-02-01')
  const edited = await call('/invoices/' + invoice.id, 200, { method: 'PUT', data: { ...invoiceInput, paid_amount: '0.00' } })
  assert.notEqual(edited.id, invoice.id)
  assert.equal(edited.status, 'unpaid')
  assert.equal((await call('/invoices/' + invoice.id, 200)).status, 'refunded')
  assert.equal(await db.prepare('SELECT stock FROM products WHERE id=1').first('stock'), 4)

})
