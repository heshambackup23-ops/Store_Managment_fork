import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPlatformProxy } from 'wrangler'

const api = fileURLToPath(new URL('../', import.meta.url))
const wrangler = join(api, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const backupRoot = join(api, 'backups')

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

async function summarize(persist) {
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
    const balanceColumns = { products: 'stock', invoices: 'total_minor', wallets: 'balance_minor' }
    const balances = {}
    for (const [table, column] of Object.entries(balanceColumns)) {
      if (tables.some(({ name, sql }) => name === table && new RegExp(`\\b${column}\\b`).test(sql))) {
        balances[table] = await db.prepare(`SELECT CAST(COALESCE(sum(${identifier(column)}), 0) AS TEXT) AS total FROM ${identifier(table)}`).first('total')
      }
    }
    return { schema: objects.map(({ type, name }) => `${type}:${name}`), counts, balances }
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
  const before = await summarize(true)
  run(['export', 'DB', '--local', '--output', backup])
  run(['execute', 'DB', '--local', '--file', backup, ...restoreTarget])
  const after = await summarize({ path: join(isolated, 'v3') })
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error('The restored schema, table counts or financial totals differ from the source snapshot.')
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
