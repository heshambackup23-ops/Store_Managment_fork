import { Hono } from 'hono';
import { z } from 'zod';
import { imageType } from './catalog';
import { auditedWrite, body, fail, hasPermission, ok, page, paginated, permit, readBytes, searchPrefix, selectPage, timestamp, type ApiContext, type ApiEnv } from './http';
import { purchaseReceiving } from './purchase-receiving';
import { walletReporting } from './wallet-reporting';

export const businessPermissions = [
  'inventory.view', 'inventory.manage',
  'invoices.view', 'invoices.create', 'invoices.pay', 'invoices.refund',
  'installments.view', 'installments.manage', 'installments.pay',
  'debts.view', 'debts.manage', 'debts.pay',
  'suppliers.view', 'suppliers.manage', 'suppliers.pay',
  'wallets.view', 'wallets.manage', 'wallets.transact', 'wallets.reverse', 'wallets.cash', 'wallets.profit',
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

function filterPeriod(c: ApiContext, column: string, predicates: string[], values: Bind[]) {
  const from = date.optional().parse(c.req.query('from'));
  const to = date.optional().parse(c.req.query('to'));
  if (from && to && from > to) return fail(400, 'INVALID_REPORT_DATES', 'تاريخ بداية الفترة يأتي بعد نهايتها.');
  if (from) {
    predicates.push(column + ' >= ?');
    values.push(from);
  }
  if (to) {
    predicates.push(column + ' <= ?');
    values.push(to);
  }
  return { from: from ?? null, to: to ?? null };
}

function where(predicates: string[]) {
  return predicates.length > 0 ? ' WHERE ' + predicates.join(' AND ') : '';
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
    ['SUPPLIER_OPENING_PAID', 'الرصيد الافتتاحي الجديد أقل من المبالغ التي سُددت منه.'],
    ['HAS_FINANCIAL_HISTORY', 'لا يمكن إلغاء سجل مرتبط بفاتورة أو بدفعات سابقة.'],
    ['RECORD_VOIDED', 'لا يمكن تعديل سجل ملغى أو إضافة دفعة إليه.'],
    ['PROFIT_OR_SOURCE_BALANCE', 'الأرباح المتاحة أو رصيد المصدر لا يكفي لإجراء السحب.'],
    ['BUSINESS_IMAGE_CAPACITY', 'بلغ هذا القسم الحد الأقصى لعدد الصور التجريبية.'],
    ['PURCHASE_PRODUCT_UNAVAILABLE', 'أحد منتجات الاستلام غير متاح.'],
    ['PURCHASE_RECEIPT_EMPTY', 'سند الاستلام لا يحتوي على أصناف.'],
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

export async function write(
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

const invoiceColumns = `i.*, COALESCE(i.invoice_date, date(i.created_at)) AS document_date,
  c.name AS customer_name, ins.id AS installment_id, replacement.id AS replacement_invoice_id`;
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
  filterPeriod(c, 'COALESCE(i.invoice_date, date(i.created_at))', clauses, values);
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
  invoice_date: date.optional(),
  notes: note.optional(),
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
type LegacyCheckout = { customer: string; receivedMinor: number | null; exactPaid?: boolean };

export function checkoutInvoice(c: ApiContext, data: z.infer<typeof checkout>, original?: OriginalInvoice, legacy?: LegacyCheckout,
  output?: (id: number) => Promise<Response>) {
  const items = [...data.items].sort((a, b) => a.product_id - b.product_id);
  const serializedItems = JSON.stringify(items);
  const expected = data.expected_total_minor ?? null;
  const operation = original ? 'invoice.reissue' : legacy && !legacy.exactPaid ? 'cashier.checkout' : 'invoice.checkout';
  return write(c, operation, { ...data, items, original, legacy }, (op, binds, actor) => {
    const db = c.env.DB;
    const customerSql = legacy?.customer
      ? '(SELECT id FROM customers WHERE name = ? COLLATE NOCASE ORDER BY id LIMIT 1)'
      : '?';
    const paidSql = legacy && !legacy.exactPaid ? 'MIN(COALESCE(?, total), total)' : '?';
    const statements = [
      db.prepare(`
        WITH basket AS (
          SELECT COUNT(*) AS product_count, SUM(p.price_minor * json_extract(j.value, '$.quantity')) AS total
          ${checkoutProducts}
        )
        INSERT INTO invoices (id, customer_id, total_minor, paid_minor, actor_id, replaces_invoice_id, invoice_date, notes)
        SELECT ${op}, ${customerSql},
          CASE WHEN product_count = ? AND (? IS NULL OR total = ?) THEN total END,
          ${paidSql}, ?, ?, ?, ?
        FROM basket
      `).bind(serializedItems, ...binds, legacy?.customer || data.customer_id || null, items.length, expected, expected,
        legacy && !legacy.exactPaid ? legacy.receivedMinor : data.paid_minor, actor, original?.id ?? null,
        data.invoice_date ?? cairoDay(), data.notes ?? ''),
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
  }, output ?? (legacy ? invoiceId => legacyCheckoutResponse(c, invoiceId, legacy.receivedMinor) : undefined));
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

const installmentFields = `i.*, CASE WHEN i.status = 'open' AND i.marked_overdue = 1 THEN 'overdue' ELSE i.status END AS display_status`;
function asInstallment<T extends { items_json?: unknown; display_status?: unknown }>(row: T) {
  const { items_json, display_status, ...fields } = row;
  return { ...fields, status: display_status, items: JSON.parse(String(items_json ?? '[]')) as unknown[] };
}

business.get('/installments', permit('installments.view'), async c => {
  const paging = page(c);
  const db = c.env.DB;
  const [rows, count] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${installmentFields}, c.name AS customer_name FROM installments i
      JOIN customers c ON c.id = i.customer_id ORDER BY i.id DESC LIMIT ? OFFSET ?`).bind(paging.limit, paging.offset),
    db.prepare('SELECT COUNT(*) AS total FROM installments'),
  ]);
  return paginated(c, rows.results.map(asInstallment), Number(count.results[0]?.total ?? 0), paging);
});

const installmentMetadata = z.object({
  principal_minor: positiveMoney.optional(),
  items: checkoutItems.optional(),
  product_name: name.optional(),
  payment_date: date.nullish(),
  due_date: date,
  note: note.default(''),
}).strict();
const installment = installmentMetadata.extend({
  customer_id: id,
  invoice_id: id.nullish(),
  paid_minor: money.default(0),
}).refine(data => Boolean(data.items || data.principal_minor) &&
  (!data.items || (!data.invoice_id && !data.principal_minor && !data.product_name)) &&
  (!data.principal_minor || data.paid_minor <= data.principal_minor) &&
  (!data.invoice_id || data.paid_minor === 0));

const installmentBasket = `
  WITH basket AS (
    SELECT COUNT(*) AS count, SUM(p.price_minor * json_extract(j.value, '$.quantity')) AS principal,
      GROUP_CONCAT(p.name, ', ') AS product_name,
      json_group_array(json_object('product_id', p.id, 'name', p.name, 'quantity', json_extract(j.value, '$.quantity'),
        'unit_price_minor', p.price_minor, 'line_total_minor', p.price_minor * json_extract(j.value, '$.quantity'))) AS items
    ${checkoutProducts}
  )
`;

business.post('/installments', permit('installments.manage'), async c => {
  const data = await body(c, installment);
  if (data.paid_minor > 0 && !hasPermission(c.get('actor'), 'installments.pay')) {
    return fail(403, 'FORBIDDEN', 'الدفعة الأولى تتطلب صلاحية السداد.');
  }
  const items = JSON.stringify(data.items ?? []);
  return write(c, 'installment.create', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      ${installmentBasket}
      INSERT INTO installments (id, customer_id, invoice_id, principal_minor, due_date, note, actor_id, product_name, items_json, payment_date)
      SELECT ${op}, ?, ?, CASE WHEN ? > 0 THEN CASE WHEN count = ? THEN principal END ELSE ? END,
        ?, ?, ?, COALESCE(product_name, ?), items, ? FROM basket
    `).bind(items, ...binds, data.customer_id, data.invoice_id ?? null, data.items?.length ?? 0,
      data.items?.length ?? 0, data.principal_minor ?? null, data.due_date, data.note, actor,
      data.product_name ?? '', data.payment_date ?? (data.paid_minor > 0 ? cairoDay() : null)),
    initialPayment(c, 'installment_payments', 'installment_id', op, binds, data.paid_minor, actor),
  ]);
});

business.patch('/installments/:id', permit('installments.manage'), async c => {
  const data = await body(c, installmentMetadata.refine(value =>
    (!value.items || (!value.principal_minor && !value.product_name)) &&
    (!value.product_name || Boolean(value.principal_minor))));
  const installmentId = identifier(c);
  const itemCount = data.items?.length ?? 0;
  const financialEdit = data.items !== undefined || data.principal_minor !== undefined;
  return change(c, 'installment.update', installmentId, `
    ${installmentBasket}
    UPDATE installments SET due_date = ?, note = ?,
      principal_minor = CASE WHEN ? > 0 THEN (SELECT principal FROM basket WHERE count = ?)
        ELSE COALESCE(?, principal_minor) END,
      product_name = CASE WHEN ? > 0 THEN (SELECT product_name FROM basket) ELSE COALESCE(?, product_name) END,
      items_json = CASE WHEN ? > 0 THEN (SELECT items FROM basket)
        WHEN ? THEN '[]' ELSE items_json END,
      payment_date = CASE WHEN ? THEN ? ELSE payment_date END, updated_at = ${timestamp}
    WHERE id = ? AND voided_at IS NULL AND (? = 0 OR (invoice_id IS NULL
      AND (json_array_length(items_json) = 0 OR ? > 0 OR ? IS NOT NULL))) RETURNING *
  `, JSON.stringify(data.items ?? []), data.due_date, data.note, itemCount, itemCount,
  data.principal_minor ?? null, itemCount, data.product_name ?? null, itemCount, Number(financialEdit),
  Number(data.payment_date !== undefined), data.payment_date ?? null, installmentId, Number(financialEdit),
  itemCount, data.product_name ?? null);
});

business.post('/installments/:id/status', permit('installments.manage'), async c => {
  const installmentId = identifier(c);
  const data = await body(c, z.object({ status: z.enum(['open', 'overdue', 'paid']) }).strict());
  return change(c, 'installment.status', installmentId, `
    UPDATE installments SET marked_overdue = ?, updated_at = ${timestamp}
    WHERE id = ? AND voided_at IS NULL AND status = ? RETURNING *
  `, Number(data.status === 'overdue'), installmentId, data.status === 'paid' ? 'paid' : 'open');
});

business.get('/debts', permit('debts.view'), c =>
  list(c, debtColumns, debtTables, [], 'd.id DESC'));

const debtColumns = `d.id, d.customer_id, d.person_name, d.phone, d.direction, d.principal_minor, d.paid_minor,
  d.due_date, d.note, d.description, d.actor_id, d.created_at, d.updated_at,
  CASE WHEN v.id IS NOT NULL THEN 'voided' ELSE d.status END AS status, v.created_at AS voided_at, v.reason AS void_reason`;
const debtTables = 'personal_debts d LEFT JOIN debt_voids v ON v.debt_id = d.id';

const debt = z.object({
  customer_id: id.nullish(),
  person_name: name,
  phone: phone.default(''),
  direction: z.enum(['receivable', 'payable']).default('receivable'),
  principal_minor: positiveMoney,
  description: note.default(''),
  due_date: date.nullish(),
  note: note.default(''),
}).strict();

business.post('/debts', permit('debts.manage'), async c => {
  const data = await body(c, debt.extend({ paid_minor: money.default(0) })
    .refine(value => value.paid_minor <= value.principal_minor));
  if (data.paid_minor > 0 && !hasPermission(c.get('actor'), 'debts.pay')) {
    return fail(403, 'FORBIDDEN', 'الدفعة الأولى تتطلب صلاحية السداد.');
  }
  return write(c, 'debt.create', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO personal_debts (id, customer_id, person_name, phone, direction, principal_minor, due_date, note, description, actor_id)
      VALUES (${op}, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(...binds, data.customer_id ?? null, data.person_name, data.phone, data.direction,
      data.principal_minor, data.due_date ?? null, data.note, data.description, actor),
    initialPayment(c, 'personal_debt_payments', 'debt_id', op, binds, data.paid_minor, actor),
  ]);
});

business.patch('/debts/:id', permit('debts.manage'), async c => {
  const data = await body(c, debt.pick({ person_name: true, phone: true, due_date: true, note: true })
    .extend({ description: note.optional(), principal_minor: positiveMoney.optional() }));
  const debtId = identifier(c);
  return change(c, 'debt.update', debtId, `
    UPDATE personal_debts SET person_name = ?, phone = ?, due_date = ?, note = ?,
      description = COALESCE(?, description), principal_minor = COALESCE(?, principal_minor), updated_at = ${timestamp}
    WHERE id = ? AND NOT EXISTS (SELECT 1 FROM debt_voids WHERE debt_id = personal_debts.id) RETURNING *
  `, data.person_name, data.phone, data.due_date ?? null, data.note, data.description ?? null, data.principal_minor ?? null, debtId);
});

function initialPayment(
  c: ApiContext, table: 'installment_payments' | 'personal_debt_payments' | 'supplier_payments',
  foreignKey: 'installment_id' | 'debt_id' | 'purchase_id', op: string, binds: Bind[], amount: number, actor: number,
) {
  return c.env.DB.prepare(`
    WITH operation AS (SELECT ${op} AS id)
    INSERT INTO ${table} (id, ${foreignKey}, amount_minor, actor_id)
    SELECT id, id, ?, ? FROM operation WHERE ? > 0
  `).bind(...binds, amount, actor, amount);
}

const voidEndpoints = [
  { path: '/installments', permission: 'installments.manage', table: 'installment_voids', foreignKey: 'installment_id' },
  { path: '/debts', permission: 'debts.manage', table: 'debt_voids', foreignKey: 'debt_id' },
];
for (const endpoint of voidEndpoints) {
  business.post(endpoint.path + '/:id/void', permit(endpoint.permission), async c => {
    const recordId = identifier(c);
    const data = await body(c, z.object({ reason }).strict());
    return write(c, endpoint.table + '.create', { recordId, ...data }, (op, binds, actor) => [
      c.env.DB.prepare(`
        INSERT INTO ${endpoint.table} (id, ${endpoint.foreignKey}, reason, actor_id)
        VALUES (${op}, ?, ?, ?)
      `).bind(...binds, recordId, data.reason, actor),
    ]);
  });
}

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
  email: z.string().trim().email().max(255).nullish(),
  opening_minor: money.optional(),
}).strict();

business.get('/suppliers', permit('suppliers.view'), c => {
  const query = z.string().trim().max(100).parse(c.req.query('q') ?? '');
  const value = searchPrefix(query);
  return list(c, '*', 'supplier_balances' + (query
    ? " WHERE name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\'" : ''),
    query ? [value, value, value] : [], 'balance_minor DESC, name, id');
});

business.get('/suppliers/:id', permit('suppliers.view'), async c => {
  const supplierId = identifier(c);
  const db = c.env.DB;
  const [supplierRows, purchases, payments] = await db.batch([
    db.prepare('SELECT * FROM supplier_balances WHERE id = ?').bind(supplierId),
    db.prepare('SELECT * FROM purchases WHERE supplier_id = ? ORDER BY purchase_date DESC, id DESC LIMIT 25').bind(supplierId),
    db.prepare(`
      SELECT id, amount_minor, payment_date, opening_applied_minor, note, legacy_receipt_number FROM supplier_receipts WHERE supplier_id = ?
      UNION ALL
      SELECT s.id, s.amount_minor, COALESCE(s.payment_date, date(s.created_at)), 0, s.note, s.legacy_receipt_number
      FROM supplier_payments s JOIN purchases p ON p.id = s.purchase_id WHERE p.supplier_id = ?
      ORDER BY payment_date DESC, id DESC LIMIT 25
    `).bind(supplierId, supplierId),
  ]);
  if (!supplierRows.results[0]) return fail(404, 'NOT_FOUND', 'المورد غير موجود.');
  return ok(c, { ...supplierRows.results[0], purchases: purchases.results, payments: payments.results });
});

business.post('/suppliers', permit('suppliers.manage'), async c => {
  const data = await body(c, supplier);
  return write(c, 'supplier.create', data, (op, binds) => [
    c.env.DB.prepare('INSERT INTO suppliers (id, name, phone, address, notes, email, opening_minor) VALUES (' + op + ', ?, ?, ?, ?, ?, ?)')
      .bind(...binds, data.name, data.phone, data.address, data.notes, data.email ?? null, data.opening_minor ?? 0),
  ]);
});

business.patch('/suppliers/:id', permit('suppliers.manage'), async c => {
  const data = await body(c, supplier.extend({ active: z.boolean() }));
  const supplierId = identifier(c);
  return change(c, 'supplier.update', supplierId, `
    UPDATE suppliers SET name = ?, phone = ?, address = ?, notes = ?, active = ?,
      email = CASE WHEN ? THEN ? ELSE email END, opening_minor = COALESCE(?, opening_minor), updated_at = ${timestamp}
    WHERE id = ? RETURNING *
  `, data.name, data.phone, data.address, data.notes, Number(data.active),
    Number(data.email !== undefined), data.email ?? null, data.opening_minor ?? null, supplierId);
});

business.delete('/suppliers/:id', permit('suppliers.manage'), async c => {
  const supplierId = identifier(c);
  return change(c, 'supplier.delete', supplierId, `
    DELETE FROM suppliers WHERE id = ? AND opening_minor = 0 RETURNING id
  `, supplierId);
});

business.post('/suppliers/:id/payments', permit('suppliers.pay'), async c => {
  const supplierId = identifier(c);
  const data = await body(c, z.object({ amount_minor: positiveMoney, payment_date: date.optional(), note: note.default('') }).strict());
  return write(c, 'supplier.receipt', { supplierId, ...data }, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO supplier_receipts (id, supplier_id, amount_minor, opening_applied_minor, payment_date, note, actor_id)
      VALUES (${op}, ?, ?, MAX(0, ? - (
        SELECT COALESCE(SUM(total_minor - paid_minor), 0) FROM purchases WHERE supplier_id = ? AND paid_minor < total_minor
      )), ?, ?, ?)
    `).bind(...binds, supplierId, data.amount_minor, data.amount_minor, supplierId,
      data.payment_date ?? cairoDay(), data.note, actor),
  ]);
});

business.get('/purchases', permit('suppliers.view'), c => {
  const supplierId = c.req.query('supplier_id');
  const query = z.string().trim().max(100).parse(c.req.query('q') ?? '');
  const predicates: string[] = [];
  const values: Bind[] = [];
  if (supplierId) {
    predicates.push('p.supplier_id = ?');
    values.push(id.parse(Number(supplierId)));
  }
  if (query) {
    predicates.push("(p.reference LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')");
    values.push(...Array(3).fill(searchPrefix(query)));
  }
  filterPeriod(c, 'p.purchase_date', predicates, values);
  return list(c, 'p.*, s.name AS supplier_name', 'purchases p JOIN suppliers s ON s.id = p.supplier_id' + where(predicates),
    values, 'p.purchase_date DESC, p.id DESC');
});

const purchase = z.object({
  supplier_id: id,
  reference: z.string().trim().min(1).max(100).nullish(),
  description: reason,
  total_minor: positiveMoney,
  purchase_date: date,
  payment_type: z.enum(['cash', 'credit']).default('credit'),
  paid_minor: money.optional(),
}).strict().refine(value => value.paid_minor === undefined ||
  (value.paid_minor <= value.total_minor && (value.payment_type !== 'cash' || value.paid_minor === value.total_minor)));

business.post('/purchases', permit('suppliers.manage'), async c => {
  const data = await body(c, purchase);
  const paid = data.payment_type === 'cash' ? data.total_minor : data.paid_minor ?? 0;
  if (paid > 0 && !hasPermission(c.get('actor'), 'suppliers.pay')) {
    return fail(403, 'FORBIDDEN', 'تسجيل دفعة المورد يتطلب صلاحية السداد.');
  }
  return write(c, 'purchase.create', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      WITH operation AS (SELECT ${op} AS id)
      INSERT INTO purchases (id, supplier_id, reference, description, total_minor, purchase_date, payment_type, actor_id)
      SELECT id, (SELECT id FROM suppliers WHERE id = ? AND active = 1), COALESCE(?, 'PUR-' || id), ?, ?, ?, ?, ? FROM operation
    `).bind(...binds, data.supplier_id, data.reference ?? null, data.description, data.total_minor,
      data.purchase_date, data.payment_type, actor),
    c.env.DB.prepare(`
      WITH operation AS (SELECT ${op} AS id)
      INSERT INTO supplier_payments (id, purchase_id, amount_minor, payment_date, note, actor_id)
      SELECT id, id, ?, ?, 'دفعة عند تسجيل المشتريات', ? FROM operation WHERE ? > 0
    `).bind(...binds, paid, data.purchase_date, actor, paid),
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
  default_commission_bps: z.number().int().min(0).max(10000).optional(),
  default_commission_min_minor: money.optional(),
  default_fee_bps: z.number().int().min(0).max(10000).optional(),
  default_fee_min_minor: money.optional(),
  default_fee_max_minor: money.nullish(),
}).strict();

function walletLimits(data: z.infer<typeof wallet>) {
  return [data.transaction_limit_minor, data.daily_send_limit_minor, data.daily_receive_limit_minor,
    data.monthly_send_limit_minor, data.monthly_receive_limit_minor].map(limit => limit ?? null);
}

function walletRates(data: z.infer<typeof wallet>, omitted: number | null) {
  return [data.default_commission_bps ?? omitted, data.default_commission_min_minor ?? omitted,
    data.default_fee_bps ?? omitted, data.default_fee_min_minor ?? omitted];
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
          daily_send_limit_minor, daily_receive_limit_minor, monthly_send_limit_minor, monthly_receive_limit_minor,
          default_commission_bps, default_commission_min_minor, default_fee_bps, default_fee_min_minor, default_fee_max_minor)
        VALUES (${op}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(...binds, data.name, data.provider, data.phone, ...walletLimits(data), ...walletRates(data, 0), data.default_fee_max_minor ?? null),
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
      monthly_receive_limit_minor = ?, default_commission_bps = COALESCE(?, default_commission_bps),
      default_commission_min_minor = COALESCE(?, default_commission_min_minor), default_fee_bps = COALESCE(?, default_fee_bps),
      default_fee_min_minor = COALESCE(?, default_fee_min_minor),
      default_fee_max_minor = CASE WHEN ? THEN ? ELSE default_fee_max_minor END,
      active = ?, updated_at = ${timestamp}
    WHERE id = ? RETURNING *
  `, data.name, data.provider, data.phone, ...walletLimits(data), ...walletRates(data, null),
  Number(data.default_fee_max_minor !== undefined), data.default_fee_max_minor ?? null, Number(data.active), walletId);
});

business.post('/wallets/:id/active', permit('wallets.manage'), async c => {
  const walletId = identifier(c);
  const data = await body(c, z.object({ active: z.boolean() }).strict());
  return change(c, 'wallet.active', walletId, `
    UPDATE wallets SET active = ?, updated_at = ${timestamp} WHERE id = ? RETURNING *
  `, Number(data.active), walletId);
});

business.post('/wallets/:id/adjustments', permit('wallets.manage'), async c => {
  const walletId = identifier(c);
  const data = await body(c, z.object({
    delta_minor: z.number().int().min(-900_000_000_000_000).max(900_000_000_000_000).refine(value => value !== 0),
    reason,
  }).strict());
  return write(c, 'wallet.adjust', { walletId, ...data }, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO wallet_adjustments (id, wallet_id, delta_minor, reason, actor_id, business_day)
      VALUES (${op}, ?, ?, ?, ?, ?)
    `).bind(...binds, walletId, data.delta_minor, data.reason, actor, cairoDay()),
  ]);
});

const walletTransactionFilters = z.object({
  wallet_id: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  kind: z.enum(['opening', 'send', 'receive', 'expense', 'settlement_in', 'settlement_out', 'reversal']).optional(),
  status: z.enum(['effective', 'reversed']).optional(),
  q: z.string().trim().max(80).optional(),
  from: date.optional(),
  to: date.optional(),
  export: z.enum(['1']).optional(),
});
business.get('/wallet-transactions', permit('wallets.view'), c => {
  const filter = walletTransactionFilters.parse(c.req.query());
  if (filter.from && filter.to && filter.from > filter.to) {
    return fail(422, 'invalid_dates', 'تاريخ بداية الفترة يأتي بعد نهايتها.');
  }
  const clauses: string[] = [];
  const parameters: (string | number)[] = [];
  for (const [value, clause] of [
    [filter.wallet_id, 't.wallet_id = ?'], [filter.kind, 't.kind = ?'],
    [filter.from, 't.business_day >= ?'], [filter.to, 't.business_day <= ?'],
  ] as const) {
    if (value !== undefined) { clauses.push(clause); parameters.push(value); }
  }
  if (filter.status === 'effective') clauses.push("r.id IS NULL AND t.kind <> 'reversal'");
  if (filter.status === 'reversed') clauses.push("(r.id IS NOT NULL OR t.kind = 'reversal')");
  if (filter.q) {
    clauses.push("(CAST(t.id AS TEXT) = ? OR t.counterparty LIKE ? ESCAPE '\\' OR w.name LIKE ? ESCAPE '\\')");
    parameters.push(filter.q.replace(/^#/, ''), searchPrefix(filter.q), searchPrefix(filter.q));
  }
  const cash = hasPermission(c.get('actor'), 'wallets.cash') ? 't.cash_delta_minor' : 'NULL';
  const columns = `t.id, t.wallet_id, t.kind, t.amount_minor, t.commission_minor, t.fee_minor, t.delta_minor,
    ${cash} AS cash_delta_minor, t.business_day, t.reversal_of, t.note, t.actor_id, t.created_at, t.counterparty,
    w.name AS wallet_name, r.id AS reversed_by, d.id AS wallet_debt_id, p.id AS profit_withdrawal_id, a.id AS adjustment_id`;
  const tables = `wallet_transactions t JOIN wallets w ON w.id = t.wallet_id
      LEFT JOIN wallet_transactions r ON r.reversal_of = t.id
      LEFT JOIN wallet_debts d ON d.wallet_transaction_id = t.id
      LEFT JOIN wallet_profit_withdrawals p ON p.id = t.id AND p.wallet_id = t.wallet_id
      LEFT JOIN wallet_adjustments a ON a.id = t.id AND a.wallet_id = t.wallet_id`;
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const order = 't.business_day DESC, t.created_at DESC, t.id DESC';
  if (filter.export) {
    if (!hasPermission(c.get('actor'), 'wallets.cash')) return fail(403, 'forbidden', 'تصدير الكشف يتطلب صلاحية حركات النقدية.');
    return c.env.DB.prepare(`SELECT ${columns} FROM ${tables} ${where} ORDER BY ${order} LIMIT 1001`)
      .bind(...parameters).all().then(({ results }) => {
        if (results.length > 1000) return fail(422, 'export_limit', 'حدد فترة أقصر أو محفظة واحدة لتصدير ما يصل إلى ١٬٠٠٠ سجل.');
        return ok(c, results);
      });
  }
  return selectPage(c, columns, tables, where, parameters, order);
});

const walletTransaction = z.object({
  kind: z.enum(['receive', 'send', 'expense', 'settlement_in', 'settlement_out']),
  amount_minor: positiveMoney,
  commission_minor: money.optional(),
  fee_minor: money.optional(),
  counterparty: phone.default(''),
  note: note.default(''),
  deferred: z.object({ customer_id: id, principal_minor: positiveMoney.optional(), due_date: date.nullish() }).strict().optional(),
}).strict().refine(data => {
  const transfer = data.kind === 'send' || data.kind === 'receive';
  if (!transfer) return !data.fee_minor && !data.commission_minor && !data.deferred && data.note.length > 0;
  if ((data.fee_minor ?? 0) > data.amount_minor || (data.commission_minor ?? 0) > data.amount_minor) return false;
  if (data.kind === 'receive') return !data.deferred;
  const owed = data.amount_minor + (data.commission_minor ?? 0);
  return owed <= 900_000_000_000_000 && data.amount_minor + (data.fee_minor ?? 0) <= 900_000_000_000_000
    && (data.deferred?.principal_minor === undefined || data.commission_minor === undefined || data.deferred.principal_minor === owed);
}, { message: 'العمولة أو الدين غير صالح لهذه الحركة.' });

// Splitting the principal before multiplication keeps half-up rounding integer-exact at the API money limit.
const rateAmount = (column: 'default_commission_bps' | 'default_fee_bps') =>
  `((amount / 10000) * ${column} + ((amount % 10000) * ${column} + 5000) / 10000)`;

business.post('/wallets/:id/transactions', permit('wallets.transact'), async c => {
  const walletId = identifier(c);
  const data = await body(c, walletTransaction);
  return write(c, 'wallet.transaction', { walletId, ...data }, (op, binds, actor) => {
    const db = c.env.DB;
    const statements = [
      db.prepare(`
        WITH incoming AS (
          SELECT ? AS kind, CAST(? AS INTEGER) AS amount, CAST(? AS INTEGER) AS requested_commission,
            CAST(? AS INTEGER) AS requested_fee, ? AS deferred
        ), priced AS (
          SELECT incoming.*,
            COALESCE(requested_commission, CASE WHEN kind IN ('send', 'receive')
              THEN MAX(default_commission_min_minor, ${rateAmount('default_commission_bps')}) ELSE 0 END) AS commission,
            COALESCE(requested_fee, CASE WHEN kind IN ('send', 'receive')
              THEN MIN(COALESCE(default_fee_max_minor, 900000000000000),
                MAX(default_fee_min_minor, ${rateAmount('default_fee_bps')})) ELSE 0 END) AS fee
          FROM incoming LEFT JOIN wallets ON wallets.id = ?
        )
        INSERT INTO wallet_transactions (id, wallet_id, kind, amount_minor, commission_minor, fee_minor,
          delta_minor, cash_delta_minor, business_day, counterparty, note, actor_id)
        SELECT ${op}, ?, kind, amount, commission, fee,
          CASE WHEN kind IN ('receive', 'settlement_in') THEN amount - fee ELSE -(amount + fee) END,
          CASE WHEN kind = 'receive' THEN -(amount - commission)
            WHEN kind = 'send' AND deferred = 0 THEN amount + commission ELSE 0 END, ?, ?, ?, ?
        FROM priced
      `).bind(data.kind, data.amount_minor, data.commission_minor ?? null, data.fee_minor ?? null, Number(Boolean(data.deferred)),
        walletId, ...binds, walletId, cairoDay(), data.counterparty, data.note, actor),
    ];
    if (data.deferred) {
      statements.push(db.prepare(`
        INSERT INTO wallet_debts (id, wallet_transaction_id, customer_id, direction, principal_minor, due_date)
        SELECT id, id, ?, 'receivable', COALESCE(?, amount_minor + commission_minor), ?
        FROM wallet_transactions WHERE id = ${op}
      `).bind(data.deferred.customer_id, data.deferred.principal_minor ?? null, data.deferred.due_date ?? null, ...binds));
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
        delta_minor, cash_delta_minor, business_day, reversal_of, counterparty, note, actor_id)
      VALUES (${op}, (SELECT wallet_id FROM original), 'reversal', (SELECT amount_minor FROM original),
        (SELECT commission_minor FROM original), (SELECT fee_minor FROM original), (SELECT -delta_minor FROM original),
        (SELECT -cash_delta_minor FROM original), ?, ?, (SELECT counterparty FROM original), ?, ?)
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
  const report = await c.env.DB.prepare('SELECT * FROM wallet_financial_totals').first();
  return ok(c, report);
});

business.get('/wallet-profit-withdrawals', permit('wallets.cash'), c =>
  list(c, 'p.*, w.name AS wallet_name',
    'wallet_profit_withdrawals p LEFT JOIN wallets w ON w.id = p.wallet_id', [], 'p.id DESC'));

business.post('/wallet-profit-withdrawals', permit('wallets.cash'), permit('wallets.profit'), async c => {
  const data = await body(c, z.object({ amount_minor: positiveMoney, wallet_id: id.nullish(), note: note.default('') }).strict());
  return write(c, 'wallet.profit.withdraw', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      INSERT INTO wallet_profit_withdrawals (id, wallet_id, amount_minor, business_day, note, actor_id)
      VALUES (${op}, ?, ?, ?, ?, ?)
    `).bind(...binds, data.wallet_id ?? null, data.amount_minor, cairoDay(), data.note, actor),
  ]);
});

const damageColumns = `d.*, d.unit_cost_minor AS unit_value_minor, d.quantity * d.unit_cost_minor AS total_value_minor,
  COALESCE(d.legacy_product_name, p.name) AS product_name,
  CASE WHEN d.legacy_damage_fingerprint IS NULL THEN p.barcode ELSE d.legacy_product_barcode END AS product_barcode,
  r.id AS reversed_by, r.reason AS reversal_reason,
  EXISTS (SELECT 1 FROM damaged_stock_images img WHERE img.record_id = d.id) AS has_image`;
const damageTables = `damaged_stock d JOIN products p ON p.id = d.product_id
  LEFT JOIN damaged_stock_reversals r ON r.damage_id = d.id`;

business.get('/damaged', permit('damaged.view'), c => {
  const predicates: string[] = [];
  const values: Bind[] = [];
  filterPeriod(c, 'COALESCE(d.damaged_on, date(d.created_at))', predicates, values);
  return list(c, damageColumns, damageTables + where(predicates), values, 'd.id DESC');
});

business.get('/reports/damaged', permit('damaged.view'), async c => {
  const predicates: string[] = [];
  const values: Bind[] = [];
  const range = filterPeriod(c, 'COALESCE(d.damaged_on, date(d.created_at))', predicates, values);
  const totals = await c.env.DB.prepare(`
    SELECT COUNT(CASE WHEN r.id IS NULL THEN 1 END) AS entries,
      COALESCE(SUM(CASE WHEN r.id IS NULL THEN d.quantity END), 0) AS units,
      CAST(COALESCE(SUM(CASE WHEN r.id IS NULL THEN d.quantity * d.unit_cost_minor END), 0) AS TEXT) AS total_value_minor,
      COUNT(r.id) AS voided_entries
    FROM damaged_stock d LEFT JOIN damaged_stock_reversals r ON r.damage_id = d.id
    ${where(predicates)}
  `).bind(...values).first<{ entries: number; units: number; total_value_minor: string; voided_entries: number }>();
  const totalMinor = Number(totals?.total_value_minor ?? 0);
  if (!Number.isSafeInteger(totalMinor)) return fail(409, 'aggregate_range', 'مجموع التقرير خارج النطاق الرقمي المدعوم.');
  return ok(c, { ...range, ...totals, total_value_minor: totalMinor });
});

business.get('/damaged/:id', permit('damaged.view'), async c => {
  const damageId = identifier(c);
  const db = c.env.DB;
  const [records, corrections] = await db.batch([
    db.prepare(`SELECT ${damageColumns} FROM ${damageTables} WHERE d.id = ?`).bind(damageId),
    db.prepare('SELECT * FROM damaged_stock_corrections WHERE damage_id = ? ORDER BY id DESC LIMIT 100').bind(damageId),
  ]);
  if (!records.results[0]) return fail(404, 'NOT_FOUND', 'سجل الهالك غير موجود.');
  return ok(c, { ...records.results[0], corrections: corrections.results });
});

const damageInput = z.object({
  quantity, reason, unit_value_minor: money.optional(), damaged_on: date.optional(), notes: note.optional(),
}).strict();

business.post('/damaged', permit('damaged.manage'), async c => {
  const data = await body(c, damageInput.extend({ product_id: id }));
  return write(c, 'damage.create', data, (op, binds, actor) => [
    c.env.DB.prepare(`
      WITH incoming AS (SELECT ? AS quantity, COALESCE(?, price_minor) AS unit_value FROM products WHERE id = ?)
      INSERT INTO damaged_stock (id, product_id, quantity, unit_cost_minor, reason, damaged_on, notes, actor_id)
      VALUES (${op}, ?, ?, (SELECT CASE WHEN unit_value * quantity <= 900000000000000 THEN unit_value END FROM incoming),
        ?, ?, ?, ?)
    `).bind(data.quantity, data.unit_value_minor ?? null, data.product_id, ...binds, data.product_id,
      data.quantity, data.reason, data.damaged_on ?? cairoDay(), data.notes ?? '', actor),
  ]);
});

business.post('/damaged/:id/correct', permit('damaged.manage'), async c => {
  const damageId = identifier(c);
  const data = await body(c, damageInput);
  return write(c, 'damage.correct', { damageId, ...data }, (op, binds, actor) => [
    c.env.DB.prepare(`
      WITH original AS (SELECT * FROM damaged_stock WHERE id = ?)
      INSERT INTO damaged_stock_corrections (id, damage_id, previous_quantity, quantity, previous_unit_minor,
        unit_value_minor, previous_reason, reason, previous_damaged_on, damaged_on, previous_notes, notes, actor_id)
      VALUES (${op}, ?, (SELECT quantity FROM original), ?, (SELECT unit_cost_minor FROM original),
        COALESCE(?, (SELECT unit_cost_minor FROM original)), (SELECT reason FROM original), ?,
        (SELECT damaged_on FROM original), COALESCE(?, (SELECT damaged_on FROM original), ?),
        (SELECT notes FROM original), COALESCE(?, (SELECT notes FROM original)), ?)
    `).bind(damageId, ...binds, damageId, data.quantity, data.unit_value_minor ?? null, data.reason,
      data.damaged_on ?? null, cairoDay(), data.notes ?? null, actor),
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
const maintenanceColumns = 'maintenance_requests.*, EXISTS (SELECT 1 FROM maintenance_images img WHERE img.record_id = maintenance_requests.id) AS has_image';

business.get('/maintenance', permit('maintenance.view'), c => {
  const query = z.string().trim().max(100).parse(c.req.query('q') ?? '');
  const status = z.enum(['received', 'in_progress', 'completed', 'delivered', 'cancelled', 'repaired']).optional().parse(c.req.query('status'));
  const predicates = ['archived_at IS NULL'];
  const values: Bind[] = [];
  if (query) {
    predicates.push("(item LIKE ? ESCAPE '\\' OR customer_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')");
    values.push(...Array(3).fill(searchPrefix(query)));
  }
  if (status === 'repaired') {
    predicates.push("status IN ('completed', 'delivered')");
  } else if (status) {
    predicates.push('status = ?');
    values.push(status);
  }
  filterPeriod(c, 'requested_date', predicates, values);
  return list(c, maintenanceColumns, 'maintenance_requests' + where(predicates), values);
});

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
      WHERE id = ? AND archived_at IS NULL AND status NOT IN ('delivered', 'cancelled')
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

business.delete('/maintenance/:id', permit('maintenance.manage'), async c => {
  const requestId = identifier(c);
  return change(c, 'maintenance.archive', requestId, `
    UPDATE maintenance_requests SET archived_at = ${timestamp}, archived_by = ?, updated_at = ${timestamp}
    WHERE id = ? AND paid_minor = 0 AND archived_at IS NULL RETURNING id, archived_at
  `, c.get('actor').id, requestId);
});

const imageEndpoints = [
  {
    path: '/damaged', view: 'damaged.view', manage: 'damaged.manage',
    table: 'damaged_stock_images', parent: 'damaged_stock',
    active: 'NOT EXISTS (SELECT 1 FROM damaged_stock_reversals WHERE damage_id = damaged_stock.id)',
  },
  {
    path: '/maintenance', view: 'maintenance.view', manage: 'maintenance.manage',
    table: 'maintenance_images', parent: 'maintenance_requests', active: 'archived_at IS NULL',
  },
] as const;
for (const endpoint of imageEndpoints) {
  business.get(endpoint.path + '/:id/image', permit(endpoint.view), async c => {
    const row = await c.env.DB.prepare(`SELECT content, media_type FROM ${endpoint.table} WHERE record_id = ?`)
      .bind(identifier(c)).first<{ content: number[] | ArrayBuffer; media_type: string }>();
    if (!row) return fail(404, 'NOT_FOUND', 'لا توجد صورة لهذا السجل.');
    const bytes = Array.isArray(row.content) ? Uint8Array.from(row.content) : row.content;
    return new Response(bytes, {
      headers: { 'Content-Type': row.media_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  });
  business.put(endpoint.path + '/:id/image', permit(endpoint.manage), async c => {
    const recordId = identifier(c);
    const bytes = await readBytes(c, 131072);
    const mime = imageType(bytes);
    try {
      const result = await auditedWrite(c, c.env.DB.prepare(`
        INSERT INTO ${endpoint.table} (record_id, media_type, content)
        SELECT id, ?, ? FROM ${endpoint.parent} WHERE id = ? AND ${endpoint.active}
        ON CONFLICT(record_id) DO UPDATE SET media_type = excluded.media_type,
          content = excluded.content, updated_at = ${timestamp}
      `).bind(mime, bytes, recordId), 'image.update', endpoint.parent, recordId);
      if (!result.meta.changes) return fail(404, 'NOT_FOUND', 'السجل غير موجود أو لا يمكن تعديله.');
      return ok(c, { id: recordId });
    } catch (error) {
      return businessError(error);
    }
  });
  business.delete(endpoint.path + '/:id/image', permit(endpoint.manage), async c => {
    const recordId = identifier(c);
    const result = await auditedWrite(c, c.env.DB.prepare(`
      DELETE FROM ${endpoint.table} WHERE record_id = (
        SELECT id FROM ${endpoint.parent} WHERE id = ? AND ${endpoint.active}
      )
    `).bind(recordId), 'image.delete', endpoint.parent, recordId);
    if (!result.meta.changes) return fail(404, 'NOT_FOUND', 'لا توجد صورة قابلة للحذف لهذا السجل.');
    return ok(c, { id: recordId });
  });
}

const paymentEndpoints = [
  { path: '/invoices', permission: 'invoices.pay', table: 'invoice_payments', foreignKey: 'invoice_id', fields: ", source_type", values: ", 'payment'" },
  { path: '/installments', permission: 'installments.pay', table: 'installment_payments', foreignKey: 'installment_id' },
  { path: '/debts', permission: 'debts.pay', table: 'personal_debt_payments', foreignKey: 'debt_id', hasNote: true },
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
    return write(c, endpoint.table + '.create', { relatedId, ...data }, (op, binds, actor) => {
      const statements = [c.env.DB.prepare(`
        INSERT INTO ${endpoint.table} (id, ${endpoint.foreignKey}, amount_minor, actor_id${fields})
        VALUES (${op}, ?, ?, ?${placeholders})
      `).bind(...binds, relatedId, data.amount_minor, actor, ...(endpoint.hasNote ? [withNote] : []))];
      if (endpoint.table === 'installment_payments') {
        statements.push(c.env.DB.prepare('UPDATE installments SET payment_date = ?, marked_overdue = 0 WHERE id = ?')
          .bind(cairoDay(), relatedId));
      }
      return statements;
    });
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
    const entityQuery = detail.table === 'personal_debts' ? `SELECT ${debtColumns} FROM ${debtTables} WHERE d.id = ?`
      : detail.table === 'installments' ? `SELECT ${installmentFields} FROM installments i WHERE i.id = ?`
      : `SELECT ${detail.table === 'maintenance_requests' ? maintenanceColumns : '*'} FROM ${detail.table} WHERE id = ?`;
    const [entity, ledger] = await db.batch<Record<string, unknown>>([
      db.prepare(entityQuery).bind(idValue),
      db.prepare(detail.table === 'purchases'
        ? `SELECT id, amount_minor, note, actor_id, created_at FROM supplier_payments WHERE purchase_id = ?
          UNION ALL SELECT r.id, a.amount_minor, r.note, r.actor_id, r.created_at
            FROM supplier_receipt_allocations a JOIN supplier_receipts r ON r.id = a.receipt_id WHERE a.purchase_id = ?
          ORDER BY id DESC LIMIT 100`
        : `SELECT * FROM ${detail.ledger} WHERE ${detail.foreignKey} = ? ORDER BY id DESC LIMIT 100`)
        .bind(...(detail.table === 'purchases' ? [idValue, idValue] : [idValue])),
    ]);
    if (!entity.results[0]) return fail(404, 'NOT_FOUND', 'السجل المطلوب غير موجود.');
    const row = detail.table === 'installments' ? asInstallment(entity.results[0]) : entity.results[0];
    return ok(c, { ...row, payments: ledger.results });
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
  list(c, `id, name, active, purchase_total_minor + opening_minor AS total_minor,
    purchase_paid_minor + opening_paid_minor AS paid_minor, balance_minor AS due_minor`,
  'supplier_balances', [], 'balance_minor DESC, name, id'));

business.route('/', purchaseReceiving(write));
business.route('/', walletReporting);
