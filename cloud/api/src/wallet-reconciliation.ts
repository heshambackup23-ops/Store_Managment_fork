import { Hono } from 'hono';
import { z } from 'zod';
import { body, fail, identifier, ok, permit, selectPage, type ApiEnv } from './http';

const maxBookMinor = 8_000_000_000_000_000;
const maxObservedMinor = 900_000_000_000_000;
const countPermission = permit('wallets.cash');
const targetType = z.enum(['drawer', 'wallet']);
const cairoCalendar = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
});

const reading = {
  observed_minor: z.number().int().min(0).max(maxObservedMinor),
  expected_minor: z.number().int().min(-maxBookMinor).max(maxBookMinor).optional(),
  reason: z.string().trim().max(1000).refine(value => !value.includes('\0')).default(''),
};
const countInput = z.discriminatedUnion('target', [
  z.strictObject({ target: z.literal('drawer'), ...reading }),
  z.strictObject({ target: z.literal('wallet'), wallet_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), ...reading }),
]);
const historyQuery = z.object({
  target: targetType.optional(), wallet_id: identifier.optional(),
  from: z.iso.date().optional(), to: z.iso.date().optional(),
});

type Target = {
  target: z.infer<typeof targetType>;
  wallet_id: number | null;
  wallet_name: string | null;
  expected_minor: number;
};

type WalletCount = Target & {
  id: number;
  observed_minor: number;
  difference_minor: number;
  reason: string;
  actor_id: number;
  actor_name: string;
  business_day: string;
  created_at: string;
};

const publicColumns = 'id, target, wallet_id, wallet_name, expected_minor, observed_minor, '
  + 'observed_minor - expected_minor AS difference_minor, reason, actor_id, actor_name, business_day, created_at';

function businessDay(time: Date) {
  const parts = cairoCalendar.formatToParts(time);
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-');
}

function checkBookBalance(minor: number) {
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > maxBookMinor) {
    return fail(409, 'RECONCILIATION_BALANCE_RANGE', 'الرصيد الدفتري يتجاوز النطاق المسموح للجرد.');
  }
}

export const walletReconciliation = new Hono<ApiEnv>();

walletReconciliation.get('/wallet-reconciliation', countPermission, async c => {
  const { results } = await c.env.DB.prepare(`
    SELECT t.*, CASE WHEN r.id IS NOT NULL THEN json_object(
      'id', r.id, 'target', r.target, 'wallet_id', r.wallet_id, 'wallet_name', r.wallet_name,
      'expected_minor', r.expected_minor, 'observed_minor', r.observed_minor,
      'difference_minor', r.observed_minor - r.expected_minor, 'reason', r.reason,
      'actor_id', r.actor_id, 'actor_name', r.actor_name, 'business_day', r.business_day, 'created_at', r.created_at
    ) END AS latest
    FROM wallet_reconciliation_targets t
    LEFT JOIN wallet_reconciliations r ON r.id = (
      SELECT h.id FROM wallet_reconciliations h
      WHERE h.target = t.target AND h.wallet_id IS t.wallet_id ORDER BY h.id DESC LIMIT 1
    )
    ORDER BY t.target, t.wallet_name, t.wallet_id
  `).all<Target & { latest: string | null }>();
  const targets = results.map(({ latest, ...target }) => {
    checkBookBalance(target.expected_minor);
    return { ...target, latest: latest === null ? null : JSON.parse(latest) as WalletCount };
  });
  return ok(c, { business_day: businessDay(new Date()), targets });
});

walletReconciliation.get('/wallet-reconciliation/history', countPermission, c => {
  const { target, wallet_id, from, to } = historyQuery.parse(c.req.query());
  if (from && to && from > to) return fail(422, 'invalid_dates', 'تاريخ بداية الفترة يأتي بعد نهايتها.');

  const filters: [string | number | undefined, string][] = [
    [target, 'target = ?'], [wallet_id, 'wallet_id = ?'],
    [from, 'business_day >= ?'], [to, 'business_day <= ?'],
  ];
  const predicates = filters.filter(([value]) => value !== undefined);
  const where = predicates.length ? 'WHERE ' + predicates.map(([, sql]) => sql).join(' AND ') : '';
  return selectPage(c, publicColumns, 'wallet_reconciliations', where, predicates.map(([value]) => value), 'id DESC');
});

walletReconciliation.post('/wallet-reconciliation', countPermission, async c => {
  const input = await body(c, countInput);
  const requestKey = c.req.header('Idempotency-Key');
  if (!requestKey || !/^[A-Za-z0-9._:-]{8,100}$/.test(requestKey)) {
    return fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'يلزم مفتاح طلب صالح لإعادة المحاولة بأمان.');
  }

  const db = c.env.DB;
  const actor = c.get('actor');
  const walletId = input.target === 'wallet' ? input.wallet_id : null;
  const expected = input.expected_minor ?? null;
  const observed = input.observed_minor;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(
    JSON.stringify([input.target, walletId, expected, observed, input.reason]),
  ));
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const time = new Date();
  const targetFilter = 'FROM wallet_reconciliation_targets WHERE target = ? AND wallet_id IS ?';
  const requestFilter = 'FROM wallet_reconciliations WHERE actor_id = ? AND request_key = ?';

  // The same D1 transaction reads the authoritative balance, inserts the count and writes its audit entry.
  const [created, stored, current] = await db.batch<Partial<WalletCount> & { fingerprint?: string }>([
    db.prepare(`
      INSERT INTO wallet_reconciliations (target, wallet_id, wallet_name, expected_minor,
        observed_minor, reason, actor_id, actor_name, business_day, created_at, request_key, fingerprint)
      SELECT target, wallet_id, wallet_name, expected_minor, ?, ?, ?, ?, ?, ?, ?, ?
      ${targetFilter} AND expected_minor BETWEEN ? AND ?
        AND (? IS NULL OR expected_minor = ?) AND (? <> '' OR expected_minor = ?)
      ON CONFLICT (actor_id, request_key) DO NOTHING RETURNING id
    `).bind(observed, input.reason, actor.id, actor.name, businessDay(time), time.toISOString(), requestKey, fingerprint,
      input.target, walletId, -maxBookMinor, maxBookMinor, expected, expected, input.reason, observed),
    db.prepare(`SELECT ${publicColumns}, fingerprint ${requestFilter}`)
      .bind(actor.id, requestKey),
    db.prepare(`SELECT CASE WHEN NOT EXISTS (SELECT 1 ${requestFilter})
      THEN (SELECT expected_minor ${targetFilter}) END AS expected_minor`)
      .bind(actor.id, requestKey, input.target, walletId),
  ]);

  const result = stored.results[0] as (WalletCount & { fingerprint: string }) | undefined;
  if (result) {
    const { fingerprint: storedFingerprint, ...count } = result;
    if (storedFingerprint !== fingerprint) return fail(409, 'IDEMPOTENCY_CONFLICT', 'استُخدم مفتاح الطلب مع بيانات مختلفة.');
    return ok(c, count, created.results.length ? 201 : 200);
  }
  const currentBalance = current.results[0]?.expected_minor;
  if (typeof currentBalance !== 'number') return fail(404, 'RECONCILIATION_TARGET_NOT_FOUND', 'المحفظة المطلوبة غير موجودة.');
  checkBookBalance(currentBalance);
  if (expected !== null && expected !== currentBalance) {
    return fail(409, 'RECONCILIATION_BALANCE_CHANGED', 'تغيّر الرصيد الدفتري. حدّث الأرصدة قبل تسجيل الجرد.');
  }
  return fail(422, 'RECONCILIATION_REASON_REQUIRED', 'اذكر سبب الفرق بين الرصيد الدفتري والفعلي.');
});
