import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { formatDate, money, request } from './api'
import type { User } from './api'
import { deviceLabel } from './RetailDevices'
import type { Device } from './RetailDevices'
import { blankTender, ShiftContext, TenderFields, tendersForAmount, useOpenShift } from './RetailShifts'
import { FormInput, Modal, Notice } from './ui'

import { displayQuantity, formatQuantity, lineMinor, quantityStep, stockQuantity, validQuantity } from './measurement'

type Disposition = 'resale' | 'quarantine'
type ReturnLine = {
  product_id: number; product_name: string; sold_quantity: number; refundable_quantity: number; returned_quantity: number; quantity_scale?: number;
  unit_price_minor: number; devices?: Device[]; tracking?: string; quarantine_only?: boolean | number;
}
type RetailReturn = { id: number; total_minor: number; returned_minor: number; debt_reduction_minor: number; reason: string; created_at: string;
  exchange?: { replacement_invoice_id: number; replacement_total_minor: number; difference_minor: number; reason: string } | null }
type ReturnSummary = { items: ReturnLine[]; returns: RetailReturn[]; outstanding_minor: number; paid_minor: number }
type Selection = { resale: number; quarantine: number; devices: Record<number, Disposition | ''> }
const emptySelection: Selection = { resale: 0, quarantine: 0, devices: {} }
const dispositions: Record<Disposition, string> = { resale: 'سليم للبيع', quarantine: 'عزل للفحص' }

export function RetailReturns({ invoiceId, user, canReturn, revision, onSaved }: { invoiceId: string; user: User; canReturn: boolean; revision: number; onSaved: () => void }) {
  const endpoint = '/invoices/' + encodeURIComponent(invoiceId) + '/returns'
  const [data, setData] = useState<ReturnSummary>()
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [exchange, setExchange] = useState<number>()
  const { hash } = useLocation()
  const section = useRef<HTMLElement>(null)
  const returnable = data?.items.some(item => item.refundable_quantity > 0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    request<ReturnSummary>(endpoint, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setData(result.data)
    })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [endpoint, revision])
  useEffect(() => {
    if (hash === '#retail-return' && section.current) {
      section.current.focus({ preventScroll: true })
      section.current.scrollIntoView({ block: 'start' })
    }
  }, [hash, invoiceId])
  return <section id="retail-return" ref={section} tabIndex={-1} aria-label="مرتجعات الفاتورة" className="form-section no-print">
    <h2>مرتجعات الفاتورة</h2>
    {error && <Notice error>{error}</Notice>}
    {!error && !data && <p role="status" className="muted">جارٍ تحميل مرتجعات الفاتورة…</p>}
    {data && <>
    {data.items.some(item => item.devices?.length) && <section className="panel panel-inner form-section" aria-label="الأجهزة المرتبطة بالفاتورة">
      <h3>الأجهزة المرتبطة بالفاتورة</h3>
      <ul className="dash-list">{data.items.flatMap(item => (item.devices ?? []).map(device => <li key={device.id}>
        {item.product_name} · <Link to={'/retail-devices/' + device.id}><bdi>{deviceLabel(device)}</bdi></Link>
      </li>))}</ul>
    </section>}
    {canReturn && returnable && <button className="secondary" onClick={() => setEditing(true)}>سجّل مرتجع أصناف</button>}
    {canReturn && !returnable && <p className="muted">لا توجد كميات متبقية للرد من هذه الفاتورة.</p>}
    {data.returns.length > 0 && <section className="panel panel-inner form-section" aria-label="سجل المرتجعات الجزئية">
      <h3>سجل المرتجعات الجزئية</h3>
      <ul className="dash-list">{data.returns.map(row => <li key={row.id}>
        <strong>مرتجع {row.id} · {money(row.total_minor)}</strong> · رد للعميل {money(row.returned_minor)} · تخفيض الآجل {money(row.debt_reduction_minor)} · {formatDate(row.created_at)} · {row.reason}
        {row.exchange ? <p><Link to={'/invoices/' + row.exchange.replacement_invoice_id}>فاتورة الاستبدال {row.exchange.replacement_invoice_id}</Link> · فرق القيمة {money(row.exchange.difference_minor)}</p>
          : canReturn && <button type="button" className="link-button" onClick={() => setExchange(row.id)}>اربط فاتورة الاستبدال</button>}
      </li>)}</ul>
    </section>}
    {editing && <ReturnDialog endpoint={endpoint} data={data} user={user} close={() => setEditing(false)} done={() => { setEditing(false); onSaved() }} />}
    {exchange && <ExchangeDialog endpoint={`${endpoint}/${exchange}/exchange`} close={() => setExchange(undefined)} done={() => { setExchange(undefined); onSaved() }} />}
    </>}
  </section>
}

function ReturnDialog({ endpoint, data, user, close, done }: { endpoint: string; data: ReturnSummary; user: User; close: () => void; done: () => void }) {
  const [selected, setSelected] = useState<Record<number, Selection>>({})
  const [reason, setReason] = useState('')
  const [tenders, setTenders] = useState([blankTender()])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'items' | 'settlement'>('items')
  const shift = useOpenShift(user)

  function change(id: number, update: (before: Selection) => Selection) {
    setSelected(before => ({ ...before, [id]: update(before[id] ?? emptySelection) }))
  }
  const selectedItems = data.items.flatMap(line => {
    const selection = selected[line.product_id]
    if (!selection) return []
    return (Object.keys(dispositions) as Disposition[]).flatMap(disposition => {
      const devices = Object.entries(selection.devices).filter(([, value]) => value === disposition).map(([id]) => Number(id))
      const quantity = devices.length || selection[disposition]
      return quantity ? [{ product_id: line.product_id, quantity, disposition, device_ids: devices.length ? devices : undefined }] : []
    })
  })
  const drafts = data.items.map(line => {
    const amounts = selectedItems.filter(item => item.product_id === line.product_id).map(item => item.quantity)
    const quantity = amounts.reduce((sum, value) => sum + stockQuantity(value, line.quantity_scale), 0)
    const valid = quantity <= line.refundable_quantity && amounts.every(value => validQuantity(value, line.quantity_scale))
    const returned = line.returned_quantity
    return { valid, minor: lineMinor(line.unit_price_minor, returned + quantity, line.quantity_scale)
      - lineMinor(line.unit_price_minor, returned, line.quantity_scale) }
  })
  const total = drafts.reduce((sum, line) => sum + line.minor, 0)
  const payout = Math.max(0, total - data.outstanding_minor)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !selectedItems.length) return
    if (step === 'items') {
      if (drafts.some(line => !line.valid)) { setError('راجع وحدة الكمية وحدّ المتاح للمرتجع لكل صنف.'); return }
      setError('')
      setStep('settlement')
      return
    }
    setBusy(true); setError('')
    try {
      if (drafts.some(line => !line.valid)) throw new Error('راجع وحدة الكمية وحدّ المتاح للمرتجع لكل صنف.')
      if (payout && shift.required && !shift.shift) throw new Error('افتح وردية لتسجيل المبلغ المردود.')
      await request(endpoint, { method: 'POST', financial: true, body: {
        reason: reason.trim(), expected_returned_minor: payout, items: selectedItems,
        ...(shift.shift ? { shift_id: shift.shift.id, payments: tendersForAmount(tenders, payout) } : {}),
      } })
      done()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر حفظ المرتجع.') }
    finally { setBusy(false) }
  }

  return <Modal title="مرتجع أصناف" close={() => { if (!busy) close() }}>
    <form className="modal-form" onSubmit={submit}>
      <p className="retail-context">{step === 'items' ? 'اختر البنود وحالة كل قطعة' : 'راجع المبلغ وطريقة التسوية'}</p>
      {step === 'items' && data.items.filter(line => line.refundable_quantity > 0).map(line => <fieldset className="panel panel-inner form-section" key={line.product_id} disabled={busy}>
        <legend>{line.product_name} · المتاح للرد {formatQuantity(line.refundable_quantity, line.quantity_scale)}</legend>
        {line.devices?.length ? line.devices.filter(device => !device.status || device.status === 'sold').map(device => <label className="field" key={device.id}>
          <bdi>{deviceLabel(device)}</bdi><select value={selected[line.product_id]?.devices[device.id] || ''} onChange={event => {
            const disposition = event.target.value as Disposition | ''
            change(line.product_id, before => ({ ...before, devices: { ...before.devices, [device.id]: disposition } }))
          }}><option value="">اتركه في الفاتورة</option><option value="resale">سليم للبيع</option><option value="quarantine">عزل للفحص</option></select>
        </label>) : <div className="form-grid">{(Object.keys(dispositions) as Disposition[]).filter(disposition => !line.quarantine_only || disposition === 'quarantine').map(disposition => <label className="field" key={disposition}>
          {dispositions[disposition]} · {line.product_name}
          <input type="number" min={0} step={quantityStep(line.quantity_scale)} max={displayQuantity(line.refundable_quantity, line.quantity_scale)}
            value={selected[line.product_id]?.[disposition] || ''}
            onChange={event => { const quantity = Number(event.target.value); change(line.product_id, before => ({ ...before, [disposition]: quantity })) }} />
        </label>)}</div>}
      </fieldset>)}
      <dl className="invoice-summary"><div><dt>قيمة المرتجع</dt><dd>{money(total)}</dd></div><div><dt>تخفيض الآجل</dt><dd>{money(Math.min(total, data.outstanding_minor))}</dd></div><div><dt>رد للعميل</dt><dd>{money(payout)}</dd></div></dl>
      {step === 'settlement' && <>
        <ul className="retail-timeline">{selectedItems.map(item => {
          const line = data.items.find(row => row.product_id === item.product_id)
          return <li key={`${item.product_id}-${item.disposition}`}>{line?.product_name} · {formatQuantity(
            stockQuantity(item.quantity, line?.quantity_scale), line?.quantity_scale)} · {dispositions[item.disposition]}</li>
        })}</ul>
        <label className="field">سبب المرتجع<textarea value={reason} required maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        {payout > 0 && <ShiftContext value={shift} />}
        {payout > 0 && shift.shift && <TenderFields rows={tenders} set={setTenders} disabled={busy} />}
      </>}
      {error && <Notice error>{error}</Notice>}
      <div className="form-actions"><button className="primary" disabled={busy || !selectedItems.length || (step === 'settlement' && shift.loading)}>
        {busy ? 'جارٍ التسجيل…' : step === 'items' ? 'راجع التسوية' : 'احفظ المرتجع'}</button>
        {step === 'settlement' && <button type="button" className="secondary" disabled={busy} onClick={() => { setError(''); setStep('items') }}>عدّل البنود</button>}
        <button type="button" className="secondary" disabled={busy} onClick={close}>إلغاء</button></div>
    </form>
  </Modal>
}

function ExchangeDialog({ endpoint, close, done }: { endpoint: string; close: () => void; done: () => void }) {
  const [invoice, setInvoice] = useState('')
  const [reason, setReason] = useState('')
  const [walkIn, setWalkIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      await request(endpoint, { method: 'POST', financial: true, body: { replacement_invoice_id: Number(invoice), reason: reason.trim(), confirm_walk_in: walkIn || undefined } })
      done()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر ربط الاستبدال.') }
    finally { setBusy(false) }
  }
  return <Modal title="ربط فاتورة الاستبدال" close={() => { if (!busy) close() }}>
    <form className="modal-form" onSubmit={submit}>
      <p>سجّل بيع القطعة البديلة أولًا. الربط يظهر فرق قيمة البضاعة ويحافظ على الدفعات المسجلة لكل مستند.</p>
      <FormInput field={{ name: 'replacement_invoice_id', label: 'رقم الفاتورة البديلة', kind: 'number', required: true, min: 1 }} value={invoice} set={setInvoice} disabled={busy} />
      <label className="field">سبب الاستبدال<textarea required value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
      <label className="check-field"><input type="checkbox" checked={walkIn} disabled={busy} onChange={event => setWalkIn(event.target.checked)} /> الفاتورتان لعملية بيع مباشر لنفس العميل</label>
      {error && <Notice error>{error}</Notice>}
      <div className="form-actions"><button className="primary" disabled={busy}>احفظ ربط الاستبدال</button><button type="button" className="secondary" disabled={busy} onClick={close}>إلغاء</button></div>
    </form>
  </Modal>
}
