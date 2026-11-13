import { useEffect, useState } from 'react'
import { integer, request } from './api'
import { Notice } from './ui'
import { formatQuantity } from './measurement'

type Row = { category_id?: number | null; category?: string; quantity_units: number; unvalued_quantity_units: number;
  length_mm: number; unvalued_length_mm: number;
  available_devices: number; unvalued_available_devices: number; held_devices: number; unvalued_held_devices: number;
  missing_devices: number; quantity_value: string; available_device_value: string; held_device_value: string }
type Valuation = { as_of: string; items: Row[]; totals: Row }
type Category = { id: number; name: string }
const whole = new Intl.NumberFormat('ar-EG')
const fraction = new Intl.NumberFormat('ar-EG', { minimumIntegerDigits: 2, useGrouping: false })

function amount(minor: string | bigint) {
  const value = BigInt(minor)
  return whole.format(value / 100n) + '٫' + fraction.format(value % 100n) + ' ج.م.'
}

export function RetailInventoryValuation({ canFilter }: { canFilter: boolean }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [category, setCategory] = useState('')
  const [report, setReport] = useState<Valuation>()
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!canFilter) return
    const abort = new AbortController()
    request<Category[]>('/categories?per_page=100', { signal: abort.signal }).then(result => {
      if (!abort.signal.aborted) setCategories(result.data)
    }).catch(() => { /* The report remains available across all categories. */ })
    return () => abort.abort()
  }, [canFilter])

  useEffect(() => {
    const abort = new AbortController()
    const query = new URLSearchParams({ page: String(page), per_page: '25' })
    if (category) query.set('category_id', category)
    setError(''); setReport(undefined)
    request<Valuation>('/reports/inventory-valuation?' + query, { signal: abort.signal }).then(result => {
      if (!abort.signal.aborted) { setReport(result.data); setTotal(result.meta?.total ?? result.data.items.length) }
    }).catch(error => { if (!abort.signal.aborted) setError(error.message) })
    return () => abort.abort()
  }, [page, category])

  return <section className="panel panel-inner form-section section-space">
    <h2>قيمة المخزون المثبتة</h2>
    <p>يعرض التقرير قيمة المخزون الحالي. قيمة المعزول أو قيد الصيانة تظهر منفصلة، والمفقود يظهر بالعدد.</p>
    {categories.length > 0 && <label className="field">الفئة<select value={category} onChange={event => { setCategory(event.target.value); setPage(1) }}>
      <option value="">كل الفئات</option>{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
    </select></label>}
    {error && <Notice error>{error}</Notice>}
    {!error && !report && <Notice>جارٍ إعداد التقييم…</Notice>}
    {report && <>
      <p className="muted">الرصيد القائم في {report.as_of}</p>
      <div className="metric-grid">
        <div className="panel metric"><p>قيمة المتاح المثبتة</p><strong>{amount(BigInt(report.totals.quantity_value) + BigInt(report.totals.available_device_value))}</strong></div>
        <div className="panel metric"><p>قيمة المعزول المثبتة</p><strong>{amount(report.totals.held_device_value)}</strong></div>
        <div className="panel metric"><p>متاح بلا تكلفة مثبتة</p><strong>{integer(report.totals.unvalued_quantity_units + report.totals.unvalued_available_devices)} قطعة
          {report.totals.unvalued_length_mm > 0 && <> · {formatQuantity(report.totals.unvalued_length_mm, 1000)}</>}</strong></div>
        <div className="panel metric"><p>معزول بلا تكلفة مثبتة</p><strong>{integer(report.totals.unvalued_held_devices)} قطعة</strong></div>
      </div>
      {report.items.length ? <div className="table-scroll"><table>
        <thead><tr>{['الفئة', 'القطع والأطوال', 'قيمة الكمي', 'أجهزة متاحة', 'قيمتها المثبتة', 'أجهزة معزولة', 'قيمتها المثبتة', 'مفقود بالجرد', 'بلا تكلفة مثبتة'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{report.items.map(row => <tr key={row.category_id ?? 'uncategorized'}>
          <th scope="row">{row.category}</th><td>{integer(row.quantity_units)} قطعة{row.length_mm > 0 && <> · {formatQuantity(row.length_mm, 1000)}</>}</td><td>{amount(row.quantity_value)}</td>
          <td>{integer(row.available_devices)}</td><td>{amount(row.available_device_value)}</td>
          <td>{integer(row.held_devices)}</td><td>{amount(row.held_device_value)}</td><td>{integer(row.missing_devices)}</td>
          <td>{integer(row.unvalued_quantity_units + row.unvalued_available_devices + row.unvalued_held_devices)} قطعة
            {row.unvalued_length_mm > 0 && <> · {formatQuantity(row.unvalued_length_mm, 1000)}</>}</td>
        </tr>)}</tbody>
      </table></div> : <p>لا توجد أرصدة مخزون مطابقة.</p>}
      {total > 25 && <nav className="pagination" aria-label="صفحات تقييم المخزون"><button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
        <button className="secondary" disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>التالي</button></nav>}
    </>}
  </section>
}
