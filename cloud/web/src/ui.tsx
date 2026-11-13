import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { allowed, integer, readMoney, request } from './api'
import type { Pagination, User } from './api'

export type Row = Record<string, unknown>

export interface Column {
  key: string
  label: string
  render?: (row: Row) => ReactNode
}

export interface Field {
  name: string
  label: string
  kind?: 'text' | 'password' | 'email' | 'number' | 'money' | 'signed-money' | 'date' | 'select' | 'textarea' | 'reference' | 'check' | 'multi' | 'items'
  options?: { value: string; label: string }[]
  reference?: { path: string; label?: string; searchable?: boolean }
  required?: boolean
  nullable?: boolean
  initial?: string
  min?: number
  placeholder?: string
  read?: (row: Row) => string
  visible?: (values: Record<string, string>) => boolean
}

export interface Action {
  label: string
  permission?: string
  fields?: Field[]
  method?: 'POST' | 'PATCH' | 'DELETE'
  endpoint: (row?: Row) => string
  confirmation?: string
  danger?: boolean
  financial?: boolean
  initialFromRow?: boolean
  visible?: (row: Row) => boolean
  transform?: (body: Row, row?: Row) => Row
}

export interface ModuleConfig {
  title: string
  description: string
  endpoint: string
  permission?: string
  empty?: string
  columns: Column[]
  create?: Action
  actions?: Action[]
  searchable?: boolean
}

export const idOf = (row: Row | undefined) => encodeURIComponent(String(row?.id ?? ''))

export function PageTitle({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="page-title">
      <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {action}
    </header>
  )
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={error ? 'notice error' : 'notice'} role={error ? 'alert' : 'status'}>{children}</div>
}

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  useEffect(() => { dialog.current?.showModal() }, [])
  return (
    <dialog ref={dialog} aria-labelledby={heading} onCancel={event => { event.preventDefault(); close() }}>
      <div className="modal-header">
        <h2 id={heading}>{title}</h2>
        <button className="icon-button" type="button" aria-label="إغلاق" onClick={close}>×</button>
      </div>
      {children}
    </dialog>
  )
}

export function dataText(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا'
  if (typeof value === 'string' || typeof value === 'number') return value
  return '—'
}

function initialValues(fields: Field[], row?: Row): Record<string, string> {
  return Object.fromEntries(fields.map(field => {
    const value = row?.[field.name]
    if (row && field.read) return [field.name, field.read(row)]
    if (field.kind === 'date' && typeof value === 'string') return [field.name, value.slice(0, 10)]
    if (field.kind === 'check' && value !== undefined) return [field.name, value ? 'true' : 'false']
    if ((field.kind === 'multi' || field.kind === 'items') && Array.isArray(value)) return [field.name, JSON.stringify(value)]
    return [field.name, value === null || value === undefined ? field.initial || '' : String(value)]
  }))
}

function ReferenceInput({ field, value, set, inputId, disabled }: {
  field: Field; value: string; set: (value: string) => void; inputId: string; disabled?: boolean
}) {
  const [options, setOptions] = useState<Row[]>([])
  const [term, setTerm] = useState('')
  const [error, setError] = useState(false)
  const path = field.reference?.path
  const searchable = field.reference?.searchable ?? ['/customers', '/products', '/categories', '/staff', '/suppliers'].includes(path || '')
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ per_page: '50' })
      if (searchable && term.trim()) params.set('q', term.trim())
      request<Row[]>(path + '?' + params, { signal: controller.signal })
        .then(result => {
          if (!controller.signal.aborted) { setOptions(Array.isArray(result.data) ? result.data : []); setError(false) }
        })
        .catch(() => { if (!controller.signal.aborted) setError(true) })
    }, term ? 250 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [path, searchable, term])
  return (
    <div className="reference-field">
      {searchable && <input type="search" disabled={disabled} aria-label={'بحث في ' + field.label} value={term}
        maxLength={100} placeholder="ابحث بالاسم أو الرمز" onChange={event => setTerm(event.target.value)} />}
      {options.length > 0 && <select disabled={disabled} aria-label={'اختر ' + field.label} value={options.some(option => String(option.id) === value) ? value : ''}
        onChange={event => set(event.target.value)}>
        <option value="">اختر من النتائج</option>
        {options.map(option => <option key={idOf(option)} value={String(option.id)}>
          {String(option[field.reference?.label || 'name'] || option.id)} (#{String(option.id)})
        </option>)}
      </select>}
      <input id={inputId} type="text" inputMode="numeric" pattern="[0-9]+" required={field.required}
        placeholder="رقم السجل" disabled={disabled} value={value} onChange={event => set(event.target.value)} />
      {error && <small>تعذر تحميل الخيارات. يمكنك إدخال رقم السجل.</small>}
    </div>
  )
}

export function FormInput({ field, value, set, disabled }: { field: Field; value: string; set: (value: string) => void; disabled?: boolean }) {
  const inputId = useId()
  const kind = field.kind || 'text'
  if (kind === 'items') return <ItemsInput label={field.label} value={value} set={set} disabled={disabled} />
  if (kind === 'multi') {
    const selected: string[] = value ? JSON.parse(value) : []
    return (
      <fieldset className="multi-select" disabled={disabled}>
        <legend>{field.label}</legend>
        {field.options?.map(option => (
          <label key={option.value}>
            <input type="checkbox" checked={selected.includes(option.value)} onChange={event => {
              set(JSON.stringify(event.target.checked ? [...selected, option.value] : selected.filter(item => item !== option.value)))
            }} />
            {option.label}
          </label>
        ))}
      </fieldset>
    )
  }
  if (kind === 'check') {
    return <label className="check-field"><input type="checkbox" disabled={disabled} checked={value === 'true'} onChange={event => set(String(event.target.checked))} />{field.label}</label>
  }
  if (kind === 'reference') return <div className="field">
    <label htmlFor={inputId}>{field.label}{field.required && <span className="required" aria-hidden="true"> *</span>}</label>
    <ReferenceInput field={field} value={value} set={set} inputId={inputId} disabled={disabled} />
  </div>
  return (
    <label htmlFor={inputId} className="field">
      <span>{field.label}{field.required && <span className="required" aria-hidden="true"> *</span>}</span>
      {kind === 'textarea'
          ? <textarea id={inputId} disabled={disabled} required={field.required} value={value} onChange={event => set(event.target.value)} />
          : kind === 'select'
            ? <select id={inputId} disabled={disabled} required={field.required} value={value} onChange={event => set(event.target.value)}>
                <option value="">اختر من القائمة</option>
                {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            : <input id={inputId} disabled={disabled} type={kind === 'money' || kind === 'signed-money' ? 'text' : kind} inputMode={kind === 'money' || kind === 'signed-money' ? 'decimal' : undefined}
                min={field.min} step={kind === 'number' ? 1 : undefined} required={field.required} placeholder={field.placeholder}
                autoComplete={kind === 'password' ? 'new-password' : undefined}
                value={value} onChange={event => set(event.target.value)} />}
    </label>
  )
}

type ItemInput = { product_id: number; quantity: number }
const catalogItem: Field = { name: 'product_id', label: 'المنتج', kind: 'reference', reference: { path: '/products' } }

function ItemsInput({ label, value, set, disabled }: { label: string; value: string; set: (value: string) => void; disabled?: boolean }) {
  const [product, setProduct] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState('')
  const items: ItemInput[] = value ? JSON.parse(value) : []

  function add() {
    const productId = Number(product)
    const count = Number(quantity)
    if (!Number.isSafeInteger(productId) || productId <= 0 || !Number.isSafeInteger(count) || count < 1 || count > 1_000_000) {
      setError('اختر منتجًا وأدخل كمية صحيحة.')
      return
    }
    if (items.some(item => item.product_id === productId)) {
      setError('هذا المنتج مضاف بالفعل.')
      return
    }
    setError('')
    set(JSON.stringify([...items, { product_id: productId, quantity: count }]))
    setProduct('')
    setQuantity('1')
  }

  return <fieldset className="multi-select" disabled={disabled}>
    <legend>{label}</legend>
    <FormInput field={catalogItem} value={product} set={setProduct} disabled={disabled} />
    <label>الكمية<input type="number" min="1" max="1000000" value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
    <button className="secondary" type="button" disabled={items.length >= 40} onClick={add}>إضافة بند</button>
    {error && <Notice error>{error}</Notice>}
    {items.length > 0 && <ul className="dash-list">{items.map(item => <li key={item.product_id}>
      <span>المنتج {integer(item.product_id)} · الكمية {integer(item.quantity)}</span>
      <button className="link-button" type="button" onClick={() => set(JSON.stringify(items.filter(row => row.product_id !== item.product_id)))}>إزالة</button>
    </li>)}</ul>}
  </fieldset>
}

function encodeField(field: Field, value: string): unknown {
  if (field.kind === 'items') {
    const items: ItemInput[] = value ? JSON.parse(value) : []
    if (field.required && !items.length) throw new Error('أضف بندًا واحدًا على الأقل.')
    return items.map(({ product_id, quantity }) => ({ product_id, quantity }))
  }
  if (field.kind === 'check') return value === 'true'
  if (field.kind === 'multi') return value ? JSON.parse(value) : []
  if (value.trim() === '') return field.nullable ? null : undefined
  if (field.kind === 'money') return readMoney(value)
  if (field.kind === 'signed-money') {
    const amount = value.trim()
    return amount.startsWith('-') ? -readMoney(amount.slice(1)) : readMoney(amount)
  }
  if (field.kind === 'number' || field.kind === 'reference') {
    const number = Number(value)
    if (!Number.isSafeInteger(number) || (field.min !== undefined && number < field.min)) {
      throw new Error('أدخل رقمًا صحيحًا في حقل ' + field.label + '.')
    }
    return number
  }
  return field.kind === 'password' ? value : value.trim()
}

export function ActionDialog({ action, row, close, done }: {
  action: Action; row?: Row; close: () => void; done: () => void
}) {
  const fields = action.fields || []
  const [values, setValues] = useState(() => initialValues(fields, action.method === 'PATCH' || action.initialFromRow ? row : undefined))
  const visible = fields.filter(field => field.visible?.(values) ?? true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [accessKey, setAccessKey] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const method = action.method || 'POST'
      const body = Object.fromEntries(visible.map(field => [field.name, encodeField(field, values[field.name] || '')]))
      const result = await request<Row>(action.endpoint(row), { method, body: method === 'DELETE' ? undefined : action.transform?.(body, row) ?? body, financial: action.financial })
      const secret = result.data?.access_key
      if (typeof secret === 'string') setAccessKey(secret)
      else done()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تعذر تنفيذ الطلب.')
    } finally {
      setBusy(false)
    }
  }

  if (accessKey) return <AccessKeyDialog accessKey={accessKey} close={done} />
  return (
    <Modal title={action.label} close={() => { if (!busy) close() }}>
      <form className="modal-form" onSubmit={submit}>
        {action.confirmation && <p>{action.confirmation}</p>}
        {visible.map(field => <FormInput key={field.name} field={field} value={values[field.name] || ''} disabled={busy}
          set={value => setValues(previous => ({ ...previous, [field.name]: value }))} />)}
        {error && <Notice error>{error}</Notice>}
        <div className="form-actions">
          <button className={action.danger ? 'danger' : 'primary'} disabled={busy}>{busy ? 'جارٍ التنفيذ…' : action.label}</button>
          <button className="secondary" type="button" disabled={busy} onClick={close}>إلغاء</button>
        </div>
      </form>
    </Modal>
  )
}

export function DataModule({ config, user, extra, rowActions, onChange }: {
  config: ModuleConfig; user: User; extra?: ReactNode; rowActions?: (row: Row) => ReactNode; onChange?: () => void
}) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Row[]>([])
  const [pagination, setPagination] = useState<Pagination>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [version, setVersion] = useState(0)
  const [success, setSuccess] = useState('')
  const [selected, setSelected] = useState<{ action: Action; row?: Row }>()
  const canRead = allowed(user, config.permission)
  const canCreate = config.create && allowed(user, config.create.permission)
  const actions = config.actions?.filter(action => allowed(user, action.permission)) || []
  const hasActions = actions.length > 0 || rowActions !== undefined
  const maxPage = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.per_page)) : 1

  useEffect(() => {
    if (!canRead) return
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const params = new URLSearchParams({ page: String(page), per_page: '20' })
    if (query) params.set('q', query)
    request<Row[]>(config.endpoint + (config.endpoint.includes('?') ? '&' : '?') + params, { signal: controller.signal })
      .then(response => {
        if (!Array.isArray(response.data)) throw new Error('تعذر قراءة قائمة السجلات.')
        setData(response.data)
        setPagination(response.meta)
        if (response.meta && page > 1 && !response.data.length) setPage(page - 1)
      })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [canRead, config.endpoint, page, query, version])

  return (
    <>
      <PageTitle title={config.title} description={config.description} action={
        canCreate && config.create && <button className="primary" onClick={() => setSelected({ action: config.create! })}>{config.create.label}</button>
      } />
      {!canRead ? <Notice error>ليست لديك صلاحية عرض هذه الصفحة.</Notice> : (
        <>
          {extra}
          {success && <Notice>{success}</Notice>}
          <section className="panel data-panel" aria-label={config.title}>
            <div className="data-toolbar">
              {config.searchable !== false && (
                <form className="search-form" onSubmit={event => { event.preventDefault(); setQuery(input.trim()); setPage(1) }}>
                  <input type="search" value={input} onChange={event => setInput(event.target.value)} aria-label="ابحث في السجلات" placeholder="ابحث في السجلات" />
                  <button className="secondary">بحث</button>
                  {query && <button type="button" className="link-button" onClick={() => { setInput(''); setQuery(''); setPage(1) }}>مسح</button>}
                </form>
              )}
              {pagination && <span className="muted">{integer(pagination.total)} سجل</span>}
            </div>
            {loading ? <p className="table-state" role="status">جارٍ تحميل السجلات…</p>
              : error ? <div className="table-state"><Notice error>{error}</Notice><button className="secondary" onClick={() => setVersion(current => current + 1)}>إعادة المحاولة</button></div>
              : !data.length ? <p className="table-state">{query ? 'لا توجد نتائج للبحث.' : config.empty || 'لا توجد سجلات حتى الآن.'}</p>
              : <div className="table-scroll" tabIndex={0} role="region" aria-label={'جدول ' + config.title}>
                  <table>
                    <thead><tr>{config.columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}{hasActions && <th scope="col">الإجراءات</th>}</tr></thead>
                    <tbody>{data.map((row, index) => <tr key={String(row.id ?? index)}>
                      {config.columns.map(column => <td key={column.key}>{column.render ? column.render(row) : dataText(row[column.key])}</td>)}
                      {hasActions && <td><div className="row-actions">
                        {rowActions?.(row)}
                        {actions.filter(action => action.visible?.(row) ?? true).map(action =>
                          <button className={action.danger ? 'link-button danger-text' : 'link-button'} key={action.label} onClick={() => setSelected({ action, row })}>{action.label}</button>,
                        )}
                      </div></td>}
                    </tr>)}</tbody>
                  </table>
                </div>}
            {maxPage > 1 && <nav className="pagination" aria-label="التنقل بين صفحات النتائج">
              <button className="secondary" onClick={() => setPage(page - 1)} disabled={page <= 1 || loading}>السابق</button>
              <span>{integer(page)} / {integer(maxPage)}</span>
              <button className="secondary" onClick={() => setPage(page + 1)} disabled={page >= maxPage || loading}>التالي</button>
            </nav>}
          </section>
        </>
      )}
      {selected && <ActionDialog action={selected.action} row={selected.row} close={() => setSelected(undefined)}
        done={() => { setSelected(undefined); setSuccess('تم تنفيذ الإجراء.'); setVersion(current => current + 1); onChange?.() }} />}
    </>
  )
}

export function AccessKeyDialog({ accessKey, close }: { accessKey: string; close: () => void }) {
  const [feedback, setFeedback] = useState('')
  const input = useRef<HTMLInputElement>(null)
  async function copy() {
    try {
      await navigator.clipboard.writeText(accessKey)
      setFeedback('تم نسخ المفتاح.')
    } catch {
      input.current?.select()
      setFeedback('انسخ المفتاح المحدد يدويًا.')
    }
  }
  return <Modal title="مفتاح الدخول الجديد" close={close}>
    <div className="modal-content">
      <p>احفظ المفتاح الآن. يُستخدم في خانة كلمة المرور عند تسجيل الدخول ويُعرض مرة واحدة.</p>
      <label className="field">مفتاح الدخول<input ref={input} value={accessKey} readOnly dir="ltr" autoComplete="off" /></label>
      {feedback && <Notice>{feedback}</Notice>}
      <div className="form-actions">
        <button className="primary" onClick={() => void copy()}>نسخ المفتاح</button>
        <button className="secondary" onClick={close}>تم الحفظ</button>
      </div>
    </div>
  </Modal>
}
