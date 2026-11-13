import { useState } from 'react'
import { money, readMoney, request } from './api'
import { FormInput, Notice } from './ui'
import type { Row } from './ui'

export type OrderItem = { product_id: number; name: string; quantity: number; unit_cost_minor: number; landed_unit_minor: number }

export function RetailOrderFields({ items, set }: { items: OrderItem[]; set: (items: OrderItem[]) => void }) {
  const [product, setProduct] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unitCost, setUnitCost] = useState('')
  const [landed, setLanded] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const total = items.reduce((sum, item) => sum + item.quantity * item.unit_cost_minor, 0)

  async function add() {
    const id = Number(product)
    const count = Number(quantity)
    if (!id || !Number.isSafeInteger(id) || !Number.isSafeInteger(count) || count < 1 || count > 1_000_000) { setError('اختر صنفًا وكمية صحيحة.'); return }
    if (items.some(row => row.product_id === id)) { setError('الصنف موجود بالفعل.'); return }
    setBusy(true); setError('')
    try {
      const cost = readMoney(unitCost)
      const landedCost = landed ? readMoney(landed) : 0
      const { data } = await request<Row>('/products/' + id)
      set([...items, { product_id: id, name: String(data.name), quantity: count, unit_cost_minor: cost, landed_unit_minor: landedCost }])
      setProduct(''); setQuantity('1'); setUnitCost(''); setLanded('')
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر إضافة الصنف.') }
    finally { setBusy(false) }
  }

  return <fieldset className="panel panel-inner form-section" disabled={busy}>
    <legend>بنود أمر الشراء</legend>
    <FormInput field={{ name: 'product_id', label: 'الصنف المطلوب', kind: 'reference', reference: { path: '/products' } }} value={product} set={setProduct} />
    <div className="form-grid">
      <label className="field">الكمية المطلوبة<input type="number" min={1} max={1000000} value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
      <label className="field">تكلفة الوحدة بعد الخصم بالجنيه<input inputMode="decimal" value={unitCost} onChange={event => setUnitCost(event.target.value)} /></label>
      <label className="field">شحن أو مصروف موزّع على الوحدة بالجنيه<input inputMode="decimal" value={landed} onChange={event => setLanded(event.target.value)} /></label>
    </div>
    <button className="secondary" type="button" onClick={add} disabled={items.length >= 40}>أضف بند شراء</button>
    {error && <Notice error>{error}</Notice>}
    {items.length > 0 && <><ul className="dash-list">{items.map(item => <li key={item.product_id}>
      {item.name} · {item.quantity} × {money(item.unit_cost_minor)} <button className="link-button" type="button" onClick={() => set(items.filter(row => row.product_id !== item.product_id))}>إزالة</button>
    </li>)}</ul><p>إجمالي البنود المطلوب في حقل إجمالي الشراء · <strong>{money(total)}</strong></p></>}
  </fieldset>
}
