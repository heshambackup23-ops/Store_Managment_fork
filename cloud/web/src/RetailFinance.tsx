import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { FormEvent } from 'react'
import { allowed, integer, money, readMoney, request } from './api'
import type { User } from './api'
import { tenderLabels } from './RetailShifts'
import { dataText, Modal, Notice, PageTitle } from './ui'
import type { Row } from './ui'
import { decimal } from './api'

const ages: Record<string, string> = { undated: 'بلا استحقاق مسجل', not_due: 'غير مستحق بعد', overdue_1_30: 'متأخر ١–٣٠ يومًا', overdue_31_60: '٣١–٦٠ يومًا', overdue_61_90: '٦١–٩٠ يومًا', overdue_90_plus: 'أكثر من ٩٠ يومًا' }
const sourceLabels: Record<string, string> = { invoice: 'فاتورة', installment: 'قسط', wallet_debt: 'آجل محفظة', personal_debt: 'دين شخصي', maintenance: 'صيانة', purchase: 'شراء', supplier_opening: 'افتتاحي مورد' }
const labels = { aging: 'أعمار الأرصدة', settlement: 'حركات القنوات غير النقدية', margin: 'هامش البضاعة المثبت' }
type View = keyof typeof labels
type Report = { items: Row[]; totals?: Record<string, number> | Row[]; from?: string; to?: string; as_of?: string }
type Column = [string, string, ('money' | 'number' | 'method' | 'source' | 'bucket')?]

const agingColumns: Column[] = [['party', 'الطرف', undefined], ['source', 'المصدر', 'source'], ['id', 'رقم المستند', 'number'], ['due_date', 'الاستحقاق', undefined], ['outstanding_minor', 'المتبقي', 'money'], ['bucket', 'الفترة', 'bucket']]
const settlementColumns: Column[] = [['method', 'الوسيلة', 'method'], ['register_name', 'الدرج', undefined], ['reference', 'المرجع', undefined], ['delta_minor', 'الصافي', 'money'], ['created_at', 'توقيت القيد', undefined]]
const marginColumns: Column[] = [['category', 'الفئة', undefined], ['net_sales_minor', 'صافي المبيعات', 'money'], ['verified_sales_minor', 'مبيعات بتكلفة مثبتة', 'money'], ['verified_cost_minor', 'تكلفة مثبتة', 'money'], ['verified_margin_minor', 'الهامش المثبت', 'money'], ['unverified_quantity', 'قطع بلا تكلفة مثبتة', 'number']]

function exportReport(rows: Row[], columns: Column[], filename: string) {
  const csv = (value: unknown) => {
    const input = String(value ?? '')
    const safe = /^(?:[\s\uFEFF]*[=+@＝＋－＠-]|[\t\r\n])/u.test(input) ? "'" + input : input
    return '"' + safe.replaceAll('"', '""') + '"'
  }
  const lines = [columns.map(([, title]) => csv(title)).join(','), ...rows.map(row => columns.map(([key, , type]) =>
    type === 'money' ? decimal(row[key]) : type === 'number' && Number.isSafeInteger(row[key]) ? String(row[key]) : csv(row[key])).join(','))]
  const url = URL.createObjectURL(new Blob(['\uFEFF', lines.join('\r\n'), '\r\n'], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function RetailFinance({ user }: { user: User }) {
  const [params, setParams] = useSearchParams()
  const canViewSettlement = allowed(user, 'retail.shifts.approve')
  const canViewMargin = allowed(user, 'products.cost.view')
  const view: View = params.get('view') === 'settlement' && canViewSettlement ? 'settlement' : params.get('view') === 'margin' && canViewMargin ? 'margin' : 'aging'
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [side, setSide] = useState('receivable')
  const [method, setMethod] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [report, setReport] = useState<Report>()
  const [error, setError] = useState('')
  const [match, setMatch] = useState<Row>()
  const [revision, refresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError(''); setReport(undefined)
    const query = new URLSearchParams({ page: String(page), per_page: '25' })
    const path = view === 'aging' ? '/reports/aging' : view === 'settlement' ? '/reports/tender-settlements' : '/reports/retail-margin'
    if (view === 'aging') query.set('side', side)
    else {
      if (from) query.set('from', from)
      if (to) query.set('to', to)
      if (view === 'settlement' && method) query.set('method', method)
      if (view === 'settlement' && status) query.set('status', status)
    }
    request<Report>(path + '?' + query, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setReport(result.data); setTotal(result.meta?.total ?? result.data.items.length) }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [view, page, side, from, to, method, status, revision])

  function render(value: unknown, kind: Column[2]) {
    if (kind === 'money') return money(value)
    if (kind === 'number') return integer(value)
    if (kind === 'method') return tenderLabels[String(value) as keyof typeof tenderLabels] ?? dataText(value)
    if (kind === 'source') return sourceLabels[String(value)] ?? dataText(value)
    if (kind === 'bucket') return ages[String(value)] ?? dataText(value)
    return dataText(value)
  }
  const columns = view === 'aging' ? agingColumns : view === 'settlement' ? settlementColumns : marginColumns
  const totals = report?.totals
  return <>
    <PageTitle title="تقارير مالية للمتجر" />
    <div className="form-actions section-space" aria-label="التقرير المعروض">{(Object.keys(labels) as View[]).filter(name => name === 'aging' || name === 'settlement' && canViewSettlement || name === 'margin' && canViewMargin).map(name =>
      <button className={name === view ? 'primary' : 'secondary'} aria-pressed={name === view} key={name} onClick={() => { setPage(1); setParams({ view: name }) }}>{labels[name]}</button>)}</div>
    <section className="panel panel-inner form-section section-space"><h2>{labels[view]}</h2>
      {view === 'aging' ? <label className="field">نوع الرصيد<select value={side} onChange={event => { setSide(event.target.value); setPage(1) }}>
        <option value="receivable">لنا · مستحقات العملاء</option><option value="payable">علينا · مستحقات الموردين</option></select></label> : <div className="form-grid">
        <label className="field">من تاريخ<input type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1) }} /></label>
        <label className="field">إلى تاريخ<input type="date" value={to} onChange={event => { setTo(event.target.value); setPage(1) }} /></label>
        {view === 'settlement' && <label className="field">القناة<select value={method} onChange={event => { setMethod(event.target.value); setPage(1) }}>
          <option value="">كل القنوات</option><option value="card">بطاقة</option><option value="wallet">محفظة</option><option value="bank_transfer">تحويل بنكي</option></select></label>}
        {view === 'settlement' && <label className="field">حالة المطابقة<select value={status} onChange={event => { setStatus(event.target.value); setPage(1) }}>
          <option value="">كل الحالات</option><option value="pending">بانتظار المطابقة</option><option value="matched">مطابق</option></select></label>}
      </div>}
      {view === 'settlement' && <p>قارن الحركات المسجّلة ومراجعها بكشف البنك أو المزود.</p>}
      {view === 'margin' && <p>الهامش محسوب للأجهزة التي ثبتت تكلفة استلامها. القطع الأخرى تظهر في عمود التكلفة غير المثبتة، وتظهر المرتجعات مقابل تاريخ الفاتورة الأصلية.</p>}
      {report && <p className="muted">{report.as_of ? `الأرصدة القائمة في ${report.as_of}` : `الفترة ${report.from ?? '—'} إلى ${report.to ?? '—'}`}</p>}
      {report?.items.length ? <button type="button" className="secondary" onClick={() => exportReport(report.items, columns, `hilal-${view}-${page}.csv`)}>تصدير الصفحة للمحاسب CSV</button> : null}
      {totals && (Array.isArray(totals) ? <div className="metric-grid">{totals.map(row => <div className="panel metric" key={String(row.method)}><p>{render(row.method, 'method')}</p><strong>{money(row.net_minor)}</strong><p>وارد {money(row.received_minor)} · صادر {money(row.paid_out_minor)}</p></div>)}</div>
        : <div className="metric-grid">{Object.entries(totals).map(([key, value]) => <div className="panel metric" key={key}><p>{ages[key] ?? key}</p><strong>{money(value)}</strong></div>)}</div>)}
      {error ? <Notice error>{error}</Notice> : !report ? <Notice>جارٍ إعداد التقرير…</Notice> : !report.items.length ? <p>لا توجد سجلات في التقرير.</p> :
        <div className="table-scroll"><table><thead><tr>{columns.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}{view === 'settlement' && <th scope="col">مطابقة الكشف</th>}</tr></thead>
          <tbody>{report.items.map((row, index) => <tr key={String(row.id ?? row.category_id ?? row.operation_id ?? index) + ':' + index}>
            {columns.map(([key, , kind]) => <td key={key}>{render(row[key], kind)}</td>)}
            {view === 'settlement' && <td>{row.settlement_status === 'matched' ? `مطابق · ${String(row.statement_reference)} · ${String(row.statement_date)}`
              : <button type="button" className="link-button" onClick={() => setMatch(row)}>طابق مع الكشف</button>}</td>}
          </tr>)}</tbody></table></div>}
      {total > 25 && view !== 'margin' && <nav className="pagination" aria-label="صفحات التقرير"><button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
        <button className="secondary" disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>التالي</button></nav>}
    </section>
    {match && <MatchTender row={match} close={() => setMatch(undefined)} done={() => { setMatch(undefined); refresh(value => value + 1) }} />}
  </>
}

function MatchTender({ row, close, done }: { row: Row; close: () => void; done: () => void }) {
  const [reference, setReference] = useState('')
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const magnitude = readMoney(amount)
      await request('/reports/tender-settlements/match', { method: 'POST', financial: true, body: {
        operation_id: row.operation_id, source: row.source, position: row.position,
        observed_delta_minor: Number(row.delta_minor) < 0 ? -magnitude : magnitude,
        statement_reference: reference.trim(), statement_date: date,
      } })
      done()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر مطابقة الحركة.') }
    finally { setBusy(false) }
  }
  return <Modal title="مطابقة حركة مع كشف البنك أو المزود" close={() => { if (!busy) close() }}><form className="modal-form" onSubmit={submit}>
    <p>{Number(row.delta_minor) < 0 ? 'حركة صادرة' : 'حركة واردة'} · القيمة الدفترية {money(row.delta_minor)}</p>
    <label className="field">المبلغ من الكشف بالجنيه<input inputMode="decimal" value={amount} required disabled={busy} onChange={event => setAmount(event.target.value)} /></label>
    <label className="field">مرجع الحركة في الكشف<input value={reference} maxLength={100} required disabled={busy} onChange={event => setReference(event.target.value)} /></label>
    <label className="field">تاريخ الحركة في الكشف<input type="date" value={date} required disabled={busy} onChange={event => setDate(event.target.value)} /></label>
    {error && <Notice error>{error}</Notice>}
    <div className="form-actions"><button className="primary" disabled={busy}>اعتمد المطابقة</button><button className="secondary" type="button" disabled={busy} onClick={close}>إلغاء</button></div>
  </form></Modal>
}
