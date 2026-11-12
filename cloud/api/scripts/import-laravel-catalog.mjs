import { parseArgs } from 'node:util'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'

const supported = ['categories', 'products', 'customers']
const migrations = new URL('../migrations/', import.meta.url)
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'mysql-utc': { type: 'boolean' },
    'actor-id': { type: 'string', default: '1' },
    'emit-sql': { type: 'string' },
  },
})

function integer(value, max = Number.MAX_SAFE_INTEGER, min = 0) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error('invalid integer')
  return number
}

function text(value, required = false) {
  if ((value === null || value === undefined) && !required) return null
  if (typeof value !== 'string' || value.includes('\0') || (required && !value.trim())) throw new Error('invalid text field')
  return value
}

function timestamp(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(value)) {
    throw new Error('invalid timestamp')
  }
  const hasOffset = /Z$|[+-]\d\d:\d\d$/.test(value)
  if (!hasOffset && !values['mysql-utc']) throw new Error('timestamp without time zone; use --mysql-utc only for a verified UTC export')
  const date = new Date(value.replace(' ', 'T') + (hasOffset ? '' : 'Z'))
  if (Number.isNaN(date.getTime())) throw new Error('invalid timestamp')
  return date.toISOString()
}

function money(value) {
  const match = typeof value === 'string' && /^(\d+)(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) throw new Error('DECIMAL values must be exported as strings with at most two decimal places')
  const amount = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  if (amount > 100000000000n) throw new Error('price exceeds the D1 catalog range')
  return Number(amount)
}

function parse(source) {
  const content = source.trim()
  if (content.startsWith('{')) {
    let json
    try { json = JSON.parse(content) } catch { /* May be NDJSON */ }
    if (json?.format === 'henra-mysql-catalog-v1') return json.tables
  }
  const [first, ...rest] = content.split(/\r?\n/).filter(line => line.trim())
  const header = JSON.parse(first ?? 'null')
  if (header?.format !== 'store-management-backup-ndjson' || header.version !== 1) throw new Error('unsupported export format')
  const tables = Object.create(null)
  for (const line of rest) {
    const { table, row } = JSON.parse(line)
    if (typeof table !== 'string' || typeof row !== 'object' || row === null || Array.isArray(row)) throw new Error('invalid NDJSON row')
    const rows = tables[table] ??= []
    rows.push(row)
  }
  return tables
}

function sql(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${value.replaceAll("'", "''")}'`
}

function upsert(table, row) {
  const fields = Object.keys(row)
  const mutable = fields.filter(field => !['id', 'stock', 'created_at', 'updated_at'].includes(field))
  const same = mutable.map(field => `${table}.${field} IS excluded.${field}`).join(' AND ')
  return `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${Object.values(row).map(sql).join(', ')}) ON CONFLICT(id) DO UPDATE SET id = CASE WHEN ${same} THEN ${table}.id ELSE NULL END;`
}

try {
  if (positionals.length !== 1) throw new Error('usage: node scripts/import-laravel-catalog.mjs EXPORT [--mysql-utc] [--actor-id 1] [--emit-sql PATH.generated.sql]')
  const output = values['emit-sql']
  if (output && !output.endsWith('.generated.sql')) throw new Error('SQL output must end in .generated.sql')
  const actor = integer(values['actor-id'], Number.MAX_SAFE_INTEGER, 1)
  const tables = parse(await readFile(positionals[0], 'utf8'))
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) throw new Error('invalid table collection')
  for (const [table, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) throw new Error('invalid table collection')
    if (!supported.includes(table) && rows.length) throw new Error('export contains populated tables outside catalog/customers; export those separately')
  }
  const db = new DatabaseSync(':memory:')
  const files = (await readdir(migrations)).filter(file => file.endsWith('.sql')).sort()
  for (const file of files) db.exec(await readFile(new URL(file, migrations), 'utf8'))
  db.prepare("INSERT INTO users(id, name, email, password_hash, role_id) VALUES (?, 'Import fixture', 'import@example.invalid', 'unused', 1)").run(actor)
  const commands = []
  const stats = { categories: 0, products: 0, customers: 0, stock_units: '0', catalog_price_minor_sum: '0', image_paths_requiring_separate_import: 0, legacy_units_sold_excluded: '0' }
  const productColumns = new Set(db.prepare('PRAGMA table_info(products)').all().map(column => column.name))
  const customerColumns = new Set(db.prepare('PRAGMA table_info(customers)').all().map(column => column.name))
  for (const table of supported) {
    const seen = new Set()
    for (const [index, original] of (tables[table] ?? []).entries()) {
      try {
        const id = integer(original.id, Number.MAX_SAFE_INTEGER, 1)
        if (seen.has(id)) throw new Error('duplicate source ID')
        seen.add(id)
        const row = { id, name: text(original.name, true) }
        for (const field of ['created_at', 'updated_at']) {
          const value = timestamp(original[field])
          if (value !== null) row[field] = value
        }
        if (table === 'customers') {
          row.phone = text(original.phone)
          if (customerColumns.has('address')) row.address = text(original.address)
          else if (original.address) throw new Error('customer address requires the address migration')
        }
        if (table === 'products') {
          row.description = text(original.description)
          if (productColumns.has('notes')) row.notes = text(original.notes)
          else if (original.notes) throw new Error('product notes require the notes migration')
          row.category_id = original.category_id == null ? null : integer(original.category_id, Number.MAX_SAFE_INTEGER, 1)
          row.barcode = text(original.barcode)
          row.price_minor = money(original.price)
          row.stock = 0
        }
        commands.push(upsert(table, row))
        if (table === 'products') {
          const stock = integer(original.stock, 1000000000)
          if (stock > 0) {
            commands.push(`INSERT INTO inventory_movements(product_id, delta, source_type, source_id, actor_id, note) SELECT ${id}, ${stock}, 'import', ${id}, ${actor}, 'MySQL opening stock' WHERE NOT EXISTS (SELECT 1 FROM inventory_movements WHERE source_type = 'import' AND source_id = ${id} AND product_id = ${id} AND delta = ${stock});`)
          }
          stats.stock_units = String(BigInt(stats.stock_units) + BigInt(stock))
          stats.catalog_price_minor_sum = String(BigInt(stats.catalog_price_minor_sum) + BigInt(row.price_minor))
          stats.legacy_units_sold_excluded = String(BigInt(stats.legacy_units_sold_excluded) + BigInt(integer(original.total_sold ?? 0)))
          if (original.image) stats.image_paths_requiring_separate_import++
        }
        stats[table]++
      } catch (error) {
        throw new Error(`${table} row ${index + 1}: ${error.message}`)
      }
    }
  }
  if (!commands.length) throw new Error('export contains no catalog or customer rows')
  const batch = commands.join('\n') + '\n'
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(batch)
    db.exec(batch)
    const check = db.prepare('SELECT CAST(COALESCE(sum(stock), 0) AS TEXT) AS stock_units, CAST(COALESCE(sum(price_minor), 0) AS TEXT) AS catalog_price_minor_sum FROM products').get()
    if (check.stock_units !== stats.stock_units || check.catalog_price_minor_sum !== stats.catalog_price_minor_sum || db.prepare('PRAGMA foreign_key_check').all().length) {
      throw new Error('source and target totals or foreign keys did not reconcile after replay')
    }
    for (const table of supported) {
      if (db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count !== stats[table]) throw new Error('row count did not reconcile')
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.close()
  }
  if (output) await writeFile(output, batch, { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ mode: output ? 'sql-generated' : 'dry-run', verified_idempotent_replay: true, ...stats }, null, 2))
} catch (error) {
  console.error(`Catalog import failed: ${error.message}`)
  process.exitCode = 1
}
