import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { allowed, formatDate, request } from './api'
import type { User } from './api'
import { Notice, PageTitle } from './ui'
import { RetailSerialStocktakes } from './RetailSerialStocktakes'
import { BranchSelect } from './RetailBranches'
import { displayQuantity, formatQuantity, measurementLabel, quantityStep } from './measurement'

type Product = { id: number; name: string; barcode?: string; tracking: string; quantity_scale?: number }
type Count = {
  id: number; product_id: number; product_name: string; tracking: string; expected_quantity: number; observed_quantity: number;
  difference_quantity: number; status: string; actor_id: number; actor_name: string; reason?: string; created_at: string;
  quantity_scale?: number;
  branch_name?: string;
}
const states: Record<string, string> = { matched: 'مطابق', pending_approval: 'بانتظار الاعتماد', report_only: 'فرق بأجهزة متتبعة', approved: 'تسوية معتمدة', stale: 'يتطلب إعادة العد' }

export function RetailStocktakes({ user }: { user: User }) {
  const [parameters, setParameters] = useSearchParams()
  const serial = parameters.get('view') === 'serial'
  const canCount = allowed(user, 'inventory.stocktake.count')
  const canApprove = allowed(user, 'inventory.stocktake.approve')
  const [rows, setRows] = useState<Count[]>([])
  const [branch, setBranch] = useState(1)
  const [query, setQuery] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [id, setId] = useState('')
  const [observed, setObserved] = useState('')
  const [reason, setReason] = useState('')
  const [decision, setDecision] = useState('')
  const [selected, setSelected] = useState<number>()
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [revision, refresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const scale = products.find(product => String(product.id) === id)?.quantity_scale

  useEffect(() => {
    if (serial) return
    const abort = new AbortController()
    setLoading(true)
    request<Count[]>('/retail/stocktakes?page=' + page + '&per_page=20', { signal: abort.signal }).then(result => {
      if (abort.signal.aborted) return
      setRows(result.data); setTotal(result.meta?.total ?? result.data.length)
    }).catch(error => { if (!abort.signal.aborted) setError(error.message) })
      .finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [page, revision, serial])

  async function search(event: FormEvent) {
    event.preventDefault(); setError('')
    try {
      const { data } = await request<Product[]>('/retail/stocktake-products?' + new URLSearchParams({ q: query.trim(), tracking: 'quantity', per_page: '30' }))
      setProducts(data); setId(data.length === 1 ? String(data[0].id) : ''); setSearched(true)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر البحث.') }
  }

  async function save(event: FormEvent, path: string, body: unknown, message: string) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setSuccess('')
    try {
      await request(path, { method: 'POST', financial: true, body })
      setSuccess(message); setObserved(''); setReason(''); setDecision(''); setSelected(undefined); setPage(1)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر حفظ الجرد.') }
    finally { setBusy(false); refresh(value => value + 1) }
  }

  return <>
    <PageTitle title="جرد المخزون" description="عدّ الصنف فعليًا، ثم قارن بالدفتري بعد تسجيل العد. التسوية تحتاج اعتمادًا مستقلًا." />
    <div className="retail-switcher" role="group" aria-label="نوع الجرد">
      <button type="button" aria-pressed={!serial} className={!serial ? 'primary' : 'secondary'} onClick={() => setParameters({})}>الجرد الكمي</button>
      <button type="button" aria-pressed={serial} className={serial ? 'primary' : 'secondary'} onClick={() => setParameters({ view: 'serial' })}>جرد الأجهزة بالسيريال وIMEI</button>
    </div>
    {serial && <RetailSerialStocktakes user={user} />}
    {!serial && <>
    {error && <Notice error>{error}</Notice>}{success && <Notice>{success}</Notice>}
    {canCount && <section className="panel form-card section-space">
      <form className="form-section" onSubmit={search}>
        <label className="field">اسم الصنف أو الباركود<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <button className="secondary">اعرض الأصناف للعدّ</button>
        {searched && !products.length && <p className="muted" role="status">لا توجد أصناف كمية مطابقة. يمكنك استخدام تبويب جرد الأجهزة للأصناف المتتبعة.</p>}
      </form>
      <form className="form-section" onSubmit={event => save(event, '/retail/stocktakes', { product_id: Number(id), branch_id: branch, observed_quantity: Number(observed), reason: reason.trim() || undefined }, 'تم تسجيل العدد الفعلي.') }>
        <BranchSelect label="فرع الجرد" value={branch} set={setBranch} disabled={busy} />
        <label className="field">الصنف<select value={id} required onChange={event => setId(event.target.value)}><option value="">اختر صنفًا</option>
          {products.map(product => <option key={product.id} value={product.id}>{product.name} {product.barcode && ` · ${product.barcode}`}</option>)}
        </select></label>
        <label className="field">الكمية الفعلية ({measurementLabel(scale)})
          <input type="number" min={0} step={quantityStep(scale)} max={displayQuantity(1000000000, scale)}
            value={observed} required onChange={event => setObserved(event.target.value)} /></label>
        <label className="field">الملاحظة<textarea value={reason} maxLength={500} onChange={event => setReason(event.target.value)} /></label>
        <button className="primary" disabled={busy || !id}>سجّل العدّ</button>
      </form>
    </section>}
    <section className="panel panel-inner form-section">
      <h2>سجل الجرد الكمي</h2>
      {loading ? <p className="muted" role="status">جارٍ تحميل نتائج الجرد…</p> : !rows.length ? <p>لا توجد نتائج جرد.</p> : <div className="table-scroll"><table>
        <thead><tr>{['الصنف', 'الدفتري', 'الفعلي', 'الفرق', 'الحالة', 'العدّ والتاريخ', 'الإجراء'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.product_name}{row.branch_name && <small> · {row.branch_name}</small>}</th><td>{formatQuantity(row.expected_quantity, row.quantity_scale)}</td><td>{formatQuantity(row.observed_quantity, row.quantity_scale)}</td>
          <td>{formatQuantity(row.difference_quantity, row.quantity_scale)}</td><td><span className="retail-status" data-tone={row.status === 'stale' ? 'attention' : undefined}>{states[row.status] ?? row.status}</span></td><td>{row.actor_name} · {formatDate(row.created_at)}{row.reason && ' · ' + row.reason}</td>
          <td>{canApprove && row.status === 'pending_approval' && row.actor_id !== user.id && <button className="link-button" onClick={() => { setSelected(row.id); setDecision('') }}>راجع الجرد {row.id}</button>}</td></tr>)}</tbody>
      </table></div>}
      {selected && <form className="form-section" onSubmit={event => save(event, `/retail/stocktakes/${selected}/approve`, { reason: decision.trim() || undefined }, 'تم اعتماد التسوية.') }>
        <p className="retail-context">تسوية محضر الجرد رقم <strong>{selected}</strong> · {rows.find(row => row.id === selected)?.product_name}</p>
        <label className="field">ملاحظة الاعتماد<textarea value={decision} maxLength={500} onChange={event => setDecision(event.target.value)} /></label>
        <div className="form-actions"><button className="primary" disabled={busy}>اعتمد التسوية</button><button className="secondary" type="button" onClick={() => setSelected(undefined)}>إلغاء</button></div>
      </form>}
      {total > 20 && <nav className="pagination" aria-label="صفحات الجرد"><button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
        <button className="secondary" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>التالي</button></nav>}
    </section>
    </>}
  </>
}
