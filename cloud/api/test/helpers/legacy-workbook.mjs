import { crc32, deflateRawSync } from 'node:zlib'

const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const office = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const packageRelationships = 'http://schemas.openxmlformats.org/package/2006/relationships'
const contentTypes = 'http://schemas.openxmlformats.org/package/2006/content-types'
const spreadsheetContent = 'application/vnd.openxmlformats-officedocument.spreadsheetml'

export function makeZip(entries) {
  const localRecords = []
  const directory = []
  let offset = 0
  for (const [path, input] of entries) {
    const name = Buffer.from(path)
    const content = Buffer.from(input)
    const compressed = deflateRawSync(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(content), 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(name.length, 26)
    localRecords.push(local, name, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50)
    central.writeUInt16LE(20, 4)
    local.copy(central, 6, 4, 30)
    central.writeUInt32LE(offset, 42)
    directory.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.reduce((sum, part) => sum + part.length, 0), 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localRecords, ...directory, end])
}

function xml(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function letters(index) {
  const rest = Math.floor(index / 26)
  return (rest ? letters(rest - 1) : '') + String.fromCharCode(65 + index % 26)
}

export function makeLegacyWorkbook(sheets, { shared = true } = {}) {
  const strings = new Map()
  const entries = []
  const manifest = []
  const links = []
  const overrides = []
  Object.entries(sheets).forEach(([table, rows], index) => {
    const id = index + 1
    const target = `worksheets/sheet${id}.xml`
    manifest.push(`<sheet name="${xml(table)}" sheetId="${id}" r:id="rId${id}"/>`)
    links.push(`<Relationship Id="rId${id}" Type="${office}/worksheet" Target="${target}"/>`)
    overrides.push(`<Override PartName="/xl/${target}" ContentType="${spreadsheetContent}.worksheet+xml"/>`)
    const body = rows.map((values, row) => {
      const cells = values.map((value, col) => {
        const address = letters(col) + (row + 1)
        if (value === undefined) return ''
        if (typeof value === 'object' && value?.formula) return `<c r="${address}"><f>${xml(value.formula)}</f><v>1</v></c>`
        if (typeof value === 'number') return `<c r="${address}"><v>${value}</v></c>`
        const raw = value === null ? '__STORE_BACKUP_NULL_V2__' : value
        if (shared) {
          if (!strings.has(raw)) strings.set(raw, strings.size)
          return `<c r="${address}" t="s"><v>${strings.get(raw)}</v></c>`
        }
        return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xml(raw)}</t></is></c>`
      }).join('')
      return `<row r="${row + 1}">${cells}</row>`
    }).join('')
    entries.push(['xl/' + target, `<worksheet xmlns="${spreadsheet}"><sheetData>${body}</sheetData></worksheet>`])
  })
  if (shared) {
    links.push(`<Relationship Id="rIdShared" Type="${office}/sharedStrings" Target="sharedStrings.xml"/>`)
    overrides.push(`<Override PartName="/xl/sharedStrings.xml" ContentType="${spreadsheetContent}.sharedStrings+xml"/>`)
    const values = Array.from(strings.keys(), value => `<si><t xml:space="preserve">${xml(value)}</t></si>`).join('')
    entries.push(['xl/sharedStrings.xml', `<sst xmlns="${spreadsheet}">${values}</sst>`])
  }
  entries.push(
    ['[Content_Types].xml', `<Types xmlns="${contentTypes}"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="${spreadsheetContent}.sheet.main+xml"/>${overrides.join('')}</Types>`],
    ['_rels/.rels', `<Relationships xmlns="${packageRelationships}"><Relationship Id="rId1" Type="${office}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<workbook xmlns="${spreadsheet}" xmlns:r="${office}"><sheets>${manifest.join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<Relationships xmlns="${packageRelationships}">${links.join('')}</Relationships>`],
  )
  return makeZip(entries)
}

export function makeLegacyZip(pageSheets, createdAt = '2026-11-13T09:15:00+02:00') {
  const pages = Object.keys(pageSheets)
  const entries = pages.map(page => [`pages/${page}.xlsx`, makeLegacyWorkbook(pageSheets[page])])
  const manifest = {
    format: 'store-management-excel-backup',
    version: 2,
    created_at: createdAt,
    pages,
    workbooks: Object.fromEntries(pages.map(page => [page, `pages/${page}.xlsx`])),
  }
  return makeZip([...entries, ['manifest.json', JSON.stringify(manifest)]])
}
