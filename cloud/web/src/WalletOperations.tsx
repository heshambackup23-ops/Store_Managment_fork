import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { allowed, apiUrl, formatDate, integer, money, readMoney, request, RequestError } from './api'
import type { User } from './api'
import { ActionDialog, DataModule, FormInput, idOf, Modal, Notice } from './ui'
import { SharedDrawerDialog, ShiftContext, useOpenShift } from './RetailShifts'
import { walletManagementTitle, walletProviderFilters, walletProviderFilterValue, walletProviderGroup, walletProviderLabel } from './wallet-providers'
import type { ModuleConfig, Row } from './ui'

type Position = {
  id: number
  name: string
  provider: string
  balance_minor: number
  active: number
  warn_at_percent: number
  transaction_limit_minor: number | null
} & Record<(typeof limits)[number][1] | (typeof limits)[number][2], number | null>

const limits = [
  ['إرسال اليوم', 'daily_sent_minor', 'daily_send_limit_minor'],
  ['استقبال اليوم', 'daily_received_minor', 'daily_receive_limit_minor'],
  ['إرسال الشهر', 'monthly_sent_minor', 'monthly_send_limit_minor'],
  ['استقبال الشهر', 'monthly_received_minor', 'monthly_receive_limit_minor'],
] as const

export function WalletPositions({ revision }: { revision: number }) {
  const [params] = useSearchParams()
  const provider = walletProviderFilterValue(params.get('provider'))
  const [rows, setRows] = useState<Position[]>()
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ page: String(page), per_page: '12' })
    if (provider) query.set('provider', provider)
    request<Position[]>('/wallets/positions?' + query, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return
        setRows(result.data)
        setLastPage(Math.max(1, Math.ceil((result.meta?.total ?? result.data.length) / 12)))
        setError('')
      })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [page, revision, provider])

  return <section className="section-space" aria-label="أرصدة وحدود المحافظ">
    <h2>الأرصدة والحدود بتوقيت القاهرة</h2>
    {error ? <Notice error>{error}</Notice> : !rows ? <Notice>جارٍ تحميل الأرصدة…</Notice> : !rows.length ? <Notice>لا توجد محافظ.</Notice> :
      <div className="wallet-positions">
        {rows.map(row => <article className="panel panel-inner wallet-position" key={row.id}>
          <header><h3>{row.name}</h3><span className="muted">{walletProviderLabel(row.provider)} · {row.active ? 'نشطة' : 'موقوفة'}</span></header>
          <dl className="invoice-summary">
            <div><dt>رصيد المحفظة لدى المزود</dt><dd>{money(row.balance_minor)}</dd></div>
            <div><dt>حد العملية</dt><dd>{row.transaction_limit_minor === null ? 'غير محدد' : money(row.transaction_limit_minor)}</dd></div>
          </dl>
          <dl className="wallet-usage">
            {limits.map(([label, usedKey, limitKey]) => {
              const used = row[usedKey] ?? 0
              const limit = row[limitKey]
              const ratio = limit ? used / limit : 0
              const warning = limit && ratio * 100 >= row.warn_at_percent
              return <div key={usedKey}>
                <dt>{label}</dt>
                <dd>{limit ? <>المتبقي <strong>{money(Math.max(0, limit - used))}</strong> · المستخدم {money(used)} من {money(limit)}</>
                  : <>المستخدم {money(used)} · الحد غير محدد</>}</dd>
                {limit ? <progress aria-label={label} value={Math.min(100, ratio * 100)} max={100} /> : null}
                {warning ? <small className="danger-text">{used >= limit ? 'بلغ الحد' : 'قريب من الحد'}</small> : null}
              </div>
            })}
          </dl>
          <Link className="secondary" to={'/wallet-transactions?wallet_id=' + row.id}>كشف المعاملات</Link>
        </article>)}
      </div>}
    {lastPage > 1 && <nav className="pagination" aria-label="صفحات المحافظ">
      <button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
      <span>{integer(page)} / {integer(lastPage)}</span>
      <button className="secondary" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>التالي</button>
    </nav>}
  </section>
}

const filters = ['provider', 'wallet_id', 'kind', 'status', 'from', 'to', 'q'] as const
const kinds = {
  opening: 'رصيد افتتاحي', send: 'إرسال', receive: 'استقبال', expense: 'مصروف',
  settlement_in: 'تسوية داخلة', settlement_out: 'تسوية خارجة', reversal: 'عكس',
}

type TransferKind = 'send' | 'receive'
const transferLabels = { send: 'إيداع للعميل', receive: 'سحب للعميل' } as const
const maximumMinor = 900_000_000_000_000

function rateCharge(amount: number, basisPoints: unknown) {
  const basis = Number(basisPoints ?? 0)
  return Number((BigInt(amount) * BigInt(basis) + 5000n) / 10000n)
}

function transferPricing(wallet: Row, kind: TransferKind, amount: number, commissionText: string, feeText: string, deferred: boolean) {
  const commission = commissionText.trim() ? readMoney(commissionText)
    : Math.max(Number(wallet.default_commission_min_minor ?? 0), rateCharge(amount, wallet.default_commission_bps))
  const fee = feeText.trim() ? readMoney(feeText)
    : Math.min(Number(wallet.default_fee_max_minor ?? maximumMinor),
      Math.max(Number(wallet.default_fee_min_minor ?? 0), rateCharge(amount, wallet.default_fee_bps)))
  if (amount <= 0 || amount > maximumMinor || commission > amount || fee > amount
      || (kind === 'send' && (amount + fee > maximumMinor || amount + commission > maximumMinor))) {
    throw new Error('أدخل مبلغًا موجبًا ورسومًا وعمولة لا تتجاوزان مبلغ المعاملة أو الحد المسموح.')
  }
  return {
    commission, fee, net: commission - fee,
    provider: kind === 'send' ? -(amount + fee) : amount - fee,
    drawer: kind === 'receive' ? -(amount - commission) : deferred ? 0 : amount + commission,
    debt: deferred ? amount + commission : undefined,
  }
}

type WalletReview = ReturnType<typeof transferPricing> & {
  amount: number
  reference?: string
  counterparty?: string
  note?: string
  customer?: number
  dueDate?: string
  shift?: { id: number; label: string }
}

export function WalletTransferDialog({ user, wallet, kind, close, done }: {
  user: User; wallet: Row; kind: TransferKind; close: () => void; done: (id?: number) => void
}) {
  const [amount, setAmount] = useState('')
  const [commission, setCommission] = useState('')
  const [fee, setFee] = useState('')
  const [reference, setReference] = useState('')
  const [counterparty, setCounterparty] = useState('')
  const [note, setNote] = useState('')
  const [customer, setCustomer] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [shared, setShared] = useState(false)
  const [review, setReview] = useState<WalletReview>()
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const amountField = useRef<HTMLInputElement>(null)
  const reviewHeading = useRef<HTMLHeadingElement>(null)
  const shift = useOpenShift(user)
  const walletId = idOf(wallet)
  const fawry = walletProviderGroup(wallet.provider) === 'fawry'
  const title = fawry ? (kind === 'send' ? 'حركة تخصم من رصيد فوري' : 'حركة تضيف إلى رصيد فوري') : transferLabels[kind]
  const deferred = kind === 'send' && Boolean(customer)
  const ledger = '/wallet-transactions?' + new URLSearchParams({
    wallet_id: String(walletId),
    ...(review?.reference ? { q: review.reference } : {}),
  })

  useEffect(() => {
    if (review) reviewHeading.current?.focus()
    else amountField.current?.focus()
  }, [review])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setError('')
    if (!review) {
      try {
        const principal = readMoney(amount)
        const priced = transferPricing(wallet, kind, principal, commission, fee, deferred)
        const providerReference = reference.trim()
        if (fawry && !providerReference) throw new Error('أدخل مرجع الحركة من فوري.')
        const customerId = deferred ? Number(customer) : undefined
        if (/[\p{Cc}\p{Cf}]/u.test(providerReference)) throw new Error('أزل الرموز المخفية من مرجع المزود.')
        if (customerId !== undefined && (!Number.isSafeInteger(customerId) || customerId <= 0)) {
          throw new Error('اختر العميل المرتبط بالمبلغ الآجل.')
        }
        if (shared && !deferred && !shift.shift) throw new Error('افتح وردية لاستخدام درج البيع.')
        const sharedShift = shared && !deferred && shift.shift ? {
          id: shift.shift.id, label: [shift.shift.branch_name, shift.shift.register_name].filter(Boolean).join(' · '),
        } : undefined
        setReview({ ...priced, amount: principal, reference: providerReference || undefined,
          counterparty: counterparty.trim() || undefined, note: note.trim() || undefined,
          customer: customerId, dueDate: customerId ? dueDate || undefined : undefined, shift: sharedShift })
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'راجع بيانات المعاملة.')
      }
      return
    }
    setBusy(true)
    try {
      const result = await request<{ id?: number }>('/wallets/' + walletId + '/transactions', {
        method: 'POST', financial: true,
        body: { kind, amount_minor: review.amount, commission_minor: review.commission, fee_minor: review.fee,
          provider_reference: review.reference, counterparty: review.counterparty, note: review.note,
          shared_shift_id: review.shift?.id,
          deferred: review.customer ? { customer_id: review.customer, due_date: review.dueDate } : undefined },
      })
      done(result.data?.id)
    } catch (failure) {
      if (failure instanceof RequestError && (failure.status === 0 || failure.status === 408
        || failure.status >= 500 || (failure.status >= 200 && failure.status < 300)
        || failure.code === 'IDEMPOTENCY_CONFLICT')) setUncertain(true)
      setError(failure instanceof Error ? failure.message : 'تعذر تسجيل المعاملة.')
    } finally {
      setBusy(false)
    }
  }

  const drawerLabel = review?.shift ? 'درج البيع للوردية' : 'الدرج المخصص للمحافظ'
  return <Modal title={title} close={() => { if (!busy) close() }}>
    <form className="modal-form" onSubmit={submit}>
      <p>{String(wallet.name)} · {walletProviderLabel(wallet.provider)}</p>
      {review ? <>
        <h3 ref={reviewHeading} tabIndex={-1}>راجع المعاملة قبل التسجيل</h3>
        <dl className="invoice-summary">
          <div><dt>مبلغ المعاملة</dt><dd>{money(review.amount)}</dd></div>
          <div><dt>العمولة من العميل</dt><dd>{money(review.commission)}</dd></div>
          <div><dt>رسوم المزود</dt><dd>{money(review.fee)}</dd></div>
          <div><dt>صافي العمولة</dt><dd>{money(review.net)}</dd></div>
          <div><dt>تغيّر رصيد المزود</dt><dd>{money(review.provider)}</dd></div>
          <div><dt>تغيّر {drawerLabel}</dt><dd>{money(review.drawer)}</dd></div>
          {review.shift && <div><dt>الوردية</dt><dd>{review.shift.label}</dd></div>}
          {review.debt !== undefined && <div><dt>المبلغ الآجل</dt><dd>{money(review.debt)} · العميل #{integer(review.customer)}</dd></div>}
          {review.dueDate && <div><dt>تاريخ الاستحقاق</dt><dd>{formatDate(review.dueDate)}</dd></div>}
          <div><dt>مرجع المزود</dt><dd>{review.reference ? <bdi>{review.reference}</bdi> : 'غير مسجل'}</dd></div>
          {review.counterparty && <div><dt>رقم الطرف الآخر</dt><dd><bdi>{review.counterparty}</bdi></dd></div>}
        </dl>
        <p className="muted">أكد المعاملة فقط بعد مطابقة المبلغ والمرجع مع تطبيق المزود.</p>
      </> : <>
        <label className="field">المبلغ بالجنيه<input ref={amountField} value={amount} required inputMode="decimal" onChange={event => setAmount(event.target.value)} /></label>
        <label className="field">{fawry ? 'مرجع الحركة من فوري' : 'مرجع العملية لدى المزود (اختياري)'}
          <input dir="auto" value={reference} required={fawry} maxLength={100} onChange={event => setReference(event.target.value)} />
        </label>
        <label className="field">رقم الطرف الآخر (اختياري)<input dir="auto" value={counterparty} maxLength={50} onChange={event => setCounterparty(event.target.value)} /></label>
        <label className="field">عمولة العميل بالجنيه<input value={commission} inputMode="decimal" placeholder="حسب إعداد المحفظة" onChange={event => setCommission(event.target.value)} /></label>
        <label className="field">رسوم المزود بالجنيه<input value={fee} inputMode="decimal" placeholder="حسب إعداد المحفظة" onChange={event => setFee(event.target.value)} /></label>
        {kind === 'send' && <FormInput field={{ name: 'deferred_customer', label: 'العميل للسداد الآجل', kind: 'reference', reference: { path: '/customers' } }}
          value={customer} set={setCustomer} />}
        {deferred && <label className="field">تاريخ الاستحقاق<input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>}
        <label className="field">ملاحظة (اختياري)<textarea value={note} maxLength={1000} onChange={event => setNote(event.target.value)} /></label>
        {!deferred && shift.shift && <label className="check-field"><input type="checkbox" checked={shared}
          onChange={event => setShared(event.target.checked)} /> استخدم درج البيع للوردية</label>}
        {!deferred && shared && <ShiftContext value={shift} />}
        {!deferred && !shared && <p className="muted">يُسجل النقد في الدرج المخصص للمحافظ.</p>}
      </>}
      {error && <Notice error>{error}</Notice>}
      {uncertain && <p>أعد المحاولة بالبيانات المراجعة نفسها، أو <Link to={ledger}>ابحث في كشف المعاملات</Link> قبل تسجيل عملية جديدة.</p>}
      <div className="form-actions">
        <button className="primary" disabled={busy}>{busy ? 'جارٍ التسجيل…' : review ? uncertain ? 'إعادة المحاولة بالبيانات نفسها' : 'أكد تسجيل المعاملة' : 'راجع المعاملة'}</button>
        {review && !uncertain && <button type="button" className="secondary" disabled={busy} onClick={() => { setReview(undefined); setError('') }}>تعديل البيانات</button>}
        <button type="button" className="secondary" disabled={busy} onClick={close}>إغلاق</button>
      </div>
    </form>
  </Modal>
}

export function WalletLedger({ user, config }: { user: User; config: ModuleConfig }) {
  const [params, setParams] = useSearchParams()
  const [wallets, setWallets] = useState<Row[]>([])
  const [walletError, setWalletError] = useState('')
  const cash = allowed(user, 'wallets.cash')
  const query = new URLSearchParams()
  for (const key of filters) {
    const value = params.get(key)
    if (value && (key !== 'provider' || walletProviderFilterValue(value))) query.set(key, value)
  }
  const queryText = query.toString()
  const querySuffix = queryText ? '?' + queryText : ''
  const walletId = query.get('wallet_id') ?? ''
  const provider = walletProviderFilterValue(query.get('provider'))

  useEffect(() => {
    const controller = new AbortController()
    const filters = new URLSearchParams({ per_page: '100' })
    if (provider) filters.set('provider', provider)
    request<Row[]>('/wallets?' + filters, { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) { setWallets(result.data); setWalletError('') }
      })
      .catch(error => { if (!controller.signal.aborted) setWalletError(error.message) })
    return () => controller.abort()
  }, [provider])

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = new FormData(event.currentTarget)
    const next = new URLSearchParams()
    for (const key of filters) {
      const value = String(input.get(key) ?? '').trim()
      if (value) next.set(key, value)
    }
    if (next.get('provider') !== (provider ?? null)) next.delete('wallet_id')
    setParams(next)
  }

  const columns = config.columns.filter(column => cash || column.key !== 'cash_delta_minor').map(column => {
    if (column.key === 'delta_minor') return { ...column, label: 'أثر رصيد المزود' }
    if (column.key === 'cash_delta_minor') return { ...column, label: 'أثر النقد في الدرج' }
    return column
  })
  const dateColumn = columns.find(column => column.key === 'created_at')
  if (dateColumn) columns.splice(columns.indexOf(dateColumn), 1, { key: 'business_day', label: 'تاريخ العمل', render: row => formatDate(row.business_day) })
  columns.splice(3, 0,
    { key: 'reversal_state', label: 'حالة القيد', render: row => {
      const related = row.reversed_by ?? row.reversal_of
      if (typeof related !== 'number') return 'مسجل'
      const relatedQuery = new URLSearchParams({ wallet_id: String(row.wallet_id), q: '#' + related })
      return <Link to={'/wallet-transactions?' + relatedQuery}>{row.reversed_by ? 'معكوس بالقيد' : 'عكس القيد'} <bdi>#{related}</bdi></Link>
    } },
    { key: 'fee_minor', label: 'رسوم المزود', render: row => money(row.fee_minor) },
  )
  const filterForm = <form className="panel form-card section-space" key={queryText} onSubmit={filter}>
    <label className="field">مزود الخدمة<select name="provider" defaultValue={provider ?? ''}>
      <option value="">كل المزودين</option>
      {walletProviderFilters.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
    <label className="field">المحفظة<select name="wallet_id" defaultValue={walletId}>
      <option value="">كل المحافظ</option>
      {walletId && !wallets.some(row => String(row.id) === walletId) && <option value={walletId}>محفظة #{walletId}</option>}
      {wallets.map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.name)}</option>)}
    </select></label>
    <label className="field">نوع الحركة<select name="kind" defaultValue={query.get('kind') ?? ''}>
      <option value="">كل الأنواع</option>{Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label className="field">حالة القيد<select name="status" defaultValue={query.get('status') ?? ''}>
      <option value="">كل الحالات</option><option value="effective">قيود سارية</option><option value="reversed">قيود معكوسة وعكسها</option>
    </select></label>
    <label className="field">من<input type="date" name="from" defaultValue={query.get('from') ?? ''} /></label>
    <label className="field">إلى<input type="date" name="to" defaultValue={query.get('to') ?? ''} /></label>
    <label className="field">رقم القيد أو بداية مرجع المزود أو الطرف الآخر<input name="q" maxLength={100} defaultValue={query.get('q') ?? ''} /></label>
    <div className="form-actions">
      <button className="primary">تصفية المعاملات</button>
      <button type="button" className="secondary" onClick={() => setParams({})}>مسح التصفية</button>
      {cash && <a className="secondary" href={apiUrl('/wallet-transactions.csv' + querySuffix)} title="حتى ١٬٠٠٠ سجل">تصدير النتائج CSV</a>}
    </div>
  </form>
  return <DataModule key={queryText} user={user}
    config={{ ...config, columns, endpoint: config.endpoint + querySuffix }}
    renderAction={props => props.action.sharedDrawer ? <SharedDrawerDialog {...props} user={user} /> : <ActionDialog {...props} />}
    extra={<>
      <div className="form-actions"><Link className="secondary" to="/wallet-workspace">{walletManagementTitle}</Link>
        {allowed(user, 'wallets.transact') && <Link className="secondary" to={'/wallet-cashier' + (provider ? '?provider=' + provider : '')}>كاشير المحافظ</Link>}
      </div>
      {filterForm}{walletError && <Notice error>{walletError}</Notice>}
    </>} />
}
