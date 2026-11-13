import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { allowed, formatDate, request } from './api'
import type { User } from './api'
import { DevicePicker } from './RetailDevices'
import { Notice, PageTitle } from './ui'

type Branch = { id: number; code: string; name: string; active: 0 | 1 }
type Stock = { id: number; name: string; barcode?: string; tracking: 'quantity' | 'serial' | 'imei'; stock: number; quantity_scale: number }
type Transfer = { id: number; from_name: string; to_name: string; product_name: string; quantity: number;
  quantity_scale: number; reason: string; actor_name: string; created_at: string }

const display = (value: number, scale: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 3 }).format(value / scale) +
  (scale === 1 ? ' قطعة' : ' م')

export function BranchSelect({ value, set, label = 'الفرع', disabled = false, revision = 0 }: {
  value: number; set: (value: number) => void; label?: string; disabled?: boolean; revision?: number
}) {
  const [rows, setRows] = useState<Branch[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    request<Branch[]>('/retail/branches', { signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return
      setRows(data.filter(branch => branch.active)); setError('')
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [revision])
  return <label className="field">{label}
    <select required value={value} disabled={disabled || !rows.length} onChange={event => set(Number(event.target.value))}>
      {!value && <option value={0}>اختر الفرع</option>}
      {!rows.length && !!value && <option value={value}>جارٍ تحميل الفروع…</option>}
      {rows.map(branch => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code}</option>)}
    </select>
    {error && <span role="alert">{error}</span>}
  </label>
}

export function RetailBranches({ user }: { user: User }) {
  const [branch, setBranch] = useState(1)
  const [destination, setDestination] = useState(0)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<Stock[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [product, setProduct] = useState<Stock>()
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [deviceIds, setDeviceIds] = useState<number[]>([])
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [revision, refresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const canManage = allowed(user, 'retail.branches.manage')
  const canTransfer = allowed(user, 'retail.branches.transfer')

  useEffect(() => {
    const controller = new AbortController()
    const filters = new URLSearchParams({ per_page: '25', page: String(page), in_stock: 'true' })
    if (query) filters.set('q', query)
    Promise.all([
      request<Stock[]>('/retail/branches/' + branch + '/stock?' + filters, { signal: controller.signal }),
      request<Transfer[]>('/retail/branch-transfers?branch_id=' + branch, { signal: controller.signal }),
    ]).then(([stock, history]) => {
      if (controller.signal.aborted) return
      setRows(stock.data); setTotal(stock.meta?.total ?? stock.data.length); setTransfers(history.data)
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [branch, query, page, revision])

  async function save(event: FormEvent, action: 'create' | 'transfer') {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (action === 'create') {
        await request<Branch>('/retail/branches', { method: 'POST', financial: true, body: { code, name } })
        setCode(''); setName(''); setMessage('تم إنشاء الفرع برصيد مخزون صفر.')
      } else {
        if (!product || !destination || branch === destination) throw new Error('اختر صنفًا وفرعًا آخر للاستلام.')
        const value = Number(quantity)
        if (!value || value > product.stock / product.quantity_scale) throw new Error('راجع الكمية المتاحة في الفرع.')
        if (product.tracking !== 'quantity' && deviceIds.length !== value) throw new Error('اختر أرقام جميع القطع.')
        await request('/retail/branch-transfers', { method: 'POST', financial: true, body: {
          from_branch_id: branch, to_branch_id: destination, product_id: product.id, quantity: value, device_ids: deviceIds, reason,
        } })
        setProduct(undefined); setDeviceIds([]); setQuantity(''); setReason(''); setMessage('تم خصم الكمية من الفرع وإضافتها للفرع المستلم.')
      }
      refresh(v => v + 1)
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذّر حفظ العملية.') }
    finally { setBusy(false) }
  }
  return <>
    <PageTitle title="مخزون الفروع" description="اعرض الرصيد المتاح في كل فرع وانقل الكميات أو القطع المتتبعة مع الاحتفاظ بسجل التحويل." />
    {message && <Notice>{message}</Notice>}
    {error && <Notice error>{error}</Notice>}
    {canManage && <form className="panel form-card section-space" onSubmit={event => save(event, 'create')}>
      <h2>إنشاء فرع</h2>
      <div className="form-grid">
        <label className="field">اسم الفرع<input value={name} maxLength={100} required onChange={e => setName(e.target.value)} /></label>
        <label className="field">رمز الفرع<input dir="ltr" value={code} minLength={2} maxLength={24} required onChange={e => setCode(e.target.value)} /></label>
      </div>
      <button type="submit" className="primary" disabled={busy}>إنشاء فرع</button>
    </form>}
    <section className="panel panel-inner section-space">
      <h2>الرصيد المتاح</h2>
      <form className="form-grid" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search.trim()) }}>
        <BranchSelect label="فرع العرض" revision={revision} value={branch} disabled={busy} set={id => {
          setBranch(id); setPage(1); setProduct(undefined); setDeviceIds([]); setRows([]); setTransfers([])
        }} />
        <label className="field">بحث في رصيد الفرع<input type="search" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></label>
        <button className="secondary">ابحث</button>
      </form>
      <div className="table-wrap"><table>
        <thead><tr><th>الصنف</th><th>الباركود</th><th>الرصيد</th>{canTransfer && <th>إجراء</th>}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td><bdi>{row.barcode || '—'}</bdi></td>
          <td>{display(row.stock, row.quantity_scale)}</td>{canTransfer && <td><button className="secondary" type="button" disabled={busy}
            onClick={() => { setProduct(row); setQuantity(''); setDeviceIds([]); setDestination(0) }}>نقل {row.name}</button></td>}</tr>)}</tbody>
      </table></div>
      {!rows.length && <p className="muted">لا يوجد رصيد مطابق في هذا الفرع.</p>}
      {total > 25 && <nav className="pagination" aria-label="صفحات مخزون الفرع">
        <button className="secondary" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>السابق</button>
        <span>{page} / {Math.ceil(total / 25)}</span>
        <button className="secondary" disabled={page * 25 >= total} onClick={() => setPage(v => v + 1)}>التالي</button>
      </nav>}
    </section>
    {product && <form className="panel form-card section-space" onSubmit={event => save(event, 'transfer')}>
      <h2>تحويل {product.name}</h2>
      <div className="form-grid">
        <BranchSelect label="الفرع المستلم" revision={revision} value={destination} set={setDestination} disabled={busy} />
        <label className="field">{product.quantity_scale === 1 ? 'عدد القطع' : 'الطول بالمتر'}
          <input type="number" required min={1 / product.quantity_scale}
            step={1 / product.quantity_scale} max={product.stock / product.quantity_scale} value={quantity}
            onChange={e => { setQuantity(e.target.value); setDeviceIds([]) }} />
        </label>
        <label className="field">سبب التحويل<input maxLength={500} required value={reason} onChange={e => setReason(e.target.value)} /></label>
      </div>
      {product.tracking !== 'quantity' && Number.isInteger(Number(quantity)) && Number(quantity) > 0 && <DevicePicker productId={product.id}
        branchId={branch} productName={product.name} quantity={Number(quantity)} selected={deviceIds} change={setDeviceIds} disabled={busy} />}
      <button type="submit" className="primary" disabled={busy}>تسجيل التحويل</button>
    </form>}
    <section className="panel panel-inner section-space"><h2>أحدث تحويلات الفرع</h2>
      {transfers.length ? <div className="table-wrap"><table>
        <thead><tr><th>رقم</th><th>المسار</th><th>الصنف</th><th>الكمية</th><th>السبب</th><th>المسجل</th><th>التاريخ</th></tr></thead>
        <tbody>{transfers.map(row => <tr key={row.id}><td>{row.id}</td><td>{row.from_name} ← {row.to_name}</td><td>{row.product_name}</td>
          <td>{display(row.quantity, row.quantity_scale)}</td><td>{row.reason}</td><td>{row.actor_name}</td><td>{formatDate(row.created_at)}</td></tr>)}</tbody>
      </table></div> : <p className="muted">لا توجد تحويلات لهذا الفرع.</p>}
    </section>
  </>
}
