import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { instaPayReferencePrefix } from '../../shared/payment-channel'
import { allowed, apiUrl, decimal, formatDate, integer, money, readMoney, request, RequestError } from './api'
import type { User } from './api'
import { activeColumn, activeField, countColumn, createAction, dateColumn, editAction, moneyColumn, numberColumn, RecordImageDialog, required } from './core'
import { ActionDialog, DataModule, dataText, FormInput, idOf, Modal, Notice, PageTitle } from './ui'
import type { Action, ActionDialogProps, Column, Field, ModuleConfig, Row } from './ui'
import { WalletAudit, WalletPeriodReport } from './WalletPeriodReport'
import { WalletPositions } from './WalletOperations'
import { walletManagementTitle, walletProviderFilterValue, walletProviderFilters, walletProviderLabel, walletProviderOptions, walletProviderPreset } from './wallet-providers'
import { blankTender, RetailActionDialog, SharedDrawerDialog, ShiftContext, tenderLabels, TenderFields, tendersForAmount, useOpenShift } from './RetailShifts'
import { DevicePicker, trackingOf } from './RetailDevices'
import { BranchSelect } from './RetailBranches'
import type { Tracking } from './RetailDevices'
import { RetailReturns } from './RetailReturns'
import { displayQuantity, formatQuantity, lineMinor, measurementLabel, quantityScale, quantityStep, stockQuantity, validQuantity } from './measurement'
import './pos.css'

const remaining = (row: Row, total: string) => Number(row[total]) - Number(row.paid_minor)
const remainingColumn = (total: string): Column => ({ key: 'remaining', label: 'المتبقي', render: row => money(remaining(row, total)) })
const paidColumn = moneyColumn('paid_minor', 'المدفوع')
function moneyField(name: string, label: string, required = false): Field {
  return { name, label, kind: 'money', required, read: row => decimal(row[name]) }
}

function voidEntry(path: string, permission: string): Action {
  return {
    ...reverse(path, permission, 'void'),
    label: 'إلغاء القيد',
    visible: row => !row.voided_at && row.paid_minor === 0 && !row.invoice_id,
    confirmation: 'يلغى القيد مع بقاء أثره في سجل المراجعة.',
  }
}

function deleteEntry(path: string, permission: string, confirmation: string): Action {
  return { method: 'DELETE', label: 'حذف', permission, danger: true, confirmation, endpoint: row => path + '/' + idOf(row) }
}

const notes: Field = { name: 'note', label: 'ملاحظات', kind: 'textarea' }

function cairoDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}

function reference(name: string, label: string, path: string, mandatory = false, lookup?: string): Field {
  return { name, label, kind: 'reference', min: 1, reference: { path, label: lookup }, required: mandatory, nullable: !mandatory }
}

function payment(path: string, permission: string, total: string, note = false): Action {
  return {
    label: 'تسجيل سداد', permission, financial: true, visible: row => remaining(row, total) > 0 && !row.voided_at && row.status !== 'cancelled',
    endpoint: row => path + '/' + idOf(row) + '/payments',
    retailTender: ['/invoices', '/purchases', '/installments'].includes(path) ? 'amount' : undefined,
    sharedDrawer: ['/maintenance', '/wallet-debts'].includes(path) ? 'optional' : undefined,
    fields: [required('amount_minor', 'المبلغ بالجنيه', 'money'), ...(note ? [notes] : [])],
  }
}

function reverse(path: string, permission: string, segment = 'reverse'): Action {
  return {
    label: segment === 'refund' ? 'استرجاع الفاتورة' : 'عكس القيد', permission, financial: true, danger: true,
    endpoint: row => path + '/' + idOf(row) + '/' + segment,
    fields: [required('reason', 'السبب', 'textarea')],
    confirmation: 'راجع السجل قبل تنفيذ العملية العكسية.',
    visible: row => segment === 'refund' ? row.status !== 'refunded' : !row.reversed_by && !row.reversal_of && !row.profit_withdrawal_id && !row.adjustment_id,
  }
}

const statuses: Record<string, string> = {
  open: 'غير مسددة بالكامل', paid: 'مسددة', refunded: 'مسترجعة', pending: 'مستحقة', overdue: 'متأخرة', voided: 'ملغاة',
  received: 'تم الاستلام', in_progress: 'قيد الصيانة', completed: 'تم الإصلاح', delivered: 'تم التسليم', cancelled: 'ملغاة',
  receivable: 'للمتجر', payable: 'على المتجر', receive: 'استقبال', send: 'إرسال', expense: 'مصروف',
  settlement_in: 'تسوية داخلة', settlement_out: 'تسوية خارجة', reversal: 'عكس', opening: 'رصيد افتتاحي',
  sale: 'بيع', invoice: 'بيع', import: 'رصيد مُرحّل', refund: 'استرجاع', adjustment: 'تعديل يدوي',
  purchase_receipt: 'استلام مشتريات', damage: 'هالك', damage_reversal: 'عكس هالك',
  owner_deposit: 'إيداع المالك', owner_withdraw: 'سحب المالك', correction: 'تصحيح', expense_reversal: 'عكس مصروف',
}
const options = (values: string[]) => values.map(value => ({ value, label: statuses[value] || value }))
function statusColumn(key = 'status', label = 'الحالة'): Column {
  return { key, label, render: row => {
    const value = String(row[key] ?? '')
    return value ? <span className="status-pill">{statuses[value] || value}</span> : '—'
  } }
}

function amounts(names: Record<string, string>): Field[] {
  return Object.entries(names).map(([name, label]) => ({ name, label, kind: 'money', nullable: name.includes('limit') }))
}

const supplierFields: Field[] = [
  required('name', 'اسم المورد'), { name: 'phone', label: 'رقم الهاتف' }, { name: 'email', label: 'البريد الإلكتروني', kind: 'email' },
  { name: 'address', label: 'العنوان' }, moneyField('opening_minor', 'الرصيد الافتتاحي بالجنيه'),
  { name: 'notes', label: 'ملاحظات', kind: 'textarea' },
]
const walletFields: Field[] = [
  required('name', 'اسم المحفظة'),
  {
    ...required('provider_type', 'مزود الخدمة', 'select'),
    options: [...walletProviderFilters, { value: 'custom', label: 'مزود آخر أو غير محدد' }],
    read: row => walletProviderPreset(row.provider)?.value ?? 'custom',
  },
  {
    name: 'custom_provider', label: 'اسم المزود',
    visible: values => values.provider_type === 'custom',
    read: row => walletProviderPreset(row.provider) ? '' : String(row.provider ?? ''),
  },
  {
    name: 'phone', label: 'رقم المحفظة أو حساب المزود',
  },
  { name: 'holder_name', label: 'اسم صاحب الحساب' },
  ...amounts({
    transaction_limit_minor: 'حد المعاملة بالجنيه', daily_send_limit_minor: 'حد الإرسال اليومي بالجنيه',
    daily_receive_limit_minor: 'حد الاستقبال اليومي بالجنيه', monthly_send_limit_minor: 'حد الإرسال الشهري بالجنيه',
    monthly_receive_limit_minor: 'حد الاستقبال الشهري بالجنيه',
  }).map(field => ({ ...field, read: (row: Row) => decimal(row[field.name]) })),
  { ...required('warn_at_percent', 'التنبيه عند بلوغ نسبة من الحد (%)', 'number'), min: 1, initial: '80' },
  moneyField('default_commission_bps', 'نسبة العمولة الافتراضية (%)'),
  moneyField('default_commission_min_minor', 'أقل عمولة افتراضية بالجنيه'),
  moneyField('default_fee_bps', 'نسبة رسوم المزود الافتراضية (%)'),
  moneyField('default_fee_min_minor', 'أقل رسوم افتراضية بالجنيه'),
  { ...moneyField('default_fee_max_minor', 'أقصى رسوم افتراضية بالجنيه'), nullable: true },
  { name: 'notes', label: 'ملاحظات المحفظة', kind: 'textarea' },
]

function walletProfile({ provider_type, custom_provider, holder_name, notes, ...body }: Row): Row {
  return {
    ...body,
    provider: provider_type === 'custom' ? custom_provider ?? '' : provider_type,
    holder_name: holder_name ?? '',
    notes: notes ?? '',
  }
}
const maintenanceFields: Field[] = [
  reference('customer_id', 'رقم سجل العميل', '/customers'), required('customer_name', 'اسم العميل'),
  { ...reference('retail_device_id', 'الجهاز المتتبع (رقم السجل)', '/retail/devices', false, 'product_name'), reference: { path: '/retail/devices', label: 'product_name', searchable: true } },
  { name: 'phone', label: 'رقم الهاتف' }, { name: 'address', label: 'العنوان' },
  { name: 'requested_date', label: 'تاريخ استلام طلب الصيانة', kind: 'date' }, required('item', 'الجهاز أو المنتج'),
  required('problem', 'العطل', 'textarea'), {
    name: 'price_minor', label: 'التكلفة بالجنيه', kind: 'money',
    read: row => decimal(row.price_minor),
  }, { name: 'notes', label: 'ملاحظات', kind: 'textarea' },
]

const walletAdjustmentEntry: Action = {
  label: 'سجّل مصروفًا أو تسوية', permission: 'wallets.transact', financial: true,
  endpoint: row => '/wallets/' + idOf(row) + '/transactions',
  visible: row => Boolean(row.active),
  fields: [
    { ...required('kind', 'نوع القيد', 'select'), options: options(['expense', 'settlement_in', 'settlement_out']) },
    required('amount_minor', 'المبلغ بالجنيه', 'money'),
    { ...notes, required: true },
  ],
}

const repairProgress = [
  { from: 'received', to: 'in_progress', label: 'بدء الإصلاح' },
  { from: 'in_progress', to: 'completed', label: 'تم الإصلاح' },
  { from: 'completed', to: 'delivered', label: 'تم التسليم' },
].map(({ from, to, label }): Action => ({
  label, method: 'PATCH', permission: 'maintenance.manage',
  endpoint: row => '/maintenance/' + idOf(row), visible: row => row.status === from,
  confirmation: 'تأكيد تحديث حالة طلب الصيانة؟',
  transform: (_body, row) => {
    const payload = Object.fromEntries(maintenanceFields.map(field => [field.name, row?.[field.name] ?? undefined]))
    return { ...payload, status: to, requested_date: typeof payload.requested_date === 'string' ? payload.requested_date.slice(0, 10) : undefined }
  },
}))

const installmentDue = required('due_date', 'تاريخ الاستحقاق', 'date')
const installmentPaidOn: Field = { name: 'payment_date', label: 'تاريخ السداد', kind: 'date', nullable: true }
const installmentCatalog: Field = { name: 'items', label: 'المنتجات', kind: 'items', required: true }
const installmentMode: Field = {
  name: 'item_mode', label: 'مصدر القيمة', kind: 'select', initial: 'manual', required: true,
  options: [{ value: 'manual', label: 'وصف وقيمة يدوية أو فاتورة مرتبطة' }, { value: 'catalog', label: 'اختيار منتجات من الكتالوج' }],
}
const installmentStatusActions = [
  { status: 'overdue', label: 'تحديد كمتأخر', show: (row: Row) => row.status === 'open' },
  { status: 'open', label: 'إزالة علامة التأخير', show: (row: Row) => row.status === 'overdue' },
].map(({ status, label, show }): Action => ({
  label, permission: 'installments.manage', endpoint: row => '/installments/' + idOf(row) + '/status',
  confirmation: 'تأكيد تحديث حالة القسط؟', visible: show, transform: () => ({ status }),
}))
const createInstallment: Action = {
  ...createAction('إضافة قسط', '/installments', 'installments.manage', [
    reference('customer_id', 'العميل', '/customers', true), installmentMode,
    { ...reference('invoice_id', 'الفاتورة', '/invoices'), visible: values => values.item_mode === 'manual' },
    { ...moneyField('principal_minor', 'قيمة القسط بالجنيه', true), visible: values => values.item_mode === 'manual' },
    { name: 'product_name', label: 'وصف المنتج', visible: values => values.item_mode === 'manual' && !values.invoice_id },
    { ...installmentCatalog, visible: values => values.item_mode === 'catalog' },
    installmentDue, installmentPaidOn, notes,
    { ...moneyField('paid_minor', 'المدفوع عند الإنشاء بالجنيه'), visible: values => !values.invoice_id || values.item_mode === 'catalog' },
  ], true),
  transform: ({ item_mode: _mode, ...body }) => body,
}
const debtFields: Field[] = [
  required('person_name', 'اسم صاحب الدين'), { name: 'phone', label: 'رقم الهاتف' },
  { name: 'due_date', label: 'تاريخ الاستحقاق', kind: 'date', nullable: true },
  { name: 'description', label: 'وصف الدين', kind: 'textarea' }, notes,
]
function imageColumn(path: string): Column {
  return {
    key: 'has_image', label: 'الصورة', render: row => row.has_image
      ? <img className="preview-image" src={apiUrl(path + '/' + idOf(row) + '/image') + '?v=' + encodeURIComponent(String(row.updated_at || ''))}
          alt="" loading="lazy" />
      : '—',
  }
}

const walletAdjustment: Action = {
  label: 'تسوية الرصيد', permission: 'wallets.manage', financial: true,
  endpoint: row => '/wallets/' + idOf(row) + '/adjustments',
  visible: row => Boolean(row.active),
  fields: [required('delta_minor', 'فرق الرصيد بالجنيه (موجب للإضافة وسالب للخصم)', 'signed-money'),
    required('reason', 'سبب التسوية', 'textarea')],
}

const damageFields: Field[] = [
  { ...required('quantity', 'الكمية بوحدة الصنف', 'number'), min: 0.001, step: 0.001,
    read: row => String(displayQuantity(row.quantity, row.quantity_scale)) },
  required('reason', 'السبب', 'textarea'),
  moneyField('unit_value_minor', 'قيمة الوحدة بالجنيه'),
  { name: 'damaged_on', label: 'تاريخ الهالك', kind: 'date' },
  { name: 'notes', label: 'ملاحظات', kind: 'textarea' },
]

function BranchInventoryAction(props: ActionDialogProps) {
  const [branch, setBranch] = useState(1)
  return <ActionDialog {...props}
    extra={<BranchSelect value={branch} set={setBranch} />}
    prepare={body => ({ ...body, branch_id: branch })} />
}
export const supplierPayment: Action = {
  label: 'سداد على حساب المورد', permission: 'suppliers.pay', financial: true, retailTender: 'amount',
  endpoint: row => '/suppliers/' + idOf(row) + '/payments',
  visible: row => Number(row.balance_minor) > 0,
  fields: [required('amount_minor', 'المبلغ بالجنيه', 'money'),
    { name: 'payment_date', label: 'تاريخ السداد', kind: 'date' }, notes],
}

const invoicePayment = payment('/invoices', 'invoices.pay', 'total_minor')
invoicePayment.visible = row => row.status === 'open' && !row.installment_id

export const businessModules: Record<string, ModuleConfig> = {
  inventory: {
    title: 'حركات المخزون', description: 'كميات الدخول والخروج ومراجع الحركات المسجلة.', endpoint: '/inventory/movements', permission: 'inventory.view', searchable: false,
    columns: [numberColumn, { key: 'product_name', label: 'المنتج' }, { key: 'branch_name', label: 'الفرع' },
      { key: 'delta', label: 'التغير في الكمية', render: row => formatQuantity(row.delta, row.quantity_scale) },
      { ...statusColumn('source_type', 'مصدر الحركة'), render: row => row.purchase_stock_receipt_id
        ? 'استلام مشتريات' : row.purchase_stock_reversal_id ? 'عكس استلام مشتريات' : statuses[String(row.source_type)] || dataText(row.source_type) },
      { key: 'source_id', label: 'رقم المرجع' }, { key: 'note', label: 'الملاحظة' }, dateColumn('created_at', 'التاريخ')],
    create: createAction('تعديل كمية المخزون', '/inventory/adjustments', 'inventory.manage', [
      reference('product_id', 'المنتج', '/products', true), { ...required('delta', 'تغير الكمية بوحدة الصنف (موجب للإضافة وسالب للخصم)', 'number'), step: 'any' },
      required('note', 'سبب التعديل', 'textarea'),
    ], true),
  },
  invoices: {
    title: 'الفواتير', description: 'سجل المبيعات والسداد والاسترجاع.', endpoint: '/invoices', permission: 'invoices.view',
    columns: [numberColumn, { key: 'customer_name', label: 'العميل' }, moneyColumn('total_minor', 'الإجمالي'),
      paidColumn, { key: 'remaining', label: 'المتبقي', render: row => money(row.status === 'refunded' ? 0 : remaining(row, 'total_minor')) }, statusColumn(), dateColumn('document_date', 'التاريخ')],
    actions: [invoicePayment],
  },
  installments: {
    title: 'الأقساط', description: 'الأقساط المستحقة والمدفوعات المسجلة لكل عميل.', endpoint: '/installments', permission: 'installments.view', searchable: false,
    columns: [numberColumn, { key: 'customer_name', label: 'العميل' }, { key: 'invoice_id', label: 'الفاتورة', render: row => row.invoice_id ? <Link to={'/invoices/' + row.invoice_id}>{dataText(row.invoice_id)}</Link> : '—' },
      { key: 'product_name', label: 'المنتج' }, moneyColumn('principal_minor', 'أصل القسط'), paidColumn, remainingColumn('principal_minor'), statusColumn(), dateColumn('due_date', 'الاستحقاق')],
    create: createInstallment,
    actions: [{ ...editAction('/installments', 'installments.manage', [installmentDue, installmentPaidOn, notes]), visible: row => !row.voided_at },
      { ...editAction('/installments', 'installments.manage', [moneyField('principal_minor', 'قيمة القسط بالجنيه', true),
        required('product_name', 'وصف المنتج'), installmentDue, installmentPaidOn, notes]),
        label: 'تعديل الوصف والقيمة', visible: row => !row.invoice_id && !row.voided_at },
      { ...editAction('/installments', 'installments.manage', [installmentCatalog, installmentDue, installmentPaidOn, notes]),
        label: 'تعديل المنتجات', visible: row => !row.invoice_id && !row.voided_at },
      ...installmentStatusActions, payment('/installments', 'installments.pay', 'principal_minor'), voidEntry('/installments', 'installments.manage')],
  },
  debts: {
    title: 'الديون الشخصية', description: 'المبالغ الشخصية المستحقة للمتجر وعليه.', endpoint: '/debts', permission: 'debts.view', searchable: false,
    columns: [numberColumn, { key: 'person_name', label: 'الاسم' }, statusColumn('direction', 'الاتجاه'),
      moneyColumn('principal_minor', 'أصل الدين'), paidColumn, remainingColumn('principal_minor'), statusColumn(), dateColumn('due_date', 'الاستحقاق')],
    create: createAction('إضافة دين', '/debts', 'debts.manage', [
      ...debtFields, reference('customer_id', 'رقم سجل العميل', '/customers'),
      { ...required('direction', 'الاتجاه', 'select'), options: options(['receivable', 'payable']) },
      required('principal_minor', 'أصل الدين بالجنيه', 'money'), moneyField('paid_minor', 'المدفوع عند الإنشاء بالجنيه'),
    ], true),
    actions: [{ ...editAction('/debts', 'debts.manage', [...debtFields, moneyField('principal_minor', 'أصل الدين بالجنيه')]), visible: row => !row.voided_at },
      payment('/debts', 'debts.pay', 'principal_minor'), voidEntry('/debts', 'debts.manage')],
  },
  suppliers: {
    title: 'الموردون', description: 'بيانات التواصل مع الموردين وحساباتهم.', endpoint: '/suppliers', permission: 'suppliers.view',
    columns: [numberColumn, { key: 'name', label: 'المورد' }, { key: 'phone', label: 'الهاتف' }, { key: 'email', label: 'البريد الإلكتروني' },
      moneyColumn('opening_minor', 'الرصيد الافتتاحي'), moneyColumn('balance_minor', 'المستحق'), activeColumn],
    create: createAction('إضافة مورد', '/suppliers', 'suppliers.manage', supplierFields, true),
    actions: [
      editAction('/suppliers', 'suppliers.manage', [...supplierFields, activeField]), supplierPayment,
      { ...deleteEntry('/suppliers', 'suppliers.manage', 'هل تريد حذف المورد؟'),
        visible: row => !row.purchases_count && !row.opening_minor && !row.opening_paid_minor },
    ],
  },
  purchases: {
    title: 'المشتريات', description: 'قيود المشتريات ومدفوعات الموردين.', endpoint: '/purchases', permission: 'suppliers.view',
    columns: [numberColumn, { key: 'supplier_name', label: 'المورد' }, { key: 'reference', label: 'المرجع' }, { key: 'description', label: 'الوصف' },
      moneyColumn('total_minor', 'الإجمالي'), paidColumn,
      { key: 'net_total_minor', label: 'المتبقي بعد إشعارات المورد', render: row => money(Number(row.net_total_minor ?? row.total_minor) - Number(row.paid_minor)) },
      { key: 'payment_type', label: 'طريقة السداد', render: row => row.payment_type === 'cash' ? 'نقدي' : 'آجل' }, dateColumn('purchase_date', 'التاريخ')],
    create: { ...createAction('تسجيل شراء', '/purchases', 'suppliers.manage', [
      reference('supplier_id', 'المورد', '/suppliers', true), { name: 'reference', label: 'المرجع', nullable: true },
      required('description', 'الوصف', 'textarea'), required('total_minor', 'إجمالي الشراء بالجنيه', 'money'),
      { ...required('purchase_date', 'تاريخ الشراء', 'date'), initial: cairoDate },
      { name: 'due_date', label: 'استحقاق المورد', kind: 'date' },
      { name: 'payment_type', label: 'نوع السداد', kind: 'select', initial: 'credit',
        options: [{ value: 'credit', label: 'آجل' }, { value: 'cash', label: 'نقدي' }] },
      { ...moneyField('paid_minor', 'المدفوع عند التسجيل بالجنيه'), visible: values => values.payment_type === 'credit' },
    ], true), retailTender: 'purchase' },
    actions: [payment('/purchases', 'suppliers.pay', 'net_total_minor', true)],
  },
  wallets: {
    title: 'المحافظ', description: 'أرصدة المحافظ وحدودها والمعاملات المسجلة.', endpoint: '/wallets', permission: 'wallets.view', searchable: false,
    columns: [numberColumn, { key: 'name', label: 'المحفظة' }, { key: 'provider', label: 'المزود', render: row => walletProviderLabel(row.provider) },
      moneyColumn('balance_minor', 'رصيد المحفظة لدى المزود'), moneyColumn('transaction_limit_minor', 'حد المعاملة'), activeColumn],
    create: {
      ...createAction('إضافة محفظة', '/wallets', 'wallets.manage', [...walletFields.map(field => field.name === 'provider_type'
        ? { ...field, options: [...walletProviderOptions, { value: 'custom', label: 'مزود آخر أو غير محدد' }] } : field),
      { name: 'opening_minor', label: 'الرصيد الافتتاحي بالجنيه', kind: 'money' }], true),
      transform: walletProfile,
    },
    actions: [walletAdjustmentEntry, walletAdjustment, { ...editAction('/wallets', 'wallets.manage', [...walletFields, activeField]), transform: walletProfile }],
  },
  'wallet-transactions': {
    title: 'حركات المحافظ', description: 'سجل التحويلات والمصروفات والتسويات والحركات العكسية.', endpoint: '/wallet-transactions', permission: 'wallets.view', searchable: false,
    columns: [numberColumn, { key: 'wallet_name', label: 'المحفظة' }, statusColumn('kind', 'نوع الحركة'), moneyColumn('amount_minor', 'المبلغ'),
      moneyColumn('delta_minor', 'أثر المحفظة'), moneyColumn('cash_delta_minor', 'أثر النقدية'), moneyColumn('commission_minor', 'العمولة'),
      { key: 'counterparty', label: 'الطرف الآخر' },
      { key: 'provider_reference', label: 'مرجع المزود', render: row => row.provider_reference ? <bdi>{String(row.provider_reference)}</bdi> : '—' },
      { key: 'note', label: 'الملاحظة' }, dateColumn('created_at', 'التاريخ')],
    actions: [{ ...reverse('/wallet-transactions', 'wallets.reverse'), sharedDrawer: 'wallet_reversal' }],
  },
  'wallet-cash': {
    title: 'حركات نقدية المحافظ', description: 'قيود الدرج النقدي ومصروفاته.', endpoint: '/wallet-cash', permission: 'wallets.cash', searchable: false,
    columns: [numberColumn, statusColumn('kind', 'نوع الحركة'), moneyColumn('delta_minor', 'أثر النقدية'),
      { key: 'category', label: 'التصنيف' }, { key: 'note', label: 'البيان' }, dateColumn('business_day', 'التاريخ')],
    create: { ...createAction('إضافة قيد نقدي', '/wallet-cash', 'wallets.cash', [
      { ...required('kind', 'نوع القيد', 'select'), options: options(['opening', 'owner_deposit', 'owner_withdraw', 'correction', 'expense']) },
      required('amount_minor', 'المبلغ بالجنيه (السالب متاح للتصحيح)', 'signed-money'),
      { name: 'category', label: 'التصنيف (إلزامي للمصروف)' }, { name: 'business_day', label: 'تاريخ القيد', kind: 'date' },
      required('note', 'سبب القيد', 'textarea'),
    ], true), sharedDrawer: 'optional' },
    actions: [{ ...reverse('/wallet-cash', 'wallets.reverse'), sharedDrawer: 'wallet_reversal', visible: row => row.kind === 'expense' && !row.reversed_by }],
  },
  'wallet-profit-withdrawals': {
    title: 'سجل سحب الأرباح', description: 'السحوبات المسجلة من الدرج النقدي أو أرصدة المحافظ.',
    endpoint: '/wallet-profit-withdrawals', permission: 'wallets.cash', searchable: false,
    columns: [numberColumn, moneyColumn('amount_minor', 'المبلغ'),
      { key: 'wallet_name', label: 'المصدر', render: row => row.wallet_name ? dataText(row.wallet_name) : 'الدرج النقدي' },
      dateColumn('business_day', 'التاريخ'), { key: 'note', label: 'الملاحظات' }],
  },
  'supplier-report': {
    title: 'أرصدة الموردين', description: 'إجمالي المشتريات والمدفوعات والأرصدة المستحقة حسب المورد.', endpoint: '/reports/suppliers', permission: 'suppliers.view', searchable: false,
    columns: [{ key: 'name', label: 'المورد' }, moneyColumn('total_minor', 'إجمالي المشتريات'),
      paidColumn, moneyColumn('due_minor', 'المستحق'), activeColumn],
  },
  'wallet-debts': {
    title: 'ديون المحافظ', description: 'المبالغ الآجلة من عمليات الإرسال ومدفوعاتها.', endpoint: '/wallet-debts', permission: 'wallets.view', searchable: false,
    columns: [numberColumn, { key: 'customer_name', label: 'العميل' }, moneyColumn('principal_minor', 'أصل المبلغ'), paidColumn,
      remainingColumn('principal_minor'), dateColumn('due_date', 'الاستحقاق')],
    actions: [payment('/wallet-debts', 'wallets.transact', 'principal_minor')],
  },
  damaged: {
    title: 'الهالك', description: 'قيود المخزون التالف وأسبابها.', endpoint: '/damaged', permission: 'damaged.view', searchable: false,
    columns: [numberColumn, imageColumn('/damaged'), { key: 'product_name', label: 'المنتج' }, { key: 'branch_name', label: 'الفرع' },
      { key: 'quantity', label: 'الكمية', render: row => formatQuantity(row.quantity, row.quantity_scale) },
      { key: 'reason', label: 'السبب' }, moneyColumn('unit_value_minor', 'قيمة الوحدة'), moneyColumn('total_value_minor', 'قيمة الهالك'), dateColumn('damaged_on', 'تاريخ الهالك'),
      { key: 'reversed_by', label: 'الحالة', render: row => <span className="status-pill">{row.reversed_by ? 'معكوس' : 'مسجل'}</span> }],
    create: createAction('تسجيل هالك', '/damaged', 'damaged.manage', [
      reference('product_id', 'المنتج', '/products', true), ...damageFields,
    ], true),
    actions: [
      {
        label: 'تصحيح القيد', permission: 'damaged.manage', financial: true, initialFromRow: true, fields: damageFields,
        endpoint: row => '/damaged/' + idOf(row) + '/correct', visible: row => !row.reversed_by,
      },
      reverse('/damaged', 'damaged.manage'),
    ],
  },
  maintenance: {
    title: 'الصيانة', description: 'طلبات الصيانة وحالة الإصلاح والتسليم والسداد.', endpoint: '/maintenance', permission: 'maintenance.view',
    columns: [numberColumn, imageColumn('/maintenance'), { key: 'customer_name', label: 'العميل' }, { key: 'item', label: 'الجهاز' }, { key: 'problem', label: 'العطل' },
      statusColumn(), dateColumn('requested_date', 'الاستلام'), dateColumn('completed_date', 'الإصلاح'),
      moneyColumn('price_minor', 'التكلفة'), paidColumn, remainingColumn('price_minor')],
    create: createAction('إضافة طلب صيانة', '/maintenance', 'maintenance.manage', maintenanceFields, true),
    actions: [
      { ...editAction('/maintenance', 'maintenance.manage', [...maintenanceFields,
        { ...required('status', 'الحالة', 'select'), options: options(['received', 'in_progress', 'completed', 'delivered', 'cancelled']) }]),
        visible: row => !['delivered', 'cancelled'].includes(String(row.status)) },
      ...repairProgress,
      payment('/maintenance', 'maintenance.pay', 'price_minor'),
      { ...deleteEntry('/maintenance', 'maintenance.manage', 'هل تريد أرشفة طلب الصيانة؟'), visible: row => row.paid_minor === 0 },
    ],
  },
}

const withPaymentHistory = new Set(['installments', 'debts', 'purchases', 'wallet-debts', 'maintenance'])

function PaymentHistory({ path, row, close }: { path: string; row: Row; close: () => void }) {
  const [payments, setPayments] = useState<Row[]>()
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    request<{ payments: Row[] }>(path + '/' + idOf(row), { signal: controller.signal })
      .then(result => setPayments(result.data.payments))
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [path, row])
  return <Modal title={'مدفوعات السجل ' + idOf(row)} close={close}>
    <div className="modal-content">
      {error ? <Notice error>{error}</Notice> : !payments ? <Notice>جارٍ تحميل المدفوعات…</Notice>
        : !payments.length ? <p>لا توجد مدفوعات مسجلة.</p>
        : <div className="table-scroll"><table>
          <thead><tr><th scope="col">المبلغ</th><th scope="col">التاريخ</th><th scope="col">ملاحظة</th></tr></thead>
          <tbody>{payments.map(payment => <tr key={idOf(payment)}><td>{money(payment.amount_minor)}</td>
            <td>{formatDate(payment.created_at)}</td><td>{dataText(payment.note)}</td></tr>)}</tbody>
        </table></div>}
    </div>
  </Modal>
}

export function CommerceModule({ name, user }: { name: string; user: User }) {
  const [history, setHistory] = useState<Row>()
  const [image, setImage] = useState<Row>()
  const [imageVersion, setImageVersion] = useState(0)
  const [filter, setFilter] = useState('')
  const [invoiceId, setInvoiceId] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })
  const navigate = useNavigate()
  const [routeParams, setRouteParams] = useSearchParams()
  const walletProvider = name === 'wallets' ? walletProviderFilterValue(routeParams.get('provider')) : undefined
  const base = businessModules[name]
  const canReadCost = allowed(user, 'products.cost.view') || allowed(user, 'products.cost.manage')
  const canManageCost = allowed(user, 'products.cost.manage')
  const damageAction = (action: Action): Action => ({
    ...action, fields: action.fields?.filter(field => field.name !== 'unit_value_minor'),
  })
  const config = name === 'damaged' ? {
    ...base,
    columns: canReadCost ? base.columns : base.columns.filter(column => !['unit_value_minor', 'total_value_minor'].includes(column.key)),
    create: !base.create || canManageCost ? base.create : damageAction(base.create),
    actions: canManageCost ? base.actions : base.actions?.map(damageAction),
  } : name === 'wallets' && base.create && walletProvider && walletProvider !== 'instapay' ? {
    ...base,
    create: { ...base.create, fields: base.create.fields?.map(field => field.name === 'provider_type'
      ? { ...field, initial: walletProvider } : field) },
  } : base
  const isInvoice = name === 'invoices'
  const hasImages = name === 'damaged' || name === 'maintenance'
  const canManageImage = hasImages && allowed(user, name + '.manage')
  const dateFilter = ['maintenance', 'purchases', 'damaged'].includes(name)
  const params = new URLSearchParams()
  if (filter) params.set('status', filter)
  if (range.from) params.set('from', range.from)
  if (range.to) params.set('to', range.to)
  if (walletProvider) params.set('provider', walletProvider)
  const endpoint = config.endpoint + (params.size ? '?' + params : '')
  return <>
    <DataModule key={endpoint + ':' + imageVersion} user={user} config={{ ...config, endpoint }}
      renderAction={props => props.action.retailTender ? <RetailActionDialog {...props} user={user} /> : props.action.sharedDrawer
        ? <SharedDrawerDialog {...props} user={user} /> : !props.row && ['inventory', 'damaged'].includes(name)
          ? <BranchInventoryAction {...props} /> : <ActionDialog {...props} />}
      extra={isInvoice ? <form className="panel panel-inner invoice-filter section-space" onSubmit={event => {
        event.preventDefault()
        if (invoiceId.trim()) navigate('/invoices/' + encodeURIComponent(invoiceId.trim()))
      }}>
        <label className="field">حالة الفاتورة<select value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="">جميع الحالات</option>{options(['open', 'paid', 'refunded']).map(option =>
            <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <label className="field">رقم الفاتورة<input inputMode="numeric" pattern="[0-9]+" value={invoiceId}
          onChange={event => setInvoiceId(event.target.value)} /></label>
        <button className="secondary" disabled={!invoiceId.trim()}>فتح الفاتورة</button>
      </form> : dateFilter ? <form className="panel panel-inner invoice-filter section-space" onSubmit={event => {
        event.preventDefault()
        const values = new FormData(event.currentTarget)
        setRange({ from: String(values.get('from')), to: String(values.get('to')) })
        setFilter(String(values.get('status') || ''))
      }}>
        {name === 'maintenance' && <label className="field">الحالة
          <select name="status" defaultValue={filter}><option value="">جميع الحالات</option><option value="repaired">تم الإصلاح أو التسليم</option>
            {options(['received', 'in_progress', 'completed', 'delivered', 'cancelled']).map(option =>
              <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>}
        <label className="field">من تاريخ<input type="date" name="from" defaultValue={range.from} /></label>
        <label className="field">إلى تاريخ<input type="date" name="to" defaultValue={range.to} /></label>
        <button className="secondary">تطبيق التصفية</button>
        {name === 'damaged' && <Link className="secondary" to="/damage-report">تقرير الهالك</Link>}
      </form> : name === 'wallets' ? <div className="panel panel-inner form-actions section-space">
        <Link className="secondary" to="/wallet-workspace">{walletManagementTitle}</Link>
        <label className="field">مزود الخدمة<select value={walletProvider ?? ''} onChange={event => {
          setRouteParams(event.target.value ? { provider: event.target.value } : {})
        }}>
          <option value="">كل المزودين</option>
          {walletProviderFilters.map(provider => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
        </select></label>
      </div> : undefined}
      rowActions={isInvoice
        ? row => <Link className="link-button" to={'/invoices/' + idOf(row)}>عرض وطباعة</Link>
        : name === 'wallets' && allowed(user, 'wallets.transact') ? row => Boolean(row.active)
          ? <Link className="link-button" to={'/wallet-cashier?wallet_id=' + idOf(row)}>إيداع أو سحب للعميل</Link> : null
        : name === 'suppliers' ? row => <Link className="link-button" to={'/suppliers/' + idOf(row)}>حساب المورد</Link>
        : hasImages ? row => <>
          {name === 'damaged'
            ? <Link className="link-button" to={'/damaged/' + idOf(row)}>عرض القيد</Link>
            : <button className="link-button" onClick={() => setHistory(row)}>سجل المدفوعات</button>}
          {canManageImage && <button className="link-button" onClick={() => setImage(row)}>الصورة</button>}
        </>
        : name === 'purchases' ? row => <>
          <Link className="link-button" to={'/purchases/' + idOf(row) + '/receipts'}>استلام أصناف</Link>
          <button className="link-button" onClick={() => setHistory(row)}>سجل المدفوعات</button>
        </>
        : withPaymentHistory.has(name) ? row => <button className="link-button" onClick={() => setHistory(row)}>سجل المدفوعات</button> : undefined}
    />
    {image && <RecordImageDialog row={image} collection={config.endpoint}
      title={name === 'damaged' ? 'صورة الهالك' : 'صورة الصيانة'} maxBytes={131072}
      close={() => setImage(undefined)} done={() => { setImage(undefined); setImageVersion(value => value + 1) }} />}
    {history && <PaymentHistory path={config.endpoint} row={history} close={() => setHistory(undefined)} />}
  </>
}

const posCustomerField = reference('customer_id', 'العميل', '/customers')

async function searchPosProducts(branch: number, term = '', signal?: AbortSignal, productId?: unknown): Promise<Row[]> {
  const params = new URLSearchParams({ per_page: '20' })
  if (term) params.set('q', term)
  if (productId) params.set('product_id', String(productId))
  return (await request<Row[]>('/retail/branches/' + branch + '/stock?' + params, { signal })).data
}

type CartItem = { id: number; name: string; stock: number; price: number; quantity: number; quantityDraft?: string;
  scale: number; tracking?: Tracking; deviceIds?: number[]; discount?: string; packSize?: number }

type ReceiptFormat = '58' | '80' | 'a4'
type SaleReceipt = {
  store: string; branch: string; date: string; total: number; paid: number; change: number;
  lines: { name: string; quantity: number; scale: number; total: number; discount: number; price: number }[];
  methods: { method: keyof typeof tenderLabels; amount_minor: number }[];
}
type SaleInput = {
  customer_id?: number; branch_id: number;
  items: { product_id: number; quantity: number; device_ids?: number[]; unit_discount_minor?: number }[];
  paid_minor: number; shift_id?: number; payments?: ReturnType<typeof tendersForAmount>;
  expected_total_minor: number; discount_request_id?: number; invoice_date?: string; due_date?: string; notes?: string; reason?: string;
}
type PendingSale = { key: string; body: SaleInput; receipt: SaleReceipt }

function readPendingSale(storageKey: string): PendingSale | undefined {
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as PendingSale | null
    if (saved && typeof saved.key === 'string' && Array.isArray(saved.body?.items) && saved.body.items.length
      && saved.receipt?.lines?.length === saved.body.items.length) return saved
  } catch { /* Session storage can be unavailable. */ }
}

function receiptPending(error: unknown, retry: boolean) {
  return !(error instanceof RequestError) || !error.code || error.status < 400 || error.status >= 500
    || [401, 408, 425, 429].includes(error.status)
    || (retry && [403, 404].includes(error.status))
    || (error.status === 409 && ['idempotency_conflict', 'operation_in_progress'].includes(error.code.toLowerCase()))
}

function SaleReceiptPreview({ id, receipt, close }: { id: number; receipt: SaleReceipt; close: () => void }) {
  const [format, setFormat] = useState<ReceiptFormat>('80')
  return createPortal(<Modal title="معاينة إيصال البيع" close={close}>
    <div className="pos-receipt-controls no-print">
      <label className="field">مقاس الورق<select value={format} onChange={event => setFormat(event.target.value as ReceiptFormat)}>
        <option value="58">حراري 58 مم</option><option value="80">حراري 80 مم</option><option value="a4">A4</option>
      </select></label>
      <button type="button" className="primary" onClick={() => window.print()}>طباعة الإيصال</button>
    </div>
    <article className={'printable pos-receipt pos-receipt-' + format} dir="rtl">
      <header><h3>{receipt.store}</h3><p>إيصال بيع رقم <bdi>{integer(id)}</bdi></p><p>{receipt.branch} · {formatDate(receipt.date)}</p></header>
      <table>
        <thead><tr><th scope="col">الصنف</th><th scope="col">الكمية</th><th scope="col">المبلغ</th></tr></thead>
        <tbody>{receipt.lines.map((line, index) => <tr key={index}><td>{line.name}{line.discount > 0 && <small>خصم {money(line.discount)}</small>}</td>
          <td>{formatQuantity(line.quantity, line.scale)}</td><td><bdi>{money(line.total)}</bdi></td></tr>)}</tbody>
      </table>
      <dl>
        <div><dt>الإجمالي</dt><dd>{money(receipt.total)}</dd></div>
        {receipt.methods.map((method, index) => <div key={index}><dt>{tenderLabels[method.method]}</dt><dd>{money(method.amount_minor)}</dd></div>)}
        <div><dt>المدفوع</dt><dd>{money(receipt.paid)}</dd></div>
        {receipt.total > receipt.paid && <div><dt>المتبقي</dt><dd>{money(receipt.total - receipt.paid)}</dd></div>}
        {receipt.change > 0 && <div><dt>الباقي للعميل</dt><dd>{money(receipt.change)}</dd></div>}
      </dl>
    </article>
  </Modal>, document.body)
}

function unitDiscount(item: CartItem) {
  if (!item.discount?.trim()) return 0
  const amount = readMoney(item.discount)
  if (amount > item.price) throw new Error('خصم الوحدة يتجاوز سعر ' + item.name + '.')
  return amount
}

export function Pos({ user }: { user: User }) {
  const { invoiceId } = useParams()
  const [params] = useSearchParams()
  const instaPay = !invoiceId && params.get('channel') === 'instapay'
  return <PosSession key={user.id + ':' + (invoiceId ?? 'sale') + ':' + instaPay} user={user} invoiceId={invoiceId} instaPay={instaPay} />
}

function PosSession({ user, invoiceId, instaPay }: { user: User; invoiceId?: string; instaPay: boolean }) {
  const storageKey = 'helal-pos-pending-v1:' + user.id + ':' + (invoiceId ?? 'sale')
  const [pendingSale, setPendingSale] = useState(() => readPendingSale(storageKey))
  const [original, setOriginal] = useState<Invoice>()
  const [reissueLoaded, setReissueLoaded] = useState(false)
  const [reissueReason, setReissueReason] = useState('')
  const [documentDate, setDocumentDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [products, setProducts] = useState<Row[]>([])
  const [query, setQuery] = useState('')
  const [cart, setCartState] = useState<CartItem[]>([])
  const cartRef = useRef<CartItem[]>([])
  const [selectedBranch, setSelectedBranch] = useState(() => Number(pendingSale?.body.branch_id || 1))
  const [customer, setCustomer] = useState('')
  const [paid, setPaid] = useState('')
  const [cashReceived, setCashReceived] = useState('')
  const initialTender = () => instaPay ? { ...blankTender(), method: 'bank_transfer' as const } : blankTender()
  const [tenders, setTenders] = useState(() => [initialTender()])
  const [checkoutMode, setCheckoutMode] = useState('full')
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checkingStock, setCheckingStock] = useState(false)
  const [stockConflict, setStockConflict] = useState(false)
  const [error, setError] = useState('')
  const [sale, setSale] = useState<{ id: number; receipt: SaleReceipt }>()
  const [showReceipt, setShowReceipt] = useState(false)
  const [storeName, setStoreName] = useState('هلال لإدارة المتجر')
  const [searchStatus, setSearchStatus] = useState('')
  const [scanErrors, setScanErrors] = useState<string[]>([])
  const [discountRequest, setDiscountRequest] = useState('')
  const [discountReason, setDiscountReason] = useState('')
  const [discountNotice, setDiscountNotice] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  const searchQueue = useRef<string[]>([])
  const searchRun = useRef<AbortController>(undefined)
  const catalogRun = useRef<AbortController>(undefined)
  const saleInFlight = useRef(false)
  const cartSection = useRef<HTMLDivElement>(null)
  const shiftContext = useOpenShift(user)
  const branch = Number(pendingSale?.body.branch_id || original?.branch_id || shiftContext.shift?.branch_id || selectedBranch)
  const canDiscount = allowed(user, 'invoices.discount')
  const invalidQuantity = cart.some(item => !validQuantity(Number(item.quantityDraft ?? displayQuantity(item.quantity, item.scale)), item.scale)
    || item.quantity > item.stock || (item.tracking !== 'quantity' && item.quantity > 200))
  let total = 0
  let invalidDiscount = false
  try { total = cart.reduce((sum, line) => sum + lineMinor(line.price - unitDiscount(line), line.quantity, line.scale), 0) }
  catch { invalidDiscount = true }
  const hasDiscount = !invalidDiscount && cart.some(line => unitDiscount(line) > 0)
  const canViewCatalog = allowed(user, 'products.view')
  const canSell = allowed(user, 'invoices.create') && (!invoiceId || canViewCatalog && allowed(user, 'invoices.refund') && allowed(user, 'invoices.view'))
  const canViewInvoice = allowed(user, 'invoices.view')
  const disabled = submitting || Boolean(pendingSale)

  function setCart(update: CartItem[] | ((items: CartItem[]) => CartItem[])) {
    const items = typeof update === 'function' ? update(cartRef.current) : update
    cartRef.current = items
    setCartState(items)
  }

  function rememberSale(value?: PendingSale) {
    setPendingSale(value)
    try {
      if (value) sessionStorage.setItem(storageKey, JSON.stringify(value))
      else sessionStorage.removeItem(storageKey)
    } catch { /* The exact operation remains available in memory. */ }
  }

  function focusSearch() {
    requestAnimationFrame(() => searchInput.current?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    if (!canSell || shiftContext.loading) return
    const controller = new AbortController()
    catalogRun.current = controller
    searchPosProducts(branch, '', controller.signal).then(rows => { if (!controller.signal.aborted) setProducts(rows) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => {
      controller.abort()
      searchRun.current?.abort()
      searchQueue.current.length = 0
    }
  }, [canSell, branch, shiftContext.loading])

  useEffect(() => {
    if (!canSell || !allowed(user, 'settings.view')) return
    const controller = new AbortController()
    request<Row>('/settings', { signal: controller.signal }).then(({ data }) => {
      if (!controller.signal.aborted && typeof data.store_name === 'string' && data.store_name) setStoreName(data.store_name)
    }).catch(() => { /* Use the default receipt name when settings are unavailable. */ })
    return () => controller.abort()
  }, [canSell, user])

  useEffect(() => {
    if (canSell && !invoiceId && !shiftContext.loading && !readPendingSale(storageKey)
      && document.activeElement === document.body && matchMedia('(pointer: fine)').matches) focusSearch()
  }, [canSell, invoiceId, shiftContext.loading, storageKey])

  useEffect(() => {
    if (!canSell || !invoiceId) return
    const controller = new AbortController()
    if (invoiceId) {
      request<Invoice>('/invoices/' + encodeURIComponent(invoiceId), { signal: controller.signal })
        .then(async result => {
          if (result.data.status === 'refunded') throw new Error('الفاتورة مسترجعة بالفعل.')
          if (controller.signal.aborted) return
          const previous = result.data
          setOriginal(previous)
          setDocumentDate(String(previous.document_date || '').slice(0, 10))
          setInvoiceNotes(String(previous.notes || ''))
          if (previous.customer_id) setCustomer(String(previous.customer_id))
          const currentProducts = await Promise.all((previous.items || []).map(async line => {
            try {
              const [product] = await searchPosProducts(Number(previous.branch_id || 1), '', controller.signal, line.product_id)
              return product
            } catch { return undefined }
          }))
          if (controller.signal.aborted) return
          const editableLines = (previous.items || []).flatMap((line, index) => {
            const product = currentProducts[index]
            if (!product?.active) return []
            const quantity = Number(line.quantity)
            return [{
              id: Number(product.id), name: String(product.name), price: Number(product.price_minor),
              stock: Number(product.stock) + quantity, quantity, scale: quantityScale(line.quantity_scale),
              tracking: trackingOf(product.tracking), packSize: Number(product.units_per_pack) || undefined,
            }]
          })
          setCart(editableLines)
          setCheckoutMode(previous.status === 'paid' ? 'full' : 'partial')
          setPaid(decimal(previous.paid_minor))
          if (editableLines.length !== (previous.items || []).length) {
            setError('لم تُدرج بعض المنتجات من الفاتورة الأصلية لأنها غير نشطة أو لم تُحمّل. راجع السلة قبل التأكيد.')
          }
          setReissueLoaded(true)
        })
        .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    }
    return () => controller.abort()
  }, [canSell, invoiceId])

  function availableStock(product: Row) {
    const originalLine = original?.items?.find(line => line.product_id === product.id)
    return Number(product.stock) + Number(originalLine?.quantity || 0)
  }

  function add(product: Row, units?: number, deviceId?: number) {
    const id = Number(product.id)
    const stock = availableStock(product)
    const price = Number(product.price_minor)
    const scale = quantityScale(product.quantity_scale)
    const tracking = trackingOf(product.tracking)
    const packSize = Number(product.units_per_pack) || undefined
    const line = cartRef.current.find(item => item.id === id)
    const deviceIds = line?.deviceIds ?? []
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(stock) || !Number.isSafeInteger(price) || stock < 1) return 'المنتج غير متاح في المخزون.'
    if (!line && cartRef.current.length >= 40) return 'تضم الفاتورة 40 صنفًا. احذف صنفًا أو افتح فاتورة أخرى.'
    if (deviceId && deviceIds.includes(deviceId)) return 'هذا الجهاز محدد بالفعل في الفاتورة.'
    const quantity = deviceId ? Math.max(line?.quantity ?? 0, deviceIds.length + 1)
      : (line?.quantity ?? 0) + (units ?? Math.min(scale, stock - (line?.quantity ?? 0)))
    if (quantity > stock || (!deviceId && quantity <= (line?.quantity ?? 0))) return 'الكمية المطلوبة تتجاوز المخزون المتاح.'
    if (!validQuantity(displayQuantity(quantity, scale), scale) || (tracking !== 'quantity' && quantity > 200)) return 'الكمية تتجاوز الحد المسموح للصنف في الفاتورة.'
    const next = { ...line, id, stock, price, name: String(product.name), quantity, quantityDraft: undefined, scale, tracking, packSize,
      deviceIds: deviceId ? [...deviceIds, deviceId] : deviceIds }
    setCart(items => line ? items.map(item => item.id === id ? next : item) : [...items, next])
    setSale(undefined)
    setSearchStatus('أضيف إلى الفاتورة · ' + next.name + ' · ' + formatQuantity(quantity, scale))
  }

  function addFromCatalog(product: Row, units?: number) {
    const issue = add(product, units)
    setScanErrors(issue ? [String(product.name) + ' · ' + issue] : [])
    focusSearch()
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saleInFlight.current || disabled || shiftContext.loading || Boolean(invoiceId && !reissueLoaded)) return
    const input = searchInput.current
    if (!input) return
    const term = input.value.trim()
    if (searchQueue.current.length >= 30) {
      setScanErrors(errors => [...errors.slice(-9), 'قائمة المسح ممتلئة. انتظر ثم أعد مسح الرقم الظاهر.'])
      return
    }
    searchQueue.current.push(term)
    input.value = ''
    setQuery('')
    input.focus({ preventScroll: true })
    if (searchRun.current) return
    const controller = new AbortController()
    searchRun.current = controller
    catalogRun.current?.abort()
    setSearching(true)
    setScanErrors([])
    setSearchStatus('جارٍ البحث…')
    try {
      while (searchQueue.current.length && !controller.signal.aborted) {
        const code = searchQueue.current.shift()!
        try {
          const found = await searchPosProducts(branch, code, controller.signal)
          if (controller.signal.aborted) return
          setProducts(found)
          const exact = code && found.find(row => row.barcode === code || row.pack_barcode === code)
          let issue: string | undefined
          if (exact) issue = add(exact, exact.pack_barcode === code ? Number(exact.units_per_pack) : undefined)
          else if (code) {
            const params = new URLSearchParams({ branch_id: String(branch), code })
            const { data: device } = await request<{ id: number; product_id: number } | null>('/retail/devices/pos-scan?' + params, { signal: controller.signal })
            if (controller.signal.aborted) return
            if (device) {
              const [product] = await searchPosProducts(branch, '', controller.signal, device.product_id)
              if (controller.signal.aborted) return
              issue = product ? add(product, undefined, device.id) : 'الصنف المرتبط بهذا الجهاز غير متاح.'
            } else if (found.length) setSearchStatus('نتائج البحث عن «' + code + '» · ' + integer(found.length))
            else issue = 'لا يوجد صنف أو جهاز متاح بهذا الرمز في الفرع.'
          } else setSearchStatus('كتالوج الفرع')
          if (issue) setScanErrors(errors => [...errors.slice(-9), code + ' · ' + issue])
        } catch (error) {
          if (controller.signal.aborted) return
          setScanErrors(errors => [...errors.slice(-9), (code ? code + ' · ' : '') + (error instanceof Error ? error.message : 'تعذر البحث.')])
        }
      }
    } finally {
      if (searchRun.current === controller) {
        searchRun.current = undefined
        setSearching(false)
      }
    }
  }

  function restoreSale(sale: PendingSale) {
    const { body, receipt } = sale
    if (!cartRef.current.length) setCart(body.items.map((item, index) => {
      const line = receipt.lines[index]
      return { id: item.product_id, name: line.name, quantity: line.quantity, scale: line.scale, price: line.price,
        stock: line.quantity, deviceIds: item.device_ids, tracking: item.device_ids?.length ? 'serial' : 'quantity',
        discount: item.unit_discount_minor ? decimal(item.unit_discount_minor) : undefined }
    }))
    setSelectedBranch(body.branch_id)
    setCheckoutMode(body.paid_minor < body.expected_total_minor ? 'partial' : 'full')
    setPaid(decimal(body.paid_minor))
    setCustomer(body.customer_id ? String(body.customer_id) : '')
    setDocumentDate(body.invoice_date ?? '')
    setDueDate(body.due_date ?? '')
    setInvoiceNotes(body.notes ?? '')
    setReissueReason(body.reason ?? '')
    setDiscountRequest(body.discount_request_id ? String(body.discount_request_id) : '')
    setTenders(body.payments?.length ? body.payments.map(row => ({
      method: row.method, amount: decimal(row.amount_minor),
      reference: instaPay && row.method === 'bank_transfer' && row.reference?.startsWith(instaPayReferencePrefix)
        ? row.reference.slice(instaPayReferencePrefix.length) : row.reference ?? '',
    })) : [initialTender()])
  }

  async function submitSale(sale: PendingSale, retry = false) {
    if (saleInFlight.current) return
    saleInFlight.current = true
    setSubmitting(true)
    setError('')
    rememberSale(sale)
    try {
      const endpoint = invoiceId ? '/invoices/' + encodeURIComponent(invoiceId) + '/reissue' : '/invoices'
      const { data } = await request<{ id: number }>(endpoint, {
        method: 'POST', financial: true, idempotencyKey: sale.key, body: sale.body,
      })
      if (!Number.isSafeInteger(data?.id) || data.id < 1) throw new Error('تعذر قراءة رقم الفاتورة من الخادم.')
      rememberSale()
      setCart([])
      setCustomer('')
      setPaid('')
      setCashReceived('')
      setTenders([initialTender()])
      setDocumentDate('')
      setDueDate('')
      setInvoiceNotes('')
      setDiscountRequest(''); setDiscountReason(''); setDiscountNotice('')
      setCheckoutMode('full')
      setScanErrors([])
      setSearchStatus('')
      setReissueLoaded(false)
      setSale({ id: data.id, receipt: sale.receipt })
      const sold = new Map(sale.body.items.map((item, index) => [item.product_id, sale.receipt.lines[index].quantity]))
      setProducts(previous => previous.map(product => {
        const quantity = sold.get(Number(product.id))
        return quantity ? { ...product, stock: Math.max(0, Number(product.stock) - quantity) } : product
      }))
      focusSearch()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تعذر تأكيد الفاتورة.')
      if (!receiptPending(error, retry)) {
        const restored = !cartRef.current.length
        restoreSale(sale)
        rememberSale()
        setStockConflict(restored || (error instanceof RequestError && error.status === 409))
      }
    } finally {
      saleInFlight.current = false
      setSubmitting(false)
    }
  }

  async function refreshCartStock() {
    setCheckingStock(true)
    setError('')
    try {
      const updated = await Promise.all(cart.map(async item => {
        const [product] = await searchPosProducts(branch, '', undefined, item.id)
        return product ? { ...item, stock: availableStock(product), price: Number(product.price_minor),
          tracking: trackingOf(product.tracking), packSize: Number(product.units_per_pack) || undefined } : { ...item, stock: 0 }
      }))
      setCart(updated)
      setStockConflict(false)
      setError('حُدّث السعر والمخزون. راجع المبلغ والكميات والأجهزة قبل التأكيد.')
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر تحديث المخزون.') }
    finally { setCheckingStock(false) }
  }

  function checkout(event: FormEvent) {
    event.preventDefault()
    if (!cart.length || saleInFlight.current || searchRun.current || disabled || stockConflict || shiftContext.loading || (invoiceId && !reissueLoaded)) return
    setError('')
    try {
      const amount = checkoutMode === 'full' ? total : readMoney(paid)
      const customerId = customer.trim() ? Number(customer) : undefined
      if (invalidDiscount) throw new Error('راجع الخصم بالجنيه لكل وحدة.')
      if (invalidQuantity) throw new Error('راجع الكميات ووحدة الصنف والمخزون المتاح.')
      if (!Number.isSafeInteger(total)) throw new Error('إجمالي الفاتورة خارج النطاق المسموح.')
      if (amount > total) throw new Error('المبلغ المدفوع يتجاوز إجمالي الفاتورة.')
      if (amount < total && (!Number.isSafeInteger(customerId) || Number(customerId) < 1)) throw new Error('اختر عميلًا لتسجيل المبلغ المتبقي.')
      if (shiftContext.required && !shiftContext.shift) throw new Error('افتح وردية قبل تسجيل البيع.')
      if (instaPay && !shiftContext.shift) throw new Error('افتح وردية لتسجيل تحويل إنستا باي.')
      if (shiftContext.error) throw new Error('تعذّر التحقق من حالة الوردية. حدّث الصفحة قبل تسجيل البيع.')
      if (cart.some(item => item.tracking && item.tracking !== 'quantity' && item.deviceIds?.length !== item.quantity)) {
        throw new Error('حدد رقم كل قطعة متتبعة قبل تأكيد البيع.')
      }
      const paymentRows = instaPay && tenders.length === 1 && tenders[0].method === 'bank_transfer' && amount > 0
        ? tenders.map(row => {
          const reference = row.reference.trim().replace(/^InstaPay:\s*/i, '')
          if (!reference || /[\p{Cc}\p{Cf}]/u.test(reference) || reference.length > 100 - instaPayReferencePrefix.length) {
            throw new Error('أدخل مرجع تحويل إنستا باي كما يظهر في التطبيق.')
          }
          return { ...row, reference: instaPayReferencePrefix + reference }
        }) : tenders
      const payments = shiftContext.shift ? tendersForAmount(paymentRows, amount) : undefined
      const cashDue = payments?.filter(row => row.method === 'cash').reduce((sum, row) => sum + row.amount_minor, 0) ?? amount
      const received = cashDue > 0 && cashReceived.trim() ? readMoney(cashReceived) : cashDue
      if (received < cashDue) throw new Error('النقد المستلم أقل من حصة النقد في هذه الفاتورة.')
      const body: SaleInput = {
        customer_id: customerId,
        branch_id: branch,
        items: cart.map(item => ({ product_id: item.id, quantity: displayQuantity(item.quantity, item.scale), device_ids: item.deviceIds?.length ? item.deviceIds : undefined,
          unit_discount_minor: canDiscount ? unitDiscount(item) || undefined : undefined })),
        paid_minor: amount,
        ...(shiftContext.shift ? { shift_id: shiftContext.shift.id, payments } : {}),
        expected_total_minor: total,
        discount_request_id: hasDiscount && discountRequest.trim() ? Number(discountRequest) : undefined,
        invoice_date: documentDate || undefined,
        due_date: amount < total ? dueDate || undefined : undefined,
        notes: invoiceNotes.trim() || undefined,
        ...(invoiceId ? { reason: reissueReason.trim() } : {}),
      }
      const receipt: SaleReceipt = {
        store: storeName, branch: shiftContext.shift?.branch_name || 'الفرع ' + integer(branch), date: documentDate || cairoDate(),
        total, paid: amount, change: received - cashDue,
        lines: cart.map(item => ({ name: item.name, quantity: item.quantity, scale: item.scale, price: item.price,
          total: lineMinor(item.price - unitDiscount(item), item.quantity, item.scale),
          discount: lineMinor(item.price, item.quantity, item.scale) - lineMinor(item.price - unitDiscount(item), item.quantity, item.scale) })),
        methods: payments?.map(({ method, amount_minor }) => ({ method, amount_minor })) ?? [],
      }
      void submitSale({ key: crypto.randomUUID(), body, receipt })
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تأكيد الفاتورة.') }
  }

  async function requestDiscount() {
    if (disabled || !hasDiscount || !discountReason.trim()) return
    setSubmitting(true); setError(''); setDiscountNotice('')
    try {
      const result = await request<{ id: number }>('/retail/discounts', { method: 'POST', financial: true, body: {
        total_minor: total, reason: discountReason.trim(),
        items: cart.map(line => ({ product_id: line.id, quantity: displayQuantity(line.quantity, line.scale), unit_discount_minor: unitDiscount(line) })),
      } })
      setDiscountRequest(String(result.data.id))
      setDiscountNotice(`أرسل رقم الطلب ${result.data.id} للمشرف. أكّد البيع بعد اعتماده.`)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر إرسال طلب الخصم.') }
    finally { setSubmitting(false) }
  }

  let paidNow = checkoutMode === 'full' ? total : 0
  let invalidPaid = false
  try { if (checkoutMode === 'partial' && paid.trim()) paidNow = readMoney(paid) }
  catch { invalidPaid = true }
  const due = Math.max(0, total - paidNow)
  const mixed = tenders.length > 1
  const tenderMethod = mixed ? 'mixed' : tenders[0].method
  const tenderAmounts = tenders.map(row => {
    try { return readMoney(row.amount) } catch { return undefined }
  })
  const allocated = tenderAmounts.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const cashDue = mixed ? tenders.reduce((sum, row, index) => sum + (row.method === 'cash' ? tenderAmounts[index] ?? 0 : 0), 0)
    : (!shiftContext.shift || tenderMethod === 'cash' ? paidNow : 0)
  let received = cashDue
  let invalidReceived = false
  try { if (cashDue > 0 && cashReceived.trim()) received = readMoney(cashReceived) }
  catch { invalidReceived = true }
  const lastUnallocated = tenderAmounts.findIndex(value => value === undefined)
  const deviceMissing = cart.some(item => item.tracking !== 'quantity' && item.tracking && item.deviceIds?.length !== item.quantity)
  const lockInputs = disabled || checkingStock || Boolean(invoiceId && !reissueLoaded)
  const checkoutBlocked = !cart.length || lockInputs || searching || invalidQuantity || invalidDiscount || invalidPaid || invalidReceived
    || received < cashDue || paidNow > total || Boolean(mixed && paidNow > 0 && shiftContext.shift && (allocated !== paidNow || tenderAmounts.some(value => !value)))
    || shiftContext.loading || Boolean(shiftContext.error || ((shiftContext.required || instaPay) && !shiftContext.shift)) || stockConflict

  function nextSale() {
    setSale(undefined)
    setQuery('')
    focusSearch()
  }

  function showCart() {
    cartSection.current?.scrollIntoView({ block: 'start' })
    cartSection.current?.focus({ preventScroll: true })
  }

  return (
    <div className="helal-pos">
      <PageTitle title={invoiceId ? 'تعديل الفاتورة ' + invoiceId : 'نقطة البيع'} description={invoiceId
        ? 'راجع البنود والأسعار الحالية. ينعكس القيد الأصلي عند نجاح إصدار البديل.'
        : undefined} />
      {!canSell ? <Notice error>ليست لديك صلاحية إنشاء فاتورة.</Notice> : pendingSale ? (
        <section className="panel panel-inner form-section pos-recovery" aria-labelledby="pos-recovery-title">
          <h2 id="pos-recovery-title">{submitting ? 'جارٍ تأكيد الفاتورة…' : 'نتيجة الفاتورة قيد التحقق'}</h2>
          {error && <Notice error>{error}</Notice>}
          <p>{pendingSale.receipt.branch} · {integer(pendingSale.receipt.lines.length)} صنف · <strong>{money(pendingSale.receipt.total)}</strong></p>
          {!submitting && <p>تحقّق من نفس العملية قبل تسجيل بيع آخر. تستخدم إعادة المحاولة البيانات ومفتاح الحفظ الأصليين.</p>}
          <div className="form-actions">
            <button type="button" className="primary" disabled={submitting} onClick={() => void submitSale(pendingSale, true)}>تحقّق وأعد المحاولة</button>
            {canViewInvoice && !submitting && <Link className="secondary" to="/invoices">سجل الفواتير</Link>}
          </div>
        </section>
      ) : (
        <>
          {sale && <section className="panel panel-inner pos-confirmation" aria-label="تأكيد البيع">
            <div role="status"><h2>تم تسجيل البيع</h2><p>الفاتورة <bdi>{integer(sale.id)}</bdi> · {money(sale.receipt.total)}
              {sale.receipt.change > 0 && <> · الباقي {money(sale.receipt.change)}</>}</p></div>
            <div className="form-actions">
              <button type="button" className="secondary" onClick={() => setShowReceipt(true)}>معاينة وطباعة الإيصال</button>
              {canViewInvoice && <Link className="secondary" to={'/invoices/' + sale.id}>عرض الفاتورة</Link>}
              {invoiceId ? <Link className="primary" to="/pos">بيع جديد</Link> : <button type="button" className="primary" onClick={nextSale}>بيع جديد</button>}
            </div>
          </section>}
          {sale && showReceipt && <SaleReceiptPreview id={sale.id} receipt={sale.receipt} close={() => setShowReceipt(false)} />}
          <div className="pos-context panel panel-inner">
            <BranchSelect label="فرع البيع" value={branch} disabled={Boolean(invoiceId || shiftContext.shift || shiftContext.loading || lockInputs || searching || cart.length)}
              set={id => { setSelectedBranch(id); setProducts([]); setQuery(''); setScanErrors([]); setSearchStatus(''); focusSearch() }} />
            <ShiftContext value={shiftContext} />
            {instaPay && <span className="status-pill">تحويل بنكي عبر إنستا باي</span>}
          </div>
          <div className="pos-grid">
            <section className="panel panel-inner pos-catalog" aria-labelledby="pos-catalog-title">
              <h2 id="pos-catalog-title">الأصناف والأجهزة</h2>
              <form className="search-form pos-search" onSubmit={search}>
                <input ref={searchInput} value={query} type="search" dir="auto" aria-label="اسم المنتج أو الباركود أو IMEI أو الرقم التسلسلي" placeholder="امسح الباركود أو IMEI، أو ابحث بالاسم"
                  maxLength={100} autoComplete="off" spellCheck={false} enterKeyHint="search" disabled={lockInputs || shiftContext.loading}
                  onChange={event => setQuery(event.target.value)} />
                <button className="secondary" disabled={lockInputs || shiftContext.loading}>بحث</button>
              </form>
              <p className="pos-search-status muted" role="status">{searchStatus || 'اضغط Enter بعد إدخال الاسم أو الرقم.'}</p>
              {scanErrors.length > 0 && <div className="pos-scan-errors"><Notice error><ul>{scanErrors.map((issue, index) => <li key={index}>{issue}</li>)}</ul></Notice></div>}
              <div className="product-results" aria-busy={searching}>
                {products.length === 0 && !searching && <p className="muted">لا توجد أصناف معروضة.</p>}
                {products.map(product => <article className="product-result" key={idOf(product)}>
                  <div>
                    <strong>{dataText(product.name)}</strong>
                    <small>{money(product.price_minor)} / {measurementLabel(product.quantity_scale)} · المتاح {formatQuantity(availableStock(product), product.quantity_scale)}</small>
                    {Boolean(product.barcode) && <small><bdi>{String(product.barcode)}</bdi></small>}
                    {Boolean(product.compatible_models) && <small>يتوافق مع {dataText(product.compatible_models)}</small>}
                  </div>
                  <div className="pos-add-actions">
                    <button className="secondary" disabled={lockInputs || availableStock(product) < 1} onClick={() => addFromCatalog(product)} aria-label={'أضف ' + String(product.name)}>إضافة</button>
                    {Number(product.units_per_pack) > 1 && <button className="secondary" disabled={lockInputs || availableStock(product) < Number(product.units_per_pack)}
                      onClick={() => addFromCatalog(product, Number(product.units_per_pack))} aria-label={'أضف عبوة من ' + String(product.name)}>عبوة · {integer(product.units_per_pack)}</button>}
                  </div>
                </article>)}
              </div>
            </section>
            <form className="panel panel-inner pos-cart" onSubmit={checkout}>
              <div className="pos-cart-title" ref={cartSection} tabIndex={-1}><h2>الفاتورة الحالية</h2>{cart.length > 0 && <span>{integer(cart.length)} صنف</span>}</div>
              {error && <Notice error>{error}</Notice>}
              {stockConflict && <button className="secondary" type="button" disabled={checkingStock} onClick={() => void refreshCartStock()}>{checkingStock ? 'جارٍ التحديث…' : 'حدّث السعر والمخزون'}</button>}
              {cart.length ? <ul className="pos-lines">{cart.map(item => <li className="pos-line" key={item.id}>
                <div className="pos-line-heading">
                  <div><strong>{item.name}</strong><small>{money(item.price)} / {measurementLabel(item.scale)} · المتاح {formatQuantity(item.stock, item.scale)}{item.packSize && item.packSize > 1 && <> · العبوة {integer(item.packSize)} قطع</>}</small></div>
                  <button type="button" className="icon-button" aria-label={'إزالة ' + item.name} disabled={lockInputs}
                    onClick={() => { setCart(items => items.filter(line => line.id !== item.id)); focusSearch() }}>×</button>
                </div>
                <div className="pos-line-fields">
                  <label className="field">الكمية ({measurementLabel(item.scale)})<input aria-label={'كمية ' + item.name + ' (' + measurementLabel(item.scale) + ')'} type="number"
                    min={quantityStep(item.scale)} step={quantityStep(item.scale)} max={displayQuantity(Math.min(item.stock, 1_000_000), item.scale)} required
                    disabled={lockInputs} value={item.quantityDraft ?? (displayQuantity(item.quantity, item.scale) || '')} onChange={event => {
                      const quantityDraft = event.target.value
                      const value = Number(quantityDraft)
                      const quantity = validQuantity(value, item.scale) ? stockQuantity(value, item.scale) : 0
                      setCart(items => items.map(line => line.id === item.id ? { ...line, quantity, quantityDraft, deviceIds: line.deviceIds?.slice(0, quantity) } : line))
                    }} /></label>
                  {canDiscount && <label className="field">خصم الوحدة<input aria-label={'خصم الوحدة من ' + item.name} inputMode="decimal" value={item.discount ?? ''} disabled={lockInputs}
                    onChange={event => { const discount = event.target.value; setCart(items => items.map(line => line.id === item.id ? { ...line, discount } : line)) }} /></label>}
                  <strong className="pos-line-total">{invalidDiscount ? '—' : money(lineMinor(item.price - unitDiscount(item), item.quantity, item.scale))}</strong>
                </div>
              </li>)}</ul> : <p className="muted">امسح باركودًا أو أضف صنفًا لبدء البيع.</p>}
              {cart.filter(item => item.tracking && item.tracking !== 'quantity' && item.quantity > 0).map(item => <DevicePicker key={item.id} branchId={branch}
                productId={item.id} productName={item.name} quantity={item.quantity} selected={item.deviceIds ?? []} disabled={lockInputs}
                change={deviceIds => setCart(items => items.map(line => line.id === item.id ? { ...line, deviceIds } : line))} />)}
              {cart.length > 0 && <section className="pos-payment" aria-labelledby="pos-payment-title">
                <div className="pos-payment-heading"><h3 id="pos-payment-title">الدفع</h3>
                  <label className="pos-check"><input type="checkbox" checked={checkoutMode === 'partial'} disabled={lockInputs}
                    onChange={event => setCheckoutMode(event.target.checked ? 'partial' : 'full')} />جزئي أو آجل</label></div>
                {checkoutMode === 'partial' && <label className="field">المبلغ المدفوع الآن بالجنيه
                  <input value={paid} inputMode="decimal" placeholder="0.00" aria-invalid={invalidPaid || paidNow > total} disabled={lockInputs} onChange={event => setPaid(event.target.value)} />
                </label>}
                {shiftContext.shift && paidNow > 0 && <>
                  <fieldset className="pos-tenders" disabled={lockInputs}>
                    <legend>وسيلة الدفع</legend>
                    {Object.entries({ ...tenderLabels, mixed: 'مختلط' }).map(([method, label]) => <button key={method} type="button" className="secondary"
                      aria-pressed={tenderMethod === method} onClick={() => {
                        if (tenderMethod === method) return
                        setCashReceived('')
                        setTenders(method === 'mixed' ? [blankTender(), { ...blankTender(), method: 'card' }]
                          : [{ ...blankTender(), method: method as keyof typeof tenderLabels }])
                      }}>{label}</button>)}
                  </fieldset>
                  {mixed ? <>
                    <TenderFields rows={tenders} set={setTenders} disabled={lockInputs} />
                    <div className="pos-allocation"><span>{allocated > paidNow ? 'زيادة التوزيع' : 'المتبقي للتوزيع'} <strong>{money(Math.abs(paidNow - allocated))}</strong></span>
                      {lastUnallocated >= 0 && allocated < paidNow && <button type="button" className="secondary" disabled={lockInputs}
                        onClick={() => setTenders(tenders.map((row, index) => index === lastUnallocated ? { ...row, amount: decimal(paidNow - allocated) } : row))}>أضف المتبقي</button>}</div>
                  </> : tenderMethod !== 'cash' && <label className="field">{instaPay && tenderMethod === 'bank_transfer' ? 'مرجع تحويل إنستا باي' : 'مرجع الدفع (اختياري)'}
                    <input value={tenders[0].reference} required={instaPay && tenderMethod === 'bank_transfer'}
                      maxLength={instaPay && tenderMethod === 'bank_transfer' ? 100 - instaPayReferencePrefix.length : 100}
                      disabled={lockInputs} onChange={event => setTenders([{ ...tenders[0], reference: event.target.value }])} />
                  </label>}
                </>}
                {cashDue > 0 && <label className="field">النقد المستلم بالجنيه (اختياري)
                  <input value={cashReceived} inputMode="decimal" placeholder={decimal(cashDue)} aria-invalid={invalidReceived || received < cashDue}
                    disabled={lockInputs} onChange={event => setCashReceived(event.target.value)} />
                </label>}
                {invalidPaid || paidNow > total ? <Notice error>أدخل مبلغًا صحيحًا لا يتجاوز الإجمالي.</Notice> : null}
                {invalidReceived || received < cashDue ? <Notice error>أدخل نقدًا مستلمًا يساوي حصة النقد أو يزيد عليها.</Notice> : null}
              </section>}
              {cart.length > 0 && <details className="form-section pos-optional" open={checkoutMode === 'partial' || Boolean(invoiceId) || undefined}>
                <summary>العميل وتفاصيل الفاتورة</summary>
                {allowed(user, 'customers.view')
                  ? <FormInput field={posCustomerField} value={customer} set={setCustomer} disabled={lockInputs} />
                  : <label className="field">رقم العميل<input inputMode="numeric" disabled={lockInputs} value={customer} onChange={event => setCustomer(event.target.value)} /></label>}
                <label className="field">تاريخ الفاتورة<input type="date" value={documentDate} disabled={lockInputs} onChange={event => setDocumentDate(event.target.value)} /></label>
                {due > 0 && <label className="field">تاريخ استحقاق المتبقي<input type="date" value={dueDate} disabled={lockInputs} onChange={event => setDueDate(event.target.value)} /></label>}
                <label className="field">ملاحظات الفاتورة<textarea value={invoiceNotes} maxLength={1000} disabled={lockInputs} onChange={event => setInvoiceNotes(event.target.value)} /></label>
              </details>}
              {invoiceId && <label className="field">سبب التعديل<textarea required disabled={submitting}
                value={reissueReason} onChange={event => setReissueReason(event.target.value)} /></label>}
              {invalidQuantity && <Notice error>راجع الكميات ووحدة كل صنف والمخزون المتاح.</Notice>}
              {invalidDiscount && <Notice error>أدخل خصمًا بالجنيه لا يتجاوز سعر الوحدة.</Notice>}
              {deviceMissing && <Notice>حدد جهازًا لكل قطعة متتبعة قبل تأكيد البيع.</Notice>}
              {hasDiscount && <details className="form-section"><summary>اعتماد خصم يتجاوز الحد</summary>
                <label className="field">رقم طلب الخصم المعتمد<input inputMode="numeric" value={discountRequest} disabled={lockInputs} onChange={event => setDiscountRequest(event.target.value)} /></label>
                <label className="field">سبب طلب الاعتماد<textarea maxLength={1000} value={discountReason} disabled={lockInputs} onChange={event => setDiscountReason(event.target.value)} /></label>
                <button type="button" className="secondary" disabled={lockInputs || invalidQuantity || !discountReason.trim()} onClick={() => void requestDiscount()}>اطلب اعتماد المشرف</button>
                {discountNotice && <Notice>{discountNotice}</Notice>}
              </details>}
              <div className="pos-checkout-bar">
                <div className="pos-total"><span>إجمالي الفاتورة</span><strong>{invalidDiscount ? '—' : money(total)}</strong></div>
                {cart.length > 0 && (due > 0 || received > cashDue) && <div className="pos-totals-extra">
                  {due > 0 && <span>المتبقي <b>{money(due)}</b></span>}
                  {received > cashDue && <span>الباقي للعميل <b>{money(received - cashDue)}</b></span>}
                </div>}
                <button className="primary" disabled={checkoutBlocked}>{invoiceId ? 'إصدار الفاتورة البديلة' : 'تأكيد البيع'}</button>
              </div>
            </form>
          </div>
          {cart.length > 0 && <div className="pos-mobile-cart"><button type="button" className="primary" onClick={showCart}>السلة · {integer(cart.length)} · {money(total)}</button></div>}
        </>
      )}
    </div>
  )
}

type Invoice = Row & { items?: Row[]; payments?: Row[]; refund?: Row | null; devices?: Row[]; tenders?: Row[] }

export function InvoiceDetail({ user }: { user: User }) {
  const { id } = useParams()
  const [invoice, setInvoice] = useState<Invoice>()
  const [storeName, setStoreName] = useState('هلال')
  const [receiptFooter, setReceiptFooter] = useState('')
  const [error, setError] = useState('')
  const [revision, refresh] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setInvoice(undefined)
    request<Invoice>('/invoices/' + encodeURIComponent(id || ''), { signal: controller.signal })
      .then(result => setInvoice(result.data)).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    request<Row>('/settings', { signal: controller.signal })
      .then(result => {
        if (typeof result.data.store_name === 'string' && result.data.store_name) setStoreName(result.data.store_name)
        if (typeof result.data.receipt_footer === 'string') setReceiptFooter(result.data.receipt_footer)
      }).catch(() => { /* The standard receipt remains printable. */ })
    return () => controller.abort()
  }, [id, revision])
  const lines = invoice?.items || []
  return (
    <div className="invoice-detail">
      <div className="no-print section-space"><Link className="secondary" to="/invoices">العودة إلى الفواتير</Link></div>
      <PageTitle title={'الفاتورة ' + (id || '')} action={invoice && <div className="form-actions no-print">
        {invoice.status !== 'refunded' && !invoice.devices?.length && !Number(invoice.retail_return_minor) && !invoice.tenders?.length && allowed(user, 'products.view') && allowed(user, 'invoices.create') && allowed(user, 'invoices.refund') &&
          <Link className="secondary" to={'/pos/reissue/' + encodeURIComponent(id || '')}>تعديل الفاتورة</Link>}
        <button className="primary" onClick={() => window.print()}>طباعة الإيصال</button>
      </div>} />
      {error ? <Notice error>{error}</Notice> : !invoice ? <Notice>جارٍ تحميل الفاتورة…</Notice> : (
        <section className="panel panel-inner form-section">
          <h2>{storeName}</h2>
          <dl className="invoice-summary">
            <div><dt>العميل</dt><dd>{dataText(invoice.customer_name)}</dd></div>
            <div><dt>التاريخ</dt><dd>{formatDate(invoice.document_date || invoice.created_at)}</dd></div>
            <div><dt>الحالة</dt><dd>{statuses[String(invoice.status)] || dataText(invoice.status)}</dd></div>
            <div><dt>إجمالي الفاتورة</dt><dd>{money(invoice.total_minor)}</dd></div>
            <div><dt>المدفوع</dt><dd>{money(invoice.paid_minor)}</dd></div>
            <div><dt>المتبقي</dt><dd>{money(invoice.status === 'refunded' ? 0 : remaining(invoice, 'total_minor'))}</dd></div>
          </dl>
          <div className="table-scroll"><table>
            <thead><tr><th scope="col">المنتج</th><th scope="col">الكمية</th><th scope="col">السعر</th><th scope="col">المجموع</th></tr></thead>
            <tbody>{lines.map((line, index) => <tr key={String(line.id ?? line.product_id ?? index)}>
              <td>{dataText(line.product_name)}</td><td>{formatQuantity(line.quantity, line.quantity_scale)}</td><td>{money(line.unit_price_minor)} / {measurementLabel(line.quantity_scale)}
                {Number(line.unit_discount_minor) > 0 && <small> · خصم {money(line.unit_discount_minor)} للقطعة</small>}</td>
              <td>{money(line.line_total_minor ?? lineMinor(Number(line.unit_price_minor), Number(line.quantity), line.quantity_scale))}</td>
            </tr>)}</tbody>
          </table></div>
          {Boolean(invoice.devices?.length) && <p>أرقام الأجهزة · {invoice.devices?.map(device =>
            [device.serial_number, device.imei1, device.imei2].filter(Boolean).join(' / ')).join('، ')}</p>}
          {Boolean(invoice.payments?.length) && <div>
            <h3>المدفوعات</h3>
            <ul className="dash-list">{invoice.payments?.map((payment, index) => <li key={String(payment.id ?? index)}>
              <span>{formatDate(payment.created_at)} {typeof payment.method === 'string' && <> · {tenderLabels[payment.method as keyof typeof tenderLabels] ?? payment.method}</>}</span><strong>{money(payment.amount_minor)}</strong>
            </li>)}</ul>
          </div>}
          {Boolean(invoice.tenders?.length) && <div><h3>وسائل الدفع المسجلة</h3><ul className="dash-list">{invoice.tenders?.map((row, index) => <li key={index}>
            {tenderLabels[String(row.method) as keyof typeof tenderLabels] ?? dataText(row.method)} · {money(row.delta_minor)} {Boolean(row.reference) && <> · <bdi>{String(row.reference)}</bdi></>}
          </li>)}</ul></div>}
          {Boolean(invoice.replaces_invoice_id) && <Link className="no-print" to={'/invoices/' + invoice.replaces_invoice_id}>عرض الفاتورة الأصلية</Link>}
          {Boolean(invoice.replacement_invoice_id) && <Link className="no-print" to={'/invoices/' + invoice.replacement_invoice_id}>عرض الفاتورة البديلة</Link>}
          {invoice.refund && <Notice>تم رد {money(invoice.refund.returned_minor)}. {dataText(invoice.refund.reason)}
            {Boolean(invoice.refund.legacy_refund_reference) && <> · المرجع {dataText(invoice.refund.legacy_refund_reference)}</>}</Notice>}
          {Boolean(invoice.notes) && <p>ملاحظات · {dataText(invoice.notes)}</p>}
          {receiptFooter && <p className="muted">{receiptFooter}</p>}
          {id && <RetailReturns invoiceId={id} user={user} canReturn={invoice.status !== 'refunded' && allowed(user, 'invoices.refund')} revision={revision} onSaved={() => refresh(value => value + 1)} />}
        </section>
      )}
    </div>
  )
}

const salesColumns = [
  { key: 'day', label: 'التاريخ' },
  countColumn('invoices', 'الفواتير'), countColumn('refunds', 'المرتجعات'),
  moneyColumn('gross_minor', 'إجمالي المبيعات'), moneyColumn('refunded_minor', 'المرتجع'),
  moneyColumn('net_minor', 'صافي المبيعات'), moneyColumn('cash_received_minor', 'النقدية الواردة'),
  moneyColumn('cash_returned_minor', 'النقدية المرتدة'), moneyColumn('received_minor', 'إجمالي المحصّل'),
  moneyColumn('returned_minor', 'إجمالي المردود'), moneyColumn('unclassified_received_minor', 'تحصيل غير مصنّف'),
  moneyColumn('unclassified_returned_minor', 'رد غير مصنّف'),
]

function downloadSales(rows: Row[], from: string, to: string) {
  const csvCell = (value: unknown) => {
    const text = String(value ?? '')
    const safe = typeof value === 'string' && /^[=+@\-\t\r]/.test(text) ? "'" + text : text
    return '"' + safe.replaceAll('"', '""') + '"'
  }
  const csv = [
    salesColumns.map(column => csvCell(column.label)).join(','),
    ...rows.map(row => salesColumns.map(column => {
      const value = row[column.key]
      return column.key.endsWith('_minor') ? decimal(value) : csvCell(value)
    }).join(',')),
  ].join('\r\n')
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'hilal-sales-' + from + '-' + to + '.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function SalesReport() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [result, setResult] = useState<{ from: string; to: string; timezone: string; days: Row[] }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setResult(undefined)
    try {
      const response = await request<{ from: string; to: string; timezone: string; days: Row[] }>('/reports/sales?' + new URLSearchParams({ from, to }))
      setResult(response.data)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تحميل تقرير المبيعات.') }
    finally { setBusy(false) }
  }

  return (
    <>
      <PageTitle title="تقارير المبيعات" description="صافي المبيعات والمرتجعات وحركة النقدية حسب اليوم." />
      <form className="panel form-card section-space" onSubmit={run}>
        <label className="field">من تاريخ<input required type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label>
        <label className="field">إلى تاريخ<input required type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label>
        <div className="form-actions">
          <button className="primary" disabled={busy}>{busy ? 'جارٍ التحميل…' : 'عرض التقرير'}</button>
          {result?.days.length ? <button type="button" className="secondary"
            onClick={() => downloadSales(result.days, result.from, result.to)}>تصدير CSV</button> : null}
        </div>
      </form>
      {error && <Notice error>{error}</Notice>}
      {result && <section className="panel data-panel" aria-label="نتائج المبيعات">
        <div className="data-toolbar"><span>الفترة {result.from} إلى {result.to}</span><small dir="ltr">{result.timezone}</small></div>
        {result.days.length ? <div className="table-scroll" tabIndex={0}>
          <table>
            <thead><tr>{salesColumns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
            <tbody>{result.days.map(row => <tr key={String(row.day)}>
              {salesColumns.map(column => <td key={column.key}>{'render' in column && column.render ? column.render(row) : dataText(row[column.key])}</td>)}
            </tr>)}</tbody>
          </table>
        </div> : <p className="table-state">لا توجد معاملات في هذه الفترة.</p>}
      </section>}
    </>
  )
}

const walletMetrics = [
  ['drawer_minor', 'رصيد الدرج الخاص بالمحافظ'], ['shared_drawer_minor', 'صافي حركات المحافظ على درج البيع'], ['provider_balance_minor', 'أرصدة المزودين'],
  ['receivables_minor', 'مستحقات المحافظ'], ['transfer_margin_minor', 'صافي عمولات التحويل'],
  ['drawer_expense_minor', 'مصروفات الدرج'], ['profit_available_minor', 'الربح المتاح'],
  ['profit_withdrawn_minor', 'الأرباح المسحوبة'], ['working_capital_minor', 'رأس المال العامل'],
] as const

export function WalletReport({ user }: { user: User }) {
  const [withdrawing, setWithdrawing] = useState(false)
  const [revision, setRevision] = useState(0)
  const [report, setReport] = useState<Row>()
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    request<Row>('/reports/wallets', { signal: controller.signal })
      .then(result => setReport(result.data))
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [revision])
  return <>
    <PageTitle title="تقرير المحافظ" description="أرصدة المحافظ والدرج والذمم وصافي العمولات." action={
      <div className="form-actions"><Link className="secondary" to="/wallet-reconciliation">مطابقة الدرج والمحافظ</Link>
        <Link className="secondary" to="/wallet-profit-withdrawals">سجل سحب الأرباح</Link>
        {allowed(user, 'wallets.profit') && <button className="primary" onClick={() => setWithdrawing(true)}>سحب من الأرباح</button>}</div>
    } />
    {withdrawing && <SharedDrawerDialog user={user} action={{ ...createAction('سحب من الأرباح', '/wallet-profit-withdrawals', 'wallets.profit', [
      required('amount_minor', 'المبلغ بالجنيه', 'money'), reference('wallet_id', 'المحفظة (اتركها فارغة للدرج النقدي)', '/wallets'), notes,
    ], true), sharedDrawer: 'optional' }} close={() => setWithdrawing(false)} done={() => { setWithdrawing(false); setRevision(value => value + 1) }} />}
    {error ? <Notice error>{error}</Notice> : !report ? <Notice>جارٍ تحميل التقرير…</Notice> :
      <div className="metric-grid">{walletMetrics.map(([key, label]) =>
        <article className="panel metric" key={key}><p>{label}</p><strong>{money(report[key])}</strong></article>,
      )}</div>}
    <WalletPositions revision={revision} />
    <WalletPeriodReport revision={revision} />
    {user.role === 'superadmin' && <WalletAudit />}
  </>
}

export function DamageReport() {
  const [result, setResult] = useState<Row>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const values = new FormData(event.currentTarget)
    const params = new URLSearchParams({ from: String(values.get('from')), to: String(values.get('to')) })
    if (params.get('from')! > params.get('to')!) { setError('تاريخ البداية بعد تاريخ النهاية.'); return }
    setBusy(true)
    setError('')
    setResult(undefined)
    try {
      const response = await request<Row>('/reports/damaged?' + params)
      setResult(response.data)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تحميل تقرير الهالك.') }
    finally { setBusy(false) }
  }

  const metrics = [
    ['entries', 'القيود المسجلة', integer], ['units', 'إجمالي القطع', integer],
    ['length_mm', 'إجمالي الأطوال', (value: unknown) => formatQuantity(value, 1000)],
    ['total_value_minor', 'إجمالي قيمة الهالك', money], ['voided_entries', 'القيود الملغاة', integer],
  ] as const
  return <>
    <Link className="secondary section-space" to="/damaged">الهالك</Link>
    <PageTitle title="تقرير الهالك" />
    <form className="panel form-card section-space" onSubmit={run}>
      <label className="field">من تاريخ<input type="date" name="from" defaultValue={new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)} required /></label>
      <label className="field">إلى تاريخ<input type="date" name="to" defaultValue={new Date().toISOString().slice(0, 10)} required /></label>
      <div className="form-actions"><button className="primary" disabled={busy}>{busy ? 'جارٍ التحميل…' : 'عرض التقرير'}</button></div>
    </form>
    {error && <Notice error>{error}</Notice>}
    {result && <div className="metric-grid">{metrics.filter(([key]) => key in result).map(([key, label, format]) =>
      <article className="panel metric" key={key}><p>{label}</p><strong>{format(result[key])}</strong></article>,
    )}</div>}
  </>
}
