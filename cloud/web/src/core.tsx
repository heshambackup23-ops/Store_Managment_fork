import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { allowed, apiUrl, decimal, formatDate, integer, money, request } from './api'
import type { User } from './api'
import { DataModule, idOf, Modal, Notice, PageTitle } from './ui'
import type { Action, Column, Field, ModuleConfig, Row } from './ui'

export const required = (name: string, label: string, kind: Field['kind'] = 'text'): Field => ({ name, label, kind, required: true })
export const optional = (name: string, label: string, kind: Field['kind'] = 'text'): Field => ({ name, label, kind, nullable: true })
export const moneyColumn = (key: string, label: string): Column => ({ key, label, render: row => money(row[key]) })
export const dateColumn = (key: string, label: string): Column => ({ key, label, render: row => formatDate(row[key]) })
export const countColumn = (key: string, label: string): Column => ({ key, label, render: row => integer(row[key]) })
export const numberColumn = { key: 'id', label: 'الرقم' }
export const activeColumn = { key: 'active', label: 'الحالة', render: (row: Row) => <span className={row.active ? 'status-pill' : 'status-pill warning'}>{row.active ? 'نشط' : 'موقوف'}</span> }
export const activeField: Field = { name: 'active', label: 'نشط', kind: 'check', initial: 'true' }

export function editAction(path: string, permission: string, fields: Field[]): Action {
  return { label: 'تعديل', method: 'PATCH', permission, fields, endpoint: row => path + '/' + idOf(row) }
}

function deleteAction(path: string, permission: string): Action {
  return { label: 'حذف', method: 'DELETE', permission, endpoint: row => path + '/' + idOf(row), confirmation: 'هل تريد حذف هذا السجل؟', danger: true }
}

export function createAction(label: string, path: string, permission: string, fields: Field[], financial = false): Action {
  return { label, endpoint: () => path, permission, fields, financial }
}

const categoryFields = [required('name', 'اسم التصنيف'), optional('description', 'الوصف', 'textarea')]
const customerFields = [
  required('name', 'اسم العميل'), optional('phone', 'رقم الهاتف'), optional('email', 'البريد الإلكتروني', 'email'),
  optional('address', 'العنوان'), optional('notes', 'ملاحظات', 'textarea'),
]
const productFields: Field[] = [
  required('name', 'اسم المنتج'),
  { ...required('price_minor', 'سعر البيع بالجنيه', 'money'), read: row => decimal(row.price_minor) },
  { ...required('cost_minor', 'التكلفة بالجنيه', 'money'), read: row => decimal(row.cost_minor) },
  { ...optional('category_id', 'التصنيف', 'reference'), reference: { path: '/categories' }, min: 1 },
  optional('barcode', 'الباركود'),
  optional('description', 'الوصف', 'textarea'),
  optional('notes', 'ملاحظات', 'textarea'),
  { ...required('low_stock_threshold', 'حد المخزون المنخفض', 'number'), min: 0, initial: '0' },
  activeField,
]
const staffFields: Field[] = [
  required('name', 'اسم الموظف'), required('email', 'البريد الإلكتروني', 'email'), optional('username', 'اسم مستخدم Android'),
  { ...required('role_id', 'الدور', 'reference'), reference: { path: '/roles' }, min: 1 }, activeField,
]

export const coreModules: Record<string, ModuleConfig> = {
  categories: {
    title: 'التصنيفات', description: 'تنظيم المنتجات في تصنيفات المتجر.', endpoint: '/categories', permission: 'categories.view',
    columns: [numberColumn, { key: 'name', label: 'التصنيف' }, { key: 'description', label: 'الوصف' }, dateColumn('created_at', 'تاريخ الإنشاء')],
    create: createAction('إضافة تصنيف', '/categories', 'categories.create', categoryFields),
    actions: [editAction('/categories', 'categories.update', categoryFields), deleteAction('/categories', 'categories.delete')],
  },
  products: {
    title: 'المنتجات', description: 'أسعار المنتجات والباركود والكميات المسجلة في المخزون.', endpoint: '/products?active=all', permission: 'products.view',
    columns: [
      { key: 'has_image', label: 'الصورة', render: row => row.has_image ? <img className="preview-image" src={apiUrl('/products/' + idOf(row) + '/image') + '?v=' + encodeURIComponent(String(row.updated_at || ''))} alt="" loading="lazy" /> : '—' },
      { key: 'name', label: 'المنتج' }, { key: 'category_name', label: 'التصنيف' }, { key: 'barcode', label: 'الباركود' },
      moneyColumn('price_minor', 'سعر البيع'), countColumn('stock', 'المخزون'), activeColumn,
    ],
    create: createAction('إضافة منتج', '/products', 'products.create', productFields),
    actions: [editAction('/products', 'products.update', productFields), { ...deleteAction('/products', 'products.delete'),
      label: 'أرشفة', visible: row => Boolean(row.active), confirmation: 'هل تريد إيقاف هذا المنتج عن البيع؟' }],
  },
  customers: {
    title: 'العملاء', description: 'سجلات العملاء وبيانات التواصل.', endpoint: '/customers', permission: 'customers.view',
    columns: [numberColumn, { key: 'name', label: 'اسم العميل' }, { key: 'phone', label: 'الهاتف' }, { key: 'email', label: 'البريد الإلكتروني' }, { key: 'notes', label: 'ملاحظات' }],
    create: createAction('إضافة عميل', '/customers', 'customers.create', customerFields),
    actions: [editAction('/customers', 'customers.update', customerFields), deleteAction('/customers', 'customers.delete')],
  },
  staff: {
    title: 'الموظفون', description: 'حسابات الموظفين والأدوار وحالة الوصول.', endpoint: '/staff', permission: 'staff.view',
    columns: [numberColumn, { key: 'name', label: 'الموظف' }, { key: 'email', label: 'البريد الإلكتروني' }, { key: 'role', label: 'الدور' }, activeColumn],
    create: createAction('إضافة موظف', '/staff', 'staff.create', [...staffFields, required('password', 'كلمة المرور الأولية', 'password')]),
    actions: [editAction('/staff', 'staff.update', staffFields)],
  },
  notifications: {
    title: 'الإشعارات', description: 'رسائل إدارة المتجر وسجل القراءة.', endpoint: '/notifications', searchable: false,
    columns: [{ key: 'title', label: 'العنوان' }, { key: 'body', label: 'الرسالة' }, dateColumn('created_at', 'التاريخ'),
      { key: 'read_at', label: 'الحالة', render: row => <span className="status-pill">{row.read_at ? 'مقروء' : 'جديد'}</span> }],
    create: createAction('إرسال إشعار', '/notifications', 'notifications.create', [
      required('title', 'العنوان'), required('body', 'الرسالة', 'textarea'),
      { ...optional('user_id', 'الموظف (اتركه فارغًا لإشعار الجميع)', 'reference'), reference: { path: '/staff' }, min: 1 },
    ]),
    actions: [{ label: 'تحديد كمقروء', visible: row => !row.read_at, endpoint: row => '/notifications/' + idOf(row) + '/read' },
      deleteAction('/notifications', 'notifications.delete')],
  },
}

function ProductImageDialog({ row, close, done }: { row: Row; close: () => void; done: () => void }) {
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endpoint = '/products/' + idOf(row) + '/image'

  async function save(remove = false) {
    if (busy || (!remove && !file)) return
    setBusy(true)
    setError('')
    try {
      if (remove) await request(endpoint, { method: 'DELETE' })
      else await request(endpoint, { method: 'PUT', file })
      done()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر حفظ الصورة.') }
    finally { setBusy(false) }
  }

  return (
    <Modal title="صورة المنتج" close={() => { if (!busy) close() }}>
      <form className="modal-form" onSubmit={event => { event.preventDefault(); void save() }}>
        {Boolean(row.has_image) && <img className="product-image" src={apiUrl(endpoint)} alt={String(row.name || 'صورة المنتج')} />}
        <label className="field">ملف الصورة
          <input type="file" accept="image/png,image/jpeg,image/webp" required onChange={event => setFile(event.target.files?.[0])} />
        </label>
        {error && <Notice error>{error}</Notice>}
        <div className="form-actions">
          <button className="primary" disabled={busy || !file}>حفظ الصورة</button>
          {Boolean(row.has_image) && <button className="danger" type="button" disabled={busy} onClick={() => void save(true)}>حذف الصورة</button>}
        </div>
      </form>
    </Modal>
  )
}

function ProductLabel({ row, close }: { row: Row; close: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState('')
  const barcode = String(row.barcode || '')
  useEffect(() => {
    let active = true
    void import('jsbarcode').then(({ default: JsBarcode }) => {
      if (!active || !canvas.current) return
      JsBarcode(canvas.current, barcode, { format: 'CODE128', margin: 8, height: 58, fontSize: 15, width: 2 })
    }).catch(() => { if (active) setError('لا يمكن تحويل هذا الباركود إلى ملصق قابل للمسح.') })
    return () => { active = false }
  }, [barcode])
  return (
    <Modal title="ملصق المنتج" close={close}>
      <div className="modal-content printable">
        <strong>{String(row.name || '')}</strong>
        {error ? <Notice error>{error}</Notice> : <canvas ref={canvas} className="barcode-canvas" role="img" aria-label={'الباركود ' + barcode} />}
        <p>{money(row.price_minor)}</p>
        <button className="primary no-print" disabled={Boolean(error)} onClick={() => window.print()}>طباعة الملصق</button>
      </div>
    </Modal>
  )
}

export function Products({ user }: { user: User }) {
  const [image, setImage] = useState<Row>()
  const [label, setLabel] = useState<Row>()
  const [version, setVersion] = useState(0)
  return (
    <>
      <DataModule key={version} config={coreModules.products} user={user} rowActions={row => (
        <>
          {allowed(user, 'products.update') && <button className="link-button" onClick={() => setImage(row)}>الصورة</button>}
          {Boolean(row.barcode) && <button className="link-button" onClick={() => setLabel(row)}>الملصق</button>}
        </>
      )} />
      {image && <ProductImageDialog row={image} close={() => setImage(undefined)} done={() => { setImage(undefined); setVersion(current => current + 1) }} />}
      {label && <ProductLabel row={label} close={() => setLabel(undefined)} />}
    </>
  )
}

const permissionNames: Record<string, string> = {
  view: 'عرض', create: 'إضافة', update: 'تعديل', delete: 'حذف', manage: 'إدارة',
  pay: 'سداد', refund: 'استرجاع', reverse: 'عكس', adjust: 'تسوية', reset_password: 'تعيين كلمة المرور', cash: 'إدارة النقدية',
}
const moduleNames: Record<string, string> = {
  dashboard: 'لوحة التحكم', categories: 'التصنيفات', products: 'المنتجات', customers: 'العملاء', staff: 'الموظفون',
  roles: 'الأدوار', settings: 'الإعدادات', notifications: 'الإشعارات', inventory: 'المخزون', invoices: 'الفواتير',
  installments: 'الأقساط', debts: 'الديون', suppliers: 'الموردون', purchases: 'المشتريات', wallets: 'المحافظ',
  damaged: 'الهالك', maintenance: 'الصيانة', reports: 'التقارير', backup: 'النسخ الاحتياطي',
}

function permissionLabel(value: string) {
  const [module, action] = value.split('.')
  return (moduleNames[module] || module) + ' — ' + (permissionNames[action] || action || '')
}

export function Roles({ user }: { user: User }) {
  const [permissions, setPermissions] = useState<string[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!allowed(user, 'roles.view')) return
    const controller = new AbortController()
    request<string[]>('/roles/permissions', { signal: controller.signal })
      .then(result => setPermissions(Array.isArray(result.data) ? result.data : []))
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [user])
  const fields: Field[] = [required('name', 'اسم الدور'), {
    name: 'permissions', label: 'الصلاحيات', kind: 'multi',
    options: permissions?.map(permission => ({ value: permission, label: permissionLabel(permission) })),
  }]
  const administrator = user.permissions.includes('*')
  const canEdit = (row: Row) => administrator && !row.is_system
  const config: ModuleConfig = {
    title: 'الأدوار والصلاحيات', description: 'تحديد العمليات المتاحة لكل دور.', endpoint: '/roles', permission: 'roles.view',
    columns: [numberColumn, { key: 'name', label: 'الدور' },
      { key: 'permissions', label: 'الصلاحيات', render: row => Array.isArray(row.permissions) ? row.permissions.map(permissionLabel).join('، ') : '—' }],
    create: permissions && administrator ? createAction('إضافة دور', '/roles', 'roles.create', fields) : undefined,
    actions: [
      ...(permissions ? [{ ...editAction('/roles', 'roles.update', fields), visible: canEdit }] : []),
      { ...deleteAction('/roles', 'roles.delete'), visible: canEdit },
    ],
  }
  return <DataModule user={user} config={config} extra={error && <Notice error>{error}</Notice>} />
}

const dashboardMetrics = [
  ['sales_minor', 'إجمالي المبيعات', money], ['daily_sales_minor', 'مبيعات اليوم', money],
  ['weekly_sales_minor', 'مبيعات آخر سبعة أيام', money], ['invoices', 'الفواتير', integer],
  ['products', 'المنتجات', integer], ['low_stock', 'مخزون منخفض', integer], ['out_of_stock', 'نفد المخزون', integer],
  ['customers', 'العملاء', integer], ['installments', 'الأقساط', integer], ['personal_debt_minor', 'الديون الشخصية', money],
  ['wallets', 'المحافظ', integer], ['wallet_balance_minor', 'رصيد المحافظ', money], ['maintenance', 'طلبات الصيانة', integer],
] as const

export function Dashboard({ user }: { user: User }) {
  const [metrics, setMetrics] = useState<Row>()
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    request<Row>('/dashboard', { signal: controller.signal })
      .then(response => setMetrics(response.data))
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [])
  const quick = [
    ['/pos', 'نقطة البيع', 'invoices.create'], ['/invoices', 'الفواتير', 'invoices.view'],
    ['/products', 'المنتجات', 'products.view'], ['/reports', 'تقارير المبيعات', 'reports.view'],
  ].filter(([, , permission]) => allowed(user, permission))
  const shown = metrics ? dashboardMetrics.filter(([key]) => key in metrics) : []
  return (
    <>
      <PageTitle title="لوحة التحكم" description="متابعة المبيعات والمخزون وحسابات المتجر." />
      {error ? <Notice error>{error}</Notice> : !metrics ? <Notice>جارٍ تحميل مؤشرات المتجر…</Notice> : (
        <>
          <div className="metric-grid">
            {shown.map(([key, label, format]) => <article key={key} className={'metric panel' + (key === 'sales_minor' ? ' highlight' : '')}>
              <p>{label}</p><strong>{format(metrics[key])}</strong>
            </article>)}
          </div>
          {!shown.length && <Notice>لا تتوفر مؤشرات ضمن صلاحيات حسابك.</Notice>}
        </>
      )}
      {quick.length > 0 && <div className="dashboard-sections">
        <section className="dashboard-section panel">
          <h2>وصول سريع</h2>
          <ul className="dash-list">
            {quick.map(([path, label]) => <li key={path}><Link to={path}>{label}</Link><span aria-hidden="true">←</span></li>)}
          </ul>
        </section>
      </div>}
    </>
  )
}

const settingsFields = [
  ['store_name', 'اسم المتجر'],
  ['currency', 'رمز العملة'],
  ['store_phone', 'رقم هاتف المتجر'],
  ['store_address', 'عنوان المتجر'],
  ['receipt_footer', 'تذييل الإيصال'],
] as const

export function Settings({ user }: { user: User }) {
  const [values, setValues] = useState<Record<string, string>>()
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const read = allowed(user, 'settings.view')
  const edit = allowed(user, 'settings.update')
  useEffect(() => {
    if (!read) return
    const controller = new AbortController()
    request<Record<string, string>>('/settings', { signal: controller.signal })
      .then(response => setValues(response.data))
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [read])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!edit || busy) return
    setBusy(true)
    setError('')
    setSuccess(false)
    try {
      const changes = Object.fromEntries(settingsFields.filter(([key]) => key !== 'currency').map(([key]) => [key, values?.[key] ?? '']))
      await request('/settings', { method: 'PATCH', body: changes })
      setSuccess(true)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر حفظ الإعدادات.') }
    finally { setBusy(false) }
  }

  return <>
    <PageTitle title="الإعدادات" description="بيانات المتجر التي تظهر في الإيصالات." />
    {!read && <Notice error>ليست لديك صلاحية عرض الإعدادات.</Notice>}
    {error && <Notice error>{error}</Notice>}
    {success && <Notice>تم حفظ الإعدادات.</Notice>}
    {read && (values ? <form className="form-card panel" onSubmit={submit}>
      {settingsFields.map(([key, label]) => <label className="field" key={key}>{label}
        <input value={values[key] || ''} required={key === 'store_name' || key === 'currency'} readOnly={!edit || key === 'currency'}
          onChange={event => setValues({ ...values, [key]: event.target.value })} />
      </label>)}
      {edit && <div className="form-actions"><button className="primary" disabled={busy}>حفظ الإعدادات</button></div>}
    </form> : !error && <Notice>جارٍ تحميل الإعدادات…</Notice>)}
  </>
}

export function Profile({ user, update }: { user: User; update: (user: User) => void }) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email)
  const emailChanged = email.trim() !== user.email
  const [profileFeedback, setProfileFeedback] = useState<{ message: string; error?: boolean }>()
  const [passwordFeedback, setPasswordFeedback] = useState<{ message: string; error?: boolean }>()
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  async function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingProfile) return
    setSavingProfile(true)
    setProfileFeedback(undefined)
    try {
      const form = event.currentTarget
      const result = emailChanged
        ? await request<User>('/profile', { method: 'PUT', body: {
            name: name.trim(), email: email.trim(), current_password: new FormData(form).get('current_password'),
          } })
        : await request<User>('/profile', { method: 'PATCH', body: { name: name.trim() } })
      setEmail(result.data.email)
      update(result.data)
      setProfileFeedback({ message: 'تم تحديث بيانات الحساب.' })
    } catch (error) { setProfileFeedback({ error: true, message: error instanceof Error ? error.message : 'تعذر حفظ الملف الشخصي.' }) }
    finally { setSavingProfile(false) }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingPassword) return
    const form = event.currentTarget
    const data = new FormData(form)
    if (data.get('new_password') !== data.get('confirmation')) {
      setPasswordFeedback({ error: true, message: 'كلمتا المرور الجديدتان غير متطابقتين.' })
      return
    }
    setSavingPassword(true)
    setPasswordFeedback(undefined)
    try {
      await request('/profile/password', { method: 'POST', body: { current_password: data.get('current_password'), new_password: data.get('new_password') } })
      form.reset()
      setPasswordFeedback({ message: 'تم تغيير كلمة المرور.' })
    } catch (error) { setPasswordFeedback({ error: true, message: error instanceof Error ? error.message : 'تعذر تغيير كلمة المرور.' }) }
    finally { setSavingPassword(false) }
  }

  return (
    <>
      <PageTitle title="الملف الشخصي" />
      <form className="form-card panel section-space" onSubmit={submitName}>
        <h2>بيانات الحساب</h2>
        <label className="field">الاسم <input required autoComplete="name" value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="field">البريد الإلكتروني <input required type="email" autoComplete="email" value={email}
          onChange={event => setEmail(event.target.value)} /></label>
        {emailChanged && <label className="field">أدخل كلمة المرور الحالية لتغيير البريد الإلكتروني
          <input required name="current_password" type="password" autoComplete="current-password" />
        </label>}
        {profileFeedback && <Notice error={profileFeedback.error}>{profileFeedback.message}</Notice>}
        <div className="form-actions"><button className="primary" disabled={savingProfile}>حفظ بيانات الحساب</button></div>
      </form>
      <form className="form-card panel" onSubmit={submitPassword}>
        <h2>تغيير كلمة المرور</h2>
        <label className="field">كلمة المرور الحالية <input name="current_password" type="password" autoComplete="current-password" required /></label>
        <label className="field">كلمة المرور الجديدة <input name="new_password" type="password" autoComplete="new-password" required /></label>
        <label className="field">تأكيد كلمة المرور الجديدة <input name="confirmation" type="password" autoComplete="new-password" required /></label>
        {passwordFeedback && <Notice error={passwordFeedback.error}>{passwordFeedback.message}</Notice>}
        <div className="form-actions"><button className="primary" disabled={savingPassword}>تغيير كلمة المرور</button></div>
      </form>
    </>
  )
}

export function Staff({ user }: { user: User }) {
  const admin = user.permissions.includes('*')
  const config: ModuleConfig = {
    ...coreModules.staff,
    create: admin ? coreModules.staff.create : undefined,
    actions: admin ? [
      ...(coreModules.staff.actions || []),
      {
        label: 'تعيين كلمة مرور جديدة', permission: 'staff.reset_password',
        endpoint: row => '/staff/' + idOf(row) + '/password',
        fields: [required('password', 'كلمة المرور الجديدة', 'password')],
        confirmation: 'ستنتهي الجلسات المفتوحة لهذا الموظف.',
      },
    ] : [],
  }
  return <DataModule user={user} config={config} />
}

export function Notifications({ user }: { user: User }) {
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean }>()

  async function readAll() {
    if (busy) return
    setBusy(true)
    setFeedback(undefined)
    try {
      await request('/notifications/read-all', { method: 'POST' })
      setVersion(current => current + 1)
      setFeedback({ message: 'تم تحديد جميع الإشعارات كمقروءة.' })
    } catch (error) { setFeedback({ error: true, message: error instanceof Error ? error.message : 'تعذر تحديث الإشعارات.' }) }
    finally { setBusy(false) }
  }

  return <DataModule key={version} user={user} config={coreModules.notifications} extra={
    <div className="section-space">
      {feedback && <Notice error={feedback.error}>{feedback.message}</Notice>}
      <button className="secondary" disabled={busy} onClick={() => void readAll()}>تحديد الكل كمقروء</button>
    </div>
  } />
}
