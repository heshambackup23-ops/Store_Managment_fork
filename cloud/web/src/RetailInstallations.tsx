import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { allowed, formatDate, request } from './api'
import type { User } from './api'
import { ActionDialog, DataModule, dataText, idOf, Modal, Notice } from './ui'
import type { ActionDialogProps, Field, ModuleConfig, Row } from './ui'

const installations = '/retail/installations'
const view = 'retail.installations.view'
const manage = 'retail.installations.manage'
const perform = 'retail.installations.perform'
const statusLabels: Record<string, string> = { scheduled: 'بانتظار الإسناد', assigned: 'مسند لفني', completed: 'تم التركيب',
  canceled: 'ملغى', returned: 'الجهاز مرتجع' }
const actionLabels: Record<string, string> = { schedule: 'تعديل الموعد والإسناد', deliver: 'إثبات التسليم', complete: 'إثبات التركيب', cancel: 'إلغاء الموعد' }
const appointmentViews = { all: 'كل المواعيد', today: 'اليوم', overdue: 'متأخرة', unassigned: 'بانتظار الإسناد' }
const isOpen = (row: Row) => row.status === 'scheduled' || row.status === 'assigned'
const actionPath = (row: Row | undefined, action: string) => installations + '/' + idOf(row) + '/' + action

function cairoDate() {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' })
  const parts = formatter.formatToParts(new Date())
  return ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-')
}

const schedule: Field[] = [
  { name: 'scheduled_on', label: 'تاريخ الموعد', kind: 'date', required: true, initial: cairoDate },
  { name: 'scheduled_time', label: 'الوقت بتوقيت القاهرة (مثال 14:30)', required: true, initial: '10:00' },
  { name: 'assignee_id', label: 'الفني المكلف', kind: 'reference', min: 1, nullable: true,
    reference: { path: installations + '/technicians' } },
  { name: 'note', label: 'ملاحظات الموعد', kind: 'textarea' },
]
const proof = (label: string): Field[] => [
  { name: 'occurred_on', label: 'التاريخ الفعلي', kind: 'date', required: true, initial: cairoDate },
  { name: 'proof_reference', label, required: true },
  { name: 'note', label: 'البيان', kind: 'textarea' },
]

type Sale = { id: number; invoice_id: number; name: string }
function ScheduleDialog({ close, done }: ActionDialogProps) {
  const [term, setTerm] = useState('')
  const [query, setQuery] = useState('')
  const [sales, setSales] = useState<Sale[]>([])
  const [selected, setSelected] = useState<Sale>()
  const [technicians, setTechnicians] = useState<{ id: number; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ per_page: '40' })
    if (query) params.set('q', query)
    request<Sale[]>(installations + '/sales?' + params, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setSales(result.data); setSearchError('') } })
      .catch(error => { if (!controller.signal.aborted) setSearchError(error.message) })
    return () => controller.abort()
  }, [query])
  useEffect(() => {
    const controller = new AbortController()
    request<typeof technicians>(installations + '/technicians?per_page=100', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setTechnicians(result.data) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !selected) return
    setError('')
    setBusy(true)
    try {
      const data = new FormData(event.currentTarget)
      await request(installations, { method: 'POST', financial: true, body: {
        invoice_id: selected.invoice_id, device_id: selected.id, service_address: String(data.get('service_address')),
        scheduled_on: String(data.get('scheduled_on')), scheduled_time: String(data.get('scheduled_time')),
        assignee_id: data.get('assignee_id') ? Number(data.get('assignee_id')) : null, note: String(data.get('note')),
      } })
      done()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تسجيل الموعد.') }
    finally { setBusy(false) }
  }
  return <Modal title="احجز موعد تركيب" close={() => { if (!busy) close() }}>
    <form className="modal-form" onSubmit={submit}>
      <label className="field">بحث برقم الفاتورة أو IMEI أو السيريال
        <input type="search" maxLength={100} value={term} disabled={busy} onChange={event => setTerm(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); setQuery(term.trim()) }
        }} />
      </label>
      <button className="secondary" type="button" disabled={busy} onClick={() => setQuery(term.trim())}>ابحث عن الجهاز</button>
      {searchError && <Notice error>{searchError}</Notice>}
      <label className="field">الجهاز المباع
        <select required disabled={busy} value={selected?.id ?? ''} onChange={event => setSelected(sales.find(sale => sale.id === Number(event.target.value)))}>
          <option value="">{sales.length ? 'اختر الجهاز والفاتورة' : 'لا توجد أجهزة مطابقة'}</option>
          {selected && !sales.some(sale => sale.id === selected.id) && <option value={selected.id}>{selected.name}</option>}
          {sales.map(sale => <option key={sale.id} value={sale.id}>{sale.name}</option>)}
        </select>
      </label>
      <label className="field">عنوان التركيب<input name="service_address" required maxLength={500} disabled={busy} /></label>
      <label className="field">تاريخ الموعد<input name="scheduled_on" type="date" defaultValue={cairoDate()} required disabled={busy} /></label>
      <label className="field">الوقت بتوقيت القاهرة<input name="scheduled_time" type="time" defaultValue="10:00" required disabled={busy} /></label>
      <label className="field">الفني المكلف<select name="assignee_id" disabled={busy}><option value="">إسناد لاحقًا</option>
        {technicians.map(technician => <option key={technician.id} value={technician.id}>{technician.name}</option>)}
      </select></label>
      <label className="field">ملاحظات الموعد<textarea name="note" maxLength={1000} disabled={busy} /></label>
      {error && <Notice error>{error}</Notice>}
      <div className="form-actions"><button className="primary" disabled={busy || !selected}>{busy ? 'جارٍ الحفظ…' : 'احجز موعد تركيب'}</button></div>
    </form>
  </Modal>
}

function InstallationDetail({ id, close, user }: { id: number; close: () => void; user: User }) {
  const [detail, setDetail] = useState<Row>()
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    request<Row>(installations + '/' + id, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setDetail(result.data) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [id])
  return <Modal title={'أمر تركيب ' + id} close={close}>
    <div className="modal-form">
      {error && <Notice error>{error}</Notice>}
      {!detail && !error && <Notice>جارٍ التحميل…</Notice>}
      {detail && <>
        <p className="retail-stat-list"><span className="retail-status">{statusLabels[String(detail.status)]}</span>
          {isOpen(detail) && <strong>{!detail.assignee_id ? 'الخطوة التالية إسناد الموعد لفني'
            : !detail.delivered_on ? 'الخطوة التالية إثبات التسليم' : 'الخطوة التالية إثبات التركيب'}</strong>}</p>
        <dl className="invoice-summary">
          <div><dt>الجهاز</dt><dd>{allowed(user, 'inventory.view') ? <Link to={'/retail-devices/' + detail.device_id}>{dataText(detail.product_name)}</Link> : dataText(detail.product_name)}</dd></div>
          <div><dt>عنوان التركيب</dt><dd>{dataText(detail.service_address)}</dd></div>
          <div><dt>الموعد</dt><dd>{formatDate(detail.scheduled_on)} · <bdi>{dataText(detail.scheduled_time)}</bdi></dd></div>
          <div><dt>ملاحظات الحجز</dt><dd>{dataText(detail.note)}</dd></div>
          <div><dt>إثبات التسليم</dt><dd>{formatDate(detail.delivered_on)} · <bdi>{dataText(detail.delivery_proof_reference)}</bdi></dd></div>
          <div><dt>إثبات التركيب</dt><dd>{formatDate(detail.completed_on)} · <bdi>{dataText(detail.proof_reference)}</bdi></dd></div>
        </dl>
        <h3>سجل الإجراءات</h3>
        {Array.isArray(detail.history) && detail.history.length ? <ul className="dash-list">
          {detail.history.map((row: Row) => <li key={String(row.id)}>
            {actionLabels[String(row.kind)]} · {dataText(row.actor_name)} · {formatDate(row.created_at)}
            {Boolean(row.scheduled_on) && <> · {formatDate(row.scheduled_on)} · <bdi>{dataText(row.scheduled_time)}</bdi> · {dataText(row.assignee_name)}</>}
            {Boolean(row.note) && <> · {dataText(row.note)}</>}
          </li>)}
        </ul> : <p className="muted">لم يُعدّل الموعد بعد.</p>}
      </>}
    </div>
  </Modal>
}

export function RetailInstallations({ user }: { user: User }) {
  const [parameters, setParameters] = useSearchParams()
  const canManage = allowed(user, manage)
  const requestedView = parameters.get('view') ?? ''
  const appointmentView = (requestedView in appointmentViews && (requestedView !== 'unassigned' || canManage))
    ? requestedView as keyof typeof appointmentViews : 'all'
  const detail = Number(parameters.get('job'))
  const setDetail = (id?: number) => {
    const next = new URLSearchParams(parameters)
    if (id !== undefined) next.set('job', String(id))
    else next.delete('job')
    setParameters(next)
  }
  function show(view: keyof typeof appointmentViews) {
    const next = new URLSearchParams(parameters)
    if (view === 'all') next.delete('view')
    else next.set('view', view)
    setParameters(next)
  }
  const path = appointmentView === 'unassigned' ? installations + '?status=scheduled' :
    appointmentView === 'all' ? installations : installations + '?due=' + appointmentView
  const config: ModuleConfig = {
    title: 'مواعيد التركيب',
    description: 'احجز موعدًا لقطعة مبيعة، وأسندها لفني وسجّل إثبات التسليم والتركيب.',
    endpoint: path,
    permission: view,
    empty: appointmentView === 'all' ? 'لا توجد مواعيد تركيب.' : 'لا توجد مواعيد في هذا العرض.',
    columns: [
      { key: 'invoice_id', label: 'الفاتورة', render: row => allowed(user, 'invoices.view')
        ? <Link to={'/invoices/' + row.invoice_id}>{dataText(row.invoice_id)}</Link> : dataText(row.invoice_id) },
      { key: 'product_name', label: 'الجهاز', render: row => <>{dataText(row.product_name)} · <bdi>{dataText(row.serial_number ?? row.imei1)}</bdi></> },
      { key: 'customer_name', label: 'العميل' },
      { key: 'scheduled_on', label: 'الموعد', render: row => <>{formatDate(row.scheduled_on)} · <bdi>{dataText(row.scheduled_time)}</bdi></> },
      { key: 'assignee_name', label: 'الفني' },
      { key: 'status', label: 'الحالة', render: row => <span className="retail-status"
        data-tone={isOpen(row) && String(row.scheduled_on) < cairoDate() ? 'attention' : undefined}>{statusLabels[String(row.status)] ?? '—'}</span> },
      { key: 'proof_reference', label: 'إثبات التركيب', render: row => <bdi>{dataText(row.proof_reference)}</bdi> },
    ],
    create: { label: 'احجز موعد تركيب', endpoint: () => installations, permission: manage },
    actions: [
      { label: 'عدّل الموعد أو الفني', permission: manage, endpoint: row => actionPath(row, 'reschedule'), financial: true,
        fields: schedule, initialFromRow: true, visible: isOpen },
      { label: 'سجّل إثبات التسليم', endpoint: row => actionPath(row, 'deliver'), financial: true, fields: proof('مرجع إثبات التسليم'),
        visible: row => isOpen(row) && !row.delivered_on && (canManage || (allowed(user, perform) && row.assignee_id === user.id)) },
      { label: 'أثبت التركيب', permission: perform, endpoint: row => actionPath(row, 'complete'), financial: true,
        fields: proof('مرجع إثبات التركيب'), visible: row => row.status === 'assigned' && row.assignee_id === user.id && !!row.delivered_on },
      { label: 'ألغِ الموعد', permission: manage, endpoint: row => actionPath(row, 'cancel'), financial: true, danger: true,
        fields: [{ name: 'note', label: 'سبب الإلغاء', kind: 'textarea', required: true }], visible: row => isOpen(row) || row.status === 'returned' },
    ],
  }
  return <>
    <DataModule key={appointmentView} config={config} user={user}
      extra={<div className="retail-switcher" role="group" aria-label="عرض مواعيد التركيب">
        {Object.entries(appointmentViews).filter(([key]) => key !== 'unassigned' || canManage).map(([key, label]) =>
          <button type="button" key={key} aria-pressed={key === appointmentView} className={key === appointmentView ? 'primary' : 'secondary'}
            onClick={() => show(key as keyof typeof appointmentViews)}>{label}</button>)}
      </div>} rowActions={row =>
      <button className="link-button" onClick={() => setDetail(Number(row.id))}>التفاصيل</button>}
      renderAction={props => props.action === config.create ? <ScheduleDialog {...props} /> : <ActionDialog {...props} />} />
    {Number.isSafeInteger(detail) && detail > 0 && <InstallationDetail id={detail} user={user} close={() => setDetail()} />}
  </>
}
