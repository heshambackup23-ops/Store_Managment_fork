import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const databaseId = process.env.HENRA_STORE_D1_ID
if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(databaseId ?? '') || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(databaseId)) {
  throw new Error('Set HENRA_STORE_D1_ID to the UUID of the isolated demo database.')
}

const source = new URL('../wrangler.jsonc', import.meta.url)
const config = JSON.parse(await readFile(source, 'utf8'))
const [database] = config.d1_databases
if (config.name !== 'henra-store-demo-api' || config.d1_databases.length !== 1 || database.database_name !== 'henra-store-demo-db') {
  throw new Error('Deployment config does not describe the isolated Store demo.')
}

const wrangler = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const listed = spawnSync(process.execPath, [wrangler, 'd1', 'list', '--json'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  encoding: 'utf8',
})
if (listed.status !== 0) throw new Error('Could not verify the D1 database using authenticated Wrangler.')
const databases = JSON.parse(listed.stdout)
if (!databases.some(row => row.uuid === databaseId && row.name === database.database_name)) {
  throw new Error('The supplied UUID does not match henra-store-demo-db in the selected Cloudflare account.')
}

database.database_id = databaseId
const output = new URL('../.wrangler-demo.json', import.meta.url)
await writeFile(output, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
console.log('Generated Cloudflare configuration for henra-store-demo-api and henra-store-demo-db.')
