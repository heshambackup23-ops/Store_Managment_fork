import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { dateTime } from './laravel-finance-export.mjs'

const transferable = new Set([
  'categories', 'products', 'customers', 'invoices', 'installments', 'sales', 'sales_items', 'payments',
  'debts', 'personal_debts', 'personal_debt_payments', 'suppliers', 'purchases', 'supplier_payments',
  'wallets', 'wallet_transactions', 'wallet_cash_adjustments', 'wallet_expenses', 'wallet_audit_logs',
  'maintenances', 'damaged_items', 'settings', 'app_notifications', 'notification_reads', 'profiles', 'cashiers',
  'roles', 'permissions', 'model_has_permissions', 'model_has_roles', 'role_has_permissions',
])
const privateSystem = new Set([
  'users', 'password_reset_tokens', 'personal_access_tokens', 'sessions', 'jobs', 'job_batches', 'failed_jobs',
  'cache', 'cache_locks', 'migrations', 'api_idempotency_records', 'backup_logs',
])
const root = fileURLToPath(new URL('../../../', import.meta.url))
const safeName = /^[a-zA-Z0-9_]{1,64}$/
const ident = name => {
  if (!safeName.test(name)) throw new Error('Unexpected identifier in the restored schema.')
  return '`' + name + '`'
}
const qname = name => { ident(name); return "'" + name + "'" }
const maxOutput = 64 * 1024 * 1024

function query(args, exe, sql, phase) {
  const run = spawnSync(exe, [...args, '--execute', sql], {
    encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], maxBuffer: maxOutput, timeout: 180_000, windowsHide: true,
  })
  if (run.error || run.status !== 0) {
    const reason = run.error?.code || ('client exit ' + run.status)
    throw new Error(`MySQL ${phase} failed (${reason}). Check the local client, copy schema, and authentication.`)
  }
  try {
    return run.stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  } catch {
    throw new Error(`Unexpected JSON output during MySQL ${phase}.`)
  }
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: false,
    options: {
      client: { type: 'string', default: 'mysql' },
      port: { type: 'string' },
      schema: { type: 'string' },
      user: { type: 'string' },
      'ask-password': { type: 'boolean' },
      'cutoff-at': { type: 'string' },
      'source-time-zone': { type: 'string' },
      output: { type: 'string' },
    },
  })
  if (positionals.length || !/^hilal_migration_[a-z0-9_]{1,48}$/.test(values.schema ?? '')
      || !/^\d{1,5}$/.test(values.port ?? '') || Number(values.port) < 1024 || Number(values.port) > 65535
      || !/^[a-zA-Z0-9_.-]{1,80}$/.test(values.user ?? '') || !values.output?.endsWith('.private.json')
      || !values['source-time-zone']) {
    throw new Error('Use --schema hilal_migration_NAME --port PORT --user USER --cutoff-at ISO --source-time-zone IANA --output PATH.private.json; optionally --client PATH and --ask-password.')
  }
  const cutoff = dateTime(values['cutoff-at'])
  new Intl.DateTimeFormat('en', { timeZone: values['source-time-zone'] })
  const output = resolve(await realpath(dirname(resolve(values.output))), resolve(values.output).split(sep).at(-1))
  const inside = relative(await realpath(root), output)
  if (!inside || (!isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep))) {
    throw new Error('Place the private snapshot outside the Git checkout.')
  }
  const args = [
    '--no-defaults', '--batch', '--raw', '--skip-column-names', '--skip-reconnect', '--local-infile=0',
    '--default-character-set=utf8mb4', '--protocol=TCP', '--host=127.0.0.1', '--port=' + values.port,
    '--user=' + values.user, '--database=' + values.schema, ...(values['ask-password'] ? ['--password'] : []),
  ]
  const schema = qname(values.schema)
  const metadataSql = `
    SELECT JSON_OBJECT('table', c.TABLE_NAME, 'column', c.COLUMN_NAME, 'type', LOWER(c.DATA_TYPE), 'engine', t.ENGINE)
    FROM INFORMATION_SCHEMA.COLUMNS c
    JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
    WHERE c.TABLE_SCHEMA=${schema} AND t.TABLE_TYPE='BASE TABLE'
    ORDER BY c.TABLE_NAME,c.ORDINAL_POSITION;`
  const fields = new Map()
  for (const item of query(args, values.client, metadataSql, 'schema inspection')) {
    ident(item.table)
    ident(item.column)
    if (!fields.has(item.table)) fields.set(item.table, [])
    fields.get(item.table).push(item)
  }
  if (!['categories', 'products', 'customers', 'invoices'].every(table => fields.has(table))) {
    throw new Error('The isolated MySQL schema does not contain the core Laravel application tables.')
  }
  const commands = ["SET time_zone='+00:00'", 'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
    'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY']
  const tables = Object.create(null)
  const excludedCounts = Object.create(null)
  const unknown = Object.create(null)
  for (const [table, columns] of fields) {
    if (privateSystem.has(table) || !transferable.has(table)) {
      commands.push(`SELECT JSON_OBJECT('kind','count','table',${qname(table)},'count',COUNT(*)) FROM ${ident(table)}`)
      continue
    }
    if (columns[0].engine !== 'InnoDB') throw new Error(`Table ${table} is not transactional; re-export from a verified frozen copy.`)
    if (columns.some(({ type }) => /^(binary|varbinary|(?:tiny|medium|long)?blob|geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection|vector)$/i.test(type))) {
      throw new Error(`Table ${table} needs an explicit binary-column mapping before export.`)
    }
    tables[table] = []
    const pairs = columns.flatMap(({ column, type }) => {
      const key = ident(column)
      const cast = `CAST(${key} AS CHAR CHARACTER SET utf8mb4)`
      const value = type === 'timestamp' ? `CONCAT(REPLACE(${cast},' ','T'),'Z')` : cast
      return [qname(column), value]
    })
    commands.push(`SELECT JSON_OBJECT('kind','row','table',${qname(table)},'data',JSON_OBJECT(${pairs.join(',')})) FROM ${ident(table)}`)
  }
  commands.push('COMMIT')
  for (const record of query(args, values.client, commands.join(';\n') + ';', 'snapshot export')) {
    const { kind, table } = record
    if (!fields.has(table)) throw new Error('The snapshot returned an unknown table.')
    if (kind === 'count' && !Object.hasOwn(tables, table) && Number.isSafeInteger(record.count) && record.count >= 0) {
      if (privateSystem.has(table)) excludedCounts[table] = record.count
      else if (record.count) unknown[table] = record.count
    } else if (kind === 'row' && Object.hasOwn(tables, table)) {
      const row = typeof record.data === 'string' ? JSON.parse(record.data) : record.data
      if (!row || typeof row !== 'object' || Array.isArray(row)
          || Object.keys(row).length !== fields.get(table).length
          || fields.get(table).some(({ column }) => !Object.hasOwn(row, column)
            || (row[column] !== null && typeof row[column] !== 'string'))) {
        throw new Error(`The exported column values for ${table} are incomplete or not exact text.`)
      }
      tables[table].push(row)
    } else {
      throw new Error('Unexpected output in the source snapshot.')
    }
  }
  if (Object.keys(unknown).length) {
    throw new Error('Unmapped populated source tables: ' + Object.entries(unknown).map(([table, count]) => `${table} (${count})`).join(', '))
  }
  const contents = JSON.stringify({
    format: 'hilal-laravel-snapshot-v1', cutoff_at: cutoff, source_time_zone: values['source-time-zone'],
    tables, excluded_table_counts: excludedCounts,
  }) + '\n'
  await writeFile(output, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({
    mode: 'private_snapshot_created', cutoff_at: cutoff,
    table_counts: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])),
    excluded_table_counts: excludedCounts, sha256: createHash('sha256').update(contents).digest('hex'),
  }, null, 2))
} catch (error) {
  console.error('MySQL snapshot export stopped: ' + error.message)
  process.exitCode = 1
}
