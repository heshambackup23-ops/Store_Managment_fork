import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { formatDate, integer, money, request } from './api'
import { Notice } from './ui'

type PeriodRow = {
  transactions: number
  sent_minor: number
  received_minor: number
  commission_minor: number
  fee_minor: number
  expense_minor: number
  net_minor: number
}
type Report = {
  from: string
  to: string
  totals: PeriodRow & { cash_movement_minor: number; shared_cash_movement_minor: number; cash_collections_minor: number; new_deferred_minor: number }
  wallets: (PeriodRow & { wallet_id: number; name: string })[]
  days: (PeriodRow & { day: string })[]
}
type AuditRow = { id: number; actor_name: string | null; action: string; entity_id: number | null; created_at: string }

const metrics = [
  ['transactions', 'العمليات', integer], ['sent_minor', 'المرسل', money], ['received_minor', 'المستلم', money],
  ['commission_minor', 'العمولات', money], ['fee_minor', 'رسوم المزود', money], ['expense_minor', 'المصروفات', money],
  ['net_minor', 'صافي الربح', money],
] as const
const cashMetrics = [
  ['cash_movement_minor', 'صافي حركة درج المحافظ'], ['shared_cash_movement_minor', 'صافي الحركة على درج البيع'], ['cash_collections_minor', 'تحصيل الآجل'], ['new_deferred_minor', 'الآجل الجديد'],
] as const

const auditLabels: Record<string, string> = {
  'wallet.create': 'إنشاء محفظة', 'wallet.update': 'تعديل محفظة', 'wallet.active': 'تغيير تفعيل المحفظة',
  'wallet.adjust': 'تسوية رصيد محفظة', 'wallet.transaction': 'عملية محفظة', 'wallet.reverse': 'عكس عملية',
  'wallet.reconcile': 'جرد رصيد',
  'wallet.cash': 'حركة درج', 'wallet.expense.reverse': 'عكس مصروف', 'wallet.profit.withdraw': 'سحب أرباح',
  'wallet_debt_payments.create': 'تحصيل آجل',
}

export function WalletPeriodReport({ revision }: { revision: number }) {
  const [mode, setMode] = useState('daily')
  const [query, setQuery] = useState('mode=daily')
  const [data, setData] = useState<Report>()
  const [error, setError] = useState('')
  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    const controller = new AbortController()
    request<Report>('/reports/wallets/period?' + query, { signal: controller.signal })
      .then(result => setData(result.data))
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [query, revision])

  function select(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const next = new URLSearchParams({ mode })
    const field = mode === 'daily' ? 'date' : 'month'
    next.set(field, String(values.get(field)))
    if (next.toString() === query) return
    setError('')
    setData(undefined)
    setQuery(next.toString())
  }

  return <section className="section-space" aria-label="تقارير المحافظ حسب الفترة">
    <h2>تقارير المحافظ حسب الفترة</h2>
    <form className="panel form-card section-space" onSubmit={select}>
      <label className="field">الفترة<select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="daily">يومي</option><option value="monthly">شهري</option>
      </select></label>
      {mode === 'daily'
        ? <label className="field">اليوم<input name="date" type="date" defaultValue={today} required /></label>
        : <label className="field">الشهر<input name="month" type="month" defaultValue={today.slice(0, 7)} required /></label>}
      <div className="form-actions"><button className="primary">عرض التقرير</button></div>
    </form>
    {error ? <Notice error>{error}</Notice> : !data ? <Notice>جارٍ تحميل الفترة…</Notice> : <>
      <p className="section-space">من {formatDate(data.from)} إلى {formatDate(data.to)}</p>
      <div className="metric-grid">{metrics.map(([key, label, format]) =>
        <article className="panel metric" key={key}><p>{label}</p><strong>{format(data.totals[key])}</strong></article>)}
      {cashMetrics.map(([key, label]) =>
        <article className="panel metric" key={key}><p>{label}</p><strong>{money(data.totals[key])}</strong></article>)}</div>
      <ReportTable title="حسب المحفظة" heading="المحفظة"
        rows={data.wallets.map(row => ({ id: String(row.wallet_id), label: row.name, row }))} />
      {query.includes('mode=monthly') && data.days.length > 0 && <ReportTable title="التفصيل اليومي" heading="اليوم"
        rows={data.days.map(row => ({ id: row.day, label: formatDate(row.day), row }))} />}
    </>}
  </section>
}

function ReportTable({ title, heading, rows }: { title: string; heading: string; rows: { id: string; label: string; row: PeriodRow }[] }) {
  return <section className="panel data-panel section-space" aria-label={title}>
    <div className="data-toolbar">{title}</div>
    {rows.length === 0 ? <p className="table-state">لا توجد عمليات في هذه الفترة.</p> : <div className="table-scroll" tabIndex={0}>
      <table><thead><tr><th scope="col">{heading}</th>{metrics.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}</tr></thead>
        <tbody>{rows.map(({ id, label, row }) => <tr key={id}><th scope="row">{label}</th>
          {metrics.map(([key, , format]) => <td key={key}>{format(row[key])}</td>)}</tr>)}</tbody></table>
    </div>}
  </section>
}

export function WalletAudit() {
  const [data, setData] = useState<AuditRow[]>()
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const parameters = new URLSearchParams(query)
    parameters.set('page', String(page))
    parameters.set('per_page', '25')
    request<AuditRow[]>('/wallet-audit?' + parameters, { signal: controller.signal })
      .then(result => { setData(result.data); setTotal(result.meta?.total ?? 0) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [open, page, query])

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const next = new URLSearchParams()
    for (const key of ['q', 'action', 'from', 'to']) {
      const value = String(fields.get(key) ?? '').trim()
      if (value) next.set(key, value)
    }
    if (page === 1 && next.toString() === query) return
    setData(undefined)
    setError('')
    setPage(1)
    setQuery(next.toString())
  }

  return <section className="section-space">
    <button type="button" className="secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>سجل تدقيق المحافظ</button>
    {open && <>
      <form className="panel form-card section-space" onSubmit={filter}>
        <label className="field">بحث<input name="q" placeholder="المستخدم أو رقم القيد" maxLength={80} /></label>
        <label className="field">الإجراء<select name="action"><option value="">جميع الإجراءات</option>
          {Object.entries(auditLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="field">من<input name="from" type="date" /></label>
        <label className="field">إلى<input name="to" type="date" /></label>
        <div className="form-actions"><button className="primary">بحث</button></div>
      </form>
      {error ? <Notice error>{error}</Notice> : !data ? <Notice>جارٍ تحميل السجل…</Notice> :
        <section className="panel data-panel" aria-label="عمليات تدقيق المحافظ">
          {data.length === 0 ? <p className="table-state">لا توجد قيود مطابقة.</p> : <div className="table-scroll" tabIndex={0}>
            <table><thead><tr><th scope="col">المستخدم</th><th scope="col">الإجراء</th><th scope="col">القيد</th><th scope="col">التاريخ</th></tr></thead>
              <tbody>{data.map(row => <tr key={row.id}><td>{row.actor_name ?? '—'}</td><td>{auditLabels[row.action] ?? row.action}</td>
                <td>{row.entity_id ?? '—'}</td><td>{formatDate(row.created_at)}</td></tr>)}</tbody></table>
          </div>}
          <div className="form-actions">
            <button type="button" className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
            <button type="button" className="secondary" disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>التالي</button>
          </div>
        </section>}
    </>}
  </section>
}
