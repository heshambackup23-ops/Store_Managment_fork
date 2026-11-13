import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, open, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { dateTime, day, id, integer, literal, minor, rowMap, text } from './laravel-finance-export.mjs'
import { readLegacyBackup } from './legacy-workbook.mjs'
import { buildDamageRestore, verifyDamageRestore } from './restore-laravel-damage.mjs'
import { supplierHistorySql, verifySupplierHistory } from './restore-laravel-suppliers.mjs'
import { walletRestore, walletRestoreTables, assertWalletRestore } from './restore-laravel-wallets.mjs'

const migrations = new URL('../migrations/', import.meta.url)
const snapshotFormat = 'hilal-laravel-snapshot-v1'
const catalogTables = ['categories', 'products', 'customers']
const debtTables = ['personal_debts', 'personal_debt_payments']
const salesTables = ['sales', 'sales_items', 'payments', 'debts']
const historyTables = ['invoices', 'installments']
const supplierTables = ['suppliers', 'purchases', 'supplier_payments']
const sameIdTables = [...catalogTables, ...debtTables, ...historyTables, 'maintenances']
const businessTables = new Set([...sameIdTables, 'damaged_items', ...supplierTables, ...walletRestoreTables])
const systemTables = new Set([
  'users', 'profiles', 'roles', 'permissions', 'model_has_permissions', 'model_has_roles', 'role_has_permissions',
  'migrations', 'sessions', 'password_reset_tokens', 'personal_access_tokens', 'cache', 'cache_locks',
  'failed_jobs', 'jobs', 'job_batches', 'api_idempotency_records', 'backup_logs',
])
const maxJsonBytes = 128 * 1024 * 1024
const localTimestamp = /^\d{4}-\d{2}-\d{2}[ T](?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?$/
const maintenanceStatuses = new Map([
  ['قيد الانتظار', 'received'], ['قيد الصيانة', 'in_progress'], ['مكتمل', 'completed'], ['مرفوض', 'cancelled'],
])

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function readSnapshot(path, pages) {
  if (!/\.json$/i.test(path)) return readLegacyBackup(path, { pages })
  if (pages?.length) throw new Error('--pages applies to ZIP files.')
  const file = await stat(path)
  if (!file.isFile() || file.size > maxJsonBytes) throw new Error('Snapshot JSON exceeds the input limit or is not a file.')
  const input = JSON.parse(await readFile(path, 'utf8'))
  if (!object(input) || input.format !== snapshotFormat || !object(input.tables) || typeof input.cutoff_at !== 'string') {
    throw new Error('Expected a hilal-laravel-snapshot-v1 JSON with cutoff_at and tables.')
  }
  return { ...input, source_kind: 'mysql-snapshot', pages: null }
}

function clock(sourceTimeZone) {
  const formatter = sourceTimeZone == null ? null : new Intl.DateTimeFormat('en', {
    timeZone: sourceTimeZone, timeZoneName: 'longOffset',
  })
  const offset = (millis) => formatter.formatToParts(millis).find((part) => part.type === 'timeZoneName').value.slice(3) || '+00:00'
  return (value) => {
    if (value == null) return null
    if (typeof value !== 'string') throw new Error('Expected timestamp text.')
    const normalized = value.replace(' ', 'T')
    if (!localTimestamp.test(value)) return dateTime(normalized)
    if (!formatter) throw new Error('A local timestamp requires --source-time-zone or an explicit ISO offset.')
    const naive = Date.parse(dateTime(normalized + 'Z'))
    const candidates = new Set([offset(naive - 86400000), offset(naive), offset(naive + 86400000)])
    const instants = [...candidates].map((zone) => dateTime(normalized + zone)).filter((iso) => (
      candidates.has(offset(Date.parse(iso))) && dateTime(normalized + offset(Date.parse(iso))) === iso
    ))
    if (instants.length !== 1) throw new Error('A local timestamp is ambiguous or invalid. Provide its explicit ISO offset.')
    return instants[0]
  }
}

function normalizeRows(rows, table, timestamp, cutoff) {
  return rows.map((row, index) => {
    try {
      const normalized = { ...row }
      for (const column of ['created_at', 'updated_at', ...(table === 'damaged_items' ? ['voided_at'] : [])]) {
        normalized[column] = timestamp(row[column])
        if (cutoff && normalized[column] && normalized[column] > cutoff) throw new Error('timestamp follows the snapshot cutoff')
      }
      if (normalized.created_at && normalized.updated_at && normalized.created_at > normalized.updated_at) {
        throw new Error('updated_at precedes created_at')
      }
      return normalized
    } catch (error) {
      throw new Error(`${table} row ${index + 1}: ${error.message}`)
    }
  })
}

function mapCustomers(invoices, customers, mapping) {
  const explicit = mapping === undefined ? {} : mapping
  if (!object(explicit)) throw new Error('invoice_customer_ids must be an object keyed by source invoice ID.')
  const known = rowMap(customers, 'customers')
  const invoiceIds = rowMap(invoices, 'invoices')
  for (const key of Object.keys(explicit)) if (!invoiceIds.has(id(key))) throw new Error('Customer mapping includes an unknown invoice ID.')
  const names = new Map()
  for (const [key, row] of known) {
    const name = text(row.name, 255, true).trim().normalize('NFC')
    const entries = names.get(name) ?? []
    entries.push(key)
    names.set(name, entries)
  }
  return Object.fromEntries([...invoiceIds].map(([key, row]) => {
    if (Object.hasOwn(explicit, key)) return [key, explicit[key]]
    const matches = names.get(text(row.customer, 255, true).trim().normalize('NFC')) ?? []
    if (matches.length === 1) return [key, matches[0]]
    if (matches.length === 0 && minor(row.paid_amount) === minor(row.total_amount)) return [key, null]
    throw new Error(`Invoice ID ${key} needs an explicit customer mapping.`)
  }))
}

function standaloneItems(row, products, principal) {
  const quantity = integer(row.quantity, 1, 1000000)
  const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items
  if (items == null) {
    if (principal % BigInt(quantity)) throw new Error('historic item price does not reconcile to the principal')
    return [{
      product_id: row.product_id == null ? null : id(row.product_id),
      name: text(row.product_name, 12000, true),
      quantity,
      unit_price_minor: Number(principal / BigInt(quantity)),
      line_total_minor: Number(principal),
    }]
  }
  if (!Array.isArray(items) || !items.length || items.length > 1000) throw new Error('invalid installment items')
  const result = items.map((item) => {
    const product = item.product_id == null ? null : id(item.product_id)
    if (product !== null && !products.has(product)) throw new Error('item product is absent from the cutoff snapshot')
    const units = integer(item.quantity, 1, 1000000)
    const price = minor(item.price)
    const total = price * BigInt(units)
    if (item.line_total != null && minor(item.line_total) !== total) throw new Error('item total differs from price times quantity')
    return {
      product_id: product, name: text(item.name, 12000, true),
      quantity: units, unit_price_minor: Number(price), line_total_minor: Number(total),
    }
  })
  if (result.reduce((sum, item) => sum + item.quantity, 0) !== quantity
    || result.reduce((sum, item) => sum + BigInt(item.line_total_minor), 0n) !== principal) {
    throw new Error('installment items do not match the principal or quantity')
  }
  return result
}

function standaloneSql(rows, source, actor) {
  const customers = rowMap(source.customers ?? [], 'customers')
  const products = rowMap(source.products ?? [], 'products')
  const commands = []
  let principalMinor = 0n
  let paidMinor = 0n
  let closedWithoutDueDate = 0
  let largest = 0
  for (const [key, row] of rowMap(rows, 'standalone installments')) {
    try {
      const candidates = row.customer_id == null ? [...customers].filter(([, customer]) => (
        text(customer.name, 255, true).trim().normalize('NFC') === text(row.customer, 255, true).trim().normalize('NFC')
      )) : [[id(row.customer_id)]]
      if (candidates.length !== 1 || !customers.has(candidates[0][0])) throw new Error('customer ID or unique source customer name is required')
      const principal = minor(row.product_price)
      const paid = minor(row.paid_amount)
      const due = minor(row.remaining)
      if (principal <= 0n || paid + due !== principal) throw new Error('stored balance does not reconcile')
      const status = row.status
      const closed = due === 0n
      if (!(closed ? ['مكتمل', 'paid'] : ['غير مكتمل', 'متأخر', 'open', 'pending']).includes(status)) {
        throw new Error('stored status differs from remaining balance')
      }
      const created = row.created_at
      const updated = row.updated_at
      if (!created || !updated) throw new Error('created_at and updated_at are required')
      if (row.product_id != null && !products.has(id(row.product_id))) throw new Error('product is absent from the cutoff snapshot')
      const paidDate = row.payment_date == null ? null : day(row.payment_date)
      const dueDate = row.next_payment_date == null && closed ? paidDate ?? created.slice(0, 10) : day(row.next_payment_date)
      if (row.next_payment_date == null && closed) closedWithoutDueDate++
      const record = {
        id: key, customer_id: candidates[0][0], invoice_id: null, principal_minor: principal, paid_minor: paid,
        historical_paid_minor: paid, due_date: dueDate, payment_date: paidDate, marked_overdue: Number(status === 'متأخر'),
        product_name: text(row.product_name, 12000, true), items_json: JSON.stringify(standaloneItems(row, products, principal)),
        note: text(row.notes, 12000), actor_id: actor, created_at: created, updated_at: updated,
      }
      commands.push(`INSERT INTO installments (${Object.keys(record).join(', ')}) VALUES (${Object.values(record).map(literal).join(', ')});`)
      largest = Math.max(largest, key)
      principalMinor += principal
      paidMinor += paid
    } catch (error) {
      throw new Error(`Standalone installment ID ${key}: ${error.message}`)
    }
  }
  const reservation = 'historical-standalone-installments'
  commands.push(`INSERT INTO business_operations(id,actor_id,request_key,operation,fingerprint)
    SELECT ${largest}, ${actor}, '${reservation}', 'import.reserve', '${reservation}'
    WHERE NOT EXISTS (SELECT 1 FROM business_operations WHERE id >= ${largest});`)
  return {
    sql: commands.join('\n'),
    checks: {
      installments: rows.length, principal_minor: String(principalMinor), historical_paid_minor: String(paidMinor),
      remaining_minor: String(principalMinor - paidMinor), closed_without_source_due_date: closedWithoutDueDate,
    },
  }
}

function maintenanceRecord(row, actor) {
  const key = id(row.id)
  const status = maintenanceStatuses.get(row.status)
  if (!status) throw new Error('unmapped maintenance status')
  const requested = day(row.requested_date)
  const completed = row.completed_date == null ? null : day(row.completed_date)
  if (completed && (completed < requested || status !== 'completed')) throw new Error('maintenance completion date conflicts with status or request date')
  if (!row.created_at || !row.updated_at) throw new Error('created_at and updated_at are required')
  const columns = ['id', 'name', 'owner', 'status', 'address', 'phone', 'description', 'notes', 'image_path', 'requested_date', 'completed_date', 'created_at', 'updated_at']
  if (Object.keys(row).some(column => !columns.includes(column) && row[column] != null)) {
    throw new Error('maintenance row has additional source data needing a destination mapping')
  }
  return {
    id: key, status, customer_name: text(row.owner, 255, true), phone: text(row.phone, 32),
    item: text(row.name, 255, true), problem: text(row.description, 12000), address: text(row.address, 255),
    notes: text(row.notes, 2000), requested_date: requested, completed_date: completed,
    actor_id: actor, created_at: row.created_at, updated_at: row.updated_at,
  }
}

function maintenanceSql(rows, actor) {
  const records = rowMap(rows, 'maintenances', row => maintenanceRecord(row, actor))
  const commands = [...records.values()].map(record => (
    `INSERT INTO maintenance_requests (${Object.keys(record).join(', ')}) VALUES (${Object.values(record).map(literal).join(', ')});`
  ))
  const reservation = 'historical-maintenance'
  const largest = [...records.keys()].reduce((max, key) => Math.max(max, key), 0)
  commands.push(`INSERT INTO business_operations(id,actor_id,request_key,operation,fingerprint)
    SELECT ${largest}, ${actor}, '${reservation}', 'import.reserve', '${reservation}'
    WHERE NOT EXISTS (SELECT 1 FROM business_operations WHERE id >= ${largest});`)
  return {
    sql: commands.join('\n'),
    checks: {
      requests: records.size,
      attachments_requiring_separate_import: rows.filter(row => row.image_path).length,
      source_has_financial_ledger: false,
    },
  }
}

async function importedSql(temp, tool, payload, actor) {
  const input = join(temp, tool + '.json')
  const output = join(temp, tool + '.generated.sql')
  await writeFile(input, JSON.stringify(payload), { flag: 'wx', mode: 0o600 })
  const script = fileURLToPath(new URL(`./import-laravel-${tool}.mjs`, import.meta.url))
  const result = spawnSync(process.execPath, [script, input, '--actor-id', String(actor), '--emit-sql', output], {
    encoding: 'utf8', maxBuffer: 256 * 1024, windowsHide: true,
  })
  if (result.status !== 0) {
    const lines = result.stderr?.trim().split(/\r?\n/) ?? []
    throw new Error(lines.find((line) => line.includes('import failed:')) ?? `The ${tool} importer failed.`)
  }
  return { sql: await readFile(output, 'utf8'), checks: JSON.parse(result.stdout) }
}

async function initialize(db) {
  const names = (await readdir(migrations)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of names) db.exec(await readFile(new URL(file, migrations), 'utf8'))
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*'").all()
  return tables.map(({ name }) => name)
}

function protectTarget(tables, actor) {
  const builtIn = new Set(['settings', 'roles', 'role_permissions', 'users'])
  const occupied = tables.filter((table) => !builtIn.has(table)).map((table) => `EXISTS (SELECT 1 FROM "${table}")`)
  const invalid = [
    ...occupied,
    '(SELECT count(*) FROM users) <> 1',
    `NOT EXISTS (SELECT 1 FROM users WHERE id = ${actor} AND active = 1 AND role_id = 1)`,
  ]
  return `CREATE TABLE hilal_restore_guard (empty_target INTEGER NOT NULL CHECK (empty_target = 1));
INSERT INTO hilal_restore_guard VALUES (CASE WHEN ${invalid.join('\n  OR ')} THEN 0 ELSE 1 END);
DROP TABLE hilal_restore_guard;`
}

function verifyCounts(db, source, actor, checks) {
  const target = {}
  for (const table of sameIdTables) {
    const expected = rowMap(source[table] ?? [], table)
    const destination = table === 'maintenances' ? 'maintenance_requests' : table
    const actual = db.prepare(`SELECT id FROM ${destination}`).all()
    if (expected.size !== actual.length || actual.some(({ id: key }) => !expected.has(key))) {
      throw new Error(`Row IDs did not reconcile for ${table}.`)
    }
    target[table] = actual.length
  }
  verifyDamageRestore(db, source.damaged_items ?? [])
  target.damaged_items = source.damaged_items?.length ?? 0
  if (checks.suppliers) Object.assign(target, verifySupplierHistory(db, source, actor))
  if (checks.wallets) {
    assertWalletRestore(db, checks.wallets)
    Object.assign(target, checks.wallets.source_counts)
  }
  const products = rowMap(source.products ?? [], 'products')
  for (const row of db.prepare('SELECT id, stock, price_minor FROM products').all()) {
    const expected = products.get(row.id)
    if (row.stock !== Number(expected.stock) || BigInt(row.price_minor) !== minor(expected.price)) {
      throw new Error('Stock or price did not reconcile per product.')
    }
  }
  const installments = rowMap(source.installments ?? [], 'installments')
  for (const row of db.prepare('SELECT id, principal_minor, paid_minor FROM installments').all()) {
    const expected = installments.get(row.id)
    if (BigInt(row.principal_minor) !== minor(expected.product_price) || BigInt(row.paid_minor) !== minor(expected.paid_amount)) {
      throw new Error('An installment balance did not reconcile.')
    }
  }
  const maintenance = rowMap(source.maintenances ?? [], 'maintenances')
  for (const row of db.prepare('SELECT id, status, requested_date, completed_date, price_minor, paid_minor FROM maintenance_requests').all()) {
    const expected = maintenance.get(row.id)
    if (row.status !== maintenanceStatuses.get(expected.status) || row.requested_date !== expected.requested_date
      || row.completed_date !== (expected.completed_date ?? null) || row.price_minor || row.paid_minor) {
      throw new Error('A maintenance status or date did not reconcile.')
    }
  }
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign keys did not reconcile.')
  return target
}

async function applyIsolated(db, sql, actor, source, checks) {
  db.exec('PRAGMA foreign_keys = ON')
  await initialize(db)
  db.prepare("INSERT INTO users (id,name,email,password_hash,role_id) VALUES (?, 'Local restore operator', 'restore@example.invalid', 'unusable', 1)").run(actor)
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(sql)
    const counts = verifyCounts(db, source, actor, checks)
    db.exec('COMMIT')
    return counts
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function requireInvoiceTables(tables) {
  for (const name of ['customers', 'products', 'installments', ...salesTables]) {
    if (!Object.hasOwn(tables, name)) throw new Error(`Invoice history requires the ${name} sheet, even when empty.`)
  }
}

function collectTables(input) {
  const sourceCounts = {}
  const excludedSystem = {}
  const blocked = {}
  for (const [table, rows] of Object.entries(input.tables)) {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(table) || !Array.isArray(rows) || !rows.every(object)) {
      throw new Error('Invalid source table or row collection.')
    }
    sourceCounts[table] = rows.length
    const emptySettings = table === 'settings' && rows.every((row) => (
      Object.keys(row).every((column) => ['id', 'created_at', 'updated_at'].includes(column))
    ))
    if (systemTables.has(table) || emptySettings) excludedSystem[table] = rows.length
    else if (!businessTables.has(table) && rows.length) blocked[table] = rows.length
  }
  if (input.excluded_table_counts !== undefined && !object(input.excluded_table_counts)) {
    throw new Error('excluded_table_counts must be an object.')
  }
  for (const [table, count] of Object.entries(input.excluded_table_counts ?? {})) {
    if (!systemTables.has(table) || !Number.isSafeInteger(count) || count < 0 || Object.hasOwn(sourceCounts, table)) {
      throw new Error('Invalid or duplicated excluded system table count.')
    }
    excludedSystem[table] = count
  }
  if (input.source_kind === 'report-workbook' || input.source_kind === 'report-zip') {
    blocked[input.source_kind.replace('-', '_')] = Object.values(sourceCounts).reduce((sum, count) => sum + count, 0)
  }
  return { sourceCounts, excludedSystem, blocked }
}

async function readSources(paths, options) {
  const input = await readSnapshot(paths[0], options.pages)
  if (paths.length === 1) return input
  if (options.pages?.length || input.source_kind !== 'workbook') {
    throw new Error('--add-workbook combines direct XLSX table workbooks from one cutoff.')
  }
  const tables = { ...input.tables }
  for (const path of paths.slice(1)) {
    const next = await readSnapshot(path)
    if (next.source_kind !== 'workbook') throw new Error('Additional inputs must be direct XLSX table workbooks.')
    for (const [table, rows] of Object.entries(next.tables)) {
      if (Object.hasOwn(tables, table)) throw new Error(`More than one workbook supplies the ${table} table.`)
      tables[table] = rows
    }
  }
  return { ...input, tables }
}

async function copyToNewSqlite(path, sql, actor, source, checks) {
  const reservation = await open(path, 'wx', 0o600)
  await reservation.close()
  let output
  try {
    output = new DatabaseSync(path)
    await applyIsolated(output, sql, actor, source, checks)
    output.close()
  } catch (error) {
    if (output?.isOpen) output.close()
    await unlink(path)
    throw error
  }
}

export async function restoreLaravelBackup(path, options = {}) {
  const actor = id(options.actorId ?? 1)
  if (options.output && options.emitD1Sql) throw new Error('Choose one output format per run.')
  if (options.output && !options.output.endsWith('.sqlite')) throw new Error('--output must end with .sqlite.')
  if (options.emitD1Sql && !options.emitD1Sql.endsWith('.generated.sql')) throw new Error('--emit-d1-sql must end with .generated.sql.')
  const paths = [path, ...(options.addWorkbooks ?? [])]
  const input = await readSources(paths, options)
  const { sourceCounts, excludedSystem, blocked } = collectTables(input)
  const manifest = {
    status: Object.keys(blocked).length ? 'blocked' : 'verified',
    source_kind: input.source_kind,
    source_sha256: await Promise.all(paths.map(digest)),
    source_pages: input.pages,
    source_counts: sourceCounts,
    excluded_system_counts: excludedSystem,
    blocked_counts: blocked,
  }
  if (manifest.status === 'blocked') return manifest

  const cutoffValue = options.cutoffAt ?? input.cutoff_at ?? input.created_at
  const cutoff = cutoffValue == null ? null : dateTime(cutoffValue)
  const timestamp = clock(options.sourceTimeZone ?? input.source_time_zone)
  const source = Object.fromEntries(Object.entries(input.tables).filter(([table]) => businessTables.has(table)).map(
    ([table, rows]) => [table, normalizeRows(rows, table, timestamp, cutoff)],
  ))
  const invoices = source.invoices ?? []
  const standalone = (source.installments ?? []).filter((row) => row.invoice_id == null)
  const linked = (source.installments ?? []).filter((row) => row.invoice_id != null)
  if (invoices.length) {
    if (!cutoff) throw new Error('Invoice history requires the backup cutoff timestamp with an explicit offset.')
    requireInvoiceTables(input.tables)
  } else if (linked.length) throw new Error('Linked installments require their source invoices.')
  const hasWalletData = walletRestoreTables.some(table => source[table]?.length)
  if ((hasWalletData || source.damaged_items?.length) && !cutoff) {
    throw new Error('Wallet and damage history require the backup cutoff timestamp with an explicit offset.')
  }
  if (source.personal_debt_payments?.length && !source.personal_debts?.length) throw new Error('Debt payments require the original debts.')
  if (!Object.values(source).some((rows) => rows.length)) throw new Error('The selected source has no restorable business rows.')

  const temp = await mkdtemp(join(tmpdir(), 'hilal-legacy-restore-'))
  const db = new DatabaseSync(':memory:')
  try {
    const destinationTables = await initialize(db)
    db.close()
    const checks = {}
    const parts = [protectTarget(destinationTables, actor)]
    const include = async (tool, payload) => {
      const result = await importedSql(temp, tool, payload, actor)
      parts.push(result.sql)
      checks[tool] = result.checks
    }
    if (catalogTables.some((name) => source[name]?.length)) await include('catalog', {
      format: 'henra-mysql-catalog-v1', tables: Object.fromEntries(catalogTables.map((name) => [name, source[name] ?? []])),
    })
    if (invoices.length) await include('invoices', {
      format: 'hilal-mysql-finance-v1', cutoff_at: cutoff,
      invoice_refund_evidence: options.invoiceRefundEvidence ?? input.invoice_refund_evidence,
      invoice_customer_ids: mapCustomers(invoices, source.customers, options.invoiceCustomerIds ?? input.invoice_customer_ids),
      tables: Object.fromEntries(['products', 'customers', ...historyTables, ...salesTables].map(
        (name) => [name, name === 'installments' ? linked : source[name] ?? []],
      )),
    })
    if (standalone.length) {
      const result = standaloneSql(standalone, source, actor)
      parts.push(result.sql)
      checks.standalone_installments = result.checks
    }
    if (source.personal_debts?.length) await include('personal-debts', {
      format: 'hilal-mysql-personal-debts-v1', tables: Object.fromEntries(debtTables.map((name) => [name, source[name] ?? []])),
    })
    if (source.maintenances?.length) {
      const result = maintenanceSql(source.maintenances, actor)
      parts.push(result.sql)
      checks.maintenance = result.checks
    }
    if (supplierTables.some(table => source[table]?.length)) {
      const plan = supplierHistorySql(source, actor)
      parts.push(plan.sql)
      checks.suppliers = plan.checks
    }
    if (hasWalletData) {
      const plan = walletRestore(source, { actor, cutoff, timestamp })
      parts.push(plan.sql)
      checks.wallets = plan.checks
    }
    if (source.damaged_items?.length) {
      const plan = buildDamageRestore(source.damaged_items, source.products ?? [], actor, cutoff)
      parts.push(plan.sql)
      checks.damage = plan.checks
    }
    const sql = parts.join('\n\n') + '\n'
    const verification = new DatabaseSync(':memory:')
    let counts
    try {
      counts = await applyIsolated(verification, sql, actor, source, checks)
    } finally {
      verification.close()
    }
    if (options.output) await copyToNewSqlite(resolve(options.output), sql, actor, source, checks)
    if (options.emitD1Sql) await writeFile(options.emitD1Sql, sql, { flag: 'wx', mode: 0o600 })
    return { ...manifest, cutoff_at: cutoff, restored_counts: counts, checks, dated_invoice_payments_inferred: 0 }
  } finally {
    if (db.isOpen) db.close()
    await rm(temp, { recursive: true, force: true })
  }
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'source-time-zone': { type: 'string' },
      'cutoff-at': { type: 'string' },
      'invoice-customer-map': { type: 'string' },
      'invoice-refund-evidence': { type: 'string' },
      'add-workbook': { type: 'string', multiple: true },
      'actor-id': { type: 'string' },
      'pages': { type: 'string' },
      'output': { type: 'string' },
      'emit-d1-sql': { type: 'string' },
    },
  })
  if (positionals.length !== 1) throw new Error('Usage: node scripts/restore-laravel-backup.mjs FILE [--source-time-zone ZONE] [--cutoff-at ISO] [--output NEW.sqlite | --emit-d1-sql NEW.generated.sql]')
  const result = await restoreLaravelBackup(positionals[0], {
    sourceTimeZone: values['source-time-zone'],
    cutoffAt: values['cutoff-at'],
    invoiceCustomerIds: values['invoice-customer-map'] ? JSON.parse(await readFile(values['invoice-customer-map'], 'utf8')) : undefined,
    invoiceRefundEvidence: values['invoice-refund-evidence'] ? JSON.parse(await readFile(values['invoice-refund-evidence'], 'utf8')) : undefined,
    addWorkbooks: values['add-workbook'],
    actorId: values['actor-id'],
    pages: values.pages?.split(','),
    output: values.output,
    emitD1Sql: values['emit-d1-sql'],
  })
  console.log(JSON.stringify(result, null, 2))
  if (result.status === 'blocked') process.exitCode = 2
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch((error) => {
    console.error(`Legacy restore failed: ${error.message}`)
    process.exitCode = 1
  })
}
