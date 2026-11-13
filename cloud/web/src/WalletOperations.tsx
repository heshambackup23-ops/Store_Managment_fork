import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { allowed, apiUrl, formatDate, integer, money, request } from './api'
import type { User } from './api'
import { ActionDialog, DataModule, Notice } from './ui'
import { SharedDrawerDialog } from './RetailShifts'
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
  const [rows, setRows] = useState<Position[]>()
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  useEffect(() => {
    const controller = new AbortController()
    request<Position[]>('/wallets/positions?' + new URLSearchParams({ page: String(page), per_page: '12' }), { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return
        setRows(result.data)
        setLastPage(Math.max(1, Math.ceil((result.meta?.total ?? result.data.length) / 12)))
        setError('')
      })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [page, revision])

  return <section className="section-space" aria-label="أرصدة وحدود المحافظ">
    <h2>الأرصدة والحدود بتوقيت القاهرة</h2>
    {error ? <Notice error>{error}</Notice> : !rows ? <Notice>جارٍ تحميل الأرصدة…</Notice> : !rows.length ? <Notice>لا توجد محافظ.</Notice> :
      <div className="wallet-positions">
        {rows.map(row => <article className="panel panel-inner wallet-position" key={row.id}>
          <header><h3>{row.name}</h3><span className="muted">{row.provider || '—'} · {row.active ? 'نشطة' : 'موقوفة'}</span></header>
          <dl className="invoice-summary">
            <div><dt>رصيد المزود</dt><dd>{money(row.balance_minor)}</dd></div>
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

const filters = ['wallet_id', 'kind', 'status', 'from', 'to', 'q'] as const
const kinds = {
  opening: 'رصيد افتتاحي', send: 'إرسال', receive: 'استقبال', expense: 'مصروف',
  settlement_in: 'تسوية داخلة', settlement_out: 'تسوية خارجة', reversal: 'عكس',
}

export function WalletLedger({ user, config }: { user: User; config: ModuleConfig }) {
  const [params, setParams] = useSearchParams()
  const [wallets, setWallets] = useState<Row[]>([])
  const [walletError, setWalletError] = useState('')
  const cash = allowed(user, 'wallets.cash')
  const query = new URLSearchParams()
  for (const key of filters) {
    const value = params.get(key)
    if (value) query.set(key, value)
  }
  const queryText = query.toString()
  const querySuffix = queryText ? '?' + queryText : ''
  const walletId = query.get('wallet_id') ?? ''

  useEffect(() => {
    const controller = new AbortController()
    request<Row[]>('/wallets?per_page=100', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setWallets(result.data) })
      .catch(error => { if (!controller.signal.aborted) setWalletError(error.message) })
    return () => controller.abort()
  }, [])

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = new FormData(event.currentTarget)
    const next = new URLSearchParams()
    for (const key of filters) {
      const value = String(input.get(key) ?? '').trim()
      if (value) next.set(key, value)
    }
    setParams(next)
  }

  const columns = config.columns.filter(column => cash || column.key !== 'cash_delta_minor')
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
    extra={<>{filterForm}{walletError && <Notice error>{walletError}</Notice>}</>} />
}
