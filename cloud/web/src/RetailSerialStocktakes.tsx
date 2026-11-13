import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { allowed, formatDate, integer, money, readMoney, request } from './api'
import type { User } from './api'
import { Notice } from './ui'

type Product = { id: number; name: string; barcode?: string; tracking: string }
type Snapshot = { stock: number; movement_id: number; review_id: number }
type Position = Snapshot & { product_id: number; product_name: string; inventory_value_minor?: number | null }
type Identity = { serial_number?: string | null; imei1?: string | null; imei2?: string | null }
type Row = { id: number; kind: 'opening' | 'count'; product_name: string; source_reference: string; status: string;
  actor_id: number; expected_stock: number; missing_count: number; recovered_count: number; added_count: number; created_at: string }
type Detail = Row & { source_product_name?: string; reason: string; approval_reason?: string;
  additions: (Identity & { unit_cost_minor?: number })[]; observations: (Identity & { id: number; disposition: string })[] }
const endpoint = '/retail/serial-stocktakes'
const statusLabels: Record<string, string> = { pending_approval: 'بانتظار الاعتماد', matched: 'مطابق', stale: 'يتطلب إعادة العد', approved: 'تسوية معتمدة' }
const dispositionLabels: Record<string, string> = { present: 'موجود', missing: 'مفقود', recovered: 'عُثر عليه' }
const asSnapshot = ({ stock, movement_id, review_id }: Position): Snapshot => ({ stock, movement_id, review_id })
const lines = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
const identityLabel = (row: Identity) => [row.serial_number, row.imei1, row.imei2].filter(Boolean).join(' / ')

function readAdditions(text: string) {
  return lines(text).map((line, index) => {
    const [serial_number, imei1, imei2, cost, ...extra] = line.split(/[;\t]/).map(field => field.trim())
    if (extra.length || !cost || (!serial_number && !imei1)) {
      throw new Error(`راجع السطر ${index + 1}. اكتب السيريال ثم IMEI الأول ثم الثاني ثم التكلفة، مع الفواصل.`)
    }
    return { serial_number: serial_number || undefined, imei1: imei1 || undefined, imei2: imei2 || undefined, unit_cost_minor: readMoney(cost) }
  })
}

function SerialProductSearch({ label, source, onChoose }: { label: string; source?: boolean; onChoose: (product?: Product) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Product[]>([])
  const [chosen, setChosen] = useState('')
  const [error, setError] = useState('')
  async function search(event: FormEvent) {
    event.preventDefault(); setError('')
    try {
      const { data } = await request<Product[]>('/retail/stocktake-products?' + new URLSearchParams({ q: query.trim(), tracking: source ? 'quantity' : 'tracked', per_page: '50' }))
      setResults(data)
      setChosen(data.length === 1 ? String(data[0].id) : '')
      onChoose(data.length === 1 ? data[0] : undefined)
      if (!data.length) setError('لا توجد أصناف مطابقة لهذا النوع.')
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر البحث.') }
  }
  return <form className="form-section" onSubmit={search}>
    <label className="field">{label}<input type="search" value={query} onChange={event => setQuery(event.target.value)} required /></label>
    <button className="secondary">ابحث عن الصنف</button>
    {error && <Notice error>{error}</Notice>}
    {results.length > 0 && <label className="field">{source ? 'الصنف الكمي المصدر' : 'الصنف المتتبع'}
      <select value={chosen} onChange={event => { setChosen(event.target.value); onChoose(results.find(row => row.id === Number(event.target.value))) }}>
        <option value="">اختر الصنف</option>{results.map(row => <option key={row.id} value={row.id}>{row.name}{row.barcode ? ' · ' + row.barcode : ''}</option>)}
      </select>
    </label>}
  </form>
}

export function RetailSerialStocktakes({ user }: { user: User }) {
  const canCount = allowed(user, 'inventory.stocktake.count')
  const canApprove = allowed(user, 'inventory.stocktake.approve')
  const canIntake = allowed(user, 'inventory.manage') && allowed(user, 'products.cost.manage')
  const [kind, setKind] = useState<'count' | 'opening'>('count')
  const [product, setProduct] = useState<Product>()
  const [source, setSource] = useState<Product>()
  const [hasSource, setHasSource] = useState(false)
  const [position, setPosition] = useState<Position>()
  const [sourcePosition, setSourcePosition] = useState<Position>()
  const [scanned, setScanned] = useState('')
  const [additions, setAdditions] = useState('')
  const [reference, setReference] = useState('')
  const [reason, setReason] = useState('')
  const [decision, setDecision] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [detail, setDetail] = useState<Detail>()
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [revision, refresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const abort = new AbortController()
    request<Row[]>(`${endpoint}?page=${page}&per_page=20`, { signal: abort.signal }).then(result => {
      if (!abort.signal.aborted) { setRows(result.data); setTotal(result.meta?.total ?? result.data.length) }
    }).catch(error => { if (!abort.signal.aborted) setError(error.message) })
    return () => abort.abort()
  }, [page, revision])

  useEffect(() => {
    setPosition(undefined)
    setSourcePosition(undefined)
    const abort = new AbortController()
    const loadPosition = (id: number, callback: (data: Position) => void) =>
      request<Position>(`${endpoint}/positions/${id}`, { signal: abort.signal }).then(result => {
        if (!abort.signal.aborted) callback(result.data)
      }).catch(error => { if (!abort.signal.aborted) setError(error.message) })
    if (product) void loadPosition(product.id, setPosition)
    if (hasSource && source) void loadPosition(source.id, setSourcePosition)
    return () => abort.abort()
  }, [product, source, hasSource, revision])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!product || !position || position.product_id !== product.id || busy || (hasSource && sourcePosition?.product_id !== source?.id)) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const devices = canIntake ? readAdditions(additions) : []
      const { data } = await request<Detail>(endpoint, { method: 'POST', financial: true, body: {
        kind, product_id: product.id, position: asSnapshot(position), source_reference: reference.trim(), reason: reason.trim(), additions: devices,
        ...(kind === 'count' ? { scanned: lines(scanned) } : hasSource && sourcePosition && source
          ? { source: { product_id: source.id, position: asSnapshot(sourcePosition) } } : {}),
      } })
      setDetail(data); setScanned(''); setAdditions(''); setReference(''); setReason(''); setPage(1); refresh(value => value + 1)
      setSuccess('تم حفظ محضر الأجهزة.')
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر حفظ المحضر.') }
    finally { setBusy(false) }
  }

  async function open(id: number) {
    setError(''); setDecision('')
    try { setDetail((await request<Detail>(`${endpoint}/${id}`)).data) }
    catch (error) { setError(error instanceof Error ? error.message : 'تعذّر عرض المحضر.') }
  }

  async function approve(event: FormEvent) {
    event.preventDefault()
    if (!detail || busy) return
    setBusy(true); setError(''); setSuccess('')
    try {
      setDetail((await request<Detail>(`${endpoint}/${detail.id}/approve`, { method: 'POST', financial: true, body: { reason: decision.trim() } })).data)
      setSuccess('تم اعتماد محضر الأجهزة وتطبيق فرق المخزون.'); setDecision('')
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر الاعتماد.') }
    finally { setBusy(false); refresh(value => value + 1) }
  }

  return <section className="panel panel-inner form-section section-space" aria-label="جرد وافتتاح الأجهزة المتتبعة">
    <h2>جرد وافتتاح الأجهزة المتتبعة</h2>
    {error && <Notice error>{error}</Notice>}{success && <Notice>{success}</Notice>}
    {canCount && <>
      {canIntake && <label className="field">نوع المحضر
        <select value={kind} onChange={event => { setKind(event.target.value === 'opening' ? 'opening' : 'count'); setHasSource(false); setAdditions('') }}>
          <option value="count">جرد بالسيريال أو IMEI</option><option value="opening">محضر رصيد افتتاحي</option>
        </select>
      </label>}
      <SerialProductSearch label="اسم الصنف المتتبع أو الباركود" onChoose={setProduct} />
      {kind === 'opening' && <label className="check-field"><input type="checkbox" checked={hasSource} onChange={event => setHasSource(event.target.checked)} /> انقل القطع من صنف كمي قائم</label>}
      {hasSource && <SerialProductSearch label="اسم الصنف الكمي القديم أو الباركود" source onChoose={setSource} />}
      {sourcePosition && <p>{sourcePosition.product_name} · {integer(sourcePosition.stock)} قطعة متاحة للنقل</p>}
      <form className="form-section" onSubmit={submit}>
        {kind === 'count' && <label className="field">الأرقام الموجودة فعليًا
          <textarea dir="ltr" value={scanned} onChange={event => setScanned(event.target.value)} rows={5} aria-describedby="serial-count-help" />
          <small id="serial-count-help">امسح أو الصق رقمًا واحدًا لكل جهاز وفي سطر مستقل. اترك القائمة فارغة فقط إذا كان العدد الفعلي صفرًا.</small>
        </label>}
        {canIntake && <label className="field">{kind === 'opening' ? 'بيانات القطع الافتتاحية' : 'قطع زائدة غير مسجلة'}
          <textarea dir="ltr" value={additions} required={kind === 'opening'} onChange={event => setAdditions(event.target.value)} rows={4} aria-describedby="serial-intake-help" />
          <small id="serial-intake-help">جهاز واحد لكل سطر. افصل الحقول بفاصلة منقوطة أو Tab، بالترتيب السيريال؛ IMEI الأول؛ IMEI الثاني؛ التكلفة بالجنيه. اترك الحقول الاختيارية فارغة واحتفظ بفواصلها.</small>
        </label>}
        <label className="field">مرجع المستند أو الجرد<input value={reference} onChange={event => setReference(event.target.value)} required maxLength={120} /></label>
        <label className="field">سبب تسجيل المحضر<input value={reason} onChange={event => setReason(event.target.value)} required maxLength={1000} /></label>
        <button className="primary" disabled={busy || !position || (hasSource && !sourcePosition)}>سجّل محضر الأجهزة</button>
      </form>
    </>}
    <h3>محاضر الأجهزة</h3>
    {rows.length ? <div className="table-scroll"><table>
      <thead><tr>{['الصنف', 'النوع والمرجع', 'المفقود', 'المسترد', 'الجديد', 'الحالة', 'الإجراء'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        <th scope="row">{row.product_name}</th><td>{row.kind === 'opening' ? 'افتتاح' : 'جرد'} · {row.source_reference}</td>
        <td>{integer(row.missing_count)}</td><td>{integer(row.recovered_count)}</td><td>{integer(row.added_count)}</td>
        <td>{statusLabels[row.status] ?? row.status} · {formatDate(row.created_at)}</td>
        <td><button className="link-button" onClick={() => void open(row.id)}>راجع المحضر {row.id}</button></td>
      </tr>)}</tbody>
    </table></div> : <p>لا توجد محاضر أجهزة.</p>}
    {total > 20 && <nav className="pagination" aria-label="صفحات محاضر الأجهزة"><button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button><button className="secondary" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>التالي</button></nav>}
    {detail && <section className="panel panel-inner form-section" aria-label="تفاصيل محضر الأجهزة">
      <h3>{detail.product_name} · محضر {detail.id}</h3>
      <p>{statusLabels[detail.status] ?? detail.status} · {detail.source_reference}{detail.source_product_name && ` · من ${detail.source_product_name}`}</p>
      <p>{detail.reason}{detail.approval_reason && ` · ${detail.approval_reason}`}</p>
      {detail.observations.length > 0 && <ul className="dash-list">{detail.observations.map(row => <li key={row.id}><bdi>{identityLabel(row)}</bdi> · {dispositionLabels[row.disposition]}</li>)}</ul>}
      {detail.additions.length > 0 && <ul className="dash-list">{detail.additions.map(row => <li key={identityLabel(row)}><bdi>{identityLabel(row)}</bdi> · جهاز جديد{row.unit_cost_minor !== undefined && ` · ${money(row.unit_cost_minor)}`}</li>)}</ul>}
      {canApprove && detail.actor_id !== user.id && detail.status === 'pending_approval' &&
        ((detail.kind === 'count' && detail.added_count === 0) || canIntake) && <form className="form-section" onSubmit={approve}>
          <label className="field">سبب اعتماد محضر الأجهزة<input value={decision} required maxLength={1000} onChange={event => setDecision(event.target.value)} /></label>
          <button className="primary" disabled={busy}>اعتمد محضر الأجهزة</button>
        </form>}
      <button className="secondary" onClick={() => setDetail(undefined)}>أغلق التفاصيل</button>
    </section>}
  </section>
}
