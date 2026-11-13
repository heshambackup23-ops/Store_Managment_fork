import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { convertV4MiniflareOptions, Miniflare } from 'miniflare'
import { unstable_splitSqlQuery } from 'wrangler'
import { buildDamageRestore } from '../scripts/restore-laravel-damage.mjs'

const products = [{ id: '42', stock: '7' }]
const cutoff = '2026-10-31T18:00:00.000Z'
const created = '2026-10-04T09:00:00.000Z'
const active = {
  id: '701', product_id: '42', product_name: 'اسم الصنف الأصلي', product_barcode: '000123',
  quantity: '2', unit_value: '1.25', total_value: '2.50', reason: 'broken', notes: 'هالك اختباري',
  damaged_on: '2026-10-04', stock_before: '9', stock_after: '7', status: 'recorded',
  created_at: created, updated_at: created,
}
const voided = {
  ...active, id: '702', quantity: '1', total_value: '1.25', stock_before: '10', stock_after: '9',
  status: 'voided', void_reason: 'خطأ في التسجيل', voided_at: '2026-10-05T09:00:00.000Z',
  voided_by: '91', updated_at: '2026-10-05T09:00:00.000Z',
}

test('legacy damage stays visible on web and Android and live reversal adjusts cutoff stock once', async t => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'neutral',
  })
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-01-01',
    d1Databases: { DB: 'legacy-damage-test-d1' },
  }))
  t.after(() => mf.dispose())
  const db = await mf.getD1Database('DB')
  const run = sql => db.batch(unstable_splitSqlQuery(sql).map(statement => db.prepare(statement)))
  const migrations = new URL('../migrations/', import.meta.url)
  for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    await run(await readFile(new URL(name, migrations), 'utf8'))
  }
  await run(`
    INSERT INTO users(id,name,email,password_hash,role_id) VALUES (1,'fixture','fixture@example.invalid','unused',1);
    INSERT INTO products(id,name,price_minor,stock,barcode) VALUES (42,'اسم الصنف الآن',100,6,'456');
  `)
  const { sql, checks } = buildDamageRestore([active, voided], products, 1, cutoff)
  assert.equal(checks.active_value_minor, '250')
  assert.equal(checks.reversed, 1)
  await assert.rejects(run(sql), /NOT NULL constraint failed/)
  assert.equal(await db.prepare('SELECT count(*) AS n FROM damaged_stock').first('n'), 0)
  await run('UPDATE products SET stock=7 WHERE id=42;')
  await run(sql)
  await run(sql)
  assert.equal(await db.prepare('SELECT stock FROM products WHERE id=42').first('stock'), 7)
  assert.equal(await db.prepare("SELECT count(*) AS n FROM inventory_movements WHERE source_type IN ('damage','damage_reversal')").first('n'), 0)
  const token = randomBytes(32).toString('base64url')
  await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES (?,1,?)')
    .bind(createHash('sha256').update(token).digest('base64url'), Math.floor(Date.now() / 1000) + 300).run()
  async function get(path, client) {
    const response = await mf.dispatchFetch('http://localhost/api/v1' + path, {
      headers: { Authorization: 'Bearer ' + token, ...(client ? { 'X-Store-Client': client } : {}) },
    })
    const result = await response.json()
    assert.equal(response.status, 200, JSON.stringify(result))
    return result.data
  }
  const web = await get('/damaged/701')
  assert.equal(web.product_name, active.product_name)
  assert.equal(web.product_barcode, active.product_barcode)
  const android = await get('/damaged/701', 'android')
  assert.equal(android.stock_before, 9)
  assert.equal(android.stock_after, 7)
  assert.equal(android.total_value, '2.50')
  assert.equal((await get('/damaged/702', 'android')).status, 'voided')
  assert.equal((await get('/damaged?q=000123', 'android')).length, 2)
  await run("INSERT INTO damaged_stock_reversals(id,damage_id,reason,actor_id) VALUES (703,701,'Future reversal',1);")
  assert.equal(await db.prepare('SELECT stock FROM products WHERE id=42').first('stock'), 9)
  await assert.rejects(run("INSERT INTO damaged_stock_reversals(id,damage_id,reason,actor_id) VALUES (704,701,'Duplicate reversal',1);"))
  assert.equal(await db.prepare('SELECT stock FROM products WHERE id=42').first('stock'), 9)
  assert.throws(() => buildDamageRestore([{ ...active, total_value: '2.49' }], products, 1, cutoff), /differs from total damage value/)
})
