import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { allowed, formatDate, request } from './api'
import type { User } from './api'
import { DevicePicker } from './RetailDevices'
import { Modal, Notice, PageTitle } from './ui'
import './retail-operations.css'

type Branch = { id: number; code: string; name: string; active: 0 | 1 }
type Stock = { id: number; name: string; barcode?: string; tracking: 'quantity' | 'serial' | 'imei'; stock: number; quantity_scale: number }
type Transfer = { id: number; from_name: string; to_name: string; product_name: string; quantity: number;
  quantity_scale: number; reason: string; actor_name: string; created_at: string }

const display = (value: number, scale: number) => new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 3 }).format(value / scale) +
  (scale === 1 ? ' قطعة' : ' م')

export function BranchSelect({ value, set, label = 'الفرع', disabled = false, revision = 0, exclude, allowAll = false }: {
  value: number; set: (value: number) => void; label?: string; disabled?: boolean; revision?: number; exclude?: number; allowAll?: boolean
}) {
  const [rows, setRows] = useState<Branch[]>([])
  const [error, setError] = useState('')
  const options = rows.filter(branch => branch.id !== exclude)
  useEffect(() => {
    const controller = new AbortController()
    request<Branch[]>('/retail/branches', { signal: controller.signal }).then(({ data }) => {
      if (controller.signal.aborted) return
      setRows(data.filter(branch => branch.active)); setError('')
    }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [revision])
  return <label className="field">{label}
    <select required={!allowAll} value={value} disabled={disabled || !options.length} onChange={event => set(Number(event.target.value))}>
      {(allowAll || !value) && <option value={0}>{allowAll ? 'كل الفروع' : 'اختر الفرع'}</option>}
      {!rows.length && !!value && <option value={value}>جارٍ تحميل الفروع…</option>}
      {options.map(branch => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code}</option>)}
    </select>
    {rows.length > 0 && options.length === 0 && <small>لا يوجد فرع آخر متاح.</small>}
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
  const [creating, setCreating] = useState(false)
  const [revision, refresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const canManage = allowed(user, 'retail.branches.manage')
  const canTransfer = allowed(user, 'retail.branches.transfer')

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setLoadError('')
    const filters = new URLSearchParams({ per_page: '25', page: String(page), in_stock: 'true' })
    if (query) filters.set('q', query)
    Promise.all([
      request<Stock[]>('/retail/branches/' + branch + '/stock?' + filters, { signal: controller.signal }),
      request<Transfer[]>('/retail/branch-transfers?branch_id=' + branch, { signal: controller.signal }),
    ]).then(([stock, history]) => {
      if (controller.signal.aborted) return
      setRows(stock.data); setTotal(stock.meta?.total ?? stock.data.length); setTransfers(history.data)
    }).catch(e => { if (!controller.signal.aborted) setLoadError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [branch, query, page, revision])

  async function save(event: FormEvent, action: 'create' | 'transfer') {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (action === 'create') {
        await request<Branch>('/retail/branches', { method: 'POST', financial: true, body: { code, name } })
        setCode(''); setName(''); setCreating(false); setMessage('تم إنشاء الفرع برصيد مخزون صفر.')
      } else {
        if (!product || !destination || branch === destination) throw new Error('اختر صنفًا وفرعًا آخر للاستلام.')
        const value = Number(quantity)
        if (value <= 0 || value > product.stock / product.quantity_scale) throw new Error('راجع الكمية المتاحة في الفرع.')
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
    <PageTitle title="مخزون الفروع" description="راجع الرصيد المتاح للتحويل وحركات المخزون لكل فرع."
      action={canManage && <button className="secondary" onClick={() => { setError(''); setCreating(true) }}>إنشاء فرع</button>} />
    {message && <div role="status"><Notice>{message}</Notice></div>}
    {creating && <Modal title="إنشاء فرع" close={() => { if (!busy) setCreating(false) }}>
      <form className="modal-form" onSubmit={event => save(event, 'create')}>
      <div className="form-grid">
        <label className="field">اسم الفرع<input value={name} maxLength={100} required onChange={e => setName(e.target.value)} /></label>
        <label className="field">رمز الفرع<input dir="ltr" value={code} minLength={2} maxLength={24} required onChange={e => setCode(e.target.value)} /></label>
      </div>
      {error && <Notice error>{error}</Notice>}
      <div className="form-actions"><button className="primary" disabled={busy}>{busy ? 'جارٍ الإنشاء…' : 'إنشاء فرع'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setCreating(false)}>إلغاء</button></div>
      </form>
    </Modal>}
    <section className="panel panel-inner section-space" aria-busy={loading}>
      <h2>الرصيد المتاح</h2>
      <form className="retail-filter-bar" onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search.trim()) }}>
        <BranchSelect label="فرع العرض" revision={revision} value={branch} disabled={busy} set={id => {
          setBranch(id); setPage(1); setProduct(undefined); setDeviceIds([]); setRows([]); setTransfers([])
        }} />
        <label className="field">بحث في رصيد الفرع<input type="search" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /></label>
        <button className="secondary">ابحث</button>
        {query && <button className="secondary" type="button" onClick={() => { setSearch(''); setQuery(''); setPage(1) }}>مسح البحث</button>}
      </form>
      {loadError && <Notice error>{loadError} <button className="secondary" onClick={() => refresh(value => value + 1)}>إعادة المحاولة</button></Notice>}
      {loading && <p role="status" className="muted">جارٍ تحميل رصيد الفرع…</p>}
      {!loading && !loadError && rows.length > 0 && <div className="table-scroll" tabIndex={0} role="region" aria-label="أرصدة الفرع"><table>
        <thead><tr><th scope="col">الصنف</th><th scope="col">الباركود</th><th scope="col">الرصيد</th>{canTransfer && <th scope="col">إجراء</th>}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.name}</th><td><bdi>{row.barcode || '—'}</bdi></td>
          <td>{display(row.stock, row.quantity_scale)}</td>{canTransfer && <td><button className="secondary" type="button" disabled={busy}
            onClick={() => { setError(''); setProduct(row); setQuantity(''); setDeviceIds([]); setDestination(0); setReason('') }}>نقل {row.name}</button></td>}</tr>)}</tbody>
      </table></div>}
      {!loading && !loadError && !rows.length && <p className="muted">{query ? 'لا يوجد صنف يطابق البحث في هذا الفرع.' : 'لا توجد أصناف متاحة للتحويل في هذا الفرع.'}</p>}
      {!loading && !loadError && total > 25 && <nav className="pagination" aria-label="صفحات مخزون الفرع">
        <button className="secondary" disabled={page <= 1} onClick={() => setPage(v => v - 1)}>السابق</button>
        <span>{page} / {Math.ceil(total / 25)}</span>
        <button className="secondary" disabled={page * 25 >= total} onClick={() => setPage(v => v + 1)}>التالي</button>
      </nav>}
    </section>
    {product && <Modal title={'تحويل ' + product.name} close={() => { if (!busy) setProduct(undefined) }}>
      <form className="modal-form" onSubmit={event => save(event, 'transfer')}>
      <p className="retail-context">المتاح في الفرع المصدر <strong>{display(product.stock, product.quantity_scale)}</strong></p>
      <div className="form-grid">
        <BranchSelect label="الفرع المصدر" revision={revision} value={branch} set={setBranch} disabled />
        <BranchSelect label="الفرع المستلم" revision={revision} value={destination} set={setDestination} disabled={busy} exclude={branch} />
        <label className="field">{product.quantity_scale === 1 ? 'عدد القطع' : 'الطول بالمتر'}
          <input type="number" required min={1 / product.quantity_scale}
            step={1 / product.quantity_scale} max={product.stock / product.quantity_scale} value={quantity}
            onChange={e => { setQuantity(e.target.value); setDeviceIds([]) }} />
        </label>
        <label className="field">سبب التحويل<input maxLength={500} required value={reason} onChange={e => setReason(e.target.value)} /></label>
      </div>
      {product.tracking !== 'quantity' && Number.isInteger(Number(quantity)) && Number(quantity) > 0 && <DevicePicker productId={product.id}
        branchId={branch} productName={product.name} quantity={Number(quantity)} selected={deviceIds} change={setDeviceIds} disabled={busy} />}
      {error && <Notice error>{error}</Notice>}
      <div className="form-actions"><button className="primary" disabled={busy || !destination}>{busy ? 'جارٍ التحويل…' : 'تسجيل التحويل'}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setProduct(undefined)}>إلغاء</button></div>
      </form>
    </Modal>}
    <section className="panel panel-inner section-space" aria-busy={loading}><h2>أحدث تحويلات الفرع</h2>
      {!loading && !loadError && (transfers.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label="سجل التحويلات"><table>
        <thead><tr><th>رقم</th><th>المسار</th><th>الصنف</th><th>الكمية</th><th>السبب</th><th>المسجل</th><th>التاريخ</th></tr></thead>
        <tbody>{transfers.map(row => <tr key={row.id}><td>{row.id}</td><td>{row.from_name} ← {row.to_name}</td><td>{row.product_name}</td>
          <td>{display(row.quantity, row.quantity_scale)}</td><td>{row.reason}</td><td>{row.actor_name}</td><td>{formatDate(row.created_at)}</td></tr>)}</tbody>
      </table></div> : <p className="muted">لا توجد تحويلات لهذا الفرع.</p>)}
    </section>
  </>
}
