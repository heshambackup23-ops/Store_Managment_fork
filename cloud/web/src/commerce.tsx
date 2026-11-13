import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { allowed, apiUrl, decimal, formatDate, integer, money, readMoney, request } from './api'
import type { User } from './api'
import { activeColumn, activeField, countColumn, createAction, dateColumn, editAction, moneyColumn, numberColumn, RecordImageDialog, required } from './core'
import { ActionDialog, DataModule, dataText, FormInput, idOf, Modal, Notice, PageTitle } from './ui'
import type { Action, Column, Field, ModuleConfig, Row } from './ui'
import { WalletAudit, WalletPeriodReport } from './WalletPeriodReport'
import { WalletPositions } from './WalletOperations'
import { walletProviderLabel, walletProviderOptions, walletProviderPreset } from './wallet-providers'

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

function reference(name: string, label: string, path: string, mandatory = false, lookup?: string): Field {
  return { name, label, kind: 'reference', min: 1, reference: { path, label: lookup }, required: mandatory, nullable: !mandatory }
}

function payment(path: string, permission: string, total: string, note = false): Action {
  return {
    label: 'تسجيل سداد', permission, financial: true, visible: row => remaining(row, total) > 0 && !row.voided_at && row.status !== 'cancelled',
    endpoint: row => path + '/' + idOf(row) + '/payments',
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
    options: [...walletProviderOptions, { value: 'custom', label: 'مزود آخر أو غير محدد' }],
    read: row => walletProviderPreset(row.provider)?.value ?? 'custom',
  },
  {
    name: 'custom_provider', label: 'اسم المزود',
    visible: values => values.provider_type === 'custom',
    read: row => walletProviderPreset(row.provider) ? '' : String(row.provider ?? ''),
  },
  {
    name: 'phone', label: 'رقم المحفظة أو عنوان الدفع',
    placeholder: 'رقم الهاتف أو عنوان إنستا باي',
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
  { name: 'phone', label: 'رقم الهاتف' }, { name: 'address', label: 'العنوان' },
  { name: 'requested_date', label: 'تاريخ استلام طلب الصيانة', kind: 'date' }, required('item', 'الجهاز أو المنتج'),
  required('problem', 'العطل', 'textarea'), {
    name: 'price_minor', label: 'التكلفة بالجنيه', kind: 'money',
    read: row => decimal(row.price_minor),
  }, { name: 'notes', label: 'ملاحظات', kind: 'textarea' },
]

export const walletTransaction: Action = {
  label: 'تسجيل معاملة', permission: 'wallets.transact', financial: true,
  endpoint: row => '/wallets/' + idOf(row) + '/transactions',
  visible: row => Boolean(row.active),
  fields: [
    { ...required('kind', 'نوع المعاملة', 'select'), options: options(['receive', 'send', 'expense', 'settlement_in', 'settlement_out']) },
    required('amount_minor', 'المبلغ بالجنيه', 'money'),
    { name: 'counterparty', label: 'رقم الطرف الآخر', visible: values => ['send', 'receive'].includes(values.kind) },
    { name: 'provider_reference', label: 'مرجع العملية لدى المزود (اختياري)', visible: values => ['send', 'receive'].includes(values.kind) },
    ...amounts({ commission_minor: 'العمولة بالجنيه (فارغ لاستخدام الإعداد)', fee_minor: 'رسوم المزود بالجنيه (فارغ لاستخدام الإعداد)' })
      .map(field => ({ ...field, visible: (values: Record<string, string>) => ['send', 'receive'].includes(values.kind) })), notes,
    { ...reference('deferred_customer', 'العميل للسداد الآجل', '/customers'), nullable: false, visible: values => values.kind === 'send' },
    { name: 'deferred_date', label: 'تاريخ استحقاق المبلغ الآجل', kind: 'date', visible: values => values.kind === 'send' && Boolean(values.deferred_customer) },
  ],
  transform(body) {
    const { deferred_customer, deferred_date, ...transaction } = body
    if (deferred_customer && transaction.kind !== 'send') throw new Error('يمكن تسجيل مبلغ آجل لعملية الإرسال فقط.')
    if (!deferred_customer) return transaction
    return { ...transaction, deferred: { customer_id: deferred_customer, due_date: deferred_date } }
  },
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
  { ...required('quantity', 'الكمية', 'number'), min: 1 },
  required('reason', 'السبب', 'textarea'),
  moneyField('unit_value_minor', 'قيمة الوحدة بالجنيه'),
  { name: 'damaged_on', label: 'تاريخ الهالك', kind: 'date' },
  { name: 'notes', label: 'ملاحظات', kind: 'textarea' },
]
export const supplierPayment: Action = {
  label: 'سداد على حساب المورد', permission: 'suppliers.pay', financial: true,
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
    columns: [numberColumn, { key: 'product_name', label: 'المنتج' }, countColumn('delta', 'التغير في الكمية'),
      { ...statusColumn('source_type', 'مصدر الحركة'), render: row => row.purchase_stock_receipt_id
        ? 'استلام مشتريات' : row.purchase_stock_reversal_id ? 'عكس استلام مشتريات' : statuses[String(row.source_type)] || dataText(row.source_type) },
      { key: 'source_id', label: 'رقم المرجع' }, { key: 'note', label: 'الملاحظة' }, dateColumn('created_at', 'التاريخ')],
    create: createAction('تعديل كمية المخزون', '/inventory/adjustments', 'inventory.manage', [
      reference('product_id', 'المنتج', '/products', true), required('delta', 'تغير الكمية (موجب للإضافة وسالب للخصم)', 'number'),
      required('note', 'سبب التعديل', 'textarea'),
    ], true),
  },
  invoices: {
    title: 'الفواتير', description: 'سجل المبيعات والسداد والاسترجاع.', endpoint: '/invoices', permission: 'invoices.view',
    columns: [numberColumn, { key: 'customer_name', label: 'العميل' }, moneyColumn('total_minor', 'الإجمالي'),
      paidColumn, { key: 'remaining', label: 'المتبقي', render: row => money(row.status === 'refunded' ? 0 : remaining(row, 'total_minor')) }, statusColumn(), dateColumn('document_date', 'التاريخ')],
    actions: [invoicePayment, reverse('/invoices', 'invoices.refund', 'refund')],
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
      moneyColumn('total_minor', 'الإجمالي'), paidColumn, remainingColumn('total_minor'),
      { key: 'payment_type', label: 'طريقة السداد', render: row => row.payment_type === 'cash' ? 'نقدي' : 'آجل' }, dateColumn('purchase_date', 'التاريخ')],
    create: createAction('تسجيل شراء', '/purchases', 'suppliers.manage', [
      reference('supplier_id', 'المورد', '/suppliers', true), { name: 'reference', label: 'المرجع', nullable: true },
      required('description', 'الوصف', 'textarea'), required('total_minor', 'إجمالي الشراء بالجنيه', 'money'),
      required('purchase_date', 'تاريخ الشراء', 'date'),
      { name: 'payment_type', label: 'نوع السداد', kind: 'select', initial: 'credit',
        options: [{ value: 'credit', label: 'آجل' }, { value: 'cash', label: 'نقدي' }] },
      { ...moneyField('paid_minor', 'المدفوع عند التسجيل بالجنيه'), visible: values => values.payment_type === 'credit' },
    ], true),
    actions: [payment('/purchases', 'suppliers.pay', 'total_minor', true)],
  },
  wallets: {
    title: 'المحافظ', description: 'أرصدة المحافظ وحدودها والمعاملات المسجلة.', endpoint: '/wallets', permission: 'wallets.view', searchable: false,
    columns: [numberColumn, { key: 'name', label: 'المحفظة' }, { key: 'provider', label: 'المزود', render: row => walletProviderLabel(row.provider) },
      moneyColumn('balance_minor', 'الرصيد'), moneyColumn('transaction_limit_minor', 'حد المعاملة'), activeColumn],
    create: {
      ...createAction('إضافة محفظة', '/wallets', 'wallets.manage', [...walletFields, { name: 'opening_minor', label: 'الرصيد الافتتاحي بالجنيه', kind: 'money' }], true),
      transform: walletProfile,
    },
    actions: [walletTransaction, walletAdjustment, { ...editAction('/wallets', 'wallets.manage', [...walletFields, activeField]), transform: walletProfile }],
  },
  'wallet-transactions': {
    title: 'حركات المحافظ', description: 'سجل التحويلات والمصروفات والتسويات والحركات العكسية.', endpoint: '/wallet-transactions', permission: 'wallets.view', searchable: false,
    columns: [numberColumn, { key: 'wallet_name', label: 'المحفظة' }, statusColumn('kind', 'نوع الحركة'), moneyColumn('amount_minor', 'المبلغ'),
      moneyColumn('delta_minor', 'أثر المحفظة'), moneyColumn('cash_delta_minor', 'أثر النقدية'), moneyColumn('commission_minor', 'العمولة'),
      { key: 'counterparty', label: 'الطرف الآخر' }, { key: 'provider_reference', label: 'مرجع المزود' },
      { key: 'note', label: 'الملاحظة' }, dateColumn('created_at', 'التاريخ')],
    actions: [reverse('/wallet-transactions', 'wallets.reverse')],
  },
  'wallet-cash': {
    title: 'حركات نقدية المحافظ', description: 'قيود الدرج النقدي ومصروفاته.', endpoint: '/wallet-cash', permission: 'wallets.cash', searchable: false,
    columns: [numberColumn, statusColumn('kind', 'نوع الحركة'), moneyColumn('delta_minor', 'أثر النقدية'),
      { key: 'category', label: 'التصنيف' }, { key: 'note', label: 'البيان' }, dateColumn('business_day', 'التاريخ')],
    create: createAction('إضافة قيد نقدي', '/wallet-cash', 'wallets.cash', [
      { ...required('kind', 'نوع القيد', 'select'), options: options(['opening', 'owner_deposit', 'owner_withdraw', 'correction', 'expense']) },
      required('amount_minor', 'المبلغ بالجنيه (السالب متاح للتصحيح)', 'signed-money'),
      { name: 'category', label: 'التصنيف (إلزامي للمصروف)' }, { name: 'business_day', label: 'تاريخ القيد', kind: 'date' },
      required('note', 'سبب القيد', 'textarea'),
    ], true),
    actions: [{ ...reverse('/wallet-cash', 'wallets.reverse'), visible: row => row.kind === 'expense' && !row.reversed_by }],
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
    columns: [numberColumn, imageColumn('/damaged'), { key: 'product_name', label: 'المنتج' }, countColumn('quantity', 'الكمية'),
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
  const config = businessModules[name]
  const isInvoice = name === 'invoices'
  const hasImages = name === 'damaged' || name === 'maintenance'
  const canManageImage = hasImages && allowed(user, name + '.manage')
  const dateFilter = ['maintenance', 'purchases', 'damaged'].includes(name)
  const params = new URLSearchParams()
  if (filter) params.set('status', filter)
  if (range.from) params.set('from', range.from)
  if (range.to) params.set('to', range.to)
  const endpoint = config.endpoint + (params.size ? '?' + params : '')
  return <>
    <DataModule key={endpoint + ':' + imageVersion} user={user} config={{ ...config, endpoint }}
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
      </form> : undefined}
      rowActions={isInvoice
        ? row => <Link className="link-button" to={'/invoices/' + idOf(row)}>عرض وطباعة</Link>
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

async function searchPosProducts(canViewCatalog: boolean, term = '', signal?: AbortSignal) {
  const params = new URLSearchParams()
  if (term) params.set('q', term)
  if (canViewCatalog) {
    params.set('per_page', '20')
    const result = await request<Row[]>('/products?' + params, { signal })
    return result.data.filter(row => Boolean(row.active))
  }
  const result = await request<Row[]>('/cashier/products?' + params, { signal })
  return result.data.map(row => ({ ...row, active: true, price_minor: readMoney(String(row.price)) }))
}

type CartItem = { id: number; name: string; stock: number; price: number; quantity: number }

export function Pos({ user }: { user: User }) {
  const { invoiceId } = useParams()
  const [original, setOriginal] = useState<Invoice>()
  const [reissueLoaded, setReissueLoaded] = useState(false)
  const [reissueReason, setReissueReason] = useState('')
  const [documentDate, setDocumentDate] = useState('')
  const [invoiceNotes, setInvoiceNotes] = useState('')
  const [products, setProducts] = useState<Row[]>([])
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [customer, setCustomer] = useState('')
  const [paid, setPaid] = useState('')
  const [checkoutMode, setCheckoutMode] = useState('full')
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [lastInvoice, setLastInvoice] = useState<number>()
  const navigate = useNavigate()
  const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0)
  const canViewCatalog = allowed(user, 'products.view')
  const canSell = allowed(user, 'invoices.create') && (!invoiceId || canViewCatalog && allowed(user, 'invoices.refund') && allowed(user, 'invoices.view'))

  useEffect(() => {
    if (!canSell) return
    const controller = new AbortController()
    searchPosProducts(canViewCatalog, '', controller.signal).then(setProducts)
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
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
              const result = await request<Row>('/products/' + line.product_id, { signal: controller.signal })
              return result.data
            } catch { return undefined }
          }))
          if (controller.signal.aborted) return
          const editableLines = (previous.items || []).flatMap((line, index) => {
            const product = currentProducts[index]
            if (!product?.active) return []
            const quantity = Number(line.quantity)
            return [{
              id: Number(product.id), name: String(product.name), price: Number(product.price_minor),
              stock: Number(product.stock) + quantity, quantity,
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
  }, [canSell, canViewCatalog, invoiceId])

  function availableStock(product: Row) {
    const originalLine = original?.items?.find(line => line.product_id === product.id)
    return Number(product.stock) + Number(originalLine?.quantity || 0)
  }

  function add(product: Row) {
    setError('')
    setLastInvoice(undefined)
    const id = Number(product.id)
    const stock = availableStock(product)
    const price = Number(product.price_minor)
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(stock) || !Number.isSafeInteger(price) || stock < 1) {
      setError('المنتج غير متاح في المخزون.')
      return
    }
    const line = cart.find(item => item.id === id)
    if (line && line.quantity >= stock) {
      setError('الكمية المطلوبة تتجاوز المخزون المتاح.')
      return
    }
    setCart(items => line ? items.map(item => item.id === id ? { ...item, quantity: item.quantity + 1, price, stock } : item)
      : [...items, { id, stock, price, name: String(product.name), quantity: 1 }])
  }

  async function search(event: FormEvent) {
    event.preventDefault()
    if (searching || submitting) return
    setSearching(true)
    setError('')
    try {
      const term = query.trim()
      const found = await searchPosProducts(canViewCatalog, term)
      setProducts(found)
      const exact = term && found.find(row => String(row.barcode ?? '') === term)
      if (exact) { add(exact); setQuery('') }
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر البحث عن المنتجات.') }
    finally { setSearching(false) }
  }

  async function checkout(event: FormEvent) {
    event.preventDefault()
    if (!cart.length || submitting || (invoiceId && !reissueLoaded)) return
    setSubmitting(true)
    setError('')
    try {
      const amount = checkoutMode === 'full' ? total : readMoney(paid)
      const customerId = customer.trim() ? Number(customer) : undefined
      if (!Number.isSafeInteger(total)) throw new Error('إجمالي الفاتورة خارج النطاق المسموح.')
      if (amount > total) throw new Error('المبلغ المدفوع يتجاوز إجمالي الفاتورة.')
      if (amount < total && (!Number.isSafeInteger(customerId) || Number(customerId) < 1)) throw new Error('اختر عميلًا لتسجيل المبلغ المتبقي.')
      const endpoint = invoiceId ? '/invoices/' + encodeURIComponent(invoiceId) + '/reissue' : '/invoices'
      await request<{ id: number }>(endpoint, {
        method: 'POST', financial: true,
        body: {
          customer_id: customerId,
          items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })),
          paid_minor: amount,
          expected_total_minor: total,
          invoice_date: documentDate || undefined,
          notes: invoiceNotes.trim() || undefined,
          ...(invoiceId ? { reason: reissueReason.trim() } : {}),
        },
      }).then(result => {
        const sold = new Map(cart.map(item => [item.id, item.quantity]))
        setProducts(previous => previous.map(product => {
          const quantity = sold.get(Number(product.id))
          return quantity ? { ...product, stock: Math.max(0, Number(product.stock) - quantity) } : product
        }))
        setCart([])
        setCustomer('')
        setPaid('')
        setDocumentDate('')
        setInvoiceNotes('')
        setCheckoutMode('full')
        setLastInvoice(result.data.id)
        if (allowed(user, 'invoices.view')) navigate('/invoices/' + result.data.id)
      })
      if (!allowed(user, 'invoices.view')) {
        searchPosProducts(canViewCatalog).then(setProducts)
          .catch(() => { /* The confirmed sale remains valid if refreshing the catalog fails. */ })
      }
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تأكيد الفاتورة.') }
    finally { setSubmitting(false) }
  }

  let due = total
  try { due = checkoutMode === 'full' ? 0 : Math.max(0, total - readMoney(paid)) } catch { /* Wait for a valid amount. */ }

  return (
    <>
      <PageTitle title={invoiceId ? 'تعديل الفاتورة ' + invoiceId : 'نقطة البيع'} description={invoiceId
        ? 'راجع البنود والأسعار الحالية. ينعكس القيد الأصلي عند نجاح إصدار البديل.'
        : 'ابحث عن منتج أو امسح الباركود لتسجيل البيع.'} />
      {!canSell ? <Notice error>ليست لديك صلاحية إنشاء فاتورة.</Notice> : (
        <>
          {error && <Notice error>{error}</Notice>}
          {lastInvoice && <Notice>تم تسجيل الفاتورة رقم {integer(lastInvoice)}.</Notice>}
          <div className="pos-grid">
            <section className="panel panel-inner">
              <form className="search-form" onSubmit={search}>
                <input value={query} type="search" aria-label="المنتج أو الباركود" placeholder="المنتج أو الباركود"
                  disabled={submitting} onChange={event => setQuery(event.target.value)} />
                <button className="secondary" disabled={searching || submitting}>{searching ? 'جارٍ البحث…' : 'بحث'}</button>
              </form>
              <div className="product-results" aria-live="polite">
                {products.length === 0 && !searching && <p className="muted">لا توجد منتجات مطابقة.</p>}
                {products.map(product => <article className="product-result" key={idOf(product)}>
                  <div>
                    <strong>{dataText(product.name)}</strong>
                    <small>{money(product.price_minor)} · المتاح {integer(availableStock(product))} {product.barcode ? '· ' + String(product.barcode) : ''}</small>
                  </div>
                  <button className="secondary" disabled={submitting || availableStock(product) < 1 || Boolean(invoiceId && !reissueLoaded)} onClick={() => add(product)}>إضافة</button>
                </article>)}
              </div>
            </section>
            <form className="panel panel-inner pos-cart" onSubmit={checkout}>
              <h2>الفاتورة الحالية</h2>
              {cart.length ? <div className="table-scroll"><table>
                <thead><tr><th scope="col">المنتج</th><th scope="col">الكمية</th><th scope="col">الإجمالي</th><th scope="col">إزالة</th></tr></thead>
                <tbody>{cart.map(item => <tr key={item.id}>
                  <td>{item.name}</td>
                  <td><input aria-label={'كمية ' + item.name} type="number" min="1" max={item.stock} required
                    disabled={submitting} value={item.quantity || ''} onChange={event => {
                      const quantity = Number(event.target.value)
                      setCart(items => items.map(line => line.id === item.id ? { ...line, quantity } : line))
                    }} /></td>
                  <td>{money(item.price * item.quantity)}</td>
                  <td><button type="button" className="icon-button" aria-label={'إزالة ' + item.name} disabled={submitting}
                    onClick={() => setCart(items => items.filter(line => line.id !== item.id))}>×</button></td>
                </tr>)}</tbody>
              </table></div> : <p className="muted">أضف منتجًا لبدء الفاتورة.</p>}
              {allowed(user, 'customers.view')
                ? <FormInput field={posCustomerField} value={customer} set={setCustomer} disabled={submitting} />
                : <label className="field">رقم العميل<input inputMode="numeric" pattern="[0-9]+" disabled={submitting}
                    value={customer} onChange={event => setCustomer(event.target.value)} /></label>}
              <label className="field">طريقة السداد
                <select disabled={submitting} value={checkoutMode} onChange={event => setCheckoutMode(event.target.value)}>
                  <option value="full">سداد كامل</option><option value="partial">سداد جزئي أو آجل</option>
                </select>
              </label>
              {checkoutMode === 'partial' && <label className="field">المبلغ المدفوع بالجنيه
                <input value={paid} inputMode="decimal" required disabled={submitting} onChange={event => setPaid(event.target.value)} />
              </label>}
              <label className="field">تاريخ الفاتورة
                <input type="date" value={documentDate} disabled={submitting} onChange={event => setDocumentDate(event.target.value)} />
              </label>
              <label className="field">ملاحظات الفاتورة
                <textarea value={invoiceNotes} maxLength={1000} disabled={submitting} onChange={event => setInvoiceNotes(event.target.value)} />
              </label>
              {invoiceId && <label className="field">سبب التعديل<textarea required disabled={submitting}
                value={reissueReason} onChange={event => setReissueReason(event.target.value)} /></label>}
              <div className="pos-total"><span>إجمالي الفاتورة</span><strong>{money(total)}</strong></div>
              <div className="pos-total"><span>المتبقي</span><strong>{money(due)}</strong></div>
              <button className="primary" disabled={!cart.length || submitting || Boolean(invoiceId && !original)}>{submitting ? 'جارٍ تأكيد العملية…' : invoiceId ? 'إصدار الفاتورة البديلة' : 'تأكيد البيع'}</button>
            </form>
          </div>
        </>
      )}
    </>
  )
}

type Invoice = Row & { items?: Row[]; payments?: Row[]; refund?: Row | null }

export function InvoiceDetail({ user }: { user: User }) {
  const { id } = useParams()
  const [invoice, setInvoice] = useState<Invoice>()
  const [storeName, setStoreName] = useState('هلال')
  const [receiptFooter, setReceiptFooter] = useState('')
  const [error, setError] = useState('')
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
  }, [id])
  const lines = invoice?.items || []
  return (
    <div className="invoice-detail">
      <div className="no-print section-space"><Link className="secondary" to="/invoices">العودة إلى الفواتير</Link></div>
      <PageTitle title={'الفاتورة ' + (id || '')} action={invoice && <div className="form-actions no-print">
        {invoice.status !== 'refunded' && allowed(user, 'products.view') && allowed(user, 'invoices.create') && allowed(user, 'invoices.refund') &&
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
              <td>{dataText(line.product_name)}</td><td>{integer(line.quantity)}</td><td>{money(line.unit_price_minor)}</td>
              <td>{money(Number(line.quantity) * Number(line.unit_price_minor))}</td>
            </tr>)}</tbody>
          </table></div>
          {Boolean(invoice.payments?.length) && <div>
            <h3>المدفوعات</h3>
            <ul className="dash-list">{invoice.payments?.map((payment, index) => <li key={String(payment.id ?? index)}>
              <span>{formatDate(payment.created_at)}</span><strong>{money(payment.amount_minor)}</strong>
            </li>)}</ul>
          </div>}
          {Boolean(invoice.replaces_invoice_id) && <Link className="no-print" to={'/invoices/' + invoice.replaces_invoice_id}>عرض الفاتورة الأصلية</Link>}
          {Boolean(invoice.replacement_invoice_id) && <Link className="no-print" to={'/invoices/' + invoice.replacement_invoice_id}>عرض الفاتورة البديلة</Link>}
          {invoice.refund && <Notice>تم رد {money(invoice.refund.returned_minor)}. {dataText(invoice.refund.reason)}
            {Boolean(invoice.refund.legacy_refund_reference) && <> · المرجع {dataText(invoice.refund.legacy_refund_reference)}</>}</Notice>}
          {Boolean(invoice.notes) && <p>ملاحظات · {dataText(invoice.notes)}</p>}
          {receiptFooter && <p className="muted">{receiptFooter}</p>}
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
  moneyColumn('cash_returned_minor', 'النقدية المرتدة'),
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
  ['drawer_minor', 'رصيد الدرج النقدي'], ['provider_balance_minor', 'أرصدة المزودين'],
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
    {withdrawing && <ActionDialog action={createAction('سحب من الأرباح', '/wallet-profit-withdrawals', 'wallets.profit', [
      required('amount_minor', 'المبلغ بالجنيه', 'money'), reference('wallet_id', 'المحفظة (اتركها فارغة للدرج النقدي)', '/wallets'), notes,
    ], true)} close={() => setWithdrawing(false)} done={() => { setWithdrawing(false); setRevision(value => value + 1) }} />}
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
    ['entries', 'القيود المسجلة', integer], ['units', 'إجمالي الوحدات', integer],
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
    {result && <div className="metric-grid">{metrics.map(([key, label, format]) =>
      <article className="panel metric" key={key}><p>{label}</p><strong>{format(result[key])}</strong></article>,
    )}</div>}
  </>
}
