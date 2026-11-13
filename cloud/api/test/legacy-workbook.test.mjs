import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readLegacyBackup } from '../scripts/legacy-workbook.mjs'
import { makeLegacyWorkbook, makeLegacyZip, makeZip } from './helpers/legacy-workbook.mjs'

async function fixture(t, bytes) {
  const folder = await mkdtemp(join(tmpdir(), 'hilal-workbook-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'legacy-backup')
  await writeFile(path, bytes)
  return path
}

test('Laravel backup ZIP preserves exact cell values and removes legacy credentials', async t => {
  const path = await fixture(t, makeLegacyZip({
    catalog: {
      categories: [['id', 'name'], ['1', 'كتب وأدوات']],
      products: [
        ['id', 'category_id', 'name', 'price', 'barcode', 'description', 'updated_at'],
        ['2', '1', '=صنف & دفتر', '12345678901.20', '00001', '', '2026-11-13 09:00:02'],
        ['3', null, '__STORE_BACKUP_ESC_V2____STORE_BACKUP_NULL_V2__', '2.01', null, null, null],
        ['4', null, '__STORE_BACKUP_ESC_V2____STORE_BACKUP_ESC_V2__كتابة', '1.09', null, null, null],
      ],
    },
    team: {
      users: [['id', 'name', 'password', 'remember_token', 'active'], ['1', 'اختبار', 'synthetic-password-hash', 'synthetic-token', '1']],
    },
  }))
  const data = await readLegacyBackup(path)
  assert.equal(data.source_kind, 'page-zip')
  assert.equal(data.created_at, '2026-11-13T09:15:00+02:00')
  assert.deepEqual(data.tables.products, [
    { id: '2', category_id: '1', name: '=صنف & دفتر', price: '12345678901.20', barcode: '00001', description: '', updated_at: '2026-11-13 09:00:02' },
    { id: '3', category_id: null, name: '__STORE_BACKUP_NULL_V2__', price: '2.01', barcode: null, description: null, updated_at: null },
    { id: '4', category_id: null, name: '__STORE_BACKUP_ESC_V2__كتابة', price: '1.09', barcode: null, description: null, updated_at: null },
  ])
  assert.deepEqual(data.tables.users, [{ id: '1', name: 'اختبار', active: '1' }])
  assert.deepEqual(Object.keys((await readLegacyBackup(path, { pages: ['catalog'] })).tables), ['categories', 'products'])
  await assert.rejects(readLegacyBackup(path, { pages: ['suppliers'] }), /absent/)
})

test('standalone XLSX distinguishes raw sheets and old display reports', async t => {
  const raw = await fixture(t, makeLegacyWorkbook({
    products: [['id', 'name', 'price'], [7, 'قلم', '29.90']],
    customers: [['id', 'name', 'phone'], [6, 'عميل', '000123']],
  }, { shared: false }))
  const data = await readLegacyBackup(raw)
  assert.equal(data.source_kind, 'workbook')
  assert.deepEqual(data.tables.products, [{ id: '7', name: 'قلم', price: '29.90' }])
  assert.equal(data.tables.customers[0].phone, '000123')
  const report = await fixture(t, makeLegacyWorkbook({
    Products: [['id', 'name', 'price'], [7, 'قلم', 29.9]],
    Invoices: [],
  }))
  const old = await readLegacyBackup(report)
  assert.equal(old.source_kind, 'report-workbook')
  assert.deepEqual(old.tables.invoices, [])
})

test('refuses invalid manifest paths, misplaced tables, formulas and duplicate entries', async t => {
  const page = makeLegacyWorkbook({ categories: [['id', 'name'], ['1', 'دفتر']] })
  const manifest = {
    format: 'store-management-excel-backup', version: 2, created_at: '2026-11-13T09:15:00+02:00',
    pages: ['catalog'], workbooks: { catalog: '../catalog.xlsx' },
  }
  const invalid = await fixture(t, makeZip([
    ['manifest.json', JSON.stringify(manifest)],
    ['pages/catalog.xlsx', page],
  ]))
  await assert.rejects(readLegacyBackup(invalid), /workbook path/)
  const misplaced = await fixture(t, makeLegacyZip({ catalog: { suppliers: [['id', 'name'], ['1', 'supplier']] } }))
  await assert.rejects(readLegacyBackup(misplaced), /unexpected or duplicate table/)
  const formula = await fixture(t, makeLegacyWorkbook({ products: [['id', 'price'], ['1', { formula: '1+1' }]] }))
  await assert.rejects(readLegacyBackup(formula), /Formula cells/)
  const duplicate = await fixture(t, makeZip([['xl/workbook.xml', 'unused'], ['XL/Workbook.xml', 'unused']]))
  await assert.rejects(readLegacyBackup(duplicate), /Duplicate entry/)
  const unknown = await fixture(t, makeZip([['arbitrary.csv', 'id,name\n1,item\n']]))
  await assert.rejects(readLegacyBackup(unknown), /not an XLSX or a recognized Laravel backup ZIP/)
})

test('identifies historical Artisan CSV archives without treating them as raw backups', async t => {
  const reportZip = await fixture(t, makeZip([
    ['products.csv', '\ufeffid,name,price\r\n1,"صنف ""دفتر""",14.00\r\n'],
    ['customers.csv', 'id,name,phone,address\n5,عميل,00001,"سطر\nآخر"\n'],
    ['maintenance.csv', ''],
  ]))
  const report = await readLegacyBackup(reportZip)
  assert.equal(report.source_kind, 'report-zip')
  assert.deepEqual(report.tables.products, [{ id: '1', name: 'صنف "دفتر"', price: '14.00' }])
  assert.deepEqual(report.tables.customers, [{ id: '5', name: 'عميل', phone: '00001', address: 'سطر\nآخر' }])
  assert.deepEqual(report.tables.maintenances, [])
  assert.deepEqual(Object.keys((await readLegacyBackup(reportZip, { pages: ['customers'] })).tables), ['customers'])
})
