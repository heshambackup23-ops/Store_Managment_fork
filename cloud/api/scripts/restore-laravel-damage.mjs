import { createHash } from 'node:crypto'
import { dateTime, day, id, integer, literal, minor, rowMap, text } from './laravel-finance-export.mjs'

const reasons = new Set(['broken', 'water', 'defective', 'not_working', 'lost', 'expired', 'returned', 'other'])
const nullableText = (value, length) => value == null ? null : text(value, length)
const nullableId = value => value == null ? null : id(value)

function damageRecord(row, key, catalog, cutoff) {
  if (row.product_id == null) throw new Error('missing product reference needs a catalog mapping')
  const product = id(row.product_id)
  if (!catalog.has(product)) throw new Error('product is absent from the cutoff catalog')
  if (!reasons.has(row.reason)) throw new Error('unknown damage reason')
  const quantity = integer(row.quantity, 1, 1000000)
  const stockBefore = integer(row.stock_before, 0, 1000000000)
  const stockAfter = stockBefore - quantity
  if (String(stockAfter) !== String(row.stock_after)) throw new Error('stock before minus quantity differs from stock after')
  const unit = minor(row.unit_value)
  const total = minor(row.total_value)
  if (BigInt(quantity) * unit !== total) throw new Error('quantity times unit value differs from total damage value')
  const created = dateTime(row.created_at)
  const updated = dateTime(row.updated_at)
  const damaged = day(row.damaged_on)
  if (updated > cutoff || created > updated || damaged > cutoff.slice(0, 10)) {
    throw new Error('record dates do not agree with the cutoff')
  }
  if (!['recorded', 'voided'].includes(row.status)) throw new Error('unknown historical damage status')
  let reversal = null
  if (row.status === 'voided') {
    const voided = dateTime(row.voided_at)
    if (voided < created || voided > updated) throw new Error('damage reversal timestamp disagrees with the original record')
    reversal = { created_at: voided, reason: text(row.void_reason, 255, true), legacy_voided_by: nullableId(row.voided_by) }
  } else if (row.voided_at != null || row.voided_by != null || row.void_reason != null) {
    throw new Error('active damage contains unexplained reversal details')
  }
  return {
    entry: {
      id: key, product_id: product, quantity, unit_cost_minor: unit, reason: row.reason, created_at: created,
      damaged_on: damaged, notes: text(row.notes, 500),
      legacy_product_name: text(row.product_name, 255, true),
      legacy_product_barcode: nullableText(row.product_barcode, 255),
      legacy_quantity: quantity, legacy_stock_before: stockBefore, legacy_stock_after: stockAfter,
      legacy_created_by: nullableId(row.created_by), legacy_created_by_name: nullableText(row.created_by_name, 255),
      legacy_updated_at: updated,
    },
    reversal, total,
    attachment: Boolean(row.image_path),
  }
}

function insert(table, values, matches) {
  return `INSERT INTO ${table} (${Object.keys(values).join(', ')})
    SELECT ${Object.values(values).map(literal).join(', ')}
    WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE ${matches});`
}

export function buildDamageRestore(rows, products, actor, cutoff) {
  if (!rows.length) throw new Error('A historical damage import requires at least one row')
  const actorId = id(actor)
  const cutoffAt = dateTime(cutoff)
  const catalog = rowMap(products, 'products', row => integer(row.stock, 0, 1000000000))
  const records = [...rowMap(rows, 'damaged_items', (row, key) => damageRecord(row, key, catalog, cutoffAt)).values()]
    .sort((left, right) => left.entry.id - right.entry.id)
  const stock = [...new Set(records.map(({ entry }) => entry.product_id))].sort((a, b) => a - b)
    .map(key => [key, catalog.get(key)])
  const fingerprint = createHash('sha256').update(JSON.stringify({ cutoffAt, records, stock },
    (_, value) => typeof value === 'bigint' ? String(value) : value)).digest('hex')
  const batch = literal(fingerprint)
  const commands = [`INSERT INTO historical_damage_imports (id, fingerprint, cutoff_at, damage_count, actor_id)
    VALUES (1, CASE WHEN EXISTS (SELECT 1 FROM historical_damage_imports WHERE id = 1)
      OR (NOT EXISTS (SELECT 1 FROM damaged_stock) AND NOT EXISTS (SELECT 1 FROM damaged_stock_reversals))
      THEN ${batch} ELSE NULL END, ${literal(cutoffAt)}, ${records.length}, ${actorId})
    ON CONFLICT (id) DO UPDATE SET fingerprint = CASE WHEN
      historical_damage_imports.fingerprint IS excluded.fingerprint
      AND historical_damage_imports.cutoff_at IS excluded.cutoff_at
      AND historical_damage_imports.damage_count IS excluded.damage_count
      AND historical_damage_imports.actor_id IS excluded.actor_id
      THEN historical_damage_imports.fingerprint ELSE NULL END;`]
  for (const [product, quantity] of stock) {
    commands.push(`UPDATE historical_damage_imports SET fingerprint = NULL WHERE fingerprint = ${batch}
      AND NOT EXISTS (SELECT 1 FROM damaged_stock WHERE legacy_damage_fingerprint = ${batch})
      AND NOT EXISTS (SELECT 1 FROM products WHERE id = ${product} AND stock = ${quantity});`)
  }
  for (const { entry, reversal } of records) {
    commands.push(insert('damaged_stock', { ...entry, actor_id: actorId, legacy_damage_fingerprint: fingerprint },
      `id = ${entry.id} AND legacy_damage_fingerprint = ${batch}`))
    if (reversal) {
      commands.push(insert('damaged_stock_reversals', {
        ...reversal, id: entry.id, damage_id: entry.id, actor_id: actorId, legacy_damage_fingerprint: fingerprint,
      }, `damage_id = ${entry.id} AND legacy_damage_fingerprint = ${batch}`))
    }
  }
  const largestId = records.at(-1).entry.id
  commands.push(`INSERT INTO business_operations(id,actor_id,request_key,operation,fingerprint)
    SELECT ${largestId}, ${actorId}, 'historical-damage:' || ${batch}, 'import.reserve', ${batch}
    WHERE NOT EXISTS (SELECT 1 FROM business_operations WHERE id >= ${largestId});`)
  const active = records.filter(record => !record.reversal)
  return {
    sql: commands.join('\n') + '\n',
    checks: {
      fingerprint, rows: records.length, reversed: records.length - active.length,
      active_units: String(active.reduce((sum, row) => sum + BigInt(row.entry.quantity), 0n)),
      active_value_minor: String(active.reduce((sum, row) => sum + row.total, 0n)),
      products_checked: stock.length,
      attachments_requiring_separate_import: records.filter(row => row.attachment).length,
    },
  }
}

export function verifyDamageRestore(db, rows) {
  const source = rowMap(rows, 'damaged_items')
  const actual = db.prepare(`
    SELECT d.id, d.product_id, d.quantity, d.unit_cost_minor, d.reason, d.damaged_on,
      d.legacy_stock_before, d.legacy_stock_after, d.legacy_product_name, d.legacy_product_barcode,
      r.created_at AS voided_at, r.reason AS void_reason
    FROM damaged_stock d LEFT JOIN damaged_stock_reversals r ON r.damage_id = d.id
  `).all()
  if (actual.length !== source.size || actual.some(row => {
    const expected = source.get(row.id)
    return !expected || row.product_id !== id(expected.product_id) || row.quantity !== Number(expected.quantity)
      || BigInt(row.unit_cost_minor) !== minor(expected.unit_value) || row.reason !== expected.reason
      || row.damaged_on !== expected.damaged_on || row.legacy_stock_before !== Number(expected.stock_before)
      || row.legacy_stock_after !== Number(expected.stock_after) || row.legacy_product_name !== expected.product_name
      || row.legacy_product_barcode !== (expected.product_barcode ?? null)
      || row.voided_at !== (expected.voided_at ?? null) || row.void_reason !== (expected.void_reason ?? null)
  })) throw new Error('Historical damage records or reversals did not reconcile.')
  if (db.prepare("SELECT 1 FROM inventory_movements WHERE source_type IN ('damage','damage_reversal') LIMIT 1").get()) {
    throw new Error('Historical damage movements were incorrectly applied to cutoff stock.')
  }
}
