import { Hono } from 'hono';
import { z } from 'zod';
import { write } from './business';
import { body, fail, identifier, ok, permit, selectPage, type ApiContext, type ApiEnv } from './http';
import { pendingLedgerSources, type LedgerLine } from './retail-ledger-sources';
import { cairoDayBoundary, cairoRetailDay } from './retail-shifts';

const canView = 'retail.ledger.view';
const canPost = 'retail.ledger.post';
const canClose = 'retail.ledger.close';
export const retailLedgerPermissions = [canView, canPost, canClose];
export const retailLedger = new Hono<ApiEnv>();

const base = '/retail/ledger';
const bookName = z.enum(['operating', 'practice']);
const periodName = z.string().regex(/^20\d\d-(0[1-9]|1[0-2])$/);
const dayName = z.string().regex(/^20\d\d-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
});
const reason = z.string().trim().min(5).max(1000).refine(value => !value.includes('\0'));
const amount = z.number().int().min(0).max(900_000_000_000_000);
const accountCode = z.string().regex(/^\d{4}$/);
const entries = z.array(z.strictObject({ account: accountCode, debit_minor: amount, credit_minor: amount })
  .refine(line => (line.debit_minor === 0) !== (line.credit_minor === 0))).min(2).max(30);
const postInput = z.strictObject({ posting_day: dayName, description: reason, lines: entries });
const resolution = z.strictObject({ reason, lines: entries.optional() });
const issueName = z.enum(['cost_unknown', 'payment_unknown', 'account_required']);
const sourceToken = z.string().regex(/^[a-z_]{1,40}$/);
const sourceRef = z.string().regex(/^\d+(?:\/\d+)?$/);
const sourceBatchSize = 15;

type BookName = z.infer<typeof bookName>;
type Book = { book: BookName; first_period: string; reason: string; created_at: string };
type Trial = { code: string; name: string; account_type: string; opening_minor: string;
  debit_minor: string; credit_minor: string; closing_minor: string };
type Close = { operation_id: number; reason: string; actor_name: string; created_at: string;
  entry_count: number; trial_balance_json: string };
type Snapshot = { operation_id: number; audit_id: number; entry_count: number; unresolved: number; last_closed: string | null };

const ledgerErrors = [
  ['LEDGER_BEFORE_START', 'تاريخ القيد يسبق بداية الدفتر.'],
  ['LEDGER_PERIOD_CLOSED', 'الفترة مقفلة. سجّل التصحيح في فترة مفتوحة.'],
  ['LEDGER_UNBALANCED', 'إجمالي المدين يجب أن يساوي إجمالي الدائن مع استخدام حسابين مختلفين على الأقل.'],
  ['LEDGER_INVALID_LINE', 'راجع الحسابات والمبالغ المدخلة.'],
  ['LEDGER_INVALID_REVERSAL', 'القيد غير متاح للعكس اليدوي.'],
  ['LEDGER_INVALID_RESOLUTION', 'التصحيح لا يطابق حركة المصدر المطلوب معالجتها.'],
  ['LEDGER_CLOSE_SEQUENCE', 'أقفل الفترات بالترتيب من أول شهر للدفتر.'],
  ['LEDGER_CLOSE_STALE', 'ظهرت حركات جديدة أثناء تجهيز الإقفال. حدّث الشاشة وراجعها.'],
  ['LEDGER_CLOSE_ISSUES', 'راجع الحركات غير المكتملة قبل إقفال الشهر.'],
  ['LEDGER_PAYMENT_MISMATCH', 'بيانات وسائل السداد لا تطابق مبلغ حركة المصدر.'],
  ['LEDGER_VALUE_LIMIT', 'القيمة تتجاوز الحد المسموح لقيد واحد.'],
] as const;

function bookParameter(c: ApiContext) {
  return bookName.parse(c.req.param('book'));
}

function periodParameter(c: ApiContext) {
  return periodName.parse(c.req.param('period'));
}

async function ledgerWrite(...args: Parameters<typeof write>) {
  try {
    return await write(...args);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const rule = ledgerErrors.find(([code]) => message.includes(code));
    if (rule) return fail(409, rule[0], rule[1]);
    throw error;
  }
}

function openDay(day: string) {
  if (day > cairoRetailDay()) return fail(422, 'LEDGER_FUTURE_DAY', 'تاريخ القيد لا يتجاوز يوم العمل الحالي في القاهرة.');
}

function balance(lines: LedgerLine[]) {
  const net = lines.reduce((total, line) => total + BigInt(line.debit_minor) - BigInt(line.credit_minor), 0n);
  if (net !== 0n || new Set(lines.map(line => line.account)).size < 2) {
    return fail(422, 'LEDGER_UNBALANCED', 'إجمالي المدين يجب أن يساوي إجمالي الدائن مع استخدام حسابين مختلفين على الأقل.');
  }
}

function nextPeriod(period: string) {
  const next = new Date(period + '-01T00:00:00Z');
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next.toISOString().slice(0, 7);
}

function boundary(period: string) {
  return cairoDayBoundary(period + '-01');
}

async function getBook(c: ApiContext, book: BookName) {
  const result = await c.env.DB.prepare('SELECT book, first_period, reason, created_at FROM retail_ledger_books WHERE book = ?')
    .bind(book).first<Book>();
  if (!result) return fail(404, 'LEDGER_BOOK_REQUIRED', 'ابدأ الدفتر وحدد أول شهر قبل تسجيل القيود.');
  return result;
}

function trialStatement(db: D1Database, book: BookName, period: string) {
  return db.prepare(`
    WITH rollup AS (
      SELECT account,
        SUM(CASE WHEN period < ?1 THEN debit_minor - credit_minor ELSE 0 END) AS opening_minor,
        SUM(CASE WHEN period = ?1 THEN debit_minor ELSE 0 END) AS debit_minor,
        SUM(CASE WHEN period = ?1 THEN credit_minor ELSE 0 END) AS credit_minor,
        SUM(debit_minor - credit_minor) AS closing_minor
      FROM retail_ledger_lines WHERE book = ?2 AND period <= ?1 GROUP BY account
    )
    SELECT a.code, a.name, a.account_type, CAST(COALESCE(r.opening_minor, 0) AS TEXT) AS opening_minor,
      CAST(COALESCE(r.debit_minor, 0) AS TEXT) AS debit_minor, CAST(COALESCE(r.credit_minor, 0) AS TEXT) AS credit_minor,
      CAST(COALESCE(r.closing_minor, 0) AS TEXT) AS closing_minor
    FROM retail_ledger_accounts a LEFT JOIN rollup r ON r.account = a.code ORDER BY a.code
  `).bind(period, book);
}

function snapshotStatement(db: D1Database, book: BookName, period: string) {
  return db.prepare(`
    SELECT COALESCE((SELECT MAX(id) FROM business_operations),0) AS operation_id,
      COALESCE((SELECT MAX(id) FROM audit_logs),0) AS audit_id,
      (SELECT COUNT(*) FROM retail_ledger_entries WHERE book = ?1 AND period = ?2) AS entry_count,
      CASE WHEN ?1 = 'practice' THEN 0 ELSE (
        SELECT COUNT(*) FROM retail_ledger_source_reviews s WHERE s.period = ?2 AND s.issue IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM retail_ledger_issue_resolutions r WHERE r.book = ?1 AND r.source = s.source
            AND r.source_ref = s.source_ref AND r.code = s.issue)
      ) END AS unresolved,
      (SELECT MAX(period) FROM retail_ledger_closures WHERE book = ?1) AS last_closed
  `).bind(book, period);
}

retailLedger.get(base, permit(canView), async c => {
  const db = c.env.DB;
  const [books, accounts] = await db.batch([
    db.prepare('SELECT book, first_period, reason, created_at FROM retail_ledger_books ORDER BY book'),
    db.prepare('SELECT code, name, account_type FROM retail_ledger_accounts ORDER BY code'),
  ]);
  return ok(c, { books: books.results, accounts: accounts.results, today: cairoRetailDay() });
});

retailLedger.post(base + '/:book/start', permit(canView), permit(canClose), async c => {
  const book = bookParameter(c);
  const data = await body(c, z.strictObject({ first_period: periodName, reason }));
  openDay(data.first_period + '-01');
  return ledgerWrite(c, 'ledger.book.start', { book, ...data }, (op, binds, actor) => [
    c.env.DB.prepare(`INSERT INTO retail_ledger_books(book, first_period, start_operation_id, reason, actor_id)
      VALUES (?, ?, ${op}, ?, ?)`).bind(book, data.first_period, ...binds, data.reason, actor),
  ], async () => ok(c, await getBook(c, book), 201));
});

retailLedger.get(base + '/:book/periods/:period', permit(canView), async c => {
  const book = bookParameter(c);
  const period = periodParameter(c);
  const started = await getBook(c, book);
  const db = c.env.DB;
  const [state, trial, closed] = await db.batch([
    snapshotStatement(db, book, period), trialStatement(db, book, period),
    db.prepare(`SELECT l.operation_id, l.reason, u.name AS actor_name, l.created_at, l.entry_count, l.trial_balance_json
      FROM retail_ledger_closures l JOIN users u ON u.id = l.actor_id WHERE l.book = ? AND l.period = ?`).bind(book, period),
  ]);
  const snapshot = state.results[0] as Snapshot;
  const closure = closed.results[0] as Close | undefined;
  const nextClose = snapshot.last_closed ? nextPeriod(snapshot.last_closed) : started.first_period;
  const pending = book === 'operating' && !closure && period >= nextClose && period <= cairoRetailDay().slice(0, 7)
    ? await pendingLedgerSources(db, boundary(period), boundary(nextPeriod(period)), sourceBatchSize + 1, cairoRetailDay) : [];
  return ok(c, { book, period, status: closure ? 'closed' : period < started.first_period ? 'before_start' : 'open',
    next_close: nextClose, entry_count: snapshot.entry_count, unresolved: snapshot.unresolved,
    pending: Math.min(pending.length, sourceBatchSize), more_pending: pending.length > sourceBatchSize,
    trial_balance: closure ? JSON.parse(closure.trial_balance_json) as Trial[] : trial.results as Trial[],
    closure: closure && { operation_id: closure.operation_id, reason: closure.reason, actor_name: closure.actor_name, created_at: closure.created_at },
  });
});

retailLedger.get(base + '/:book/periods/:period/entries', permit(canView), c => {
  const book = bookParameter(c);
  const period = periodParameter(c);
  return selectPage(c, `e.id, e.posting_day, e.kind, e.source, e.source_ref, e.description, e.lines_json, e.reverses_id,
    u.name AS actor_name, EXISTS (SELECT 1 FROM retail_ledger_entries r WHERE r.reverses_id = e.id) AS reversed`,
  'retail_ledger_entries e JOIN users u ON u.id = e.actor_id', 'WHERE e.book = ? AND e.period = ?', [book, period],
  'e.posting_day DESC, e.id DESC', ({ lines_json, ...row }) => ({ ...row, lines: JSON.parse(String(lines_json)) }));
});

retailLedger.get(base + '/operating/periods/:period/issues', permit(canView), c =>
  selectPage(c, 's.source, s.source_ref, s.posting_day, s.description, s.issue, s.unclassified_minor, r.reason AS resolution_reason, r.resolution_entry_id',
    `retail_ledger_source_reviews s LEFT JOIN retail_ledger_issue_resolutions r
      ON r.book = 'operating' AND r.source = s.source AND r.source_ref = s.source_ref AND r.code = s.issue`,
    'WHERE s.period = ? AND s.issue IS NOT NULL', [periodParameter(c)], 'r.created_at IS NOT NULL, s.posting_day, s.source, s.source_ref'));

retailLedger.post(base + '/:book/entries', permit(canView), permit(canPost), async c => {
  const book = bookParameter(c);
  const data = await body(c, postInput);
  openDay(data.posting_day);
  balance(data.lines);
  await getBook(c, book);
  return ledgerWrite(c, 'ledger.entry.post', { book, ...data }, (op, binds, actor) => [
    c.env.DB.prepare(`INSERT INTO retail_ledger_entries(book, posting_day, kind, description, lines_json, operation_id, actor_id)
      VALUES (?, ?, 'manual', ?, ?, ${op}, ?)`).bind(book, data.posting_day, data.description, JSON.stringify(data.lines), ...binds, actor),
  ]);
});

retailLedger.post(base + '/:book/entries/:id/reverse', permit(canView), permit(canPost), async c => {
  const book = bookParameter(c);
  const entryId = identifier.parse(c.req.param('id'));
  const data = await body(c, postInput.omit({ lines: true }));
  openDay(data.posting_day);
  const original = await c.env.DB.prepare(`SELECT lines_json FROM retail_ledger_entries
    WHERE id = ? AND book = ? AND kind = 'manual'`).bind(entryId, book).first<string>('lines_json');
  if (!original) return fail(404, 'LEDGER_ENTRY_NOT_FOUND', 'القيد اليدوي المطلوب غير موجود.');
  const lines = (JSON.parse(original) as LedgerLine[]).map(line => ({ account: line.account,
    debit_minor: line.credit_minor, credit_minor: line.debit_minor }));
  return ledgerWrite(c, 'ledger.entry.reverse', { book, entryId, ...data }, (op, binds, actor) => [
    c.env.DB.prepare(`INSERT INTO retail_ledger_entries(book, posting_day, kind, reverses_id, description, lines_json, operation_id, actor_id)
      VALUES (?, ?, 'reversal', ?, ?, ?, ${op}, ?)`).bind(book, data.posting_day, entryId, data.description, JSON.stringify(lines), ...binds, actor),
  ]);
});

retailLedger.post(base + '/operating/periods/:period/sync', permit(canView), permit(canPost), async c => {
  const period = periodParameter(c);
  const data = await body(c, z.strictObject({}));
  const book = await getBook(c, 'operating');
  if (period < book.first_period) return fail(409, 'LEDGER_BEFORE_START', 'الفترة تسبق بداية الدفتر.');
  openDay(period + '-01');
  const db = c.env.DB;
  if (await db.prepare(`SELECT 1 FROM retail_ledger_closures WHERE book = 'operating' AND period >= ?`).bind(period).first()) {
    return fail(409, 'LEDGER_PERIOD_CLOSED', 'الفترة مقفلة.');
  }
  const pending = await pendingLedgerSources(db, boundary(period), boundary(nextPeriod(period)), sourceBatchSize, cairoRetailDay);
  return ledgerWrite(c, 'ledger.sources.sync', { period, ...data }, (op, binds, actor) => pending.flatMap(source => [
    db.prepare(`INSERT INTO retail_ledger_source_reviews(source,source_ref,posting_day,description,issue,unclassified_minor,operation_id)
      SELECT ?, ?, ?, ?, ?, ?, ${op}
      WHERE NOT EXISTS (SELECT 1 FROM retail_ledger_source_reviews WHERE source = ? AND source_ref = ?)`)
      .bind(source.source, source.source_ref, source.posting_day, source.description, source.issue, source.unclassified, ...binds,
        source.source, source.source_ref),
    ...(source.lines.length ? [db.prepare(`INSERT INTO retail_ledger_entries(book,posting_day,kind,source,source_ref,description,lines_json,operation_id,actor_id)
      SELECT 'operating', ?, 'source', r.source, r.source_ref, ?, ?, r.operation_id, ? FROM retail_ledger_source_reviews r
      WHERE r.source = ? AND r.source_ref = ? AND r.operation_id = ${op}`)
      .bind(source.posting_day, source.description, JSON.stringify(source.lines), actor, source.source, source.source_ref, ...binds)] : []),
  ]), async operation => {
    const count = await db.prepare('SELECT COUNT(*) AS count FROM retail_ledger_source_reviews WHERE operation_id = ?')
      .bind(operation).first<number>('count');
    return ok(c, { id: operation, reviewed: count ?? 0 }, 201);
  });
});

retailLedger.post(base + '/operating/periods/:period/issues/resolve', permit(canView), permit(canPost), async c => {
  const period = periodParameter(c);
  const data = await body(c, resolution.extend({ source: sourceToken, source_ref: sourceRef, code: issueName }));
  const db = c.env.DB;
  const issue = await db.prepare('SELECT posting_day, issue FROM retail_ledger_source_reviews WHERE source = ? AND source_ref = ? AND period = ?')
    .bind(data.source, data.source_ref, period).first<{ posting_day: string; issue: string }>();
  if (!issue || issue.issue !== data.code) return fail(404, 'LEDGER_ISSUE_NOT_FOUND', 'حركة المصدر المطلوب معالجتها غير موجودة.');
  if (data.code !== 'cost_unknown' && !data.lines) return fail(422, 'LEDGER_LINES_REQUIRED', 'أدخل قيد التصحيح والمستند المؤيد.');
  if (data.lines) balance(data.lines);
  return ledgerWrite(c, 'ledger.source.resolve', { period, ...data }, (op, binds, actor) => [
    ...(data.lines ? [db.prepare(`INSERT INTO retail_ledger_entries(book,posting_day,kind,description,lines_json,operation_id,actor_id)
      VALUES ('operating', ?, 'resolution', ?, ?, ${op}, ?)`).bind(issue.posting_day, data.reason, JSON.stringify(data.lines), ...binds, actor)] : []),
    db.prepare(`WITH operation AS (SELECT ${op} AS id)
      INSERT INTO retail_ledger_issue_resolutions(book,period,source,source_ref,code,resolution_entry_id,operation_id,reason,actor_id)
      SELECT 'operating', ?, ?, ?, ?, (SELECT id FROM retail_ledger_entries e WHERE e.operation_id = operation.id AND kind = 'resolution'),
        operation.id, ?, ? FROM operation`).bind(...binds, period, data.source, data.source_ref, data.code, data.reason, actor),
  ]);
});

retailLedger.post(base + '/:book/periods/:period/close', permit(canView), permit(canClose), async c => {
  const book = bookParameter(c);
  const period = periodParameter(c);
  const data = await body(c, z.strictObject({ reason }));
  if (period >= cairoRetailDay().slice(0, 7)) return fail(422, 'LEDGER_MONTH_IN_PROGRESS', 'يمكن إقفال الشهر بعد انتهائه بتوقيت القاهرة.');
  const started = await getBook(c, book);
  const db = c.env.DB;
  const [state, trial] = await db.batch([snapshotStatement(db, book, period), trialStatement(db, book, period)]);
  const snapshot = state.results[0] as Snapshot;
  const nextClose = snapshot.last_closed ? nextPeriod(snapshot.last_closed) : started.first_period;
  if (snapshot.last_closed && period <= snapshot.last_closed) {
    const existing = await db.prepare('SELECT operation_id FROM retail_ledger_closures WHERE book = ? AND period = ?')
      .bind(book, period).first<number>('operation_id');
    return ledgerWrite(c, 'ledger.period.close', { book, period, ...data }, () => {
      return fail(409, 'LEDGER_PERIOD_CLOSED', 'الفترة مقفلة بالفعل.');
    }, id => {
      if (id !== existing) return fail(409, 'LEDGER_PERIOD_CLOSED', 'الفترة مقفلة بالفعل.');
      return ok(c, { id }, 201);
    });
  }
  if (period !== nextClose) return fail(409, 'LEDGER_CLOSE_SEQUENCE', 'أقفل الفترات بالترتيب من أول شهر للدفتر.');
  const pending = book === 'operating' ? await pendingLedgerSources(db, boundary(period), boundary(nextPeriod(period)), 1, cairoRetailDay) : [];
  if (pending.length) return fail(409, 'LEDGER_CLOSE_PENDING', 'رحّل حركات الشهر قبل إقفاله.');
  if (snapshot.unresolved > 0) return fail(409, 'LEDGER_CLOSE_ISSUES', 'راجع الحركات غير المكتملة قبل إقفال الشهر.');
  if (book === 'operating') {
    const liveShift = await db.prepare(`SELECT 1 FROM retail_shift_positions WHERE business_day >= ? AND business_day < ?
      AND status IN ('open','pending_approval') LIMIT 1`).bind(period + '-01', nextPeriod(period) + '-01').first();
    if (liveShift) return fail(409, 'LEDGER_CLOSE_SHIFT', 'أقفل ورديات الشهر واعتمد الفروق قبل الإقفال.');
  }
  const total = (trial.results as Trial[]).reduce((net, row) => net + BigInt(row.closing_minor), 0n);
  if (total !== 0n) return fail(409, 'LEDGER_UNBALANCED', 'ميزان المراجعة غير متوازن.');
  return ledgerWrite(c, 'ledger.period.close', { book, period, ...data }, (op, binds, actor) => [
    db.prepare(`INSERT INTO retail_ledger_closures(book,period,operation_id,actor_id,reason,entry_count,
      expected_operation_id,expected_audit_id,trial_balance_json) VALUES (?, ?, ${op}, ?, ?, ?, ?, ?, ?)`)
      .bind(book, period, ...binds, actor, data.reason, snapshot.entry_count, snapshot.operation_id, snapshot.audit_id, JSON.stringify(trial.results)),
  ]);
});
