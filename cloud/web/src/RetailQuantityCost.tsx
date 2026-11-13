import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { allowed, money, readMoney, request } from './api'
import type { User } from './api'
import { Modal, Notice } from './ui'
import { formatQuantity } from './measurement'

type Position = { id: number; name: string; stock: number; quantity_scale?: number; inventory_value_minor: number | null; last_movement_id: number | null;
  opening_valuations: { id: number; value_minor: number; reason: string }[] }

export function RetailQuantityCost({ productId, user, close }: { productId: string; user: User; close: () => void }) {
  const [position, setPosition] = useState<Position>()
  const [total, setTotal] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, refresh] = useState(0)
  const url = `/retail/quantity-costs/${productId}`
  const canSet = allowed(user, 'inventory.manage') && allowed(user, 'products.cost.manage')
  useEffect(() => {
    const abort = new AbortController()
    request<Position>(url, { signal: abort.signal }).then(response => { if (!abort.signal.aborted) setPosition(response.data) })
      .catch(error => { if (!abort.signal.aborted) setError(error.message) })
    return () => abort.abort()
  }, [url, revision])
  async function record(event: FormEvent) {
    event.preventDefault()
    if (busy || !position) return
    setBusy(true); setError('')
    try {
      await request(url + '/opening', { method: 'POST', financial: true, body: {
        expected_stock: position.stock, expected_movement_id: position.last_movement_id ?? 0,
        value_minor: readMoney(total), reason: reason.trim(),
      } })
      setTotal(''); setReason(''); refresh(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر اعتماد القيمة.'); refresh(value => value + 1) }
    finally { setBusy(false) }
  }
  return <Modal title="تقييم المخزون الكمي" close={() => { if (!busy) close() }}>
    <div className="modal-content">
      {error && <Notice error>{error}</Notice>}
      {!position && !error && <Notice>جارٍ تحميل التقييم…</Notice>}
      {position && <>
        <p>{position.name} · {formatQuantity(position.stock, position.quantity_scale)} · {position.inventory_value_minor === null ? 'التكلفة تحتاج مستندًا معتمدًا' : money(position.inventory_value_minor)}</p>
        {canSet && position.stock > 0 && position.inventory_value_minor === null && <form className="form-section" onSubmit={record}>
          <label className="field">إجمالي القيمة المعتمدة بالجنيه<input value={total} required inputMode="decimal" disabled={busy} onChange={event => setTotal(event.target.value)} /></label>
          <label className="field">المستند أو سبب اعتماد التكلفة<textarea value={reason} required maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
          <button className="primary" disabled={busy}>اعتمد قيمة الرصيد الحالي</button>
        </form>}
        {position.opening_valuations.length > 0 && <ul className="dash-list">{position.opening_valuations.map(item => <li key={item.id}>{money(item.value_minor)} · {item.reason}</li>)}</ul>}
      </>}
      <button type="button" className="secondary" disabled={busy} onClick={close}>إغلاق</button>
    </div>
  </Modal>
}
