import { open } from 'node:fs/promises'
import { posix } from 'node:path'
import { TextDecoder } from 'node:util'
import { crc32 } from 'node:zlib'
import { parse } from 'csv-parse/sync'
import { SaxesParser } from 'saxes'
import yauzl from 'yauzl'

export const backupGroups = Object.freeze({
  catalog: ['categories', 'products'],
  customers: ['customers'],
  sales: ['sales', 'sales_items', 'payments'],
  invoices: ['invoices'],
  installments: ['installments', 'debts', 'personal_debts', 'personal_debt_payments'],
  suppliers: ['suppliers', 'purchases', 'supplier_payments'],
  maintenance: ['maintenances'],
  wallets: ['wallets', 'wallet_transactions', 'wallet_expenses', 'wallet_cash_adjustments', 'wallet_audit_logs'],
  damaged: ['damaged_items'],
  notifications: ['app_notifications', 'notification_reads'],
  team: ['users', 'profiles', 'settings', 'roles', 'permissions', 'model_has_permissions', 'model_has_roles', 'role_has_permissions'],
})

const format = 'store-management-excel-backup'
const nullMarker = '__STORE_BACKUP_NULL_V2__'
const escapeMarker = '__STORE_BACKUP_ESC_V2__'
const MiB = 1024 * 1024
const maxFile = 128 * MiB
const maxEntry = 96 * MiB
const maxExpanded = 512 * MiB
const maxEntries = 512
const maxRows = 250_000
const maxCells = 2_000_000
const maxColumns = 128
const rawTableNames = new Set(Object.values(backupGroups).flat())
const reportNames = new Map([['Maintenance', 'maintenances']])
for (const name of rawTableNames) {
  reportNames.set(name.replaceAll('_', ' ').replace(/\b[a-z]/g, c => c.toUpperCase()).slice(0, 31), name)
}
const reportCsvTables = new Map([
  ['products.csv', 'products'], ['invoices.csv', 'invoices'], ['installments.csv', 'installments'],
  ['customers.csv', 'customers'], ['maintenance.csv', 'maintenances'], ['wallets.csv', 'wallets'],
  ['wallet_transactions.csv', 'wallet_transactions'], ['wallet_expenses.csv', 'wallet_expenses'],
  ['wallet_cash_adjustments.csv', 'wallet_cash_adjustments'], ['wallet_audit_logs.csv', 'wallet_audit_logs'],
  ['damaged_items.csv', 'damaged_items'],
])
const spreadsheetUris = new Set([
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
  'http://purl.oclc.org/ooxml/spreadsheetml/main',
])
const relationshipUris = new Set([
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  'http://purl.oclc.org/ooxml/officeDocument/relationships',
])
const packageRelationshipUri = 'http://schemas.openxmlformats.org/package/2006/relationships'
const decoder = new TextDecoder('utf-8', { fatal: true })

function archivePath(name) {
  return typeof name === 'string'
    && name.length <= 300
    && !/[\\:\u0000-\u001f\u007f]/.test(name)
    && name.replace(/\/$/, '').split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

async function withZip(bytes, callback) {
  let zip
  try {
    zip = await yauzl.fromBufferPromise(bytes, { strictFileNames: true, validateEntrySizes: true })
    if (zip.entryCount > maxEntries) throw new Error('Backup archive contains too many entries.')
    const entries = new Map()
    const knownNames = new Set()
    let total = 0
    for await (const entry of zip.eachEntry()) {
      const name = entry.fileName
      if (!archivePath(name)) throw new Error('Invalid backup archive path.')
      const key = name.replace(/\/$/, '').toLowerCase()
      if (knownNames.has(key)) throw new Error('Duplicate entry in backup archive.')
      knownNames.add(key)
      if (entry.isEncrypted()) throw new Error('Encrypted backup archives are unsupported.')
      if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw new Error('Unsupported archive compression.')
      if ((entry.externalFileAttributes >>> 28) === 10) throw new Error('Backup archive contains a symbolic link.')
      total += entry.uncompressedSize
      if (total > maxExpanded || entry.uncompressedSize > maxEntry) throw new Error('Expanded backup archive exceeds the size limit.')
      if (!name.endsWith('/')) entries.set(name, entry)
    }
    const read = async (name, budget, limit = maxEntry) => {
      const entry = entries.get(name)
      if (!entry) throw new Error('Backup archive is missing a required entry.')
      if (entry.uncompressedSize > limit || budget.bytes + entry.uncompressedSize > maxExpanded) {
        throw new Error('Expanded backup data exceeds the size limit.')
      }
      budget.bytes += entry.uncompressedSize
      const stream = await zip.openReadStreamPromise(entry)
      const chunks = []
      let bytesRead = 0
      let checksum = 0
      for await (const chunk of stream) {
        bytesRead += chunk.length
        if (bytesRead > entry.uncompressedSize) throw new Error('Archive entry exceeds its declared size.')
        checksum = crc32(chunk, checksum)
        chunks.push(chunk)
      }
      if (bytesRead !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error('Archive entry failed its integrity check.')
      return Buffer.concat(chunks, bytesRead)
    }
    return await callback(entries, read)
  } finally {
    zip?.close()
  }
}

function readXml(bytes, root, namespaces, handlers) {
  const parser = new SaxesParser({ xmlns: true })
  const stack = []
  parser.on('error', () => { throw new Error('Malformed workbook XML.') })
  parser.on('doctype', () => { throw new Error('Workbook XML must not contain a document type declaration.') })
  parser.on('opentag', node => {
    if (stack.length === 0 && (node.local !== root || !namespaces.has(node.uri))) {
      throw new Error('Unexpected workbook XML type.')
    }
    stack.push(node)
    if (stack.length > 32) throw new Error('Workbook XML nesting exceeds the limit.')
    if (namespaces.has(node.uri)) handlers.open?.(node, stack)
  })
  parser.on('closetag', node => {
    if (namespaces.has(node.uri)) handlers.close?.(node, stack)
    stack.pop()
  })
  const receiveText = value => handlers.text?.(value, stack)
  parser.on('text', receiveText)
  parser.on('cdata', receiveText)
  parser.write(decoder.decode(bytes)).close()
}

function attribute(node, local, uri = '') {
  return Object.values(node.attributes).find(attr => attr.local === local && attr.uri === uri)?.value
}

function excelText(value) {
  const text = value.replace(/_x([a-f0-9]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  if (text.includes('\0') || text.length > 32_767) throw new Error('Invalid workbook text cell.')
  return text
}

function sharedStrings(bytes) {
  const values = []
  let parts
  readXml(bytes, 'sst', spreadsheetUris, {
    open(node, stack) {
      if (node.local === 'si' && stack.length === 2) parts = []
    },
    close(node, stack) {
      if (node.local === 'si' && stack.length === 2) {
        values.push(excelText(parts.join('')))
        if (values.length > maxCells) throw new Error('Workbook contains too many shared strings.')
        parts = undefined
      }
    },
    text(value, stack) {
      const tag = stack.at(-1)
      const parent = stack.at(-2)
      if (parts && tag?.local === 't' && spreadsheetUris.has(tag.uri) && ['si', 'r'].includes(parent?.local)) {
        parts.push(value)
      }
    },
  })
  return values
}

function positiveInteger(value, limit, error) {
  if (!/^[1-9]\d{0,7}$/.test(value ?? '') || Number(value) > limit) throw new Error(error)
  return Number(value)
}

function cellColumn(ref, row) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref ?? '')
  if (!match || Number(match[2]) !== row) throw new Error('Invalid workbook cell reference.')
  let column = 0
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64
  if (column > maxColumns) throw new Error('Workbook has too many columns.')
  return column - 1
}

function decodeCell(cell, strings) {
  const value = cell.parts.join('')
  if (cell.type === 'inlineStr' || cell.type === 'str' || cell.type === 'd') return excelText(value)
  if (cell.type === 's') {
    if (!/^(0|[1-9]\d*)$/.test(value) || Number(value) >= strings.length) throw new Error('Invalid workbook shared string reference.')
    return strings[Number(value)]
  }
  if (!value) return null
  if (cell.type === 'b' && /^[01]$/.test(value)) return value
  if (cell.type === 'n' && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && value.length <= 64) return value
  throw new Error('Unsupported or invalid workbook cell type.')
}

function legacyValue(value) {
  if (value === nullMarker) return null
  if (typeof value === 'string' && value.startsWith(escapeMarker)) return value.slice(escapeMarker.length)
  return value
}

function validHeaders(headers) {
  return headers.length <= maxColumns
    && headers.every(value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value))
    && new Set(headers).size === headers.length
}

function worksheet(bytes, strings, budget, table, raw) {
  const records = []
  let headers
  let rowIndex = 0
  let row
  let cell
  readXml(bytes, 'worksheet', spreadsheetUris, {
    open(node, stack) {
      if (node.local === 'row' && stack.length === 3 && stack[1].local === 'sheetData') {
        const next = positiveInteger(attribute(node, 'r'), 1_048_576, 'Invalid workbook row reference.')
        if (next <= rowIndex || (!rowIndex && next !== 1)) throw new Error('Workbook rows are out of order or missing their header.')
        rowIndex = next
        row = new Map()
      } else if (node.local === 'c' && row && stack.length === 4 && stack[2].local === 'row') {
        if (++budget.cells > maxCells) throw new Error('Backup contains too many cells.')
        const column = cellColumn(attribute(node, 'r'), rowIndex)
        if (row.has(column)) throw new Error('Duplicate workbook cell.')
        cell = { column, type: attribute(node, 't') ?? 'n', parts: [] }
      } else if (node.local === 'f' && cell) {
        throw new Error('Formula cells cannot be used for restoration.')
      }
    },
    close(node, stack) {
      if (node.local === 'c' && cell && stack.length === 4) {
        row.set(cell.column, decodeCell(cell, strings))
        cell = undefined
      } else if (node.local === 'row' && row && stack.length === 3) {
        if (rowIndex === 1) {
          const width = row.size ? Math.max(...row.keys()) + 1 : 0
          headers = Array.from({ length: width }, (_, index) => row.get(index))
          if (!validHeaders(headers)) {
            throw new Error('Workbook has invalid or duplicate column headers.')
          }
        } else if ([...row.values()].some(value => value !== null && value !== '')) {
          if (!headers?.length || [...row.keys()].some(column => column >= headers.length)) {
            throw new Error('Workbook row has data outside the header columns.')
          }
          if (++budget.rows > maxRows) throw new Error('Backup contains too many rows.')
          const record = {}
          for (const [index, column] of headers.entries()) {
            if (isCredential(table, column)) continue
            const value = row.get(index) ?? null
            record[column] = raw ? legacyValue(value) : value
          }
          records.push(record)
        }
        row = undefined
      }
    },
    text(value, stack) {
      const tag = stack.at(-1)
      if (!cell || !spreadsheetUris.has(tag?.uri)) return
      if (tag.local === 'v' && stack.length === 5) cell.parts.push(value)
      if (tag.local === 't' && cell.type === 'inlineStr' && ['is', 'r'].includes(stack.at(-2)?.local)) cell.parts.push(value)
    },
  })
  if (raw && !headers?.length) throw new Error('Backup workbook is missing its column headers.')
  return records
}

function isCredential(table, column) {
  return (table === 'users' || table === 'profiles') && /password|token|secret|recovery_codes|api_key/i.test(column)
}

function workbookTarget(target) {
  if (typeof target !== 'string' || !archivePath(target.replace(/^\//, ''))) throw new Error('Invalid workbook relationship target.')
  const path = target.startsWith('/') ? target.slice(1) : posix.join('xl', target)
  if (!path.startsWith('xl/') || !path.endsWith('.xml')) throw new Error('Workbook relationship target is outside the workbook.')
  return path
}

async function readWorkbook(read, entries, budget, allowedTables, canonical) {
  if (!entries.has('[Content_Types].xml') || !entries.has('xl/workbook.xml')) throw new Error('Invalid XLSX workbook package.')
  const sheets = new Map()
  readXml(await read('xl/workbook.xml', budget, MiB), 'workbook', spreadsheetUris, {
    open(node, stack) {
      if (node.local !== 'sheet' || stack.length !== 3 || stack[1].local !== 'sheets') return
      const name = attribute(node, 'name')
      const relationship = Object.values(node.attributes).find(attr => attr.local === 'id' && relationshipUris.has(attr.uri))?.value
      if (!name || name.length > 31 || !relationship || sheets.has(name) || sheets.size >= rawTableNames.size + 1) {
        throw new Error('Workbook has invalid or duplicate sheet metadata.')
      }
      sheets.set(name, relationship)
    },
  })
  const links = new Map()
  readXml(await read('xl/_rels/workbook.xml.rels', budget, MiB), 'Relationships', new Set([packageRelationshipUri]), {
    open(node, stack) {
      if (node.local !== 'Relationship' || stack.length !== 2) return
      const id = attribute(node, 'Id')
      const type = attribute(node, 'Type')
      const target = attribute(node, 'Target')
      if (!id || !type || !target || links.has(id) || attribute(node, 'TargetMode') === 'External') {
        throw new Error('Workbook has invalid or external relationships.')
      }
      links.set(id, { type, target })
    },
  })
  if (canonical && sheets.size === 1 && sheets.has('empty')) return { tables: {}, report: false }
  const tables = Object.create(null)
  let report = false
  const used = new Set()
  let shared
  for (const link of links.values()) {
    if (!isRelation(link.type, 'sharedStrings')) continue
    if (shared) throw new Error('Workbook has duplicate shared string data.')
    shared = workbookTarget(link.target)
  }
  const strings = shared ? sharedStrings(await read(shared, budget)) : []
  for (const [sheet, relationship] of sheets) {
    const raw = rawTableNames.has(sheet)
    const table = raw ? sheet : reportNames.get(sheet)
    if (!table || (canonical && !raw) || !allowedTables.has(table) || Object.hasOwn(tables, table)) {
      throw new Error('Workbook contains an unexpected or duplicate table.')
    }
    const link = links.get(relationship)
    if (!link || !isRelation(link.type, 'worksheet')) throw new Error('Missing workbook worksheet relationship.')
    const target = workbookTarget(link.target)
    if (!target.startsWith('xl/worksheets/') || used.has(target)) throw new Error('Invalid or duplicate worksheet target.')
    used.add(target)
    tables[table] = worksheet(await read(target, budget), strings, budget, table, raw)
    report ||= !raw
  }
  if (!sheets.size) throw new Error('Workbook has no sheets.')
  return { tables, report }
}

function isRelation(uri, name) {
  return [...relationshipUris].some(namespace => uri === namespace + '/' + name)
}

function requestedPages(pages) {
  if (!Array.isArray(pages) || !pages.length || new Set(pages).size !== pages.length
    || pages.some(page => typeof page !== 'string' || !Object.hasOwn(backupGroups, page))) {
    throw new Error('Invalid backup page selection.')
  }
  return pages
}

function readManifest(bytes) {
  let manifest
  try { manifest = JSON.parse(decoder.decode(bytes)) }
  catch { throw new Error('Invalid Laravel backup manifest.') }
  if (manifest?.format !== format || manifest.version !== 2 || !manifest.workbooks
    || typeof manifest.workbooks !== 'object' || Array.isArray(manifest.workbooks)
    || typeof manifest.created_at !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(manifest.created_at)
    || !Number.isFinite(Date.parse(manifest.created_at))) {
    throw new Error('Unsupported or invalid Laravel backup manifest.')
  }
  const pages = requestedPages(manifest.pages)
  if (Object.keys(manifest.workbooks).length !== pages.length
    || pages.some(page => manifest.workbooks[page] !== `pages/${page}.xlsx`)) {
    throw new Error('Invalid workbook path in the Laravel backup manifest.')
  }
  return manifest
}

function pickTables(tables, sourceKind, pages) {
  const available = Object.keys(backupGroups).filter(page => backupGroups[page].some(table => Object.hasOwn(tables, table)))
  if (pages?.some(page => !available.includes(page))) throw new Error('Selected page is absent from the workbook.')
  const selected = pages ?? available
  const wanted = new Set(selected.flatMap(page => backupGroups[page]))
  return {
    format,
    source_kind: sourceKind,
    created_at: null,
    pages: selected,
    tables: Object.fromEntries(Object.entries(tables).filter(([table]) => wanted.has(table))),
  }
}

async function reportZip(entries, read, budget, pages) {
  if (!entries.size || [...entries.keys()].some(name => !reportCsvTables.has(name))) {
    throw new Error('This archive is not an XLSX or a recognized Laravel backup ZIP.')
  }
  const tables = Object.create(null)
  for (const name of entries.keys()) {
    const table = reportCsvTables.get(name)
    const content = decoder.decode(await read(name, budget))
    let headers
    try {
      tables[table] = parse(content, {
        bom: true,
        skip_empty_lines: true,
        max_record_size: 256 * 1024,
        on_record(record) {
          if (!headers) {
            if (!validHeaders(record) || !record.length) throw new Error('Invalid CSV header.')
            headers = record
            return null
          }
          budget.cells += record.length
          if (budget.cells > maxCells || ++budget.rows > maxRows) throw new Error('Backup contains too many records.')
          return Object.fromEntries(headers.map((header, index) => [header, record[index] === '' ? null : record[index]]))
        },
      })
    } catch {
      throw new Error('Invalid or oversized data in a legacy CSV report.')
    }
  }
  return pickTables(tables, 'report-zip', pages)
}

export async function readLegacyBackup(filePath, options = {}) {
  const pages = options.pages === undefined ? undefined : requestedPages(options.pages)
  const handle = await open(filePath, 'r')
  let bytes
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size < 22 || info.size > maxFile) throw new Error('Invalid backup file size.')
    bytes = Buffer.alloc(info.size)
    let total = 0
    while (total < bytes.length) {
      const { bytesRead } = await handle.read(bytes, total, bytes.length - total, total)
      if (!bytesRead) throw new Error('Backup file changed while reading.')
      total += bytesRead
    }
    const after = await handle.stat()
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('Backup file changed while reading.')
  } finally {
    await handle.close()
  }
  const budget = { bytes: 0, cells: 0, rows: 0 }
  return withZip(bytes, async (entries, read) => {
    if (entries.has('manifest.json')) {
      const manifest = readManifest(await read('manifest.json', budget, 64 * 1024))
      const selected = pages ?? manifest.pages
      if (selected.some(page => !manifest.pages.includes(page))) throw new Error('Selected page is absent from the backup.')
      if (entries.size !== manifest.pages.length + 1
        || manifest.pages.some(page => !entries.has(manifest.workbooks[page]))) {
        throw new Error('Backup archive entries do not match its manifest.')
      }
      const tables = Object.create(null)
      for (const page of selected) {
        const bytes = await read(manifest.workbooks[page], budget)
        const workbook = await withZip(bytes, (files, entryRead) => readWorkbook(entryRead, files, budget, new Set(backupGroups[page]), true))
        Object.assign(tables, workbook.tables)
      }
      return { format, source_kind: 'page-zip', created_at: manifest.created_at, pages: selected, tables }
    }
    if (!entries.has('xl/workbook.xml')) return reportZip(entries, read, budget, pages)
    const { tables, report } = await readWorkbook(read, entries, budget, rawTableNames, false)
    return pickTables(tables, report ? 'report-workbook' : 'workbook', pages)
  })
}
