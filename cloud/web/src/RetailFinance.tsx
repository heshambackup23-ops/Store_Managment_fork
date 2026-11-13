import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { FormEvent } from 'react'
import { allowed, apiUrl, decimal, integer, money, readMoney, request } from './api'
import type { User } from './api'
import { tenderLabels } from './RetailShifts'
import { RetailInventoryValuation } from './RetailInventoryValuation'
import { dataText, Modal, Notice, PageTitle } from './ui'
import type { Row } from './ui'
import { displayQuantity, formatQuantity } from './measurement'

const ages: Record<string, string> = { undated: 'بلا استحقاق مسجل', not_due: 'غير مستحق بعد', overdue_1_30: 'متأخر ١–٣٠ يومًا', overdue_31_60: '٣١–٦٠ يومًا', overdue_61_90: '٦١–٩٠ يومًا', overdue_90_plus: 'أكثر من ٩٠ يومًا' }
const sourceLabels: Record<string, string> = { invoice: 'فاتورة', installment: 'قسط', wallet_debt: 'آجل محفظة', personal_debt: 'دين شخصي', maintenance: 'صيانة', purchase: 'شراء', supplier_opening: 'افتتاحي مورد' }
const labels = { aging: 'أعمار الأرصدة', settlement: 'حركات القنوات غير النقدية', margin: 'هامش البضاعة المثبت', valuation: 'قيمة المخزون المثبتة', audit: 'سجل تدقيق المتجر' }
type View = keyof typeof labels
type Report = { items: Row[]; totals?: Record<string, number> | Row[]; from?: string; to?: string; as_of?: string }
type Column = [string, string, ('money' | 'number' | 'method' | 'source' | 'bucket' | 'length')?]

const agingColumns: Column[] = [['party', 'الطرف', undefined], ['source', 'المصدر', 'source'], ['id', 'رقم المستند', 'number'], ['due_date', 'الاستحقاق', undefined], ['outstanding_minor', 'المتبقي', 'money'], ['bucket', 'الفترة', 'bucket']]
const settlementColumns: Column[] = [['method', 'الوسيلة', 'method'], ['register_name', 'الدرج', undefined], ['reference', 'المرجع', undefined], ['delta_minor', 'الصافي', 'money'], ['created_at', 'توقيت القيد', undefined]]
const marginColumns: Column[] = [['category', 'الفئة', undefined], ['net_sales_minor', 'صافي المبيعات', 'money'], ['verified_sales_minor', 'مبيعات بتكلفة مثبتة', 'money'], ['verified_cost_minor', 'تكلفة مثبتة', 'money'], ['verified_margin_minor', 'الهامش المثبت', 'money'], ['unverified_quantity', 'قطع بلا تكلفة مثبتة', 'number'], ['unverified_length_mm', 'أمتار بلا تكلفة مثبتة', 'length']]
const auditColumns: Column[] = [['actor_name', 'الموظف'], ['action', 'الإجراء'], ['entity_type', 'نوع السجل'], ['entity_id', 'رقم السجل', 'number'], ['created_at', 'توقيت القيد']]

function exportReport(rows: Row[], columns: Column[], filename: string) {
  const csv = (value: unknown) => {
    const input = String(value ?? '')
    const safe = /^(?:[\s\uFEFF]*[=+@＝＋－＠-]|[\t\r\n])/u.test(input) ? "'" + input : input
    return '"' + safe.replaceAll('"', '""') + '"'
  }
  const lines = [columns.map(([, title]) => csv(title)).join(','), ...rows.map(row => columns.map(([key, , type]) =>
    type === 'money' ? decimal(row[key]) : type === 'length' ? String(displayQuantity(row[key], 1000))
      : type === 'number' && Number.isSafeInteger(row[key]) ? String(row[key]) : csv(row[key])).join(','))]
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
  const canAudit = allowed(user, 'retail.audit.view')
  const canExport = allowed(user, 'retail.accountant.export')
  const selectedView = params.get('view')
  const view: View = selectedView === 'settlement' && canViewSettlement ? 'settlement' : selectedView === 'margin' && canViewMargin ? 'margin' : selectedView === 'valuation' && canViewMargin ? 'valuation' : selectedView === 'audit' && canAudit ? 'audit' : 'aging'
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const side = params.get('side') === 'payable' ? 'payable' : 'receivable'
  const method = params.get('method') ?? ''
  const status = params.get('status') ?? ''
  const shiftId = params.get('shift_id') ?? ''
  const auditQuery = params.get('q') ?? ''
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [report, setReport] = useState<Report>()
  const [error, setError] = useState('')
  const [match, setMatch] = useState<Row>()
  const [batch, setBatch] = useState<Row[]>([])
  const [settlementAction, setSettlementAction] = useState<'batch' | 'reverse'>()
  const [revision, refresh] = useState(0)

  function filter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: key === 'q' })
    setPage(1)
    setBatch([])
  }

  useEffect(() => {
    if (view === 'valuation') return
    const controller = new AbortController()
    setError(''); setReport(undefined)
    const query = new URLSearchParams({ page: String(page), per_page: '25' })
    const path = view === 'aging' ? '/reports/aging' : view === 'settlement' ? '/reports/tender-settlements' : view === 'audit' ? '/retail/audit' : '/reports/retail-margin'
    if (view === 'aging') query.set('side', side)
    else {
      if (from) query.set('from', from)
      if (to) query.set('to', to)
      if (view === 'settlement' && method) query.set('method', method)
      if (view === 'settlement' && status) query.set('status', status)
      if (view === 'settlement' && /^\d+$/.test(shiftId)) query.set('shift_id', shiftId)
      if (view === 'audit' && auditQuery.trim()) query.set('q', auditQuery.trim())
    }
    request<Report | Row[]>(path + '?' + query, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) {
        const data = Array.isArray(result.data) ? { items: result.data, from, to } : result.data
        setReport(data); setTotal(result.meta?.total ?? data.items.length)
      }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [view, page, side, from, to, method, status, shiftId, revision, auditQuery])

  function render(value: unknown, kind: Column[2]) {
    if (kind === 'money') return money(value)
    if (kind === 'number') return integer(value)
    if (kind === 'length') return formatQuantity(value, 1000)
    if (kind === 'method') return tenderLabels[String(value) as keyof typeof tenderLabels] ?? dataText(value)
    if (kind === 'source') return sourceLabels[String(value)] ?? dataText(value)
    if (kind === 'bucket') return ages[String(value)] ?? dataText(value)
    return dataText(value)
  }
  const columns = view === 'aging' ? agingColumns : view === 'settlement' ? settlementColumns : view === 'audit' ? auditColumns : marginColumns
  const totals = report?.totals
  function document(row: Row) {
    if (view === 'settlement' && row.invoice_id && allowed(user, 'invoices.view')) return '/invoices/' + row.invoice_id
    if (view === 'aging' && row.source === 'invoice' && allowed(user, 'invoices.view')) return '/invoices/' + row.id
    if (view === 'aging' && row.source === 'purchase' && allowed(user, 'suppliers.view')) return '/purchases/' + row.id + '/receipts'
    return undefined
  }
  function toggleBatch(row: Row) {
    const same = (item: Row) => item.operation_id === row.operation_id && item.source === row.source && item.position === row.position
    setBatch(items => items.some(same) ? items.filter(item => !same(item)) : [...items, row])
  }
  function settlementDone() {
    setSettlementAction(undefined); setMatch(undefined); setBatch([]); refresh(value => value + 1)
  }
  const exportQuery = new URLSearchParams()
  if (from) exportQuery.set('from', from)
  if (to) exportQuery.set('to', to)
  return <>
    <PageTitle title="تقارير مالية للمتجر" action={canExport && <a className="secondary" href={apiUrl('/retail/accountant.csv?' + exportQuery)}>حركات المتجر للمحاسب CSV</a>} />
    <div className="form-actions section-space" aria-label="التقرير المعروض">{(Object.keys(labels) as View[]).filter(name => name === 'aging' || name === 'settlement' && canViewSettlement || (name === 'margin' || name === 'valuation') && canViewMargin || name === 'audit' && canAudit).map(name =>
      <button className={name === view ? 'primary' : 'secondary'} aria-pressed={name === view} key={name} onClick={() => filter('view', name)}>{labels[name]}</button>)}</div>
    {view === 'valuation' ? <RetailInventoryValuation canFilter={allowed(user, 'categories.view')} /> : <section className="panel panel-inner form-section section-space"><h2>{labels[view]}</h2>
      {view === 'aging' ? <label className="field">نوع الرصيد<select value={side} onChange={event => filter('side', event.target.value)}>
        <option value="receivable">لنا · مستحقات العملاء</option><option value="payable">علينا · مستحقات الموردين</option></select></label> : <div className="form-grid">
        <label className="field">من تاريخ<input type="date" value={from} onChange={event => filter('from', event.target.value)} /></label>
        <label className="field">إلى تاريخ<input type="date" value={to} onChange={event => filter('to', event.target.value)} /></label>
        {view === 'settlement' && <label className="field">القناة<select value={method} onChange={event => filter('method', event.target.value)}>
          <option value="">كل القنوات</option><option value="card">بطاقة</option><option value="wallet">محفظة</option><option value="bank_transfer">تحويل بنكي</option></select></label>}
        {view === 'settlement' && <label className="field">حالة المطابقة<select value={status} onChange={event => filter('status', event.target.value)}>
          <option value="">كل الحالات</option><option value="pending">بانتظار المطابقة</option><option value="matched">مطابق</option></select></label>}
        {view === 'settlement' && shiftId && <button className="secondary" onClick={() => filter('shift_id', '')}>مسح فلتر الوردية {integer(Number(shiftId))}</button>}
        {view === 'audit' && <label className="field">الموظف أو الإجراء أو رقم السجل<input type="search" value={auditQuery} onChange={event => filter('q', event.target.value)} /></label>}
      </div>}
      {view === 'settlement' && <p>قارن الحركات المسجّلة ومراجعها بكشف البنك أو المزود.</p>}
      {view === 'settlement' && batch.length > 0 && <div className="form-actions">
        <button type="button" className="primary" onClick={() => setSettlementAction('batch')}>تسوية الحركات المحددة ({integer(batch.length)})</button>
        <button type="button" className="secondary" onClick={() => setBatch([])}>مسح الاختيار</button>
      </div>}
      {canExport && <p className="muted">ملف المحاسب يفصل مستندات البيع والشراء عن التحصيل وحركات الدرج، ويبيّن المدفوعات القديمة مجهولة الوسيلة.</p>}
      {view === 'margin' && <p>الهامش يضم الأجهزة التي ثبتت تكلفة استلامها والأصناف الكمية ذات المتوسط المرجّح المثبت. القطع الأخرى تظهر بلا تكلفة مثبتة، وتظهر المرتجعات مقابل تاريخ الفاتورة الأصلية.</p>}
      {report && <p className="muted">{report.as_of ? `الأرصدة القائمة في ${report.as_of}` : `الفترة ${report.from ?? '—'} إلى ${report.to ?? '—'}`}</p>}
      {report?.items.length ? <button type="button" className="secondary" onClick={() => exportReport(report.items, columns, `hilal-${view}-${page}.csv`)}>تصدير الصفحة للمحاسب CSV</button> : null}
      {totals && (Array.isArray(totals) ? <div className="metric-grid">{totals.map(row => <div className="panel metric" key={String(row.method)}><p>{render(row.method, 'method')}</p><strong>{money(row.net_minor)}</strong><p>وارد {money(row.received_minor)} · صادر {money(row.paid_out_minor)}</p></div>)}</div>
        : <div className="metric-grid">{Object.entries(totals).map(([key, value]) => <div className="panel metric" key={key}><p>{ages[key] ?? key}</p><strong>{money(value)}</strong></div>)}</div>)}
      {error ? <Notice error>{error}</Notice> : !report ? <Notice>جارٍ إعداد التقرير…</Notice> : !report.items.length ? <p>لا توجد سجلات في التقرير.</p> :
        <div className="table-scroll" tabIndex={0} role="region" aria-label={labels[view]}><table><thead><tr>{columns.map(([key, label]) => <th scope="col" key={key}>{label}</th>)}{view === 'settlement' && <th scope="col">مطابقة الكشف</th>}</tr></thead>
          <tbody>{report.items.map((row, index) => <tr key={String(row.id ?? row.category_id ?? row.operation_id ?? index) + ':' + index}>
            {columns.map(([key, , kind]) => <td key={key}>{((view === 'aging' && key === 'id') || (view === 'settlement' && key === 'delta_minor')) && document(row)
              ? <Link to={document(row)!}>{render(row[key], kind)}</Link> : render(row[key], kind)}</td>)}
            {view === 'settlement' && <td>{row.settlement_status === 'matched' ? <>
              <span>{`مطابق · ${String(row.statement_reference)} · ${String(row.statement_date)}`}</span>{' '}
              <button type="button" className="link-button" onClick={() => { setMatch(row); setSettlementAction('reverse') }}>اعكس المطابقة</button>
            </> : <label className="checkbox-field"><input type="checkbox"
              disabled={batch.length > 0 && batch[0].method !== row.method || batch.length >= 40 && !batch.some(item => item.operation_id === row.operation_id && item.source === row.source && item.position === row.position)}
              checked={batch.some(item => item.operation_id === row.operation_id && item.source === row.source && item.position === row.position)}
              onChange={() => toggleBatch(row)} /> اختر للتسوية</label>}</td>}
          </tr>)}</tbody></table></div>}
      {total > 25 && view !== 'margin' && <nav className="pagination" aria-label="صفحات التقرير"><button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
        <button className="secondary" disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>التالي</button></nav>}
    </section>}
    {settlementAction && <SettleTenders key={settlementAction} rows={batch} reverse={settlementAction === 'reverse' ? match : undefined}
      close={() => { setSettlementAction(undefined); setMatch(undefined) }} done={settlementDone} />}
  </>
}

function SettleTenders({ rows, reverse, close, done }: { rows: Row[]; reverse?: Row; close: () => void; done: () => void }) {
  const [reference, setReference] = useState('')
  const [date, setDate] = useState('')
  const [amount, setAmount] = useState('')
  const [fee, setFee] = useState('0')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const gross = rows.reduce((sum, row) => sum + Number(row.delta_minor), 0)
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      if (reverse) await request(`/reports/tender-settlements/${reverse.settlement_id}/reverse`, { method: 'POST', financial: true, body: { reason: reason.trim() } })
      else {
        const negative = amount.trim().startsWith('-')
        await request('/reports/tender-settlements/batches', { method: 'POST', financial: true, body: {
          method: rows[0].method, items: rows.map(({ operation_id, source, position }) => ({ operation_id, source, position })),
          observed_minor: (negative ? -1 : 1) * readMoney(amount.trim().replace(/^-/, '')), fee_minor: readMoney(fee),
          statement_reference: reference.trim(), statement_date: date,
        } })
      }
      done()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر مطابقة الحركة.') }
    finally { setBusy(false) }
  }
  return <Modal title={reverse ? 'عكس مطابقة الكشف' : 'تسوية مع كشف البنك أو المزود'} close={() => { if (!busy) close() }}><form className="modal-form" onSubmit={submit}>
    {reverse ? <><p>مرجع الكشف {String(reverse.statement_reference)}. ترجع حركات هذه التسوية إلى انتظار المطابقة.</p>
      <label className="field">سبب العكس<textarea value={reason} maxLength={1000} required disabled={busy} onChange={event => setReason(event.target.value)} /></label></> : <>
    <p>صافي {integer(rows.length)} حركة قبل الرسوم {money(gross)}. اكتب المبلغ بإشارة سالبة لو خرج من الحساب.</p>
    <label className="field">الرسوم بالجنيه<input inputMode="decimal" value={fee} required disabled={busy} onChange={event => setFee(event.target.value)} /></label>
    <label className="field">صافي المبلغ في الكشف بالجنيه<input inputMode="decimal" value={amount} required disabled={busy} onChange={event => setAmount(event.target.value)} /></label>
    <label className="field">مرجع الحركة في الكشف<input value={reference} maxLength={100} required disabled={busy} onChange={event => setReference(event.target.value)} /></label>
    <label className="field">تاريخ الحركة في الكشف<input type="date" value={date} required disabled={busy} onChange={event => setDate(event.target.value)} /></label></>}
    {error && <Notice error>{error}</Notice>}
    <div className="form-actions"><button className="primary" disabled={busy}>{reverse ? 'سجّل العكس' : 'اعتمد المطابقة'}</button><button className="secondary" type="button" disabled={busy} onClick={close}>إلغاء</button></div>
  </form></Modal>
}
