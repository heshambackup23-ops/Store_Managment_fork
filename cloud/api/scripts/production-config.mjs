import { readFile, writeFile, cp, mkdir } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const productionWorker = 'hilal-store-production-api'
export const productionPages = 'hilal-store-production-ui'
export const productionDatabase = 'hilal-store-production-db'
export const productionBranch = 'cloudflare-full-migration'
const defaultDatabase = '00000000-0000-0000-0000-000000000000'
const databaseUuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/
const apiRoot = fileURLToPath(new URL('../', import.meta.url))
const webRoot = fileURLToPath(new URL('../../web/', import.meta.url))

export function productionInputs(env, prepare = false, now = Date.now()) {
  const account = env.CLOUDFLARE_ACCOUNT_ID
  const database = env.HILAL_PRODUCTION_D1_ID
  const demo = env.HENRA_STORE_DEMO_D1_ID
  if (!/^[a-f\d]{32}$/.test(account ?? '') || !env.CLOUDFLARE_API_TOKEN) throw new Error('Configure the production Cloudflare account and token.')
  if (!databaseUuid.test(database ?? '') || database === defaultDatabase ||
      !databaseUuid.test(demo ?? '') || demo === defaultDatabase || demo === database) {
    throw new Error('Configure distinct production and demo D1 UUIDs.')
  }
  if (prepare) {
    const restoreAt = Date.parse(env.HILAL_RESTORE_AT ?? '')
    if (!/^[a-f\d]{64}$/.test(env.HILAL_RESTORE_SHA256 ?? '') ||
        env.HILAL_RESTORE_DATABASE_ID !== database ||
        !Number.isFinite(restoreAt) || restoreAt > now || now - restoreAt > 24 * 3600 * 1000) {
      throw new Error('An independently checked private D1 restore proof from the past 24 hours is required.')
    }
    if (env.HILAL_PRODUCTION_DEPLOY_ENABLED !== 'true' || env.HILAL_PRODUCTION_CONFIRM !== productionPages) {
      throw new Error('Production deployment is not enabled or the confirmation does not match.')
    }
    if (!isAbsolute(env.HILAL_PRODUCTION_PAGES_STAGE ?? '')) throw new Error('Provide a new absolute Pages staging path.')
  }
  return { account, database, demo }
}

export function validateResources(databaseId, database, pages, worker) {
  if (database?.uuid !== databaseId || database?.name !== productionDatabase) {
    throw new Error('The D1 UUID does not identify the named production database.')
  }
  if (pages?.name !== productionPages || pages?.production_branch !== productionBranch || pages?.source != null) {
    throw new Error('The production Pages project must use Direct Upload and the designated production branch.')
  }
  const binding = pages.deployment_configs?.production?.services?.STORE_API
  if (binding?.service !== productionWorker || binding.environment) {
    throw new Error('Production Pages must already bind to the dedicated Worker.')
  }
  if (!worker?.bindings?.some(binding => binding.type === 'd1' && binding.name === 'DB' && binding.id === databaseId) ||
      !worker?.bindings?.some(binding => binding.type === 'secret_text' && binding.name === 'AUTH_PEPPER')) {
    throw new Error('The production Worker needs the verified D1 binding and its own AUTH_PEPPER secret.')
  }
  return database.file_size
}

async function main() {
  const [mode = '--check', ...extra] = process.argv.slice(2)
  if (extra.length || !['--check', '--prepare'].includes(mode)) throw new Error('Use production-config.mjs --check or --prepare.')
  const prepare = mode === '--prepare'
  const { account, database, demo } = productionInputs(process.env, prepare)
  const accountRoot = 'https://api.cloudflare.com/client/v4/accounts/' + account
  async function get(path, label) {
    const response = await fetch(accountRoot + path, {
      headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error('Could not verify ' + label + ' (HTTP ' + response.status + ').')
    const envelope = await response.json()
    if (!envelope.success) throw new Error('Could not verify ' + label + '.')
    return envelope.result
  }
  const [db, pages, worker, apiConfig, webConfig] = await Promise.all([
    get('/d1/database/' + database, 'production D1'),
    get('/pages/projects/' + productionPages, 'production Pages'),
    get('/workers/scripts/' + productionWorker + '/settings', 'production Worker bindings'),
    readFile(join(apiRoot, 'wrangler.jsonc'), 'utf8').then(JSON.parse),
    readFile(join(webRoot, 'wrangler.jsonc'), 'utf8').then(JSON.parse),
  ])
  const size = validateResources(database, db, pages, worker)
  if (Number.isSafeInteger(size)) console.log('Production D1 size in bytes:', size)
  const [binding] = apiConfig.d1_databases
  if (apiConfig.name !== 'henra-store-demo-api' || apiConfig.d1_databases.length !== 1 ||
      binding.binding !== 'DB' || binding.database_name !== 'henra-store-demo-db' ||
      binding.database_id !== defaultDatabase || webConfig.name !== 'henra-store-demo-ui' ||
      webConfig.services?.length !== 1 || webConfig.services[0].binding !== 'STORE_API' ||
      webConfig.services[0].service !== 'henra-store-demo-api' || database === demo) {
    throw new Error('Review changed base Cloudflare configuration before generating production bindings.')
  }
  if (prepare) {
    apiConfig.name = productionWorker
    apiConfig.workers_dev = false
    apiConfig.preview_urls = false
    binding.database_name = productionDatabase
    binding.database_id = database
    webConfig.name = productionPages
    webConfig.services[0].service = productionWorker
    const stage = process.env.HILAL_PRODUCTION_PAGES_STAGE
    await mkdir(stage, { mode: 0o700 })
    await Promise.all([
      writeFile(join(apiRoot, '.wrangler-production.json'), JSON.stringify(apiConfig, null, 2) + '\n', { mode: 0o600, flag: 'wx' }),
      writeFile(join(stage, 'wrangler.jsonc'), JSON.stringify(webConfig, null, 2) + '\n', { mode: 0o600, flag: 'wx' }),
      cp(join(webRoot, 'dist'), join(stage, 'dist'), { recursive: true }),
      cp(join(webRoot, 'functions'), join(stage, 'functions'), { recursive: true }),
    ])
  }
  console.log(prepare ? 'Prepared isolated production Worker, D1 and Pages configuration.' : 'Verified isolated production resources. No changes applied.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
