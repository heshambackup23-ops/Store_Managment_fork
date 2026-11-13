import { readFile, readdir, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { parseArgs } from 'node:util'

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { 'actor-id': { type: 'string', default: '1' }, 'emit-sql': { type: 'string' } },
})
const migrations = new URL('../migrations/', import.meta.url)
const tables = ['personal_debts', 'personal_debt_payments']
const maxMoney = 900000000000000n

function identifier(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) >= Number.MAX_SAFE_INTEGER) {
    throw new Error('invalid identifier')
  }
  return Number(value)
}

function money(value) {
  const match = typeof value === 'string' && /^(\d+)(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) throw new Error('DECIMAL must be a string with at most two fractional digits')
  const minor = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'))
  if (minor > maxMoney) throw new Error('amount exceeds the destination range')
  return Number(minor)
}

function date(value, optional = false) {
  if (value == null && optional) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('invalid date')
  const parsed = new Date(value + 'T00:00:00Z')
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) throw new Error('invalid calendar date')
  return value
}

function dateTime(value, fallback) {
  if (value == null) return fallback
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new Error('timestamp requires an explicit time zone')
  }
  date(value.slice(0, 10))
  const parsed = new Date(value)
  if (!Number.isFinite(+parsed)) throw new Error('invalid timestamp')
  return parsed.toISOString()
}

function text(value, max, required = false) {
  if (value == null && !required) return ''
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (required && !value.trim())) throw new Error('invalid text field')
  return value
}

function literal(value) {
  if (value === null) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${value.replaceAll("'", "''")}'`
}

function insert(table, data, { payment = false } = {}) {
  const columns = Object.keys(data)
  const identical = columns.filter(column => column !== 'id').map(column => `${table}.${column} IS ${literal(data[column])}`).join(' AND ')
  if (payment) {
    // Suppress an identical insert before its AFTER trigger, preserving the settled balance.
    return `INSERT INTO ${table} (${columns.join(', ')}) SELECT ${Object.values(data).map(literal).join(', ')} WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${table}.id = ${data.id} AND ${identical});`
  }
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${Object.values(data).map(literal).join(', ')}) ON CONFLICT(id) DO UPDATE SET id = CASE WHEN ${identical} THEN ${table}.id ELSE NULL END;`
}

function fromRows(rows, table, convert) {
  const byId = new Map()
  for (const [index, row] of rows.entries()) {
    try {
      const id = identifier(row.id)
      if (byId.has(id)) throw new Error('duplicate source ID')
      byId.set(id, convert(row, id))
    } catch (error) {
      throw new Error(`${table} row ${index + 1}: ${error.message}`)
    }
  }
  return byId
}

try {
  if (positionals.length !== 1) throw new Error('usage: node scripts/import-laravel-personal-debts.mjs EXPORT [--actor-id 1] [--emit-sql PATH.generated.sql]')
  const actor = identifier(values['actor-id'])
  const output = values['emit-sql']
  if (output && !output.endsWith('.generated.sql')) throw new Error('SQL output must end in .generated.sql')
  const input = JSON.parse(await readFile(positionals[0], 'utf8'))
  if (input?.format !== 'hilal-mysql-personal-debts-v1' || !input.tables || Object.keys(input.tables).length !== tables.length
    || tables.some(table => !Array.isArray(input.tables[table]))) throw new Error('unsupported export format or table collection')

  const debts = fromRows(input.tables.personal_debts, tables[0], (row, id) => {
    const principal = money(row.total_amount)
    const paid = money(row.paid_amount)
    const remaining = money(row.remaining)
    if (principal <= 0 || paid + remaining !== principal || row.status !== (remaining === 0 ? 'paid' : 'open')) {
      throw new Error('stored balance or status does not reconcile')
    }
    const created = dateTime(row.created_at, null)
    if (!created) throw new Error('created_at is required')
    return { expectedPaid: paid, sourceActor: row.created_by == null ? null : identifier(row.created_by), row: {
      id, person_name: text(row.creditor, 255, true), direction: 'payable', principal_minor: principal,
      due_date: date(row.due_date, true), description: text(row.description, 255), note: text(row.notes, 2000),
      actor_id: actor, created_at: created,
    } }
  })
  const payments = fromRows(input.tables.personal_debt_payments, tables[1], (row, id) => {
    const debt = identifier(row.personal_debt_id)
    const amount = money(row.amount)
    if (!debts.has(debt) || amount <= 0) throw new Error('invalid amount or missing related debt')
    const day = date(row.paid_on)
    return { sourceActor: row.created_by == null ? null : identifier(row.created_by), row: {
      id, debt_id: debt, amount_minor: amount, note: text(row.notes, 500), actor_id: actor,
      created_at: dateTime(row.created_at, `${day}T00:00:00.000Z`),
    } }
  })
  if (!debts.size) throw new Error('no personal debts to import')
  const byDebt = new Map()
  for (const { row } of payments.values()) byDebt.set(row.debt_id, (byDebt.get(row.debt_id) ?? 0n) + BigInt(row.amount_minor))
  for (const [id, { expectedPaid }] of debts) {
    if ((byDebt.get(id) ?? 0n) !== BigInt(expectedPaid)) throw new Error(`payment history does not reconcile for debt ID ${id}`)
  }

  let largest = 0
  for (const id of debts.keys()) largest = Math.max(largest, id)
  for (const id of payments.keys()) largest = Math.max(largest, id)
  const journalKey = `import-personal-debts-${largest}`
  const reserve = `INSERT INTO business_operations(id,actor_id,request_key,operation,fingerprint) SELECT ${largest},${actor},'${journalKey}','import.reserve','${journalKey}' WHERE NOT EXISTS (SELECT 1 FROM business_operations WHERE id >= ${largest});`
  const commands = [
    ...Array.from(debts.values(), ({ row }) => insert(tables[0], row)),
    ...Array.from(payments.values(), ({ row }) => insert(tables[1], row, { payment: true })),
    reserve,
  ]
  const sql = commands.join('\n') + '\n'
  const db = new DatabaseSync(':memory:')
  try {
    for (const name of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
      db.exec(await readFile(new URL(name, migrations), 'utf8'))
    }
    db.prepare("INSERT INTO users (id,name,email,password_hash,role_id) VALUES (?,'Import operator','debt-import@example.invalid','unused',1)").run(actor)
    for (let attempt = 0; attempt < 2; attempt++) {
      db.exec('BEGIN IMMEDIATE')
      db.exec(sql)
      const imported = db.prepare('SELECT id, paid_minor, principal_minor FROM personal_debts').all()
      if (imported.length !== debts.size || db.prepare('SELECT count(*) AS total FROM personal_debt_payments').get().total !== payments.size
        || imported.some(row => row.paid_minor !== debts.get(row.id)?.expectedPaid || row.principal_minor !== debts.get(row.id)?.row.principal_minor)
        || db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new Error('replayed database did not reconcile')
      db.exec('COMMIT')
    }
    const imported = db.prepare('SELECT CAST(sum(principal_minor) AS TEXT) AS principal_minor, CAST(sum(paid_minor) AS TEXT) AS paid_minor FROM personal_debts').get()
    if (output) await writeFile(output, sql, { flag: 'wx', mode: 0o600 })
    console.log(JSON.stringify({ mode: output ? 'sql-generated' : 'dry-run', verified_idempotent_replay: true, debts: debts.size, payments: payments.size,
      ...imported, remaining_minor: String(BigInt(imported.principal_minor) - BigInt(imported.paid_minor)),
      actor_id: actor, source_actors_mapped: new Set([...debts.values(), ...payments.values()].map(value => value.sourceActor).filter(Boolean)).size }, null, 2))
  } finally {
    db.close()
  }
} catch (error) {
  console.error(`Personal debt import failed: ${error.message}`)
  process.exitCode = 1
}
