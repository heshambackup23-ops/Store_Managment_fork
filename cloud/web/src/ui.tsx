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
  kind?: 'text' | 'password' | 'email' | 'number' | 'money' | 'signed-money' | 'date' | 'select' | 'textarea' | 'reference' | 'check' | 'multi'
  options?: { value: string; label: string }[]
  reference?: { path: string; label?: string }
  required?: boolean
  nullable?: boolean
  initial?: string
  min?: number
  placeholder?: string
  read?: (row: Row) => string
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
    if (field.kind === 'check' && value !== undefined) return [field.name, value ? 'true' : 'false']
    if (field.kind === 'multi' && Array.isArray(value)) return [field.name, JSON.stringify(value)]
    return [field.name, value === null || value === undefined ? field.initial || '' : String(value)]
  }))
}

function ReferenceInput({ field, value, set, inputId }: {
  field: Field; value: string; set: (value: string) => void; inputId: string
}) {
  const [options, setOptions] = useState<Row[]>([])
  useEffect(() => {
    if (!field.reference) return
    const controller = new AbortController()
    request<Row[]>(field.reference.path + '?per_page=50', { signal: controller.signal })
      .then(result => setOptions(Array.isArray(result.data) ? result.data : []))
      .catch(() => { /* The record ID can still be entered directly. */ })
    return () => controller.abort()
  }, [field.reference])
  return (
    <>
      <input id={inputId} type="text" inputMode="numeric" pattern="[0-9]+" required={field.required}
        list={inputId + '-list'} value={value} onChange={event => set(event.target.value)} />
      <datalist id={inputId + '-list'}>
        {options.map(option => <option key={idOf(option)} value={String(option.id)} label={String(option[field.reference?.label || 'name'] ?? '')} />)}
      </datalist>
      <small>رقم السجل المرتبط</small>
    </>
  )
}

function FormInput({ field, value, set }: { field: Field; value: string; set: (value: string) => void }) {
  const inputId = useId()
  const kind = field.kind || 'text'
  if (kind === 'multi') {
    const selected: string[] = value ? JSON.parse(value) : []
    return (
      <fieldset className="multi-select">
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
    return <label className="check-field"><input type="checkbox" checked={value === 'true'} onChange={event => set(String(event.target.checked))} />{field.label}</label>
  }
  return (
    <label htmlFor={inputId} className="field">
      <span>{field.label}{field.required && <span className="required" aria-hidden="true"> *</span>}</span>
      {kind === 'reference'
        ? <ReferenceInput field={field} value={value} set={set} inputId={inputId} />
        : kind === 'textarea'
          ? <textarea id={inputId} required={field.required} value={value} onChange={event => set(event.target.value)} />
          : kind === 'select'
            ? <select id={inputId} required={field.required} value={value} onChange={event => set(event.target.value)}>
                <option value="">اختر من القائمة</option>
                {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            : <input id={inputId} type={kind === 'money' || kind === 'signed-money' ? 'text' : kind} inputMode={kind === 'money' || kind === 'signed-money' ? 'decimal' : undefined}
                min={field.min} step={kind === 'number' ? 1 : undefined} required={field.required} placeholder={field.placeholder}
                autoComplete={kind === 'password' ? 'new-password' : undefined}
                value={value} onChange={event => set(event.target.value)} />}
    </label>
  )
}

function encodeField(field: Field, value: string): unknown {
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

function ActionDialog({ action, row, close, done }: {
  action: Action; row?: Row; close: () => void; done: () => void
}) {
  const fields = action.fields || []
  const [values, setValues] = useState(() => initialValues(fields, row))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const method = action.method || 'POST'
      const body = Object.fromEntries(fields.map(field => [field.name, encodeField(field, values[field.name] || '')]))
      await request(action.endpoint(row), { method, body: method === 'DELETE' ? undefined : action.transform?.(body, row) ?? body, financial: action.financial })
      done()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تعذر تنفيذ الطلب.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={action.label} close={() => { if (!busy) close() }}>
      <form className="modal-form" onSubmit={submit}>
        {action.confirmation && <p>{action.confirmation}</p>}
        {fields.map(field => <FormInput key={field.name} field={field} value={values[field.name] || ''}
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

export function DataModule({ config, user, extra, rowActions }: {
  config: ModuleConfig; user: User; extra?: ReactNode; rowActions?: (row: Row) => ReactNode
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
        done={() => { setSelected(undefined); setSuccess('تم تنفيذ الإجراء.'); setVersion(current => current + 1) }} />}
    </>
  )
}
