import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler'
import { summarizeRetailBackup } from './retail-backup-checks.mjs'

const api = fileURLToPath(new URL('../', import.meta.url))
const wrangler = join(api, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const backupRoot = join(api, 'backups')
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--persist-to' || !args[1].trim())) {
  throw new Error('Usage: node scripts/backup-drill.mjs [--persist-to LOCAL_D1_DIRECTORY]')
}
const sourcePath = args[1]

function run(args) {
  const result = spawnSync(process.execPath, [wrangler, 'd1', ...args], {
    cwd: api,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  if (result.status !== 0) {
    throw new Error(`Wrangler ${args[0]} failed (${result.status ?? result.error?.code}). Check local D1 and its migrations.`)
  }
  return result.stdout
}

function identifier(name) {
  return `"${name.replaceAll('"', '""')}"`
}

function orderRestoreStatements(sql) {
  const pragmas = []
  const tables = []
  const rows = []
  const schema = []
  for (const statement of unstable_splitSqlQuery(sql)) {
    const start = statement.trimStart()
    if (/^PRAGMA\s+defer_foreign_keys\s*=/i.test(start)) pragmas.push(statement)
    else if (/^CREATE\s+TABLE\b/i.test(start)) tables.push(statement)
    else if (/^(INSERT|REPLACE|DELETE|UPDATE)\b/i.test(start)) rows.push(statement)
    else schema.push(statement)
  }
  // SQLite must resolve foreign table names even for nullable links in a deferred batch.
  // Load rows before triggers so a snapshot restores existing ledgers without applying their effects twice.
  return [...pragmas, ...tables, ...rows, ...schema].map(sql => sql.replace(/;\s*$/, '') + ';').join('\n') + '\n'
}

async function inspectDatabase(persist, exportSnapshot = false) {
  const local = await getPlatformProxy({ configPath: join(api, 'wrangler.jsonc'), persist, remoteBindings: false })
  try {
    const db = local.env.DB
    const { results: objects } = await db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND sql IS NOT NULL ORDER BY type, name").all()
    const tables = objects.filter(row => row.type === 'table')
    if (!tables.some(({ name }) => name === 'products')) {
      throw new Error('Apply the Store migrations to local D1 before running the drill.')
    }
    const results = await db.batch(tables.map(({ name }) => db.prepare(`SELECT count(*) AS count FROM ${identifier(name)}`)))
    const counts = Object.fromEntries(tables.map(({ name }, index) => [name, results[index].results[0].count]))
    if ((await db.prepare('PRAGMA foreign_key_check').all()).results.length) {
      throw new Error('The database failed the foreign-key check.')
    }
    const retail = await summarizeRetailBackup(db, new Set(objects.map(({ name }) => name)))
    const schema = objects.map(({ type, name }) => `${type}:${name}`)
    const schemaSha256 = createHash('sha256').update(JSON.stringify(objects.map(({ type, name, sql }) =>
      [type, name, sql.replace(/;\s*$/, '')]))).digest('hex')
    const snapshot = exportSnapshot
      ? (await db.prepare('PRAGMA miniflare_d1_export(?,?,?);').bind(false, false).raw())[0].join('\n')
      : undefined
    return { summary: { schema, schemaSha256, counts, retail }, snapshot }
  } finally {
    await local.dispose()
  }
}

await mkdir(backupRoot, { recursive: true })
const directory = await mkdtemp(join(backupRoot, 'drill-'))
const backup = join(directory, 'store.generated.sql')
const isolated = join(directory, 'restored')
const restoreTarget = ['--persist-to', isolated]
process.env.WRANGLER_REGISTRY_PATH = join(directory, 'registry')

try {
  const { summary: before, snapshot } = await inspectDatabase(sourcePath ? { path: join(sourcePath, 'v3') } : true, true)
  await writeFile(backup, orderRestoreStatements(snapshot), { mode: 0o600 })
  run(['execute', 'DB', '--local', '--file', backup, ...restoreTarget])
  const { summary: after } = await inspectDatabase({ path: join(isolated, 'v3') })
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    const mismatched = Object.keys(before.retail).filter(name => JSON.stringify(before.retail[name]) !== JSON.stringify(after.retail[name]))
    throw new Error('The restored schema, table counts or retail ledgers differ from the source snapshot.' +
      (mismatched.length ? ` Differences: ${mismatched.join(', ')}.` : ''))
  }
  const sha = createHash('sha256')
  for await (const chunk of createReadStream(backup)) sha.update(chunk)
  console.log(JSON.stringify({ status: 'verified', backup, sha256: sha.digest('hex'), ...after }, null, 2))
} finally {
  const resolvedTarget = await realpath(isolated).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  if (resolvedTarget) {
    const within = relative(await realpath(directory), resolvedTarget)
    if (!within || isAbsolute(within) || within === '..' || within.startsWith(`..${sep}`)) {
      throw new Error('Refusing to remove a restored database outside the drill directory.')
    }
    await rm(resolvedTarget, { recursive: true, force: true })
  }
}
