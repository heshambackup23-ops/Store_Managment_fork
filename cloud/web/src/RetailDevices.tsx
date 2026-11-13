import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { allowed, formatDate, money, request } from './api'
import type { User } from './api'
import { Notice, PageTitle } from './ui'

export type Tracking = 'quantity' | 'serial' | 'imei'
export type Device = {
  id: number; product_id: number; product_name: string; serial_number?: string | null;
  imei1?: string | null; imei2?: string | null; status: string; receipt_id?: number | null;
  branch_id?: number;
  used_acquisition_id?: number | null; used_grade?: 'excellent' | 'good' | 'fair' | null;
  used_battery_percent?: number | null; used_accessories?: string | null; used_defects?: string | null;
}
const usedGrades = { excellent: 'ممتاز', good: 'جيد', fair: 'مقبول' }
export const trackingOf = (value: unknown): Tracking => value === 'serial' || value === 'imei' ? value : 'quantity'
export const deviceLabel = (device: Device) => [device.serial_number, device.imei1, device.imei2].filter(Boolean).join(' / ') || '#' + device.id
const states: Record<string, string> = { available: 'متاح', sold: 'مباع', quarantined: 'معزول للفحص', quarantine: 'معزول للفحص',
  voided: 'استلام معكوس', returned_to_supplier: 'مرتجع للمورد', stocktake_missing: 'مفقود بالجرد', in_repair: 'صيانة داخلية', written_off: 'هالك معتمد' }
const dispositions = { repair: 'صيانة داخلية', supplier: 'رد للمورد', write_off: 'إعدام كهالك' }
type Disposition = keyof typeof dispositions
const dispositionPermissions: Record<Disposition, string> = { repair: 'maintenance.manage', supplier: 'suppliers.manage', write_off: 'damaged.manage' }
const dispositionApprover = 'retail.devices.disposition.approve'
const eventLabels = { delivered: 'إثبات تسليم', installed: 'إثبات تركيب', warranty_claim: 'مطالبة ضمان' }
const warrantyBasis = { sale: 'الفاتورة', delivery: 'التسليم', installation: 'التركيب' }
const warrantyStates = { none: 'بدون ضمان مسجل', pending: 'بانتظار تاريخ البدء', active: 'سارٍ', expired: 'منتهي', returned: 'مرتجع' }

export function DevicePicker({ productId, purchaseId, branchId, productName, quantity, selected, change, disabled }: {
  productId: number; purchaseId?: number; branchId?: number; productName: string; quantity: number; selected: number[]; change: (ids: number[]) => void; disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<Device[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [cached, setCached] = useState<Record<number, Device>>({})
  useEffect(() => {
    const controller = new AbortController()
    const filter = new URLSearchParams({ product_id: String(productId), status: 'available', per_page: '50' })
    if (purchaseId) filter.set('purchase_id', String(purchaseId))
    if (branchId) filter.set('branch_id', String(branchId))
    if (query) filter.set('q', query)
    request<Device[]>('/retail/devices?' + filter, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return
      setRows(result.data)
      setTotal(result.meta?.total ?? result.data.length)
      setCached(previous => ({ ...previous, ...Object.fromEntries(result.data.map(device => [device.id, device])) }))
      setError('')
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [productId, purchaseId, branchId, query])
  return <fieldset className="panel panel-inner form-section" disabled={disabled}>
    <legend>{productName} · حدد {quantity} قطعة</legend>
    <label className="field">بحث بالرقم التسلسلي أو IMEI
      <input type="search" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); setQuery(search.trim()) }
      }} />
    </label>
    <button className="secondary" type="button" onClick={() => setQuery(search.trim())}>ابحث عن الجهاز</button>
    {error && <Notice error>{error}</Notice>}
    {total > rows.length && <p>تظهر أول ٥٠ قطعة. ابحث عن الرقم لتحديد قطعة أخرى.</p>}
    {!error && rows.length === 0 && <p className="muted">لا توجد قطع مطابقة متاحة.</p>}
    <div className="form-section">
      {rows.map(device => <label className="check-field" key={device.id}>
        <input type="checkbox" checked={selected.includes(device.id)} disabled={selected.length >= quantity && !selected.includes(device.id)}
          onChange={event => change(event.target.checked ? [...selected, device.id] : selected.filter(id => id !== device.id))} /> <bdi>{deviceLabel(device)}</bdi>
        {device.used_grade && <span> · مستعمل {usedGrades[device.used_grade]}
          {device.used_battery_percent != null && ' · البطارية ' + device.used_battery_percent + '%'}
          {device.used_accessories && ' · الملحقات: ' + device.used_accessories}
          {device.used_defects && ' · العيوب: ' + device.used_defects}</span>}
      </label>)}
      {selected.filter(id => !rows.some(row => row.id === id)).map(id => <button key={id} type="button" className="link-button" onClick={() => change(selected.filter(value => value !== id))}>إزالة {cached[id] ? deviceLabel(cached[id]) : '#' + id}</button>)}
    </div>
  </fieldset>
}

type DispositionRecord = {
  id: number; return_id: number; disposition: Disposition; reason: string; requested_by: string; actor_id: number;
  decision?: 'approve' | 'reject' | null; review_id?: number; review_reason?: string; reviewed_by?: string;
  repair_status?: string; repair_archived_at?: string; loss_minor?: number | null; supplier_reference?: string;
  credit_minor?: number; unapplied_credit_minor?: number;
}

type DeviceDetailData = Device & {
  sales?: { invoice_id: number; warranty_months?: number; invoice_date?: string; warranty_starts_on?: string | null;
    warranty_expires_on?: string | null; warranty_basis?: keyof typeof warrantyBasis; warranty_guarantor?: string | null;
    warranty_status?: keyof typeof warrantyStates; warranty_proof_reference?: string | null }[];
  events?: { id: number; kind: keyof typeof eventLabels; occurred_on: string; note?: string; proof_reference?: string | null; invoice_id?: number }[];
  returns?: { return_id: number; disposition: string }[];
  quarantine_resolutions?: { id: number; reason: string; created_at: string }[];
  dispositions?: DispositionRecord[];
  can_read_cost?: boolean;
  repairs?: { id: number; item: string; status: string; requested_date: string }[];
  purchase_id?: number | null;
  inventory_intake_id?: number | null; intake_source_reference?: string | null;
  installation_id?: number | null;
}

export function DeviceDetail({ user }: { user: User }) {
  const { id } = useParams()
  const [device, setDevice] = useState<DeviceDetailData>()
  const [kind, setKind] = useState<keyof typeof eventLabels>('delivered')
  const [occurredOn, setOccurredOn] = useState('')
  const [note, setNote] = useState('')
  const [proofReference, setProofReference] = useState('')
  const [resolution, setResolution] = useState('')
  const [disposition, setDisposition] = useState<Disposition | 'restock'>('restock')
  const [supplierReference, setSupplierReference] = useState('')
  const [reviewReason, setReviewReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, refresh] = useState(0)
  const path = '/retail/devices/' + encodeURIComponent(id || '')
  const currentReturn = device?.returns?.[0]
  const pending = device?.dispositions?.find(row => row.return_id === currentReturn?.return_id && !row.decision)
  const completedRepair = device?.dispositions?.some(row => row.return_id === currentReturn?.return_id &&
    row.disposition === 'repair' && row.decision === 'approve' && !row.repair_archived_at &&
    (row.repair_status === 'completed' || row.repair_status === 'delivered'))
  const availableDispositions = (Object.keys(dispositions) as Disposition[]).filter(choice =>
    allowed(user, dispositionPermissions[choice]) && (choice !== 'supplier' || device?.purchase_id) &&
    (choice !== 'repair' || device?.status !== 'in_repair'))

  useEffect(() => {
    const controller = new AbortController()
    request<DeviceDetailData>(path, { signal: controller.signal }).then(result => setDevice(result.data))
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [path, revision])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await request(path + '/events', { method: 'POST', financial: true, body: {
        kind, occurred_on: occurredOn || undefined, note: note.trim() || undefined,
        proof_reference: proofReference.trim() || undefined,
      } })
      setNote(''); setOccurredOn(''); setProofReference(''); refresh(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر تسجيل الإجراء.') }
    finally { setBusy(false) }
  }

  async function release(event: FormEvent) {
    event.preventDefault()
    if (busy || !currentReturn || pending) return
    setBusy(true); setError('')
    try {
      await request(path + (disposition === 'restock' ? '/quarantine-resolution' : '/dispositions'), { method: 'POST', financial: true,
        body: { disposition, reason: resolution.trim(), return_id: currentReturn.return_id,
          supplier_reference: disposition === 'supplier' ? supplierReference.trim() : undefined } })
      setResolution(''); setDisposition('restock'); setSupplierReference(''); refresh(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر إنهاء العزل.') }
    finally { setBusy(false) }
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !pending) return
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    if (!(submitter instanceof HTMLButtonElement)) return
    setBusy(true); setError('')
    try {
      await request(path + `/dispositions/${pending.id}/review`, { method: 'POST', financial: true,
        body: { decision: submitter.value, reason: reviewReason.trim() } })
      setReviewReason(''); refresh(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّرت مراجعة القرار.') }
    finally { setBusy(false) }
  }

  return <>
    <PageTitle title="سجل الجهاز" action={<Link className="secondary" to="/retail-devices">الأجهزة المتتبعة</Link>} />
    {error && <Notice error>{error}</Notice>}
    {!device ? !error && <Notice>جارٍ تحميل الجهاز…</Notice> : <>
      <section className="panel panel-inner form-section section-space">
        <h2>{device.product_name}</h2>
        <p><bdi>{deviceLabel(device)}</bdi> · {states[device.status] ?? device.status}</p>
        {device.purchase_id && <Link to={'/purchases/' + device.purchase_id + '/receipts'}>استلام المورد</Link>}
        {device.used_acquisition_id
          ? <p><Link to={'/retail-used-phones?q=' + encodeURIComponent(device.imei1 ?? '')}>شراء هاتف مستعمل رقم {device.used_acquisition_id}</Link>
            {device.used_grade && ' · ' + usedGrades[device.used_grade]}</p>
          : device.inventory_intake_id && <p>محضر افتتاح أو جرد رقم {device.inventory_intake_id} · <bdi>{device.intake_source_reference}</bdi></p>}
        {device.installation_id && <p><Link to={'/retail-installations?job=' + device.installation_id}>أمر تركيب رقم {device.installation_id}</Link></p>}
        {(device.sales ?? []).map(sale => <article className="form-section" key={sale.invoice_id}>
          <p><Link to={'/invoices/' + sale.invoice_id}>فاتورة {sale.invoice_id}</Link> · {formatDate(sale.invoice_date)}
            {sale.warranty_status && <> · {warrantyStates[sale.warranty_status]}</>}</p>
          {Boolean(sale.warranty_months) && <dl className="invoice-summary">
            <div><dt>مدة الضمان</dt><dd>{sale.warranty_months} شهر {sale.warranty_basis && `من ${warrantyBasis[sale.warranty_basis]}`}</dd></div>
            {sale.warranty_guarantor && <div><dt>جهة الضمان</dt><dd>{sale.warranty_guarantor}</dd></div>}
            {sale.warranty_starts_on && <div><dt>بداية الضمان</dt><dd>{formatDate(sale.warranty_starts_on)}</dd></div>}
            {sale.warranty_expires_on && <div><dt>الضمان حتى</dt><dd>{formatDate(sale.warranty_expires_on)}</dd></div>}
            {sale.warranty_proof_reference && <div><dt>مرجع إثبات البدء</dt><dd><bdi>{sale.warranty_proof_reference}</bdi></dd></div>}
          </dl>}
        </article>)}
      </section>
      {device.status === 'sold' && allowed(user, 'inventory.manage') && <form className="panel form-card section-space" onSubmit={save}>
        <h2>إجراء على الجهاز</h2>
        <label className="field">الإجراء<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
          {Object.entries(eventLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label className="field">تاريخ الإجراء<input type="date" value={occurredOn} onChange={event => setOccurredOn(event.target.value)} /></label>
        <label className="field">مرجع مستند الإثبات<input value={proofReference} maxLength={120} onChange={event => setProofReference(event.target.value)} /></label>
        <label className="field">البيان<textarea maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></label>
        <button className="primary" disabled={busy}>سجّل الإجراء</button>
      </form>}
      {!pending && currentReturn?.disposition === 'quarantine' && (device.status === 'quarantined' || (device.status === 'in_repair' && completedRepair)) && allowed(user, 'inventory.manage') && <form className="panel form-card section-space" onSubmit={release}>
        <h2>نتيجة فحص الجهاز المعزول</h2>
        <label className="field">القرار<select value={disposition} onChange={event => setDisposition(event.target.value as typeof disposition)}>
          <option value="restock">إعادة الجهاز السليم للبيع</option>
          {availableDispositions.map(choice => <option key={choice} value={choice}>{dispositions[choice]}</option>)}
        </select></label>
        {disposition === 'supplier' && <label className="field">مرجع إشعار المورد الدائن
          <input value={supplierReference} required maxLength={100} onChange={event => setSupplierReference(event.target.value)} />
        </label>}
        <label className="field">نتيجة الفحص وسبب القرار<textarea value={resolution} required maxLength={1000} onChange={event => setResolution(event.target.value)} /></label>
        <button className="primary" disabled={busy}>{disposition === 'restock' ? 'أعد الجهاز السليم للمخزون' : 'أرسل قرار الجهاز للمراجعة'}</button>
      </form>}
      {pending && <section className="panel panel-inner form-section section-space">
        <h2>قرار بانتظار المراجعة</h2>
        <p>{dispositions[pending.disposition]} · {pending.requested_by} · {pending.reason}</p>
        {allowed(user, dispositionApprover) && pending.actor_id !== user.id && <form className="form-section" onSubmit={review}>
          <label className="field">سبب الاعتماد أو الرفض<textarea value={reviewReason} required maxLength={1000} onChange={event => setReviewReason(event.target.value)} /></label>
          <div className="form-actions">
            {allowed(user, dispositionPermissions[pending.disposition]) && <button className="primary" value="approve" disabled={busy}>اعتمد قرار الجهاز</button>}
            <button className="secondary" value="reject" disabled={busy}>ارفض القرار</button>
          </div>
        </form>}
      </section>}
      <section className="panel panel-inner form-section">
        <h2>التسليم والتركيب والضمان</h2>
        {!device.events?.length ? <p className="muted">لا توجد إجراءات مسجلة.</p> : <ul className="dash-list">
          {device.events.map(event => <li key={event.id}><strong>{eventLabels[event.kind]}</strong> · {formatDate(event.occurred_on)}
            {event.proof_reference && <> · مرجع الإثبات <bdi>{event.proof_reference}</bdi></>}{event.note && ' · ' + event.note}</li>)}
        </ul>}
      </section>
      {Boolean(device.quarantine_resolutions?.length) && <section className="panel panel-inner form-section section-space"><h2>سجل فحص العزل</h2>
        <ul className="dash-list">{device.quarantine_resolutions?.map(row => <li key={row.id}>{formatDate(row.created_at)} · {row.reason}</li>)}</ul></section>}
      {Boolean(device.dispositions?.length) && <section className="panel panel-inner form-section section-space"><h2>قرارات الأجهزة المعزولة</h2>
        <ul className="dash-list">{device.dispositions?.map(row => <li key={row.id}>{dispositions[row.disposition]} · {row.requested_by} · {row.reason}
          {row.decision && <> · {row.decision === 'approve' ? 'معتمد' : 'مرفوض'} بواسطة {row.reviewed_by} · {row.review_reason}</>}
          {row.decision === 'approve' && row.disposition === 'write_off' && device.can_read_cost && <> · {row.loss_minor == null ? 'تكلفة غير موثقة' : `قيمة الهالك ${money(row.loss_minor)}`}</>}
          {row.supplier_reference && <> · مرجع الإشعار <bdi>{row.supplier_reference}</bdi></>}
          {row.credit_minor != null && <> · قيمة الإشعار {money(row.credit_minor)}</>}
          {Boolean(row.unapplied_credit_minor) && <> · رصيد دائن عند المورد للتسوية {money(row.unapplied_credit_minor)}</>}
        </li>)}</ul></section>}
      {Boolean(device.repairs?.length) && <section className="panel panel-inner form-section section-space"><h2>طلبات الصيانة</h2>
        <ul className="dash-list">{device.repairs?.map(row => <li key={row.id}>{row.item} · {formatDate(row.requested_date)} · رقم الطلب {row.id}</li>)}</ul></section>}
    </>}
  </>
}

export function DeviceList() {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<Device[]>()
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ per_page: '30', page: String(page) })
    if (query) params.set('q', query)
    if (status) params.set('status', status)
    setRows(undefined)
    setError('')
    request<Device[]>('/retail/devices?' + params, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return
      setRows(result.data); setTotal(result.meta?.total ?? result.data.length)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [query, status, page])

  return <>
    <PageTitle title="الأجهزة المتتبعة" description="ابحث عن كل قطعة برقمها وتابع حالتها وتاريخها." />
    <form className="panel form-card section-space" onSubmit={event => { event.preventDefault(); setPage(1); setQuery(search.trim()) }}>
      <label className="field">الرقم التسلسلي أو IMEI<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label className="field">الحالة<select value={status} onChange={event => { setStatus(event.target.value); setPage(1) }}>
        <option value="">كل الحالات</option>{Object.entries(states).filter(([state]) => state !== 'quarantine').map(([state, label]) =>
          <option key={state} value={state}>{label}</option>)}
      </select></label>
      <button className="primary">بحث</button>
    </form>
    {error ? <Notice error>{error}</Notice> : !rows ? <Notice>جارٍ تحميل الأجهزة…</Notice> : !rows.length ? <p>لا توجد أجهزة مطابقة.</p> : <div className="panel table-scroll"><table>
      <thead><tr><th scope="col">الصنف</th><th scope="col">الرقم</th><th scope="col">الحالة</th></tr></thead>
      <tbody>{rows.map(device => <tr key={device.id}><td>{device.product_name}</td><td><Link to={'/retail-devices/' + device.id}><bdi>{deviceLabel(device)}</bdi></Link></td><td>{states[device.status] ?? device.status}</td></tr>)}</tbody>
    </table></div>}
    {total > 30 && <nav className="pagination" aria-label="صفحات الأجهزة"><button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
      <button className="secondary" disabled={page * 30 >= total} onClick={() => setPage(page + 1)}>التالي</button></nav>}
  </>
}
