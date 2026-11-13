import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { allowed, apiUrl, decimal, formatDate, integer, money, request } from './api'
import { RetailQuantityCost } from './RetailQuantityCost'
import { displayQuantity, formatQuantity, measurementLabel } from './measurement'
import type { User } from './api'
import { AccessKeyDialog, DataModule, idOf, Modal, Notice, PageTitle } from './ui'
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
const warrantyEnabled = (values: Record<string, string>) => values.measurement_unit !== 'meter' && values.tracking !== 'quantity' && Number(values.warranty_months) > 0
const productFields: Field[] = [
  required('name', 'اسم المنتج'),
  { ...required('price_minor', 'سعر وحدة البيع بالجنيه', 'money'), read: row => decimal(row.price_minor) },
  { ...required('cost_minor', 'تكلفة الوحدة بالجنيه', 'money'), read: row => decimal(row.cost_minor) },
  { ...required('measurement_unit', 'وحدة البيع والمخزون', 'select'), initial: 'piece', options: [
    { value: 'piece', label: 'قطعة' }, { value: 'meter', label: 'متر (حتى ٣ خانات عشرية)' },
  ] },
  { ...optional('category_id', 'التصنيف', 'reference'), reference: { path: '/categories' }, min: 1 },
  optional('barcode', 'الباركود'),
  optional('variant_group', 'الموديل أو مجموعة المتغيرات'), optional('variant_color', 'اللون'), optional('variant_size', 'المقاس'),
  optional('compatible_models', 'الأجهزة المتوافقة', 'textarea'),
  { ...required('tracking', 'تتبّع المخزون', 'select'), initial: 'quantity', visible: values => values.measurement_unit !== 'meter', options: [
    { value: 'quantity', label: 'بالكمية' }, { value: 'serial', label: 'بالرقم التسلسلي' }, { value: 'imei', label: 'برقم IMEI' },
  ] },
  { ...optional('warranty_months', 'مدة الضمان بالشهور', 'number'), min: 0, initial: '0', visible: values => values.measurement_unit !== 'meter' && values.tracking !== 'quantity' },
  { ...required('warranty_basis', 'بداية احتساب الضمان', 'select'), initial: 'sale', visible: warrantyEnabled, options: [
    { value: 'sale', label: 'تاريخ الفاتورة' }, { value: 'delivery', label: 'تاريخ التسليم' },
    { value: 'installation', label: 'تاريخ التركيب' },
  ] },
  { ...optional('warranty_guarantor', 'اسم جهة الضمان'), visible: warrantyEnabled },
  { ...optional('units_per_pack', 'عدد القطع في العبوة', 'number'), min: 1, nullable: false, initial: '1', visible: values => values.tracking === 'quantity' && values.measurement_unit !== 'meter' },
  { ...optional('pack_barcode', 'باركود العبوة'), visible: values => values.tracking === 'quantity' && values.measurement_unit !== 'meter' },
  optional('description', 'الوصف', 'textarea'),
  optional('notes', 'ملاحظات', 'textarea'),
  { ...required('low_stock_threshold', 'حد المخزون المنخفض بوحدة الصنف', 'number'), min: 0, step: 0.001,
    initial: '0', read: row => String(displayQuantity(row.low_stock_threshold, row.quantity_scale)) },
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
      { key: 'price_minor', label: 'سعر البيع', render: row => money(row.price_minor) + ' / ' + measurementLabel(row.quantity_scale) },
      { key: 'stock', label: 'المخزون', render: row => formatQuantity(row.stock, row.quantity_scale) }, activeColumn,
    ],
    create: createAction('إضافة منتج', '/products', 'products.create', productFields),
    actions: [editAction('/products', 'products.update', productFields.map(field =>
      field.name === 'measurement_unit' ? { ...field, visible: () => false } : field)), { ...deleteAction('/products', 'products.delete'),
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
    columns: [numberColumn, { key: 'name', label: 'الموظف' }, { key: 'email', label: 'البريد الإلكتروني' }, { key: 'role', label: 'الدور' },
      { key: 'credential_mode', label: 'الدخول', render: row => row.credential_mode === 'access_key' ? 'مفتاح دخول' : 'كلمة مرور' }, activeColumn],
    create: createAction('إضافة موظف', '/staff', 'staff.create', [...staffFields, {
      name: 'credential_mode', label: 'طريقة الدخول', kind: 'select', initial: 'password', required: true,
      options: [{ value: 'password', label: 'كلمة مرور' }, { value: 'access_key', label: 'مفتاح دخول مولّد' }],
    }, { ...required('password', 'كلمة المرور الأولية', 'password'), visible: values => values.credential_mode !== 'access_key' }]),
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

export function RecordImageDialog({ row, collection, title, maxBytes, close, done }: {
  row: Row; collection: string; title: string; maxBytes?: number; close: () => void; done: () => void
}) {
  const [file, setFile] = useState<File>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const endpoint = collection + '/' + idOf(row) + '/image'

  async function save(remove = false) {
    if (busy || (!remove && !file)) return
    if (!remove && maxBytes && file && file.size > maxBytes) { setError('حجم الصورة يتجاوز الحد المسموح.'); return }
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
    <Modal title={title} close={() => { if (!busy) close() }}>
      <form className="modal-form" onSubmit={event => { event.preventDefault(); void save() }}>
        {Boolean(row.has_image) && <img className="product-image" src={apiUrl(endpoint)} alt={String(row.name || title)} />}
        <label className="field">ملف الصورة
          <input type="file" accept="image/png,image/jpeg,image/webp" required disabled={busy} onChange={event => setFile(event.target.files?.[0])} />
        </label>
        {maxBytes && <small>الحد الأقصى {integer(maxBytes / 1024)} كيلوبايت.</small>}
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
  const [valuation, setValuation] = useState<string>()
  const productConfig = coreModules.products
  const withoutCost = (action: Action) => ({ ...action, fields: action.fields?.filter(field => field.name !== 'cost_minor') })
  const config = allowed(user, 'products.cost.manage') ? productConfig : {
    ...productConfig, create: productConfig.create && withoutCost(productConfig.create), actions: productConfig.actions?.map(withoutCost),
  }
  return (
    <>
      <DataModule key={version} config={config} user={user} rowActions={row => (
        <>
          {allowed(user, 'products.update') && <button className="link-button" onClick={() => setImage(row)}>الصورة</button>}
          {Boolean(row.barcode) && <button className="link-button" onClick={() => setLabel(row)}>الملصق</button>}
          {row.tracking === 'quantity' && (allowed(user, 'products.cost.view') || allowed(user, 'products.cost.manage')) && <button className="link-button" onClick={() => setValuation(idOf(row))}>تقييم المخزون</button>}
        </>
      )} />
      {image && <RecordImageDialog row={image} collection="/products" title="صورة المنتج" close={() => setImage(undefined)} done={() => { setImage(undefined); setVersion(current => current + 1) }} />}
      {label && <ProductLabel row={label} close={() => setLabel(undefined)} />}
      {valuation && <RetailQuantityCost productId={valuation} user={user} close={() => setValuation(undefined)} />}
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
  if (value === 'retail.devices.disposition.approve') return 'الأجهزة المتتبعة — اعتماد قرار الجهاز المعزول'
  if (value === 'retail.used_phones.acquire') return 'الموبايلات المستعملة — إثبات الشراء والدفع'
  if (value === 'retail.installations.view') return 'التركيب — عرض المواعيد'
  if (value === 'retail.installations.manage') return 'التركيب — جدولة المواعيد والإسناد'
  if (value === 'retail.installations.perform') return 'التركيب — إثبات التسليم والتركيب'
  if (value === 'retail.shifts.operate') return 'ورديات الكاشير — فتح وإقفال'
  if (value === 'retail.shifts.approve') return 'ورديات الكاشير — اعتماد الفروق'
  if (value === 'retail.shifts.emergency_close') return 'ورديات الكاشير — إقفال استثنائي'
  if (value === 'retail.cash.manage') return 'ورديات الكاشير — حركات الدرج والخزنة'
  if (value === 'retail.safe.manage') return 'الخزنة — توثيق الافتتاح والجرد'
  if (value === 'retail.audit.view') return 'الرقابة — عرض سجل تدقيق المتجر'
  if (value === 'retail.ledger.view') return 'دفتر الأستاذ — عرض القيود وميزان المراجعة'
  if (value === 'retail.ledger.post') return 'دفتر الأستاذ — ترحيل الحركات وتسجيل القيود والتصحيحات'
  if (value === 'retail.ledger.close') return 'دفتر الأستاذ — بدء الدفتر وإقفال الفترات'
  if (value === 'retail.accountant.export') return 'الحسابات — تصدير الحركات للمحاسب'
  if (value === 'products.cost.view') return 'المنتجات — عرض التكلفة والهامش'
  if (value === 'products.cost.manage') return 'المنتجات — تعديل التكلفة'
  if (value === 'invoices.discount') return 'الفواتير — السماح بخصم السعر'
  if (value === 'retail.discounts.approve') return 'الفواتير — اعتماد تجاوز حد الخصم'
  if (value === 'inventory.stocktake.count') return 'المخزون — تسجيل الجرد'
  if (value === 'inventory.stocktake.approve') return 'المخزون — اعتماد تسوية الجرد'
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
  const [accessKey, setAccessKey] = useState('')
  const [keyFeedback, setKeyFeedback] = useState('')
  const [issuingKey, setIssuingKey] = useState(false)

  async function issueKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (issuingKey) return
    const form = event.currentTarget
    const currentPassword = new FormData(form).get('current_password')
    setIssuingKey(true)
    setKeyFeedback('')
    try {
      const result = await request<{ access_key: string }>('/profile/access-key', {
        method: 'POST', body: { current_password: currentPassword },
      })
      form.reset()
      setAccessKey(result.data.access_key)
      update({ ...user, credential_mode: 'access_key' })
    } catch (error) { setKeyFeedback(error instanceof Error ? error.message : 'تعذر إصدار المفتاح.') }
    finally { setIssuingKey(false) }
  }

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
      update({ ...user, credential_mode: 'password' })
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
        {emailChanged && <label className="field">أدخل كلمة المرور أو مفتاح الدخول الحالي لتغيير البريد الإلكتروني
          <input required name="current_password" type="password" autoComplete="current-password" />
        </label>}
        {profileFeedback && <Notice error={profileFeedback.error}>{profileFeedback.message}</Notice>}
        <div className="form-actions"><button className="primary" disabled={savingProfile}>حفظ بيانات الحساب</button></div>
      </form>
      <form className="form-card panel section-space" onSubmit={submitPassword}>
        <h2>تعيين كلمة مرور</h2>
        <label className="field">كلمة المرور أو مفتاح الدخول الحالي <input name="current_password" type="password" autoComplete="current-password" required /></label>
        <label className="field">كلمة المرور الجديدة <input name="new_password" type="password" autoComplete="new-password" required /></label>
        <label className="field">تأكيد كلمة المرور الجديدة <input name="confirmation" type="password" autoComplete="new-password" required /></label>
        {passwordFeedback && <Notice error={passwordFeedback.error}>{passwordFeedback.message}</Notice>}
        <div className="form-actions"><button className="primary" disabled={savingPassword}>تغيير كلمة المرور</button></div>
      </form>
      <form className="form-card panel" onSubmit={issueKey}>
        <h2>مفتاح الدخول</h2>
        <p className="muted">طريقة الدخول الحالية {user.credential_mode === 'access_key' ? 'بمفتاح دخول' : 'بكلمة مرور'}.</p>
        <p className="muted">يستبدل المفتاح الجديد بيانات الدخول الحالية وينهي الجلسات الأخرى.</p>
        <label className="field">كلمة المرور أو مفتاح الدخول الحالي
          <input name="current_password" type="password" autoComplete="current-password" required />
        </label>
        {keyFeedback && <Notice error>{keyFeedback}</Notice>}
        <div className="form-actions"><button className="secondary" disabled={issuingKey}>إصدار مفتاح دخول</button></div>
      </form>
      {accessKey && <AccessKeyDialog accessKey={accessKey} close={() => setAccessKey('')} />}
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
      {
        label: 'إصدار مفتاح دخول', permission: 'staff.reset_password',
        endpoint: row => '/staff/' + idOf(row) + '/access-key',
        confirmation: 'يستبدل المفتاح الجديد بيانات دخول الموظف وينهي جلساته.',
        visible: row => row.id !== user.id,
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
