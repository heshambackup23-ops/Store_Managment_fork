import { dateTime, day, id, literal, minor, rowMap, text } from './laravel-finance-export.mjs'

const tables = ['suppliers', 'purchases', 'supplier_payments']
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0n)

function dates(row) {
  const created_at = dateTime(row.created_at)
  const updated_at = dateTime(row.updated_at)
  if (updated_at < created_at) throw new Error('update predates creation')
  return { created_at, updated_at }
}

function insert(table, row) {
  return `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(literal).join(', ')});`
}

function uniqueDocument(row, name, existing) {
  const number = text(row[name], 255, true)
  if (existing.has(number)) throw new Error(`duplicate ${name}`)
  existing.add(number)
  return number
}

function receiptRow(receipt, actor) {
  return {
    id: receipt.id, amount_minor: receipt.amount, payment_date: receipt.paymentDate, note: receipt.notes,
    actor_id: actor, created_at: receipt.created_at, legacy_receipt_number: receipt.number,
    legacy_updated_at: receipt.updated_at,
  }
}

function plan(source, actor) {
  if (tables.some((name) => source[name]?.length) && tables.some((name) => !Array.isArray(source[name]))) {
    throw new Error('Supplier history requires the suppliers, purchases and supplier_payments sheets, even when empty.')
  }
  const commands = []
  const suppliers = rowMap(source.suppliers ?? [], 'suppliers', (row, key) => ({
    id: key, name: text(row.name, 255, true), phone: text(row.phone, 20), email: row.email == null ? null : text(row.email, 255),
    address: text(row.address, 255), notes: text(row.notes, 2000),
    opening: minor(row.opening_balance), balance: minor(row.balance), ...dates(row), purchases: [], receipts: [],
  }))
  const references = new Set()
  const purchases = rowMap(source.purchases ?? [], 'purchases', (row, key) => {
    const supplier = suppliers.get(id(row.supplier_id))
    if (!supplier) throw new Error('purchase is missing its supplier')
    const total = minor(row.total_amount)
    const paid = minor(row.paid_amount)
    const status = paid === total ? 'paid' : paid > 0n ? 'partial' : 'unpaid'
    if (total <= 0n || paid + minor(row.remaining) !== total || row.status !== status
      || !['cash', 'credit'].includes(row.payment_type) || (row.payment_type === 'cash' && paid !== total)) {
      throw new Error('purchase amount, type or status conflicts with the recorded balance')
    }
    const purchase = {
      id: key, supplierId: supplier.id, reference: uniqueDocument(row, 'invoice_number', references),
      total, paid, type: row.payment_type, purchaseDate: day(row.purchase_date), notes: text(row.notes, 2000),
      ...dates(row), currentPaid: 0n, initialPaid: 0n, cashReceipt: null,
    }
    if (purchase.created_at < supplier.created_at) throw new Error('purchase predates its supplier')
    supplier.purchases.push(purchase)
    return purchase
  })
  const receiptNumbers = new Set()
  const receipts = rowMap(source.supplier_payments ?? [], 'supplier_payments', (row, key) => {
    const supplier = suppliers.get(id(row.supplier_id))
    if (!supplier) throw new Error('receipt is missing its supplier')
    const purchaseId = row.purchase_id == null ? null : id(row.purchase_id)
    const purchase = purchaseId === null ? null : purchases.get(purchaseId)
    if (purchaseId !== null && purchase?.supplierId !== supplier.id) throw new Error('receipt is linked to a missing purchase or another supplier')
    const amount = minor(row.amount)
    if (amount === 0n) throw new Error('receipt amount must be positive')
    const receipt = {
      id: key, supplierId: supplier.id, purchaseId, amount, number: uniqueDocument(row, 'receipt_number', receiptNumbers),
      paymentDate: day(row.payment_date), notes: text(row.notes, 2000), ...dates(row), openingApplied: 0n, allocations: [],
      cash: purchase?.type === 'cash',
    }
    if (receipt.created_at < supplier.created_at) throw new Error('receipt predates its supplier')
    if (receipt.cash) {
      if (purchase.cashReceipt || receipt.amount !== purchase.total || receipt.paymentDate !== purchase.purchaseDate
        || receipt.created_at < purchase.created_at || receipt.notes !== 'سداد فاتورة كاش ' + purchase.reference) {
        throw new Error('cash receipt does not match the source purchase and its generated receipt')
      }
      purchase.cashReceipt = receipt
    } else {
      supplier.receipts.push(receipt)
    }
    return receipt
  })

  for (const supplier of suppliers.values()) {
    try {
      const { opening, balance, purchases, receipts: fifoReceipts } = supplier
      const credit = purchases.filter(({ type }) => type === 'credit')
      const creditPaid = sum(credit, 'paid')
      // Laravel leaves the opening allocation implicit and may omit credit paid at purchase creation from its receipts.
      const openingApplied = opening + sum(purchases, 'total') - sum(purchases, 'paid') - balance
      const fifoAllocation = sum(fifoReceipts, 'amount') - openingApplied
      const initialPaid = creditPaid - fifoAllocation
      if (openingApplied < 0n || openingApplied > opening || fifoAllocation < 0n || initialPaid < 0n) {
        throw new Error('opening balance, purchases and receipts do not reconcile')
      }
      if (fifoAllocation === 0n) {
        for (const purchase of credit) purchase.initialPaid = purchase.paid
      } else if (initialPaid > 0n) {
        const funded = credit.filter(({ paid }) => paid > 0n)
        if (funded.length !== 1) throw new Error('unreceipted initial credit payments overlap FIFO across purchases without a unique allocation')
        funded[0].initialPaid = initialPaid
      }

      const purchaseTimes = new Set(credit.map(({ created_at }) => created_at))
      if (fifoReceipts.some(({ created_at }) => purchaseTimes.has(created_at))) {
        throw new Error('credit purchase and FIFO receipt share a creation timestamp without a reliable event order')
      }
      const { id, name, phone, address, notes, email, created_at, updated_at } = supplier
      commands.push(insert('suppliers', { id, name, phone, address, notes, email, opening_minor: opening, created_at, updated_at }))
      const events = [
        ...purchases.map((row) => ({ purchase: true, row })),
        ...fifoReceipts.map((row) => ({ purchase: false, row })),
      ].sort((left, right) => left.row.created_at.localeCompare(right.row.created_at) || left.row.id - right.row.id)
      const oldest = []
      let appliedToOpening = 0n
      for (const event of events) {
        const row = event.row
        if (event.purchase) {
          row.currentPaid = row.initialPaid
          commands.push(insert('purchases', {
            id: row.id, supplier_id: id, reference: row.reference, description: row.notes,
            total_minor: row.total, paid_minor: row.initialPaid, purchase_date: row.purchaseDate,
            actor_id: actor, created_at: row.created_at, payment_type: row.type,
            legacy_initial_paid_minor: row.initialPaid, legacy_updated_at: row.updated_at,
          }))
          if (row.type === 'cash') {
            if (!row.cashReceipt) throw new Error('fully paid cash purchase is missing its source receipt')
            commands.push(insert('supplier_payments', { ...receiptRow(row.cashReceipt, actor), purchase_id: row.id }))
            row.currentPaid = row.total
          } else {
            oldest.push(row)
            oldest.sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.id - b.id)
          }
          continue
        }
        let remaining = row.amount
        for (const purchase of oldest) {
          if (!remaining) break
          const due = purchase.total - purchase.currentPaid
          if (!due) continue
          const allocation = remaining < due ? remaining : due
          row.allocations.push({ purchaseId: purchase.id, amount: allocation })
          purchase.currentPaid += allocation
          remaining -= allocation
        }
        if ((row.allocations[0]?.purchaseId ?? null) !== row.purchaseId) {
          throw new Error(`receipt ID ${row.id} does not match the first reconstructed FIFO purchase`)
        }
        row.openingApplied = remaining
        appliedToOpening += remaining
        if (appliedToOpening > opening) throw new Error(`receipt ID ${row.id} exceeds the opening balance`)
        commands.push(insert('supplier_receipts', {
          ...receiptRow(row, actor), supplier_id: id, opening_applied_minor: remaining, legacy_first_purchase_id: row.purchaseId,
        }))
      }
      if (appliedToOpening !== openingApplied || purchases.some((purchase) => purchase.currentPaid !== purchase.paid)) {
        throw new Error('the source balances do not match the reconstructed receipt allocations')
      }
    } catch (error) {
      throw new Error(`Supplier ID ${supplier.id}: ${error.message}`)
    }
  }

  if (commands.length) {
    const lastId = [...suppliers.keys(), ...purchases.keys(), ...receipts.keys()].reduce((highest, key) => Math.max(highest, key), 0)
    const marker = 'historical-suppliers'
    commands.push(`INSERT INTO business_operations(id,actor_id,request_key,operation,fingerprint)
      SELECT ${lastId}, ${actor}, '${marker}', 'import.reserve', '${marker}'
      WHERE NOT EXISTS (SELECT 1 FROM business_operations WHERE id >= ${lastId});`)
  }
  return { commands, suppliers, purchases, receipts }
}

export function supplierHistorySql(source, actorId) {
  const { commands, suppliers, purchases, receipts } = plan(source, id(actorId))
  const supplierRows = [...suppliers.values()]
  const purchaseRows = [...purchases.values()]
  const receiptRows = [...receipts.values()]
  return {
    sql: commands.join('\n'),
    checks: {
      suppliers: suppliers.size, purchases: purchases.size, receipts: receipts.size,
      opening_minor: String(sum(supplierRows, 'opening')),
      balance_minor: String(sum(supplierRows, 'balance')),
      purchase_total_minor: String(sum(purchaseRows, 'total')),
      purchase_paid_minor: String(sum(purchaseRows, 'paid')),
      receipts_minor: String(sum(receiptRows, 'amount')),
      purchase_initial_paid_without_receipt_minor: String(sum(purchaseRows, 'initialPaid')),
      opening_applied_minor: String(sum(receiptRows, 'openingApplied')),
      fifo_allocations: receiptRows.reduce((total, row) => total + row.allocations.length, 0),
    },
  }
}

export function verifySupplierHistory(db, source, actorId) {
  const { suppliers, purchases, receipts } = plan(source, id(actorId))
  const assert = (valid, table) => {
    if (!valid) throw new Error(`Supplier migration mismatch in ${table}.`)
  }
  const actualSuppliers = db.prepare('SELECT id, opening_minor, balance_minor FROM supplier_balances').all()
  assert(actualSuppliers.length === suppliers.size && actualSuppliers.every(row => {
    const expected = suppliers.get(row.id)
    return expected && BigInt(row.opening_minor) === expected.opening && BigInt(row.balance_minor) === expected.balance
  }), 'supplier balances')
  const actualPurchases = db.prepare(`SELECT id, supplier_id, reference, total_minor, paid_minor, legacy_initial_paid_minor,
    purchase_date, payment_type, created_at, legacy_updated_at FROM purchases`).all()
  assert(actualPurchases.length === purchases.size && actualPurchases.every(row => {
    const expected = purchases.get(row.id)
    return expected && row.supplier_id === expected.supplierId && row.reference === expected.reference
      && BigInt(row.total_minor) === expected.total && BigInt(row.paid_minor) === expected.paid
      && row.legacy_initial_paid_minor !== null && BigInt(row.legacy_initial_paid_minor) === expected.initialPaid
      && row.purchase_date === expected.purchaseDate && row.payment_type === expected.type
      && row.created_at === expected.created_at && row.legacy_updated_at === expected.updated_at
  }), 'purchase balances')
  const actualReceipts = db.prepare(`SELECT id, legacy_receipt_number, amount_minor, payment_date, opening_applied_minor,
      supplier_id, legacy_first_purchase_id AS purchase_id, 0 AS cash, created_at, legacy_updated_at FROM supplier_receipts
    UNION ALL SELECT s.id, s.legacy_receipt_number, s.amount_minor, s.payment_date, 0,
      p.supplier_id, p.id, 1, s.created_at, s.legacy_updated_at FROM supplier_payments s JOIN purchases p ON p.id = s.purchase_id`).all()
  assert(actualReceipts.length === receipts.size && new Set(actualReceipts.map(row => row.id)).size === receipts.size
    && actualReceipts.every(row => {
      const expected = receipts.get(row.id)
      return expected && row.legacy_receipt_number === expected.number && BigInt(row.amount_minor) === expected.amount
        && row.payment_date === expected.paymentDate && row.supplier_id === expected.supplierId && row.purchase_id === expected.purchaseId
        && BigInt(row.opening_applied_minor) === expected.openingApplied && Boolean(row.cash) === expected.cash
        && row.created_at === expected.created_at && row.legacy_updated_at === expected.updated_at
    }), 'receipt amounts and source references')
  const actualAllocations = db.prepare('SELECT receipt_id, purchase_id, amount_minor FROM supplier_receipt_allocations').all()
  const expectedAllocations = new Map([...receipts.values()].flatMap(row =>
    row.allocations.map(allocation => [`${row.id}:${allocation.purchaseId}`, allocation.amount]),
  ))
  assert(actualAllocations.length === expectedAllocations.size && actualAllocations.every(row =>
    expectedAllocations.get(`${row.receipt_id}:${row.purchase_id}`) === BigInt(row.amount_minor),
  ), 'FIFO receipt allocations')
  return { suppliers: suppliers.size, purchases: purchases.size, supplier_payments: receipts.size }
}
