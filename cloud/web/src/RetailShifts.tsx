import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { allowed, formatDate, money, readMoney, request } from './api'
import type { User } from './api'
import { ActionDialog, Notice, PageTitle } from './ui'
import type { ActionDialogProps, Row } from './ui'
import { RetailOrderFields } from './RetailOrderFields'
import type { OrderItem } from './RetailOrderFields'

export const tenderLabels = { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة', bank_transfer: 'تحويل بنكي' }
type TenderMethod = keyof typeof tenderLabels
export type TenderDraft = { method: TenderMethod; amount: string; reference: string }
type Tender = { method: TenderMethod; amount_minor: number; reference?: string }
export const blankTender = (): TenderDraft => ({ method: 'cash', amount: '', reference: '' })

export type Shift = {
  id: number; register_name: string; actor_id: number; actor_name: string; opening_minor: number;
  opened_at: string; business_day: string; status: 'open' | 'closed' | 'pending_approval' | 'approved';
  expected_minor: number; observed_minor: number | null; difference_minor: number | null;
  close_reason: string; approval_reason: string; closed_at: string | null;
  totals?: { method: TenderMethod; received_minor: number; paid_out_minor: number }[];
  cash_movements_minor?: number;
  service_cash_minor?: number;
  cash_movement_totals?: { kind: CashMovementKind; amount_minor: number }[];
}
export const shiftStatus = { open: 'مفتوحة', closed: 'مغلقة', pending_approval: 'بانتظار اعتماد الفرق', approved: 'تم اعتماد الفرق' }
const cashMovementLabels = { safe_deposit: 'توريد نقدية من الدرج للخزنة', safe_withdrawal: 'تغذية الدرج من الخزنة', general_expense: 'مصروف عام من الدرج' }
type CashMovementKind = keyof typeof cashMovementLabels
type CashMovement = { id: number; kind: CashMovementKind; amount_minor: number; reason: string; reference?: string | null; created_at: string }

export function tendersForAmount(rows: TenderDraft[], amount: number): Tender[] {
  if (!amount) return []
  if (rows.length === 1) return [{ method: rows[0].method, amount_minor: amount, reference: rows[0].reference.trim() || undefined }]
  const tenders = rows.map(row => ({ method: row.method, amount_minor: readMoney(row.amount), reference: row.reference.trim() || undefined }))
  if (tenders.some(row => row.amount_minor <= 0) || tenders.reduce((sum, row) => sum + row.amount_minor, 0) !== amount) {
    throw new Error('مجموع طرق الدفع لازم يساوي المبلغ المطلوب، وكل وسيلة لها مبلغ أكبر من صفر.')
  }
  return tenders
}

export function TenderFields({ rows, set, disabled = false }: { rows: TenderDraft[]; set: (value: TenderDraft[]) => void; disabled?: boolean }) {
  function change(index: number, values: Partial<TenderDraft>) {
    set(rows.map((row, position) => position === index ? { ...row, ...values } : row))
  }
  return <fieldset className="panel panel-inner form-section" disabled={disabled}>
    <legend>وسائل الدفع</legend>
    {rows.map((row, index) => <div className="form-grid" key={index}>
      <label className="field">{rows.length > 1 ? 'وسيلة الدفع ' + (index + 1) : 'وسيلة الدفع'}
        <select value={row.method} onChange={event => change(index, { method: event.target.value as TenderMethod })}>
          {Object.entries(tenderLabels).map(([method, label]) => <option key={method} value={method}>{label}</option>)}
        </select>
      </label>
      {rows.length > 1 && <label className="field">مبلغ الوسيلة {index + 1} بالجنيه
        <input required inputMode="decimal" value={row.amount} onChange={event => change(index, { amount: event.target.value })} />
      </label>}
      {row.method !== 'cash' && <label className="field">مرجع الدفع {rows.length > 1 ? index + 1 : ''} (اختياري)
        <input value={row.reference} maxLength={100} onChange={event => change(index, { reference: event.target.value })} />
      </label>}
      {rows.length > 1 && <button type="button" className="secondary" onClick={() => set(rows.filter((_, position) => position !== index))}>احذف وسيلة {index + 1}</button>}
    </div>)}
    <button type="button" className="secondary" disabled={rows.length >= 4} onClick={() => set([...rows, { ...blankTender(), method: 'card' }])}>أضف وسيلة دفع</button>
  </fieldset>
}

export function useOpenShift(user: User) {
  const canOperate = allowed(user, 'retail.shifts.operate')
  const [shift, setShift] = useState<Shift>()
  const [required, setRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    Promise.all([
      request<{ require_shift: boolean }>('/retail/settings', { signal: abort.signal }),
      canOperate ? request<Shift[]>('/retail/shifts?status=open&per_page=100', { signal: abort.signal }) : undefined,
    ]).then(([settings, shifts]) => {
      if (abort.signal.aborted) return
      setRequired(settings.data.require_shift)
      setShift(shifts?.data.find(row => row.actor_id === user.id && row.status === 'open'))
    }).catch(error => { if (!abort.signal.aborted) setError(error.message) })
      .finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [canOperate, user.id])
  return { shift, required, loading, error, canOperate }
}

export function ShiftContext({ value }: { value: ReturnType<typeof useOpenShift> }) {
  if (value.loading) return <p className="muted" role="status">جارٍ تحميل الوردية…</p>
  if (value.error) return <Notice error>{value.error}</Notice>
  if (value.shift) return <p>الوردية المفتوحة · <strong>{value.shift.register_name}</strong></p>
  return <p>{value.required ? 'يلزم فتح وردية قبل تسجيل العملية.' : 'العملية خارج وردية.'} {value.canOperate && <Link to="/retail-shifts">فتح وردية</Link>}</p>
}

export function RetailActionDialog({ user, ...props }: ActionDialogProps & { user: User }) {
  const shift = useOpenShift(user)
  const [rows, setRows] = useState([blankTender()])
  const [items, setItems] = useState<OrderItem[]>([])
  const mode = props.action.retailTender
  function prepare(body: Row) {
    const amount = mode === 'purchase' && body.payment_type === 'cash' ? Number(body.total_minor) : Number(mode === 'purchase' ? body.paid_minor ?? 0 : body.amount_minor)
    const order = mode === 'purchase' && items.length ? { ...body, items: items.map(({ name: _, ...item }) => item) } : body
    if (order !== body && items.reduce((sum, item) => sum + item.quantity * item.unit_cost_minor, 0) !== Number(body.total_minor)) {
      throw new Error('إجمالي الشراء لازم يساوي مجموع بنود أمر الشراء. الشحن الموزع يُحسب ضمن تكلفة المخزون.')
    }
    if (amount && shift.required && !shift.shift) throw new Error('افتح وردية قبل تسجيل هذه الدفعة.')
    if (!shift.shift || !amount) return order
    return { ...order, shift_id: shift.shift.id, payments: tendersForAmount(rows, amount) }
  }
  return <ActionDialog {...props} prepare={prepare} waiting={shift.loading} extra={<>
    {mode === 'purchase' && <RetailOrderFields items={items} set={setItems} />}
    <ShiftContext value={shift} />
    {shift.shift && <TenderFields rows={rows} set={setRows} />}
  </>} />
}

export function SharedDrawerDialog({ user, ...props }: ActionDialogProps & { user: User }) {
  const shift = useOpenShift(user)
  const required = props.action.sharedDrawer === 'wallet_reversal' && props.row?.shared_shift_id != null
  const [useDrawer, setUseDrawer] = useState(false)
  function prepare(body: Row) {
    if (!required && !useDrawer) return body
    if (!shift.shift) throw new Error('افتح وردية قبل استخدام الدرج المشترك.')
    return { ...body, shared_shift_id: shift.shift.id }
  }
  return <ActionDialog {...props} prepare={prepare} waiting={required && shift.loading} extra={required || props.action.sharedDrawer === 'optional' ? <>
    {required ? <p>أثر الحركة الأصلية مسجل في درج البيع. عكسها يحتاج وردية مفتوحة.</p> : shift.shift ? <label className="check-field">
      <input type="checkbox" checked={useDrawer} onChange={event => setUseDrawer(event.target.checked)} /> استخدم نفس الدرج النقدي للوردية
    </label> : null}
    {(required || useDrawer) && <ShiftContext value={shift} />}
  </> : undefined} />
}

export function RetailShifts({ user }: { user: User }) {
  const canOperate = allowed(user, 'retail.shifts.operate')
  const canApprove = allowed(user, 'retail.shifts.approve')
  const canSettings = allowed(user, 'settings.update')
  const [shifts, setShifts] = useState<Shift[]>([])
  const [required, setRequired] = useState<boolean>()
  const [register, setRegister] = useState('')
  const [opening, setOpening] = useState('')
  const [selected, setSelected] = useState<number>()
  const [observed, setObserved] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [revision, refresh] = useState(0)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [details, setDetails] = useState<Shift>()
  const [cashEntries, setCashEntries] = useState<CashMovement[]>([])
  const [cashKind, setCashKind] = useState<CashMovementKind>('general_expense')
  const [cashAmount, setCashAmount] = useState('')
  const [cashReason, setCashReason] = useState('')
  const [cashReference, setCashReference] = useState('')

  useEffect(() => {
    const abort = new AbortController()
    Promise.all([
      request<Shift[]>('/retail/shifts?page=' + page + '&per_page=20', { signal: abort.signal }),
      request<{ require_shift: boolean }>('/retail/settings', { signal: abort.signal }),
    ]).then(([list, settings]) => {
      if (abort.signal.aborted) return
      setShifts(list.data)
      setTotal(list.meta?.total ?? list.data.length)
      setRequired(settings.data.require_shift)
    }).catch(error => { if (!abort.signal.aborted) setError(error.message) })
    return () => abort.abort()
  }, [revision, page])

  useEffect(() => {
    if (!selected) return
    const abort = new AbortController()
    request<Shift>('/retail/shifts/' + selected, { signal: abort.signal }).then(result => {
      if (!abort.signal.aborted) setDetails(result.data)
    }).catch(error => { if (!abort.signal.aborted) setError(error.message) })
    setCashEntries([])
    request<CashMovement[]>(`/retail/shifts/${selected}/cash-movements?per_page=20`, { signal: abort.signal })
      .then(result => { if (!abort.signal.aborted) setCashEntries(result.data) })
      .catch(error => { if (!abort.signal.aborted) setError(error.message) })
    return () => abort.abort()
  }, [selected, revision])

  async function action(event: FormEvent, path: string, makeBody: () => unknown, success: string, method: 'POST' | 'PATCH' = 'POST') {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const response = await request<Shift>(path, { method, financial: method === 'POST', body: makeBody() })
      if (path === '/retail/shifts' && response.data?.id) setSelected(response.data.id)
      setMessage(success)
      setObserved('')
      setReason('')
      if (path === '/retail/shifts') { setRegister(''); setOpening(''); setPage(1) }
      if (path.endsWith('/cash-movements')) { setCashAmount(''); setCashReason(''); setCashReference('') }
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر تنفيذ العملية.') }
    finally { setBusy(false); refresh(value => value + 1) }
  }

  const close = details?.status === 'open' && details.actor_id === user.id && canOperate
  const approve = details?.status === 'pending_approval' && details.actor_id !== user.id && canApprove
  let difference: number | undefined
  if (close && observed) { try { difference = readMoney(observed) - details.expected_minor } catch { /* Validate on submit. */ } }

  return <>
    <PageTitle title="ورديات الكاشير" description="عهدة الدرج، طرق الدفع، والإقفال باعتماد فرق النقدية." action={<Link className="secondary" to="/pos">نقطة البيع</Link>} />
    {error && <Notice error>{error}</Notice>}
    {message && <Notice>{message}</Notice>}
    {canSettings && required !== undefined && <form className="panel form-card section-space" onSubmit={event => action(event, '/retail/settings', () => ({ require_shift: !required }), 'تم تحديث سياسة الورديات.', 'PATCH')}>
      <p>{required ? 'الوردية مطلوبة للعمليات التي يدعمها دفتر الورديات.' : 'الوردية اختيارية حاليًا.'}</p>
      <button className="secondary" disabled={busy}>{required ? 'اجعل الوردية اختيارية' : 'اطلب وردية للعمليات'}</button>
    </form>}
    {canOperate && !shifts.some(shift => shift.actor_id === user.id && shift.status === 'open') && <form className="panel form-card section-space" onSubmit={event => action(event, '/retail/shifts', () => ({ register_name: register.trim(), opening_minor: readMoney(opening) }), 'تم فتح الوردية.')}>
      <h2>فتح وردية</h2>
      <label className="field">اسم الدرج<input required value={register} maxLength={100} disabled={busy} onChange={event => setRegister(event.target.value)} /></label>
      <label className="field">العهدة الافتتاحية بالجنيه<input required value={opening} inputMode="decimal" disabled={busy} onChange={event => setOpening(event.target.value)} /></label>
      <button className="primary" disabled={busy}>افتح الوردية</button>
    </form>}
    {details && details.id === selected && <section className="panel panel-inner form-section section-space" aria-label="تفاصيل الوردية">
      <h2>{details.register_name} · {shiftStatus[details.status]}</h2>
      <dl className="invoice-summary">
        <div><dt>الكاشير</dt><dd>{details.actor_name}</dd></div><div><dt>العهدة</dt><dd>{money(details.opening_minor)}</dd></div>
        <div><dt>النقدية المتوقعة</dt><dd>{money(details.expected_minor)}</dd></div><div><dt>النقدية المعدودة</dt><dd>{money(details.observed_minor)}</dd></div>
        <div><dt>الفرق</dt><dd>{money(details.difference_minor)}</dd></div><div><dt>يوم العمل</dt><dd>{formatDate(details.business_day)}</dd></div>
      </dl>
      {details.close_reason && <p>سبب الفرق · {details.close_reason}</p>}
      {details.approval_reason && <p>اعتماد المشرف · {details.approval_reason}</p>}
      {details.totals?.length ? <div className="table-scroll"><table><thead><tr><th scope="col">الوسيلة</th><th scope="col">الوارد</th><th scope="col">الصادر</th></tr></thead>
        <tbody>{details.totals.map(row => <tr key={row.method}><th scope="row">{tenderLabels[row.method]}</th><td>{money(row.received_minor)}</td><td>{money(row.paid_out_minor)}</td></tr>)}</tbody></table></div> : null}
      {details.cash_movements_minor !== undefined && <section className="form-section" aria-label="حركات الدرج والخزنة">
        <h3>حركات الدرج والخزنة</h3>
        <p>صافي الحركات اليدوية ضمن المتوقع · <strong>{money(details.cash_movements_minor)}</strong></p>
        {details.service_cash_minor !== undefined && <p>صافي نقدية المحافظ والصيانة المسجلة على نفس الدرج · <strong>{money(details.service_cash_minor)}</strong></p>}
        {cashEntries.length > 0 && <ul className="dash-list">{cashEntries.map(row => <li key={row.id}>
          {cashMovementLabels[row.kind]} · {money(row.amount_minor)} · {row.reason}{row.reference ? ` · ${row.reference}` : ''} · {formatDate(row.created_at)}
        </li>)}</ul>}
        {close && allowed(user, 'retail.cash.manage') && <form className="form-section" onSubmit={event => action(event, `/retail/shifts/${details.id}/cash-movements`, () => ({
          kind: cashKind, amount_minor: readMoney(cashAmount), reason: cashReason.trim(), reference: cashReference.trim() || undefined,
        }), 'تم تسجيل حركة الدرج.') }>
          <label className="field">نوع حركة الدرج<select value={cashKind} disabled={busy} onChange={event => setCashKind(event.target.value as CashMovementKind)}>
            {Object.entries(cashMovementLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
          <label className="field">مبلغ الحركة بالجنيه<input value={cashAmount} required inputMode="decimal" disabled={busy} onChange={event => setCashAmount(event.target.value)} /></label>
          <label className="field">بيان الحركة<textarea value={cashReason} required maxLength={500} disabled={busy} onChange={event => setCashReason(event.target.value)} /></label>
          <label className="field">مرجع السند<input value={cashReference} maxLength={100} disabled={busy} onChange={event => setCashReference(event.target.value)} /></label>
          <button className="secondary" disabled={busy}>سجّل حركة الدرج</button>
        </form>}
      </section>}
      {close && <form className="form-section" onSubmit={event => action(event, `/retail/shifts/${details.id}/close`, () => ({ observed_minor: readMoney(observed), expected_minor: details.expected_minor, reason: reason.trim() || undefined }), 'تم تسجيل إقفال الوردية.')}>
        <label className="field">النقدية المعدودة بالجنيه<input required inputMode="decimal" value={observed} disabled={busy} onChange={event => setObserved(event.target.value)} /></label>
        {difference !== undefined && <p>الفرق عند الإقفال · {money(difference)}</p>}
        <label className="field">سبب الفرق<textarea required={Boolean(difference)} value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        <button className="primary" disabled={busy}>أقفل الوردية</button>
      </form>}
      {approve && <form className="form-section" onSubmit={event => action(event, `/retail/shifts/${details.id}/approve`, () => ({ reason: reason.trim() }), 'تم اعتماد فرق الوردية.')}>
        <label className="field">قرار المشرف<textarea required value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        <button className="primary" disabled={busy}>اعتمد الفرق</button>
      </form>}
    </section>}
    <section className="panel panel-inner form-section">
      <h2>سجل الورديات</h2>
      {!shifts.length ? <p className="muted">لا توجد ورديات في هذه الصفحة.</p> : <div className="table-scroll"><table>
        <thead><tr>{['الدرج', 'الكاشير', 'يوم العمل', 'الحالة', 'التفاصيل'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{shifts.map(shift => <tr key={shift.id}><th scope="row">{shift.register_name}</th><td>{shift.actor_name}</td><td>{formatDate(shift.business_day)}</td><td>{shiftStatus[shift.status]}</td>
          <td><button className="link-button" type="button" onClick={() => { setSelected(shift.id); setObserved(''); setReason('') }}>عرض وردية {shift.id}</button></td></tr>)}</tbody>
      </table></div>}
      {total > 20 && <nav className="pagination" aria-label="صفحات الورديات">
        <button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
        <button className="secondary" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>التالي</button>
      </nav>}
    </section>
  </>
}
