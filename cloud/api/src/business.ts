import { Hono } from 'hono';
import { z } from 'zod';
import { auditedWrite, body, fail, hasPermission, ok, permit, searchPrefix, selectPage, timestamp, type ApiContext, type ApiEnv } from './http';

export const businessPermissions = [
  'inventory.view', 'inventory.manage',
  'invoices.view', 'invoices.create', 'invoices.pay', 'invoices.refund',
  'installments.view', 'installments.manage', 'installments.pay',
  'debts.view', 'debts.manage', 'debts.pay',
  'suppliers.view', 'suppliers.manage', 'suppliers.pay',
  'wallets.view', 'wallets.manage', 'wallets.transact', 'wallets.reverse', 'wallets.cash',
  'damaged.view', 'damaged.manage',
  'maintenance.view', 'maintenance.manage', 'maintenance.pay',
  'reports.view',
];

export const business = new Hono<ApiEnv>();

type Bind = string | number | null;

const money = z.number().int().min(0).max(900_000_000_000_000);
const positiveMoney = money.min(1);
const id = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const quantity = z.number().int().min(1).max(1_000_000);
const name = z.string().trim().min(1).max(200);
const note = z.string().trim().max(1000);
const reason = z.string().trim().min(1).max(1000);
const phone = z.string().trim().max(50);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
});

function identifier(c: ApiContext) {
  return id.parse(Number(c.req.param('id')));
}

function list(c: ApiContext, columns: string, from: string, values: Bind[] = [], order = '1 DESC') {
  return selectPage(c, columns, from, '', values, order);
}

function businessError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const rules = [
    ['INSUFFICIENT_STOCK', 'المخزون غير كافٍ أو يتجاوز الحد المسموح.'],
    ['PAYMENT_EXCEEDS_BALANCE', 'المبلغ يتجاوز الرصيد المستحق أو أُغلقت العملية.'],
    ['USE_INSTALLMENT_PAYMENT', 'سدد هذا المبلغ من شاشة الأقساط المرتبطة بالفاتورة.'],
    ['INSTALLMENT_BALANCE_MISMATCH', 'بيانات القسط لا تطابق رصيد الفاتورة أو عميلها.'],
    ['INVOICE_NOT_REFUNDABLE', 'الفاتورة غير قابلة للاسترجاع.'],
    ['WALLET_BALANCE_OR_LIMIT', 'الرصيد أو حد المعاملة أو حالة المحفظة لا تسمح بالعملية.'],
    ['INVALID_WALLET_REVERSAL', 'لا يمكن عكس هذه الحركة.'],
    ['WALLET_DEBT_MISMATCH', 'الدين المؤجل لا يطابق مبلغ الحركة أو نوعها.'],
    ['WALLET_DEBT_SETTLED', 'حركة الدين المسددة تتطلب معالجة السداد قبل العكس.'],
    ['IMMUTABLE_LEDGER', 'سجل الحركات لا يسمح بالتعديل المباشر.'],
    ['UNIQUE constraint failed', 'يوجد سجل مطابق لهذه العملية.'],
    ['FOREIGN KEY constraint failed', 'السجل المرتبط غير موجود أو مرتبط بعمليات أخرى.'],
    ['NOT NULL constraint failed', 'السجل المرتبط غير متاح أو تغيّر إجمالي الفاتورة.'],
    ['CHECK constraint failed', 'بيانات العملية لا تتوافق مع الرصيد أو حالة السجل.'],
  ] as const;
  const match = rules.find(([tag]) => message.includes(tag));
  if (match) {
    const [tag, description] = match;
    const code = tag.includes('constraint') ? 'INVALID_BUSINESS_STATE' : tag;
    return fail(409, code, description);
  }
  throw error;
}

type Operation = { id: number; fingerprint: string };
type StatementFactory = (operationIdSql: string, operationIdBindings: Bind[], actor: number) => D1PreparedStatement[];

async function write(
  c: ApiContext, operation: string, payload: unknown, statements: StatementFactory,
  output = (id: number): Response | Promise<Response> => ok(c, { id }, 201),
) {
  const db = c.env.DB;
  const actor = c.get('actor').id;
  const requestKey = c.req.header('Idempotency-Key');
  if (!requestKey || !/^[A-Za-z0-9._:-]{8,100}$/.test(requestKey)) {
    return fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'يلزم مفتاح طلب صالح لإعادة المحاولة بأمان.');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([operation, payload])));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const lookup = 'FROM business_operations WHERE actor_id = ? AND request_key = ?';
  const operationId = '(SELECT id ' + lookup + ')';
  const bindings = [actor, requestKey];
  const read = () => db.prepare('SELECT id, fingerprint ' + lookup).bind(...bindings).first<Operation>();
  const respond = (existing: Operation) => {
    if (existing.fingerprint !== fingerprint) {
      return fail(409, 'IDEMPOTENCY_CONFLICT', 'استُخدم مفتاح الطلب مع بيانات مختلفة.');
    }
    return output(existing.id);
  };

  const existing = await read();
  if (existing) return respond(existing);
  let inserted: number;
  try {
    const [created] = await db.batch<{ id: number }>([
      db.prepare('INSERT INTO business_operations(actor_id, request_key, operation, fingerprint) VALUES (?, ?, ?, ?) RETURNING id')
        .bind(actor, requestKey, operation, fingerprint),
      ...statements(operationId, bindings, actor),
      db.prepare('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id) VALUES (?, ?, ?, ' + operationId + ')')
        .bind(actor, operation, 'business_operation', ...bindings),
    ]);
    const resultId = created.results[0]?.id;
    if (typeof resultId !== 'number') throw new Error('Missing business operation ID');
    inserted = resultId;
  } catch (error) {
    const concurrent = await read();
    if (concurrent) return respond(concurrent);
    return businessError(error);
  }
  return output(inserted);
}

business.get('/inventory/movements', permit('inventory.view'), c => {
  const product = c.req.query('product_id');
  const values = product ? [id.parse(Number(product))] : [];
  return list(c, 'm.*, p.name AS product_name',
    'inventory_movements m JOIN products p ON p.id = m.product_id' + (product ? ' WHERE m.product_id = ?' : ''),
    values, 'm.id DESC');
});

const adjustment = z.object({
  product_id: id,
  delta: z.number().int().min(-1_000_000_000).max(1_000_000_000).refine(value => value !== 0),
  note: reason,
}).strict();

business.post('/inventory/adjustments', permit('inventory.manage'), async c => {
  const data = await body(c, adjustment);
  return write(c, 'inventory.adjust', data, (op, binds, actor) => [
    c.env.DB.prepare('INSERT INTO inventory_movements (product_id, delta, source_type, source_id, note, actor_id) VALUES (?, ?, ?, ' + op + ', ?, ?)')
      .bind(data.product_id, data.delta, 'adjustment', ...binds, data.note, actor),
  ]);
});

const invoiceColumns = 'i.*, c.name AS customer_name, ins.id AS installment_id, replacement.id AS replacement_invoice_id';
const invoiceTables = `invoices i LEFT JOIN customers c ON c.id = i.customer_id
  LEFT JOIN installments ins ON ins.invoice_id = i.id AND ins.voided_at IS NULL
  LEFT JOIN invoices replacement ON replacement.replaces_invoice_id = i.id`;

business.get('/invoices', permit('invoices.view'), c => {
  const status = c.req.query('status');
  const customer = c.req.query('customer_id');
  const query = z.string().trim().max(100).parse(c.req.query('q') ?? '');
  const clauses: string[] = [];
  const values: Bind[] = [];
  if (status) {
    clauses.push('i.status = ?');
    values.push(z.enum(['open', 'paid', 'refunded']).parse(status));
  }
  if (customer) {
    clauses.push('i.customer_id = ?');
    values.push(id.parse(Number(customer)));
  }
  if (query) {
    const numeric = id.safeParse(Number(query));
    clauses.push(numeric.success ? 'i.id = ?' : "c.name LIKE ? ESCAPE '\\'");
    values.push(numeric.success ? numeric.data : searchPrefix(query));
  }
  return list(c, invoiceColumns, invoiceTables + (clauses.length ? ' WHERE ' + clauses.join(' AND ') : ''), values, 'i.id DESC');
});

business.get('/invoices/:id', permit('invoices.view'), async c => {
  const invoiceId = identifier(c);
  const db = c.env.DB;
  const [invoices, items, payments, refunds] = await db.batch([
    db.prepare(`SELECT ${invoiceColumns} FROM ${invoiceTables} WHERE i.id = ?`).bind(invoiceId),
    db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY product_id').bind(invoiceId),
    db.prepare('SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY id').bind(invoiceId),
    db.prepare('SELECT * FROM invoice_refunds WHERE invoice_id = ?').bind(invoiceId),
  ]);
  if (!invoices.results[0]) return fail(404, 'NOT_FOUND', 'الفاتورة غير موجودة.');
  return ok(c, { ...invoices.results[0], items: items.results, payments: payments.results, refund: refunds.results[0] ?? null });
});

const checkoutItems = z.array(z.object({ product_id: id, quantity }).strict()).min(1).max(40)
    .refine(items => new Set(items.map(item => item.product_id)).size === items.length);

const checkout = z.object({
  customer_id: id.nullish(),
  items: checkoutItems,
  paid_minor: money,
  expected_total_minor: money.optional(),
}).strict();

const checkoutProducts = `
  FROM json_each(?) AS j
  JOIN products p ON p.id = json_extract(j.value, '$.product_id') AND p.active = 1
`;

function refundStatement(db: D1Database, op: string, binds: Bind[], actor: number, invoiceId: number, refundReason: string) {
  return db.prepare(`
    INSERT INTO invoice_refunds (id, invoice_id, total_minor, returned_minor, reason, actor_id)
    VALUES (${op}, ?, (SELECT total_minor FROM invoices WHERE id = ?),
      (SELECT paid_minor FROM invoices WHERE id = ?), ?, ?)
  `).bind(...binds, invoiceId, invoiceId, invoiceId, refundReason, actor);
}

type OriginalInvoice = { id: number; reason: string };
type LegacyCheckout = { customer: string; receivedMinor: number | null };

function checkoutInvoice(c: ApiContext, data: z.infer<typeof checkout>, original?: OriginalInvoice, legacy?: LegacyCheckout) {
  const items = [...data.items].sort((a, b) => a.product_id - b.product_id);
  const serializedItems = JSON.stringify(items);
  const expected = data.expected_total_minor ?? null;
  const operation = legacy ? 'cashier.checkout' : original ? 'invoice.reissue' : 'invoice.checkout';
  return write(c, operation, { ...data, items, original, legacy }, (op, binds, actor) => {
    const db = c.env.DB;
    const customerSql = legacy?.customer
      ? '(SELECT id FROM customers WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1)'
      : '?';
    const paidSql = legacy ? 'MIN(COALESCE(?, total), total)' : '?';
    const statements = [
      db.prepare(`
        WITH basket AS (
          SELECT COUNT(*) AS product_count, SUM(p.price_minor * json_extract(j.value, '$.quantity')) AS total
          ${checkoutProducts}
        )
        INSERT INTO invoices (id, customer_id, total_minor, paid_minor, actor_id, replaces_invoice_id)
        SELECT ${op}, ${customerSql},
          CASE WHEN product_count = ? AND (? IS NULL OR total = ?) THEN total END,
          ${paidSql}, ?, ?
        FROM basket
      `).bind(serializedItems, ...binds, legacy?.customer || data.customer_id || null, items.length, expected, expected,
        legacy ? legacy.receivedMinor : data.paid_minor, actor, original?.id ?? null),
      db.prepare(`
        INSERT INTO invoice_items (invoice_id, product_id, product_name, quantity, unit_price_minor, unit_cost_minor)
        SELECT ${op}, p.id, p.name, json_extract(j.value, '$.quantity'), p.price_minor, p.cost_minor
        ${checkoutProducts}
      `).bind(...binds, serializedItems),
    ];
    if (original) statements.unshift(refundStatement(db, op, binds, actor, original.id, original.reason));
    if (legacy?.customer) {
      statements.unshift(db.prepare(`
        INSERT INTO customers (name)
        SELECT ? WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = ? COLLATE NOCASE)
      `).bind(legacy.customer, legacy.customer));
    }
    statements.push(db.prepare(`
      INSERT INTO invoice_payments (id, invoice_id, amount_minor, source_type, actor_id)
      SELECT id, id, paid_minor, 'checkout', ? FROM invoices WHERE id = ${op} AND paid_minor > 0
    `).bind(actor, ...binds));
    return statements;
  }, legacy ? invoiceId => legacyCheckoutResponse(c, invoiceId, legacy.receivedMinor) : undefined);
}

business.post('/invoices', permit('invoices.create'), async c => checkoutInvoice(c, await body(c, checkout)));

function moneyString(value: number) {
  const minor = BigInt(value);
  return String(minor / 100n) + '.' + String(minor % 100n).padStart(2, '0');
}

async function legacyCheckoutResponse(c: ApiContext, invoiceId: number, received: number | null) {
  const invoice = await c.env.DB.prepare(`
    SELECT i.total_minor, COALESCE(p.amount_minor, 0) AS checkout_paid_minor
    FROM invoices i LEFT JOIN invoice_payments p ON p.id = i.id AND p.source_type = 'checkout' WHERE i.id = ?
  `).bind(invoiceId).first<{ total_minor: number; checkout_paid_minor: number }>();
  if (!invoice) throw new Error('Missing checkout invoice');
  const { total_minor: total, checkout_paid_minor: paid } = invoice;
  return c.json({ data: {
    invoice_id: invoiceId,
    invoice_number: String(invoiceId),
    total: moneyString(total),
    paid: moneyString(paid),
    remaining: moneyString(total - paid),
    change: moneyString((received ?? total) - paid),
  } }, 201);
}

type CashierProduct = { id: number; name: string; price_minor: number; stock: number; barcode: string | null };
const cashierProducts = 'SELECT id, name, price_minor, stock, barcode FROM products WHERE active = 1';
const asCashierProduct = ({ price_minor, ...product }: CashierProduct) => ({ ...product, price: moneyString(price_minor) });

business.get('/cashier/products', permit('invoices.create'), async c => {
  const query = z.string().trim().max(100).parse(c.req.query('q') ?? '');
  const db = c.env.DB;
  if (!query) {
    const items = await db.prepare(cashierProducts + ' AND stock > 0 ORDER BY name, id LIMIT 12').all<CashierProduct>();
    return c.json({ exact: false, data: items.results.map(asCashierProduct) });
  }
  const exact = await db.prepare(cashierProducts + ' AND barcode = ?').bind(query).first<CashierProduct>();
  if (exact) return c.json({ exact: true, data: [asCashierProduct(exact)] });
  const items = await db.prepare(cashierProducts + " AND name LIKE ? ESCAPE '\\' ORDER BY stock = 0, name, id LIMIT 20")
    .bind(searchPrefix(query)).all<CashierProduct>();
  return c.json({ exact: false, data: items.results.map(asCashierProduct) });
});

const legacyReceived = z.string().trim().max(16)
  .transform(value => value.replace(/[٠-٩۰-۹]/g, digit => String(digit.charCodeAt(0) & 15)).replace('٫', '.'))
  .pipe(z.string().regex(/^\d{1,8}(?:\.\d{1,2})?$/))
  .transform(value => {
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  });

business.post('/cashier/checkout', permit('invoices.create'), async c => {
  const { customer, items, received } = await body(c, z.object({
    customer: z.string().trim().max(255).nullish(),
    items: checkoutItems,
    received: legacyReceived.nullish(),
  }).strict());
  return checkoutInvoice(c, { items, paid_minor: 0 }, undefined, {
    customer: customer?.replace(/\s+/gu, ' ') ?? '',
    receivedMinor: received ?? null,
  });
});

business.post('/invoices/:id/reissue', permit('invoices.create'), permit('invoices.refund'), async c => {
  const { reason: refundReason, ...data } = await body(c, checkout.extend({ reason }));
  return checkoutInvoice(c, data, { id: identifier(c), reason: refundReason });
});

business.post('/invoices/:id/refund', permit('invoices.refund'), async c => {
  const invoiceId = identifier(c);
  const data = await body(c, z.object({ reason }).strict());
  return write(c, 'invoice.refund', { invoiceId, ...data }, (op, binds, actor) => [
    refundStatement(c.env.DB, op, binds, actor, invoiceId, data.reason),
  ]);
});

business.get('/installments', permit('installments.view'), c =>
  list(c, 'i.*, c.name AS customer_name', 'installments i JOIN customers c ON c.id = i.customer_id', [], 'i.id DESC'));

const installment = z.object({
  customer_id: id,
  invoice_id: id.nullish(),
  principal_minor: positiveMoney,
  due_date: date,
  note: note.default(''),
}).strict();

business.post('/installments', permit('installments.manage'), async c => {
  const data = await body(c, installment);
  return write(c, 'installment.create', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO installments (id, customer_id, invoice_id, principal_minor, due_date, note, actor_id)
      VALUES (${op}, ?, ?, ?, ?, ?, ?)
    `).bind(...binds, data.customer_id, data.invoice_id ?? null, data.principal_minor, data.due_date, data.note, actor),
  ]);
});

business.patch('/installments/:id', permit('installments.manage'), async c => {
  const data = await body(c, z.object({ due_date: date, note: note.default('') }).strict());
  const installmentId = identifier(c);
  return change(c, 'installment.update', installmentId, `
    UPDATE installments SET due_date = ?, note = ?, updated_at = ${timestamp}
    WHERE id = ? AND voided_at IS NULL RETURNING *
  `, data.due_date, data.note, installmentId);
});

business.get('/debts', permit('debts.view'), c => list(c, '*', 'personal_debts'));

const debt = z.object({
  customer_id: id.nullish(),
  person_name: name,
  phone: phone.default(''),
  direction: z.enum(['receivable', 'payable']).default('receivable'),
  principal_minor: positiveMoney,
  due_date: date.nullish(),
  note: note.default(''),
}).strict();

business.post('/debts', permit('debts.manage'), async c => {
  const data = await body(c, debt);
  return write(c, 'debt.create', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO personal_debts (id, customer_id, person_name, phone, direction, principal_minor, due_date, note, actor_id)
      VALUES (${op}, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(...binds, data.customer_id ?? null, data.person_name, data.phone, data.direction,
      data.principal_minor, data.due_date ?? null, data.note, actor),
  ]);
});

business.patch('/debts/:id', permit('debts.manage'), async c => {
  const data = await body(c, debt.pick({ person_name: true, phone: true, due_date: true, note: true }).strict());
  const debtId = identifier(c);
  return change(c, 'debt.update', debtId, `
    UPDATE personal_debts SET person_name = ?, phone = ?, due_date = ?, note = ?, updated_at = ${timestamp}
    WHERE id = ? RETURNING *
  `, data.person_name, data.phone, data.due_date ?? null, data.note, debtId);
});

async function change(c: ApiContext, action: string, id: number, sql: string, ...values: Bind[]) {
  try {
    const result = await auditedWrite(c, c.env.DB.prepare(sql).bind(...values), action, action.split('.')[0], id);
    if (!result.results[0]) return fail(404, 'NOT_FOUND', 'السجل المطلوب غير موجود أو لا يمكن تعديله.');
    return ok(c, result.results[0]);
  } catch (error) {
    return businessError(error);
  }
}

const supplier = z.object({
  name,
  phone: phone.default(''),
  address: note.default(''),
  notes: note.default(''),
}).strict();

business.get('/suppliers', permit('suppliers.view'), c => list(c, '*', 'suppliers'));

business.post('/suppliers', permit('suppliers.manage'), async c => {
  const data = await body(c, supplier);
  return write(c, 'supplier.create', data, (op, binds) => [
    c.env.DB.prepare('INSERT INTO suppliers (id, name, phone, address, notes) VALUES (' + op + ', ?, ?, ?, ?)')
      .bind(...binds, data.name, data.phone, data.address, data.notes),
  ]);
});

business.patch('/suppliers/:id', permit('suppliers.manage'), async c => {
  const data = await body(c, supplier.extend({ active: z.boolean() }));
  const supplierId = identifier(c);
  return change(c, 'supplier.update', supplierId, `
    UPDATE suppliers SET name = ?, phone = ?, address = ?, notes = ?, active = ?, updated_at = ${timestamp}
    WHERE id = ? RETURNING *
  `, data.name, data.phone, data.address, data.notes, Number(data.active), supplierId);
});

business.get('/purchases', permit('suppliers.view'), c => {
  const supplierId = c.req.query('supplier_id');
  return list(c, 'p.*, s.name AS supplier_name',
    'purchases p JOIN suppliers s ON s.id = p.supplier_id' + (supplierId ? ' WHERE p.supplier_id = ?' : ''),
    supplierId ? [id.parse(Number(supplierId))] : [], 'p.id DESC');
});

const purchase = z.object({
  supplier_id: id,
  reference: z.string().trim().min(1).max(100).nullish(),
  description: reason,
  total_minor: positiveMoney,
  purchase_date: date,
}).strict();

business.post('/purchases', permit('suppliers.manage'), async c => {
  const data = await body(c, purchase);
  return write(c, 'purchase.create', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO purchases (id, supplier_id, reference, description, total_minor, purchase_date, actor_id)
      VALUES (${op}, (SELECT id FROM suppliers WHERE id = ? AND active = 1), ?, ?, ?, ?, ?)
    `).bind(...binds, data.supplier_id, data.reference ?? null, data.description, data.total_minor, data.purchase_date, actor),
  ]);
});

const wallet = z.object({
  name,
  provider: z.string().trim().max(150).default(''),
  phone: phone.default(''),
  transaction_limit_minor: positiveMoney.nullish(),
  daily_send_limit_minor: positiveMoney.nullish(),
  daily_receive_limit_minor: positiveMoney.nullish(),
  monthly_send_limit_minor: positiveMoney.nullish(),
  monthly_receive_limit_minor: positiveMoney.nullish(),
}).strict();

function walletLimits(data: z.infer<typeof wallet>) {
  return [data.transaction_limit_minor, data.daily_send_limit_minor, data.daily_receive_limit_minor,
    data.monthly_send_limit_minor, data.monthly_receive_limit_minor].map(limit => limit ?? null);
}

const cairoCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
});
function cairoDay() {
  const parts = cairoCalendar.formatToParts(new Date());
  return ['year', 'month', 'day'].map(part => parts.find(value => value.type === part)?.value).join('-');
}

business.get('/wallets', permit('wallets.view'), c => list(c, '*', 'wallets'));

business.post('/wallets', permit('wallets.manage'), async c => {
  const data = await body(c, wallet.extend({ opening_minor: money.default(0) }));
  if (data.opening_minor > 0 && !hasPermission(c.get('actor'), 'wallets.transact')) {
    return fail(403, 'FORBIDDEN', 'تسجيل رصيد الافتتاح يتطلب صلاحية عمليات المحفظة.');
  }
  return write(c, 'wallet.create', data, (op, binds, actor) => {
    const db = c.env.DB;
    const statements = [
      db.prepare(`
        INSERT INTO wallets (id, name, provider, phone, transaction_limit_minor,
          daily_send_limit_minor, daily_receive_limit_minor, monthly_send_limit_minor, monthly_receive_limit_minor)
        VALUES (${op}, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(...binds, data.name, data.provider, data.phone, ...walletLimits(data)),
    ];
    if (data.opening_minor > 0) {
      statements.push(db.prepare(`
        INSERT INTO wallet_transactions (id, wallet_id, kind, amount_minor, delta_minor, actor_id)
        VALUES (${op}, ${op}, 'opening', ?, ?, ?)
      `).bind(...binds, ...binds, data.opening_minor, data.opening_minor, actor));
    }
    return statements;
  });
});

business.patch('/wallets/:id', permit('wallets.manage'), async c => {
  const data = await body(c, wallet.extend({ active: z.boolean() }));
  const walletId = identifier(c);
  return change(c, 'wallet.update', walletId, `
    UPDATE wallets SET name = ?, provider = ?, phone = ?, transaction_limit_minor = ?,
      daily_send_limit_minor = ?, daily_receive_limit_minor = ?, monthly_send_limit_minor = ?,
      monthly_receive_limit_minor = ?, active = ?, updated_at = ${timestamp}
    WHERE id = ? RETURNING *
  `, data.name, data.provider, data.phone, ...walletLimits(data), Number(data.active), walletId);
});

business.get('/wallet-transactions', permit('wallets.view'), c => {
  const walletId = c.req.query('wallet_id');
  return list(c, 't.*, w.name AS wallet_name, r.id AS reversed_by, d.id AS wallet_debt_id',
    `wallet_transactions t JOIN wallets w ON w.id = t.wallet_id
      LEFT JOIN wallet_transactions r ON r.reversal_of = t.id
      LEFT JOIN wallet_debts d ON d.wallet_transaction_id = t.id` + (walletId ? ' WHERE t.wallet_id = ?' : ''),
    walletId ? [id.parse(Number(walletId))] : [], 't.id DESC');
});

const walletTransaction = z.object({
  kind: z.enum(['receive', 'send', 'expense', 'settlement_in', 'settlement_out']),
  amount_minor: positiveMoney,
  commission_minor: money.default(0),
  fee_minor: money.default(0),
  note: note.default(''),
  deferred: z.object({ customer_id: id, principal_minor: positiveMoney, due_date: date.nullish() }).strict().optional(),
}).strict().refine(data => {
  const transfer = data.kind === 'send' || data.kind === 'receive';
  if (!transfer) return data.fee_minor === 0 && data.commission_minor === 0 && !data.deferred && data.note.length > 0;
  if (data.fee_minor > data.amount_minor || data.commission_minor > data.amount_minor) return false;
  if (data.kind === 'receive') return !data.deferred;
  const owed = data.amount_minor + data.commission_minor;
  return owed <= 900_000_000_000_000 && data.amount_minor + data.fee_minor <= 900_000_000_000_000
    && (!data.deferred || data.deferred.principal_minor === owed);
}, { message: 'العمولة أو الدين غير صالح لهذه الحركة.' });

business.post('/wallets/:id/transactions', permit('wallets.transact'), async c => {
  const walletId = identifier(c);
  const data = await body(c, walletTransaction);
  const receive = data.kind === 'receive';
  const send = data.kind === 'send';
  const delta = receive || data.kind === 'settlement_in' ? data.amount_minor - data.fee_minor : -(data.amount_minor + data.fee_minor);
  const cash = receive ? -(data.amount_minor - data.commission_minor)
    : send && !data.deferred ? data.amount_minor + data.commission_minor : 0;
  return write(c, 'wallet.transaction', { walletId, ...data }, (op, binds, actor) => {
    const db = c.env.DB;
    const statements = [
      db.prepare(`
        INSERT INTO wallet_transactions (id, wallet_id, kind, amount_minor, commission_minor, fee_minor,
          delta_minor, cash_delta_minor, business_day, note, actor_id)
        VALUES (${op}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(...binds, walletId, data.kind, data.amount_minor, data.commission_minor, data.fee_minor,
        delta, cash, cairoDay(), data.note, actor),
    ];
    if (data.deferred) {
      statements.push(db.prepare(`
        INSERT INTO wallet_debts (id, wallet_transaction_id, customer_id, direction, principal_minor, due_date)
        VALUES (${op}, ${op}, ?, ?, ?, ?)
      `).bind(...binds, ...binds, data.deferred.customer_id, 'receivable',
        data.deferred.principal_minor, data.deferred.due_date ?? null));
    }
    return statements;
  });
});

business.post('/wallet-transactions/:id/reverse', permit('wallets.reverse'), async c => {
  const transactionId = identifier(c);
  const data = await body(c, z.object({ reason }).strict());
  return write(c, 'wallet.reverse', { transactionId, ...data }, (op, binds, actor) => [
    c.env.DB.prepare(`
      WITH original AS (SELECT * FROM wallet_transactions WHERE id = ?)
      INSERT INTO wallet_transactions (id, wallet_id, kind, amount_minor, commission_minor, fee_minor,
        delta_minor, cash_delta_minor, business_day, reversal_of, note, actor_id)
      VALUES (${op}, (SELECT wallet_id FROM original), 'reversal', (SELECT amount_minor FROM original),
        (SELECT commission_minor FROM original), (SELECT fee_minor FROM original), (SELECT -delta_minor FROM original),
        (SELECT -cash_delta_minor FROM original), ?, ?, ?, ?)
    `).bind(transactionId, ...binds, cairoDay(), transactionId, data.reason, actor),
  ]);
});

business.get('/wallet-debts', permit('wallets.view'), c =>
  list(c, 'd.*, c.name AS customer_name', 'wallet_debts d JOIN customers c ON c.id = d.customer_id', [], 'd.id DESC'));

business.get('/wallet-cash', permit('wallets.cash'), c =>
  list(c, 'e.*, r.id AS reversed_by',
    'wallet_cash_entries e LEFT JOIN wallet_cash_entries r ON r.reversal_of = e.id', [], 'e.id DESC'));

const cashEntry = z.object({
  kind: z.enum(['opening', 'owner_deposit', 'owner_withdraw', 'correction', 'expense']),
  amount_minor: z.number().int().min(-900_000_000_000_000).max(900_000_000_000_000),
  category: name.optional(),
  business_day: date.optional(),
  note: reason,
}).strict().refine(data => {
  if (data.kind === 'correction') return data.amount_minor !== 0;
  return data.amount_minor > 0 && (data.kind !== 'expense' || Boolean(data.category));
});

business.post('/wallet-cash', permit('wallets.cash'), async c => {
  const data = await body(c, cashEntry);
  const day = cairoDay();
  const entryDate = data.business_day ?? day;
  if (entryDate > day) return fail(400, 'INVALID_CASH_DATE', 'تاريخ القيد لا يمكن أن يكون في المستقبل.');
  const delta = data.kind === 'owner_withdraw' || data.kind === 'expense' ? -data.amount_minor : data.amount_minor;
  return write(c, 'wallet.cash', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO wallet_cash_entries (id, kind, delta_minor, business_day, category, note, actor_id)
      VALUES (${op}, ?, ?, ?, ?, ?, ?)
    `).bind(...binds, data.kind, delta, entryDate, data.category ?? '', data.note, actor),
  ]);
});

business.post('/wallet-cash/:id/reverse', permit('wallets.reverse'), async c => {
  if (!hasPermission(c.get('actor'), 'wallets.cash')) {
    return fail(403, 'FORBIDDEN', 'عكس مصروف الدرج يتطلب صلاحية حركات النقدية.');
  }
  const expenseId = identifier(c);
  const data = await body(c, z.object({ reason }).strict());
  return write(c, 'wallet.expense.reverse', { expenseId, ...data }, (op, binds, actor) => [
    c.env.DB.prepare(`
      WITH original AS (SELECT * FROM wallet_cash_entries WHERE id = ? AND kind = 'expense')
      INSERT INTO wallet_cash_entries (id, kind, delta_minor, business_day, category, note, reversal_of, actor_id)
      VALUES (${op}, 'expense_reversal', (SELECT -delta_minor FROM original), ?,
        (SELECT category FROM original), ?, ?, ?)
    `).bind(expenseId, ...binds, cairoDay(), data.reason, expenseId, actor),
  ]);
});

business.get('/reports/wallets', permit('wallets.cash'), async c => {
  const db = c.env.DB;
  const report = await db.prepare(`
    WITH cash AS (
      SELECT COALESCE(SUM(cash_delta_minor), 0) AS delta FROM wallet_transactions
      UNION ALL SELECT COALESCE(SUM(amount_minor), 0) FROM wallet_debt_payments
      UNION ALL SELECT COALESCE(SUM(delta_minor), 0) FROM wallet_cash_entries
    )
    SELECT (SELECT SUM(delta) FROM cash) AS drawer_minor,
      (SELECT COALESCE(SUM(balance_minor), 0) FROM wallets) AS provider_balance_minor,
      (SELECT COALESCE(SUM(principal_minor - paid_minor), 0) FROM wallet_debts WHERE voided_at IS NULL) AS receivables_minor,
      (SELECT COALESCE(SUM(t.commission_minor - t.fee_minor), 0)
        FROM wallet_transactions t WHERE t.kind IN ('send', 'receive')
          AND NOT EXISTS (SELECT 1 FROM wallet_transactions r WHERE r.reversal_of = t.id)) AS transfer_margin_minor,
      (SELECT COALESCE(SUM(-delta_minor), 0) FROM wallet_cash_entries WHERE kind IN ('expense', 'expense_reversal')) AS drawer_expense_minor
  `).first();
  return ok(c, report);
});

business.get('/damaged', permit('damaged.view'), c =>
  list(c, 'd.*, p.name AS product_name, r.id AS reversed_by, r.reason AS reversal_reason',
    `damaged_stock d JOIN products p ON p.id = d.product_id
      LEFT JOIN damaged_stock_reversals r ON r.damage_id = d.id`, [], 'd.id DESC'));

business.post('/damaged', permit('damaged.manage'), async c => {
  const data = await body(c, z.object({ product_id: id, quantity, reason }).strict());
  return write(c, 'damage.create', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO damaged_stock (id, product_id, quantity, unit_cost_minor, reason, actor_id)
      VALUES (${op}, ?, ?, (SELECT cost_minor FROM products WHERE id = ?), ?, ?)
    `).bind(...binds, data.product_id, data.quantity, data.product_id, data.reason, actor),
  ]);
});

business.post('/damaged/:id/reverse', permit('damaged.manage'), async c => {
  const damageId = identifier(c);
  const data = await body(c, z.object({ reason }).strict());
  return write(c, 'damage.reverse', { damageId, ...data }, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO damaged_stock_reversals (id, damage_id, reason, actor_id) VALUES (${op}, ?, ?, ?)
    `).bind(...binds, damageId, data.reason, actor),
  ]);
});

const maintenance = z.object({
  customer_id: id.nullish(),
  customer_name: name,
  phone: phone.default(''),
  item: name,
  problem: reason,
  address: note.default(''),
  requested_date: date.optional(),
  price_minor: money.default(0),
  notes: note.default(''),
}).strict();

business.get('/maintenance', permit('maintenance.view'), c => list(c, '*', 'maintenance_requests'));

business.post('/maintenance', permit('maintenance.manage'), async c => {
  const data = await body(c, maintenance);
  return write(c, 'maintenance.create', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO maintenance_requests (id, customer_id, customer_name, phone, item, problem,
        address, requested_date, price_minor, notes, actor_id)
      VALUES (${op}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(...binds, data.customer_id ?? null, data.customer_name, data.phone, data.item, data.problem,
      data.address, data.requested_date ?? cairoDay(), data.price_minor, data.notes, actor),
  ]);
});

business.patch('/maintenance/:id', permit('maintenance.manage'), async c => {
  const data = await body(c, maintenance.extend({
    status: z.enum(['received', 'in_progress', 'completed', 'delivered', 'cancelled']),
  }));
  const db = c.env.DB;
  const maintenanceId = identifier(c);
  try {
    const statement = db.prepare(`
      UPDATE maintenance_requests SET customer_id = ?, customer_name = ?, phone = ?, item = ?, problem = ?,
        address = ?, requested_date = COALESCE(?, requested_date), price_minor = ?, notes = ?,
        completed_date = CASE WHEN status = 'in_progress' AND ? = 'completed' THEN ? ELSE completed_date END,
        status = ?, updated_at = ${timestamp}
      WHERE id = ? AND status NOT IN ('delivered', 'cancelled')
        AND (status = ? OR ? = 'cancelled' OR (status = 'received' AND ? = 'in_progress')
          OR (status = 'in_progress' AND ? = 'completed') OR (status = 'completed' AND ? = 'delivered'))
      RETURNING *
    `).bind(data.customer_id ?? null, data.customer_name, data.phone, data.item, data.problem,
      data.address, data.requested_date ?? null, data.price_minor, data.notes, data.status, cairoDay(), data.status,
      maintenanceId, data.status, data.status, data.status, data.status, data.status);
    const result = await auditedWrite(c, statement, 'maintenance.update', 'maintenance', maintenanceId);
    if (!result.results[0]) return fail(409, 'INVALID_MAINTENANCE_TRANSITION', 'حالة طلب الصيانة لا تسمح بالتعديل أو الانتقال المطلوب.');
    return ok(c, result.results[0]);
  } catch (error) {
    return businessError(error);
  }
});

const paymentEndpoints = [
  { path: '/invoices', permission: 'invoices.pay', table: 'invoice_payments', foreignKey: 'invoice_id', fields: ", source_type", values: ", 'payment'" },
  { path: '/installments', permission: 'installments.pay', table: 'installment_payments', foreignKey: 'installment_id' },
  { path: '/debts', permission: 'debts.pay', table: 'personal_debt_payments', foreignKey: 'debt_id' },
  { path: '/purchases', permission: 'suppliers.pay', table: 'supplier_payments', foreignKey: 'purchase_id', hasNote: true },
  { path: '/wallet-debts', permission: 'wallets.transact', table: 'wallet_debt_payments', foreignKey: 'wallet_debt_id' },
  { path: '/maintenance', permission: 'maintenance.pay', table: 'maintenance_payments', foreignKey: 'maintenance_id' },
];

const paymentBody = z.object({ amount_minor: positiveMoney }).strict();
for (const endpoint of paymentEndpoints) {
  business.post(endpoint.path + '/:id/payments', permit(endpoint.permission), async c => {
    const relatedId = identifier(c);
    const data = await body(c, endpoint.hasNote ? paymentBody.extend({ note: note.default('') }) : paymentBody);
    const withNote = 'note' in data ? String(data.note) : null;
    const fields = (endpoint.fields ?? '') + (endpoint.hasNote ? ', note' : '');
    const placeholders = (endpoint.values ?? '') + (endpoint.hasNote ? ', ?' : '');
    return write(c, endpoint.table + '.create', { relatedId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`
        INSERT INTO ${endpoint.table} (id, ${endpoint.foreignKey}, amount_minor, actor_id${fields})
        VALUES (${op}, ?, ?, ?${placeholders})
      `).bind(...binds, relatedId, data.amount_minor, actor, ...(endpoint.hasNote ? [withNote] : [])),
    ]);
  });
}

const businessDetails = [
  { path: '/installments', permission: 'installments.view', table: 'installments', ledger: 'installment_payments', foreignKey: 'installment_id' },
  { path: '/debts', permission: 'debts.view', table: 'personal_debts', ledger: 'personal_debt_payments', foreignKey: 'debt_id' },
  { path: '/purchases', permission: 'suppliers.view', table: 'purchases', ledger: 'supplier_payments', foreignKey: 'purchase_id' },
  { path: '/wallet-debts', permission: 'wallets.view', table: 'wallet_debts', ledger: 'wallet_debt_payments', foreignKey: 'wallet_debt_id' },
  { path: '/maintenance', permission: 'maintenance.view', table: 'maintenance_requests', ledger: 'maintenance_payments', foreignKey: 'maintenance_id' },
];
for (const detail of businessDetails) {
  business.get(detail.path + '/:id', permit(detail.permission), async c => {
    const idValue = identifier(c);
    const db = c.env.DB;
    const [entity, ledger] = await db.batch([
      db.prepare(`SELECT * FROM ${detail.table} WHERE id = ?`).bind(idValue),
      db.prepare(`SELECT * FROM ${detail.ledger} WHERE ${detail.foreignKey} = ? ORDER BY id DESC LIMIT 100`).bind(idValue),
    ]);
    if (!entity.results[0]) return fail(404, 'NOT_FOUND', 'السجل المطلوب غير موجود.');
    return ok(c, { ...entity.results[0], payments: ledger.results });
  });
}

business.get('/reports/sales', permit('reports.view'), async c => {
  const today = new Date();
  const prior = new Date(today.valueOf() - 29 * 86_400_000);
  const from = date.parse(c.req.query('from') ?? prior.toISOString().slice(0, 10));
  const to = date.parse(c.req.query('to') ?? today.toISOString().slice(0, 10));
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days < 0 || days > 365) return fail(400, 'INVALID_REPORT_DATES', 'اختر فترة تقرير لا تتجاوز 366 يومًا.');
  const db = c.env.DB;
  const bounds = [from, to, from, to, from, to];
  const daily = await db.prepare(`
    WITH events AS (
      SELECT date(created_at) AS day, 1 AS invoices, 0 AS refunds, total_minor AS gross_minor,
        0 AS refunded_minor, 0 AS cash_received_minor, 0 AS cash_returned_minor FROM invoices
      WHERE created_at >= ? AND created_at < date(?, '+1 day')
      UNION ALL
      SELECT date(created_at), 0, 1, 0, total_minor, 0, returned_minor FROM invoice_refunds
      WHERE created_at >= ? AND created_at < date(?, '+1 day')
      UNION ALL
      SELECT date(created_at), 0, 0, 0, 0, amount_minor, 0 FROM invoice_payments
      WHERE created_at >= ? AND created_at < date(?, '+1 day')
    )
    SELECT day, SUM(invoices) AS invoices, SUM(refunds) AS refunds, SUM(gross_minor) AS gross_minor,
      SUM(refunded_minor) AS refunded_minor, SUM(gross_minor - refunded_minor) AS net_minor,
      SUM(cash_received_minor) AS cash_received_minor, SUM(cash_returned_minor) AS cash_returned_minor
    FROM events GROUP BY day ORDER BY day DESC
  `).bind(...bounds).all();
  return ok(c, { from, to, timezone: 'UTC', days: daily.results });
});

business.get('/reports/suppliers', permit('suppliers.view'), c =>
  list(c, 'id, name, active, total_minor, paid_minor, total_minor - paid_minor AS due_minor',
    `(SELECT s.id, s.name, s.active, COALESCE(SUM(p.total_minor), 0) AS total_minor,
      COALESCE(SUM(p.paid_minor), 0) AS paid_minor
      FROM suppliers s LEFT JOIN purchases p ON p.supplier_id = s.id GROUP BY s.id)`));
