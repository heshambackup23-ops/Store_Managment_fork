import { useEffect, useState } from 'react'
import { money, readMoney, request } from './api'
import { FormInput, Notice } from './ui'
import type { Row } from './ui'
import { formatQuantity, lineMinor, measurementLabel, quantityScale, quantityStep, stockQuantity, validQuantity } from './measurement'

export type OrderItem = { product_id: number; name: string; quantity: number; scale: number; unit_cost_minor: number; landed_unit_minor: number }
export const orderTotal = (items: OrderItem[]) => items.reduce((sum, item) =>
  sum + lineMinor(item.unit_cost_minor, stockQuantity(item.quantity, item.scale), item.scale), 0)

export function RetailOrderFields({ items, set }: { items: OrderItem[]; set: (items: OrderItem[]) => void }) {
  const [product, setProduct] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [scale, setScale] = useState(1)
  const [unitCost, setUnitCost] = useState('')
  const [landed, setLanded] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const total = orderTotal(items)

  useEffect(() => {
    const abort = new AbortController()
    setScale(1)
    if (product) request<Row>('/products/' + product, { signal: abort.signal }).then(({ data }) => {
      if (!abort.signal.aborted) setScale(quantityScale(data.quantity_scale))
    }).catch(() => { /* Adding the line shows any lookup error. */ })
    return () => abort.abort()
  }, [product])

  async function add() {
    const id = Number(product)
    const count = Number(quantity)
    if (!id || !Number.isSafeInteger(id)) { setError('اختر صنفًا.'); return }
    if (items.some(row => row.product_id === id)) { setError('الصنف موجود بالفعل.'); return }
    setBusy(true); setError('')
    try {
      const cost = readMoney(unitCost)
      const landedCost = landed ? readMoney(landed) : 0
      const { data } = await request<Row>('/products/' + id)
      const scale = quantityScale(data.quantity_scale)
      if (!validQuantity(count, scale)) throw new Error('أدخل كمية صالحة بوحدة ' + measurementLabel(scale) + '.')
      set([...items, { product_id: id, name: String(data.name), quantity: count, scale, unit_cost_minor: cost, landed_unit_minor: landedCost }])
      setProduct(''); setQuantity('1'); setUnitCost(''); setLanded('')
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر إضافة الصنف.') }
    finally { setBusy(false) }
  }

  return <fieldset className="panel panel-inner form-section" disabled={busy}>
    <legend>بنود أمر الشراء</legend>
    <FormInput field={{ name: 'product_id', label: 'الصنف المطلوب', kind: 'reference', reference: { path: '/products' } }} value={product} set={setProduct} />
    <div className="form-grid">
      <label className="field">الكمية المطلوبة ({measurementLabel(scale)})<input type="number" min={quantityStep(scale)} step={quantityStep(scale)} max={1000000 / scale} value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
      <label className="field">تكلفة الوحدة بعد الخصم بالجنيه<input inputMode="decimal" value={unitCost} onChange={event => setUnitCost(event.target.value)} /></label>
      <label className="field">شحن أو مصروف موزّع على الوحدة بالجنيه<input inputMode="decimal" value={landed} onChange={event => setLanded(event.target.value)} /></label>
    </div>
    <button className="secondary" type="button" onClick={add} disabled={items.length >= 40}>أضف بند شراء</button>
    {error && <Notice error>{error}</Notice>}
    {items.length > 0 && <><ul className="dash-list">{items.map(item => <li key={item.product_id}>
      {item.name} · {formatQuantity(stockQuantity(item.quantity, item.scale), item.scale)} × {money(item.unit_cost_minor)} <button className="link-button" type="button" onClick={() => set(items.filter(row => row.product_id !== item.product_id))}>إزالة</button>
    </li>)}</ul><p>إجمالي البنود المطلوب في حقل إجمالي الشراء · <strong>{money(total)}</strong></p></>}
  </fieldset>
}
