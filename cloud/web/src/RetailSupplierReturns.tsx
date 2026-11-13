import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { formatDate, integer, money, request } from './api'
import { DevicePicker } from './RetailDevices'
import { BranchSelect } from './RetailBranches'
import { Modal, Notice } from './ui'
import type { Row } from './ui'
import { displayQuantity, formatQuantity, measurementLabel, quantityStep } from './measurement'

type PurchaseItem = { product_id: number; product_name: string; quantity: number; quantity_scale?: number; unit_cost_minor: number; inventory_unit_cost_minor: number; received_quantity: number; remaining_quantity: number; returned_quantity: number; tracking?: string }
type Purchase = { items: PurchaseItem[]; gross_total_minor?: number; net_total_minor?: number; supplier_credit_minor?: number; paid_minor: number }
type Selected = { quantity: number; deviceIds: number[] }

export function RetailPurchaseSummary({ purchaseId, revision, canReturn, onSaved }: { purchaseId: number; revision: number; canReturn: boolean; onSaved: () => void }) {
  const [purchase, setPurchase] = useState<Purchase>()
  const [history, setHistory] = useState<Row[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const path = '/purchases/' + purchaseId
  useEffect(() => {
    const abort = new AbortController()
    Promise.all([request<Purchase>(path, { signal: abort.signal }), request<Row[]>(path + '/returns?per_page=30', { signal: abort.signal })])
      .then(([purchaseResult, returns]) => { if (!abort.signal.aborted) { setPurchase(purchaseResult.data); setHistory(returns.data) } })
      .catch(error => { if (!abort.signal.aborted) setError(error.message) })
    return () => abort.abort()
  }, [path, revision])
  if (error) return <Notice error>{error}</Notice>
  if (!purchase?.items?.length) return null
  const ordered = purchase.items.length
  const completed = purchase.items.filter(item => item.remaining_quantity <= 0).length
  const remainingBalance = Number(purchase.net_total_minor ?? purchase.gross_total_minor ?? 0) - purchase.paid_minor
  return <section className="panel panel-inner form-section section-space">
    <h2>بنود أمر الشراء</h2>
    <p className="retail-context">اكتمل استلام <strong>{integer(completed)} من {integer(ordered)}</strong> بنود الطلب</p>
    <dl className="invoice-summary">
      <div><dt>قيمة الشراء</dt><dd>{money(purchase.gross_total_minor)}</dd></div>
      <div><dt>إشعارات المورد الدائنة</dt><dd>{money(purchase.supplier_credit_minor)}</dd></div>
      <div><dt>المدفوع</dt><dd>{money(purchase.paid_minor)}</dd></div>
      <div><dt>المتبقي للمورد</dt><dd>{money(remainingBalance)}</dd></div>
    </dl>
    <div className="table-scroll"><table><thead><tr>{['الصنف', 'مطلوب', 'مستلم', 'باقي الاستلام', 'مردود'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{purchase.items.map(item => <tr key={item.product_id}><th scope="row">{item.product_name}</th>
        <td>{formatQuantity(item.quantity, item.quantity_scale)}</td><td>{formatQuantity(item.received_quantity, item.quantity_scale)}</td>
        <td>{item.remaining_quantity > 0 ? <strong>{formatQuantity(item.remaining_quantity, item.quantity_scale)}</strong> : 'مكتمل'}</td>
        <td>{formatQuantity(item.returned_quantity, item.quantity_scale)}</td></tr>)}</tbody></table></div>
    {canReturn && purchase.items.some(item => item.received_quantity > item.returned_quantity) && <button className="secondary" onClick={() => setOpen(true)}>مرتجع إلى المورد</button>}
    {history.length > 0 && <section aria-label="إشعارات المورد الدائنة">
      <h3>إشعارات المورد الدائنة</h3>
      <ul className="retail-timeline">{history.map(row => <li key={String(row.id)}>
        <strong>إشعار {String(row.id)} · {money(row.credit_minor)}</strong> · {formatDate(row.created_at)}
        <p>{String(row.reason)}
          {Boolean(row.vendor_reference) && <> · المرجع <bdi>{String(row.vendor_reference)}</bdi></>}
          {Number(row.unapplied_credit_minor) > 0 && <> · رصيد دائن عند المورد للتسوية {money(row.unapplied_credit_minor)}</>}
        </p>
      </li>)}</ul>
    </section>}
    {open && <SupplierReturnDialog purchaseId={purchaseId} items={purchase.items} close={() => setOpen(false)} done={() => { setOpen(false); onSaved() }} />}
  </section>
}

function SupplierReturnDialog({ purchaseId, items, close, done }: { purchaseId: number; items: PurchaseItem[]; close: () => void; done: () => void }) {
  const [branch, setBranch] = useState(1)
  const [selected, setSelected] = useState<Record<number, Selected>>({})
  const [tracking, setTracking] = useState<Record<number, string>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    Promise.all(items.map(async item => [item.product_id, item.tracking ?? (await request<Row>('/products/' + item.product_id, { signal: abort.signal })).data.tracking] as const))
      .then(rows => { if (!abort.signal.aborted) setTracking(Object.fromEntries(rows.map(([id, value]) => [id, String(value ?? 'quantity')]))) })
      .catch(error => { if (!abort.signal.aborted) setError(error.message) })
    return () => abort.abort()
  }, [items])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const lines = Object.entries(selected).filter(([, row]) => row.quantity > 0).map(([id, row]) => {
        if (tracking[Number(id)] !== 'quantity' && row.deviceIds.length !== row.quantity) throw new Error('اختر القطع المتاحة من نفس الاستلام.')
        return { product_id: Number(id), quantity: row.quantity, device_ids: row.deviceIds.length ? row.deviceIds : undefined }
      })
      if (!lines.length) throw new Error('حدد الأصناف المرتجعة.')
      await request(`/purchases/${purchaseId}/returns`, { method: 'POST', financial: true, body: { reason: reason.trim(), branch_id: branch, items: lines } })
      done()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر حفظ مرتجع المورد.') }
    finally { setBusy(false) }
  }
  return <Modal title="مرتجع إلى المورد" close={() => { if (!busy) close() }}><form className="modal-form" onSubmit={submit}>
    <p className="retail-context">أمر الشراء <strong><bdi>#{purchaseId}</bdi></strong> · تُخصم الأصناف من الفرع المحدد ويُسجل إشعار المورد الدائن.</p>
    <BranchSelect label="فرع رد البضاعة" value={branch} set={id => { setBranch(id); setSelected({}) }} disabled={busy} />
    {items.filter(item => item.received_quantity > item.returned_quantity).map(item => {
      const value = selected[item.product_id] ?? { quantity: 0, deviceIds: [] }
      return <fieldset className="panel panel-inner" key={item.product_id} disabled={busy || !tracking[item.product_id]}><legend>{item.product_name}</legend>
        <p className="muted">المستلم الذي لم يُرد {formatQuantity(item.received_quantity - item.returned_quantity, item.quantity_scale)}</p>
        <label className="field">كمية رد {item.product_name} ({measurementLabel(item.quantity_scale)})
          <input type="number" min={0} step={quantityStep(item.quantity_scale)}
          max={displayQuantity(item.received_quantity - item.returned_quantity, item.quantity_scale)} value={value.quantity || ''} onChange={event => {
          const quantity = Number(event.target.value); setSelected(previous => ({ ...previous, [item.product_id]: { quantity, deviceIds: value.deviceIds.slice(0, quantity) } }))
        }} /></label>
        {tracking[item.product_id] !== 'quantity' && value.quantity > 0 && <DevicePicker productId={item.product_id} purchaseId={purchaseId} branchId={branch} productName={item.product_name}
          quantity={value.quantity} selected={value.deviceIds} change={deviceIds => setSelected(previous => ({ ...previous, [item.product_id]: { ...value, deviceIds } }))} />}
      </fieldset>
    })}
    <label className="field">سبب الرد للمورد<textarea value={reason} required maxLength={500} onChange={event => setReason(event.target.value)} /></label>
    {error && <Notice error>{error}</Notice>}
    <div className="form-actions"><button className="primary" disabled={busy || !Object.values(selected).some(value => value.quantity > 0)}>
      {busy ? 'جارٍ حفظ المرتجع…' : 'احفظ المرتجع والإشعار الدائن'}</button>
      <button className="secondary" type="button" disabled={busy} onClick={close}>إلغاء</button></div>
  </form></Modal>
}
