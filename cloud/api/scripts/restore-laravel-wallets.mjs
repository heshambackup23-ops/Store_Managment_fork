import { amountLimit, dateTime, day, id, integer, literal, minor, rowMap, text } from './laravel-finance-export.mjs'

export const walletRestoreTables = [
  'wallets', 'wallet_transactions', 'wallet_expenses', 'wallet_cash_adjustments', 'wallet_audit_logs',
]

const calendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
})
const transferKinds = new Set(['send', 'receive'])
const nonTransferKinds = new Set(['reversal', 'settlement', 'adjustment', 'profit_withdrawal'])
const cashKinds = new Set(['opening', 'owner_deposit', 'owner_withdraw', 'correction', 'profit_withdraw'])
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function requireValue(condition, message) {
  if (!condition) throw new Error(message)
}

function businessDay(at) {
  const parts = calendar.formatToParts(new Date(at))
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-')
}

function sqlTimestamp(at) {
  return at.slice(0, -1).replace('T', ' ')
}

function insert(table, row) {
  return `INSERT INTO ${table} (${Object.keys(row).join(', ')}) VALUES (${Object.values(row).map(literal).join(', ')});`
}

function source(table, sourceId, targetTable, targetId, details) {
  return insert('legacy_wallet_sources', {
    source_table: table, source_id: sourceId, target_table: targetTable, target_id: targetId,
    details_json: JSON.stringify(details),
  })
}

function validateTimestamp(value, timestamp, cutoff, required = true) {
  const at = timestamp(value)
  requireValue(at !== null || !required, 'source timestamp is required')
  requireValue(at === null || (typeof at === 'string' && dateTime(at) === at && at <= cutoff),
    'source timestamp is invalid or follows the snapshot cutoff')
  return at
}

const optionalId = value => value == null ? null : id(value)
const optionalMoney = value => value == null ? null : minor(value)
const limit = value => optionalMoney(value) || null
const asciiKey = value => value.replace(/[A-Z]/g, character => character.toLowerCase())

function walletRows(rows, at) {
  const names = new Set()
  return rowMap(rows, 'wallets', (row, key) => {
    const created = at(row.created_at)
    const updated = at(row.updated_at)
    requireValue(updated >= created, 'wallet updated_at precedes created_at')
    const name = text(row.name, 100)
    const provider = text(row.provider, 30)
    const phone = text(row.identifier, 64)
    const preferredName = name.trim() || [provider, phone].filter(Boolean).join(' - ') || 'محفظة #' + key
    let displayName = preferredName
    while (names.has(asciiKey(displayName))) displayName += ' #' + key
    names.add(asciiKey(displayName))
    const opening = minor(row.opening_balance ?? '0')
    const balance = minor(row.balance)
    const commission = optionalMoney(row.default_commission_percent) ?? 0n
    const fee = optionalMoney(row.default_fee_percent) ?? 0n
    const feeMin = optionalMoney(row.default_fee_min) ?? 0n
    const feeMax = optionalMoney(row.default_fee_max)
    requireValue(commission <= 10000n && fee <= 10000n && (feeMax === null || feeMax >= feeMin),
      'wallet default rates or fee limits are invalid')
    return {
      id: key, opening, balance, active: row.is_active == null ? 0 : integer(row.is_active, 0, 1),
      created, updated, sourceName: row.name ?? null,
      fields: {
        id: key, name: displayName, provider, phone, holder_name: text(row.holder_name, 100),
        notes: text(row.notes, 500), warn_at_percent: row.warn_at_percent == null ? 80 : integer(row.warn_at_percent, 1, 100),
        default_commission_bps: commission, default_commission_min_minor: optionalMoney(row.default_commission_min) ?? 0n,
        default_fee_bps: fee, default_fee_min_minor: feeMin, default_fee_max_minor: feeMax,
      },
      limits: {
        transaction_limit_minor: limit(row.per_transaction_limit), daily_send_limit_minor: limit(row.daily_send_limit),
        daily_receive_limit_minor: limit(row.daily_receive_limit), monthly_send_limit_minor: limit(row.monthly_send_limit),
        monthly_receive_limit_minor: limit(row.monthly_receive_limit),
      },
    }
  })
}

function sourceTransactions(rows, wallets, at) {
  const uuids = new Set()
  return rowMap(rows, 'wallet_transactions', (row, key) => {
    const wallet = wallets.get(id(row.wallet_id))
    requireValue(wallet, 'wallet is absent from the source')
    const atTime = at(row.occurred_at)
    const created = at(row.created_at, false)
    requireValue(atTime >= wallet.created, 'transaction predates the wallet')
    requireValue(uuidPattern.test(row.uuid ?? '') && !uuids.has(row.uuid.toLowerCase()), 'missing or duplicated transaction UUID')
    uuids.add(row.uuid.toLowerCase())
    const kind = row.type
    requireValue(transferKinds.has(kind) || nonTransferKinds.has(kind), 'unknown wallet transaction type')
    const status = row.status
    const method = row.payment_method
    const amount = minor(row.amount)
    const commission = minor(row.commission)
    const fee = minor(row.fee)
    const margin = minor(row.profit, true)
    const delta = minor(row.wallet_delta, true)
    const cash = minor(row.cash_delta, true)
    const after = minor(row.balance_after)
    const receivable = minor(row.receivable)
    const reverses = optionalId(row.reverses_id)
    const settles = optionalId(row.settles_id)
    const reversedAt = at(row.reversed_at, false)
    const settledAt = at(row.settled_at, false)
    const note = text(row.notes, 500)
    if (transferKinds.has(kind)) {
      requireValue(['completed', 'reversed'].includes(status) && amount > 0n && commission <= amount && fee <= amount
        && margin === commission - fee && !reverses && !settles, 'transfer amount, fees, status or references are invalid')
      requireValue((status === 'reversed') === Boolean(reversedAt), 'transfer reversal status and timestamp disagree')
      if (kind === 'send') {
        requireValue(['cash', 'deferred'].includes(method) && delta === -(amount + fee)
          && cash === (method === 'cash' ? amount + commission : 0n), 'send does not match wallet and drawer effects')
      } else {
        requireValue(method === 'cash' && delta === amount - fee && cash === -(amount - commission),
          'receive does not match wallet and drawer effects')
      }
      requireValue(method === 'deferred' || (receivable === 0n && !settledAt), 'cash transfer has deferred data')
    } else {
      requireValue(status === 'completed' && method === 'cash' && amount === 0n && commission === 0n && fee === 0n
        && margin === 0n && receivable === 0n && !reversedAt && !settledAt, 'non-transfer has incompatible financial fields')
      requireValue(Boolean(reverses) === (kind === 'reversal') && Boolean(settles) === (kind === 'settlement'),
        'non-transfer references do not match its type')
      if (kind === 'settlement') requireValue(delta === 0n && cash > 0n, 'settlement must only add cash')
      if (kind === 'adjustment') requireValue(delta !== 0n && cash === 0n && note.trim(), 'wallet correction needs amount and reason')
      if (kind === 'profit_withdrawal') requireValue(delta < 0n && cash === 0n, 'wallet profit withdrawal has incompatible effects')
    }
    return {
      id: key, walletId: wallet.id, kind, status, method, amount, commission, fee, margin, delta, cash, after, receivable,
      at: atTime, created, reverses, settles, reversedAt, settledAt, note,
      sourceUuid: row.uuid, sourceActor: optionalId(row.created_by), sourceActorName: text(row.created_by_name, 255),
      customerId: optionalId(row.customer_id), customerName: text(row.customer_name, 120),
      counterparty: text(row.counterparty, 64), reversedBy: optionalId(row.reversed_by),
      reversalReason: text(row.reversal_reason, 255),
    }
  })
}

function reconcileTransactions(wallets, transactions, customers) {
  const order = [...transactions.values()].sort((left, right) => left.id - right.id)
  const amounts = new Map([...wallets].map(([key, wallet]) => [key, wallet.opening]))
  const lastTimes = new Map()
  const reversals = new Map()
  const settlements = new Map()
  const customerNames = new Map()
  for (const [customerId, customer] of customers) {
    const key = text(customer.name, 255, true).trim().normalize('NFC')
    const matches = customerNames.get(key) ?? []
    matches.push(customerId)
    customerNames.set(key, matches)
  }
  for (const row of order) {
    const next = amounts.get(row.walletId) + row.delta
    requireValue(next === row.after && next >= 0n && next <= amountLimit,
      `Wallet transaction ID ${row.id} has a mismatched balance_after`)
    requireValue(row.at >= (lastTimes.get(row.walletId) ?? ''), `Wallet transaction ID ${row.id} has ambiguous posting order`)
    requireValue(row.customerId === null || customers.has(row.customerId), `Wallet transaction ID ${row.id} has a missing customer`)
    amounts.set(row.walletId, next)
    lastTimes.set(row.walletId, row.at)
    if (row.reverses !== null) {
      const original = transactions.get(row.reverses)
      requireValue(original && original.walletId === row.walletId && original.id < row.id && transferKinds.has(original.kind)
        && original.status === 'reversed' && original.reversedAt >= row.at && original.reversedAt >= original.at
        && row.delta === -original.delta && row.cash === -original.cash && !reversals.has(original.id),
      `Wallet reversal ID ${row.id} does not match its original`)
      reversals.set(original.id, row)
    }
    if (row.settles !== null) {
      const original = transactions.get(row.settles)
      requireValue(original && original.walletId === row.walletId && original.id < row.id
        && original.kind === 'send' && original.method === 'deferred' && original.status === 'completed'
        && row.customerId === original.customerId, `Wallet settlement ID ${row.id} does not match its deferred transfer`)
      const entries = settlements.get(original.id) ?? []
      entries.push(row)
      settlements.set(original.id, entries)
    }
  }
  const debts = new Map()
  for (const row of order.filter(row => transferKinds.has(row.kind))) {
    requireValue((row.status === 'reversed') === reversals.has(row.id), `Wallet transaction ID ${row.id} has no matching reversal`)
    if (row.method !== 'deferred') continue
    const inferred = customerNames.get(row.customerName.trim().normalize('NFC')) ?? []
    const customer = row.customerId ?? (inferred.length === 1 ? inferred[0] : null)
    requireValue(customer, `Deferred wallet transaction ID ${row.id} needs a source customer ID or unique name`)
    const principal = row.amount + row.commission
    const payments = settlements.get(row.id) ?? []
    const paid = payments.reduce((total, payment) => total + payment.cash, 0n)
    const voided = row.status === 'reversed'
    const paidAt = payments.at(-1)?.at
    const outstanding = voided ? 0n : principal - paid
    requireValue(principal <= amountLimit && paid <= principal && outstanding === row.receivable
      && (voided || (outstanding === 0n) === Boolean(row.settledAt))
      && (!row.settledAt || (paidAt && row.settledAt >= paidAt && outstanding === 0n && !voided))
      && (!voided || paid === 0n), `Deferred wallet transaction ID ${row.id} does not match its collections`)
    debts.set(row.id, { customer, principal, paid, voided })
  }
  for (const [key, wallet] of wallets) {
    requireValue(amounts.get(key) === wallet.balance, `Wallet ID ${key} balance does not match its opening and movements`)
  }
  return { order, debts }
}

function expenseRows(rows, at) {
  return rowMap(rows, 'wallet_expenses', (row, key) => {
    const amount = minor(row.amount)
    const spent = day(row.spent_on)
    const created = at(row.created_at)
    const voided = at(row.voided_at, false)
    const reason = text(row.void_reason, 255)
    requireValue(amount > 0n && (!voided || (voided >= created && reason.trim())), 'expense or void metadata is invalid')
    return {
      id: key, amount, spent, created, voided, reason, category: text(row.category, 60, true), note: text(row.note, 500),
      sourceActor: optionalId(row.created_by), sourceActorName: text(row.created_by_name, 255), voidedBy: optionalId(row.voided_by),
    }
  })
}

function cashRows(rows, at) {
  return rowMap(rows, 'wallet_cash_adjustments', (row, key) => {
    const kind = row.kind
    const amount = minor(row.amount, true)
    requireValue(cashKinds.has(kind) && amount !== 0n && (kind === 'correction'
      || (['opening', 'owner_deposit'].includes(kind) ? amount > 0n : amount < 0n)), 'cash entry amount or type is invalid')
    return {
      id: key, kind, amount, at: at(row.occurred_at), note: text(row.note, 500),
      sourceActor: optionalId(row.created_by), sourceActorName: text(row.created_by_name, 255),
    }
  })
}

function auditRows(rows, at) {
  return rowMap(rows, 'wallet_audit_logs', (row, key) => {
    const action = text(row.action, 60, true)
    requireValue(/^[a-z][a-z0-9_.-]*$/.test(action), 'wallet audit action is invalid')
    const meta = typeof row.meta === 'string' ? JSON.parse(text(row.meta, 32_768)) : row.meta ?? null
    requireValue(meta === null || (typeof meta === 'object' && JSON.stringify(meta).length <= 32_768), 'wallet audit details are invalid')
    return {
      id: key, action, at: at(row.created_at), subject: text(row.subject_type, 40),
      subjectId: optionalId(row.subject_id), sourceActor: optionalId(row.user_id), sourceActorName: text(row.user_name, 255), meta,
    }
  })
}

function provenance(row) {
  return { source_actor: row.sourceActor, source_actor_name: row.sourceActorName }
}

function rowDetails(row) {
  return {
    ...provenance(row), uuid: row.sourceUuid, source_type: row.kind, source_status: row.status, payment_method: row.method,
    original_balance_after_minor: String(row.after), occurred_at: row.at, source_created_at: row.created,
    customer_id: row.customerId, customer_name: row.customerName, settles_id: row.settles, reverses_id: row.reverses,
    reversed_at: row.reversedAt, reversed_by: row.reversedBy, reversal_reason: row.reversalReason, settled_at: row.settledAt,
  }
}

function totalCheck(value) {
  requireValue(value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER),
    'wallet aggregate exceeds the reporting range')
  return String(value)
}

export function walletRestore(tables, { actor: operator, cutoff, timestamp }) {
  const actor = id(operator)
  cutoff = dateTime(cutoff)
  for (const table of walletRestoreTables.slice(0, 4)) {
    requireValue(Array.isArray(tables[table]), `Wallet history requires the ${table} table, even when empty`)
  }
  const at = (value, required) => validateTimestamp(value, timestamp, cutoff, required)
  const wallets = walletRows(tables.wallets, at)
  const transactions = sourceTransactions(tables.wallet_transactions, wallets, at)
  const customers = rowMap(tables.customers ?? [], 'customers')
  const { order, debts } = reconcileTransactions(wallets, transactions, customers)
  const expenses = expenseRows(tables.wallet_expenses, at)
  const cash = cashRows(tables.wallet_cash_adjustments, at)
  const audits = auditRows(tables.wallet_audit_logs ?? [], at)
  requireValue([...cash.values()].filter(row => row.kind === 'opening').length <= 1,
    'Several original opening cash entries require review before mapping to the single D1 opening')
  let allocated = Math.max(0, ...[wallets, transactions, expenses, cash, audits].map(rows => (
    [...rows.keys()].reduce((largest, key) => Math.max(largest, key), 0)
  )))
  const syntheticId = () => id(++allocated)
  const commands = []
  let openings = 0
  for (const wallet of wallets.values()) {
    commands.push(insert('wallets', { ...wallet.fields, created_at: wallet.created, updated_at: wallet.updated }))
    if (wallet.opening > 0n) {
      commands.push(insert('wallet_transactions', {
        id: syntheticId(), wallet_id: wallet.id, kind: 'opening', amount_minor: wallet.opening, delta_minor: wallet.opening,
        business_day: businessDay(wallet.created), actor_id: actor, created_at: sqlTimestamp(wallet.created),
      }))
      openings++
    }
    commands.push(source('wallets', wallet.id, 'wallets', wallet.id, {
      original_name: wallet.sourceName, opening_minor: String(wallet.opening), closing_minor: String(wallet.balance),
    }))
  }
  const targetIds = new Map()
  const events = order.map(row => ({ at: row.at, order: 1, id: row.id, type: 'transaction', row }))
  for (const row of expenses.values()) {
    events.push({ at: row.created, order: 0, id: row.id, type: 'expense', row })
    if (row.voided) events.push({ at: row.voided, order: 2, id: row.id, type: 'expense-void', row })
  }
  for (const row of cash.values()) events.push({ at: row.at, order: 3, id: row.id, type: 'cash', row })
  events.sort((left, right) => left.at.localeCompare(right.at) || left.order - right.order || left.id - right.id)
  let withdrawals = 0
  let adjustments = 0
  let cashEntries = 0
  let collections = 0
  let voidedExpenses = 0
  for (const { type, row, at: eventAt } of events) {
    const created = sqlTimestamp(eventAt)
    const business = businessDay(eventAt)
    if (type === 'transaction') {
      const common = { id: row.id, wallet_id: row.walletId, actor_id: actor, created_at: created }
      let target = 'wallet_transactions'
      if (row.kind === 'settlement') {
        target = 'wallet_debt_payments'
        commands.push(insert(target, {
          id: row.id, wallet_debt_id: row.settles, amount_minor: row.cash, actor_id: actor, created_at: created,
        }))
        collections++
      } else if (row.kind === 'adjustment') {
        target = 'wallet_adjustments'
        commands.push(insert(target, { ...common, delta_minor: row.delta, reason: row.note, business_day: business }))
        adjustments++
      } else if (row.kind === 'profit_withdrawal') {
        target = 'wallet_profit_withdrawals'
        commands.push(insert(target, { ...common, amount_minor: -row.delta, business_day: business, note: row.note }))
        withdrawals++
      } else {
        const original = row.reverses === null ? row : transactions.get(row.reverses)
        commands.push(insert(target, {
          ...common, kind: row.kind, amount_minor: original.amount, commission_minor: original.commission, fee_minor: original.fee,
          delta_minor: row.delta, cash_delta_minor: row.cash, business_day: business, reversal_of: row.reverses,
          counterparty: row.counterparty, note: row.note,
        }))
        const debt = debts.get(row.id)
        if (debt) {
          commands.push(insert('wallet_debts', {
            id: row.id, wallet_transaction_id: row.id, customer_id: debt.customer, direction: 'receivable',
            principal_minor: debt.principal, created_at: created,
          }))
        }
      }
      targetIds.set('wallet_transaction:' + row.id, [target, row.id])
      commands.push(source('wallet_transactions', row.id, target, row.id, rowDetails(row)))
    } else if (type === 'expense') {
      commands.push(insert('wallet_cash_entries', {
        id: row.id, kind: 'expense', delta_minor: -row.amount, business_day: row.spent, category: row.category,
        note: row.note, actor_id: actor, created_at: created,
      }))
      targetIds.set('wallet_expense:' + row.id, ['wallet_cash_entries', row.id])
      commands.push(source('wallet_expenses', row.id, 'wallet_cash_entries', row.id, {
        ...provenance(row), voided_at: row.voided, voided_by: row.voidedBy, void_reason: row.reason,
      }))
      cashEntries++
    } else if (type === 'expense-void') {
      commands.push(insert('wallet_cash_entries', {
        id: syntheticId(), kind: 'expense_reversal', delta_minor: row.amount, business_day: business, category: row.category,
        note: row.reason, reversal_of: row.id, actor_id: actor, created_at: created,
      }))
      cashEntries++
      voidedExpenses++
    } else {
      const key = syntheticId()
      const target = row.kind === 'profit_withdraw' ? 'wallet_profit_withdrawals' : 'wallet_cash_entries'
      if (row.kind === 'profit_withdraw') {
        commands.push(insert(target, { id: key, amount_minor: -row.amount, business_day: business, note: row.note, actor_id: actor, created_at: created }))
        withdrawals++
      } else {
        commands.push(insert(target, { id: key, kind: row.kind, delta_minor: row.amount, business_day: business, note: row.note, actor_id: actor, created_at: created }))
        cashEntries++
      }
      targetIds.set('wallet_cash_adjustment:' + row.id, [target, key])
      commands.push(source('wallet_cash_adjustments', row.id, target, key, provenance(row)))
    }
  }
  for (const wallet of wallets.values()) {
    const fields = { ...wallet.limits, active: wallet.active, updated_at: wallet.updated }
    commands.push(`UPDATE wallets SET ${Object.entries(fields).map(([key, value]) => `${key} = ${literal(value)}`).join(', ')} WHERE id = ${wallet.id};`)
  }
  for (const row of audits.values()) {
    const match = targetIds.get(row.subject + ':' + row.subjectId)
    const entity = match?.[0] ?? (row.subject === 'wallet' && wallets.has(row.subjectId) ? 'wallet' : 'legacy_wallet_audit')
    const entityId = match?.[1] ?? (entity === 'wallet' ? row.subjectId : null)
    commands.push(insert('audit_logs', {
      actor_id: actor, action: 'wallet.legacy.' + row.action, entity_type: entity, entity_id: entityId, created_at: row.at,
    }))
    const details = literal(JSON.stringify({
      ...provenance(row), action: row.action, subject_type: row.subject, subject_id: row.subjectId, meta: row.meta,
    }))
    commands.push(`INSERT INTO legacy_wallet_sources (source_table, source_id, target_table, target_id, details_json)
      VALUES ('wallet_audit_logs', ${row.id}, 'audit_logs', last_insert_rowid(), ${details});`)
  }
  if (allocated > 0) {
    commands.push(`INSERT INTO business_operations(id,actor_id,request_key,operation,fingerprint)
      SELECT ${allocated}, ${actor}, 'historical-wallet-import', 'import.reserve', 'historical-wallet-import'
      WHERE NOT EXISTS (SELECT 1 FROM business_operations WHERE id >= ${allocated});`)
  }
  const provider = [...wallets.values()].reduce((sum, wallet) => sum + wallet.balance, 0n)
  const drawerAdjustments = [...cash.values()].reduce((sum, row) => sum + row.amount, 0n)
  const drawerExpenses = [...expenses.values()].reduce((sum, row) => sum + (row.voided ? 0n : row.amount), 0n)
  const drawer = order.reduce((sum, row) => sum + row.cash, drawerAdjustments) - drawerExpenses
  const receivables = order.reduce((sum, row) => sum + (row.status === 'completed' ? row.receivable : 0n), 0n)
  const margin = order.reduce((sum, row) => sum + (transferKinds.has(row.kind) && row.status === 'completed' ? row.margin : 0n), 0n)
  const withdrawn = order.reduce((sum, row) => sum - (row.kind === 'profit_withdrawal' ? row.delta : 0n), 0n)
    - [...cash.values()].reduce((sum, row) => sum + (row.kind === 'profit_withdraw' ? row.amount : 0n), 0n)
  const profit = margin - drawerExpenses - withdrawn
  const totals = {
    provider_balance_minor: provider, drawer_minor: drawer, receivables_minor: receivables,
    transfer_margin_minor: margin, drawer_expense_minor: drawerExpenses, profit_withdrawn_minor: withdrawn,
    profit_available_minor: profit, working_capital_minor: provider + drawer + receivables - profit,
  }
  return {
    sql: commands.join('\n'),
    checks: {
      totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, totalCheck(value)])),
      balances: [...wallets.values()].map(wallet => ({ id: wallet.id, balance_minor: String(wallet.balance), active: wallet.active })),
      debts: [...debts].map(([key, debt]) => ({ id: key, principal_minor: String(debt.principal), paid_minor: String(debt.paid), voided: debt.voided })),
      source_counts: Object.fromEntries(walletRestoreTables.map(table => [table, tables[table]?.length ?? 0])),
      destination_counts: {
        wallets: wallets.size, wallet_transactions: order.length - collections + openings, wallet_debts: debts.size,
        wallet_debt_payments: collections, wallet_cash_entries: cashEntries, wallet_profit_withdrawals: withdrawals,
        wallet_adjustments: adjustments, legacy_wallet_sources: wallets.size + transactions.size + expenses.size + cash.size + audits.size,
      },
      voided_expenses: voidedExpenses, wallet_audit_logs: audits.size,
    },
  }
}

export function assertWalletRestore(db, checks) {
  const totals = db.prepare('SELECT * FROM wallet_financial_totals').get()
  for (const [column, expected] of Object.entries(checks.totals)) {
    requireValue(String(totals[column]) === expected, `Restored wallet totals differ at ${column}`)
  }
  const wallets = db.prepare('SELECT id, balance_minor, active FROM wallets ORDER BY id').all()
  const debts = db.prepare('SELECT id, principal_minor, paid_minor, voided_at FROM wallet_debts ORDER BY id').all()
  const expectedWallets = new Map(checks.balances.map(row => [row.id, row]))
  const expectedDebts = new Map(checks.debts.map(row => [row.id, row]))
  for (const row of wallets) {
    const expected = expectedWallets.get(row.id)
    requireValue(expected?.balance_minor === String(row.balance_minor) && expected.active === row.active,
      `Restored wallet ID ${row.id} does not reconcile`)
  }
  for (const row of debts) {
    const expected = expectedDebts.get(row.id)
    requireValue(expected?.principal_minor === String(row.principal_minor) && expected.paid_minor === String(row.paid_minor)
      && expected.voided === Boolean(row.voided_at), `Restored wallet debt ID ${row.id} does not reconcile`)
  }
  for (const [table, expected] of Object.entries(checks.destination_counts)) {
    requireValue(db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count === expected,
      `Restored wallet counts differ at ${table}`)
  }
  requireValue(db.prepare("SELECT count(*) AS count FROM audit_logs WHERE action LIKE 'wallet.legacy.%'").get().count === checks.wallet_audit_logs,
    'Restored wallet audit count differs')
  return checks.destination_counts
}
