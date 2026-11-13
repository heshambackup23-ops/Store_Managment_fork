import assert from 'node:assert/strict'
import test from 'node:test'
import {
  productionBranch, productionDatabase, productionInputs, productionPages, productionWorker, validateResources,
} from '../scripts/production-config.mjs'

const d1Id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const demoId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const now = Date.parse('2026-11-13T10:00:00Z')
const options = {
  CLOUDFLARE_ACCOUNT_ID: 'c'.repeat(32),
  CLOUDFLARE_API_TOKEN: 'synthetic-test-token',
  HILAL_PRODUCTION_D1_ID: d1Id,
  HENRA_STORE_DEMO_D1_ID: demoId,
  HILAL_PRODUCTION_DEPLOY_ENABLED: 'true',
  HILAL_PRODUCTION_CONFIRM: productionPages,
  HILAL_PRODUCTION_PAGES_STAGE: process.cwd(),
  HILAL_RESTORE_AT: '2026-11-13T09:00:00Z',
  HILAL_RESTORE_SHA256: 'd'.repeat(64),
  HILAL_RESTORE_DATABASE_ID: d1Id,
}

test('production deployment requires a separate D1 and recent restoration proof', () => {
  assert.equal(productionInputs(options, true, now).database, d1Id)
  assert.throws(() => productionInputs({ ...options, HENRA_STORE_DEMO_D1_ID: d1Id }), /distinct/)
  assert.throws(() => productionInputs({ ...options, HILAL_RESTORE_DATABASE_ID: demoId }, true, now), /restore proof/)
  assert.throws(() => productionInputs({ ...options, HILAL_RESTORE_AT: '2026-11-12T09:00:00Z' }, true, now), /restore proof/)
  assert.throws(() => productionInputs({ ...options, HILAL_PRODUCTION_DEPLOY_ENABLED: 'false' }, true, now), /not enabled/)
  assert.throws(() => productionInputs({ ...options, HILAL_PRODUCTION_CONFIRM: 'henra-store-demo-ui' }, true, now), /confirmation/)
  assert.equal(productionInputs({ ...options, HILAL_PRODUCTION_DEPLOY_ENABLED: 'false' }).database, d1Id)
})

test('production preflight rejects misplaced Pages, Worker or D1 bindings', () => {
  const database = { uuid: d1Id, name: productionDatabase, file_size: 102400 }
  const pages = {
    name: productionPages,
    production_branch: productionBranch,
    deployment_configs: { production: { services: { STORE_API: { service: productionWorker } } } },
  }
  const worker = {
    bindings: [{ name: 'DB', type: 'd1', id: d1Id }, { name: 'AUTH_PEPPER', type: 'secret_text' }],
  }
  assert.equal(validateResources(d1Id, database, pages, worker), 102400)
  assert.throws(() => validateResources(d1Id, { ...database, name: 'henra-store-demo-db' }, pages, worker), /D1 UUID/)
  assert.throws(() => validateResources(d1Id, database, { ...pages, source: {} }, worker), /Direct Upload/)
  const demoBinding = { production: { services: { STORE_API: { service: 'henra-store-demo-api' } } } }
  assert.throws(() => validateResources(d1Id, database, { ...pages, deployment_configs: demoBinding }, worker), /Pages must/)
  assert.throws(() => validateResources(d1Id, database, pages, { bindings: worker.bindings.slice(0, 1) }), /AUTH_PEPPER/)
  assert.throws(() => validateResources(d1Id, database, pages, {
    bindings: [{ ...worker.bindings[0], id: demoId }, worker.bindings[1]],
  }), /verified D1/)
})
