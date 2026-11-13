import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { allowed, formatDate, money, request } from './api'
import type { User } from './api'
import { ActionDialog, DataModule, dataText, idOf, Notice, PageTitle } from './ui'
import type { Action, Column, ModuleConfig, Row } from './ui'
import { countColumn, dateColumn, moneyColumn, required } from './core'
import { businessModules, supplierPayment, walletTransaction } from './commerce'
import { walletProviderLabel } from './wallet-providers'
import { RetailReceipt } from './RetailReceipt'
import { deviceLabel } from './RetailDevices'
import { RetailActionDialog, SharedDrawerDialog } from './RetailShifts'
import { RetailPurchaseSummary } from './RetailSupplierReturns'

export function WalletCashier({ user }: { user: User }) {
  const [wallets, setWallets] = useState<Row[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [selectedAction, setSelectedAction] = useState<Action>()
  const [revision, setRevision] = useState(0)
  const [balanceVersion, setBalanceVersion] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const chosen = wallets.find(row => String(row.id) === selectedId)
  const canTransact = allowed(user, 'wallets.transact')

  useEffect(() => {
    const controller = new AbortController()
    request<Row[]>('/wallets?per_page=100', { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) {
          setWallets(result.data.filter(wallet => wallet.active))
          setError('')
        }
      })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoaded(true) })
    return () => controller.abort()
  }, [revision, balanceVersion])

  function launch(kind: 'send' | 'receive') {
    const label = kind === 'send' ? 'تسجيل إيداع للعميل' : 'تسجيل سحب للعميل'
    const fields = (walletTransaction.fields || []).filter(field => field.name !== 'kind'
      && (kind === 'send' || !field.name.startsWith('deferred_')))
      .map(field => ({
        ...field,
        visible: field.visible ? (values: Record<string, string>) => field.visible!({ ...values, kind }) : undefined,
      }))
    setSuccess(false)
    setSelectedAction({
      ...walletTransaction, label, fields, sharedDrawer: 'optional',
      transform: body => walletTransaction.transform?.({ ...body, kind }) ?? { ...body, kind },
    })
  }

  const transactions = businessModules['wallet-transactions']
  const config: ModuleConfig = {
    ...transactions, title: 'آخر المعاملات',
    endpoint: transactions.endpoint + (chosen ? '?wallet_id=' + idOf(chosen) : ''),
  }

  return <>
    <PageTitle title="كاشير المحافظ" description="سجّل العملية في هلال بعد تأكيدها لدى المزود." />
    {error && <Notice error>{error}</Notice>}
    {success && <Notice>تم تسجيل المعاملة وتحديث رصيد المحفظة.</Notice>}
    <section className="panel form-card section-space" aria-label="تنفيذ معاملة محفظة">
      {!loaded ? <p role="status">جارٍ تحميل المحافظ…</p> : !wallets.length ? <p>لا توجد محافظ نشطة.</p> : <>
        <label className="field">المحفظة
          <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
            <option value="">اختر محفظة</option>
            {wallets.map(wallet => <option key={idOf(wallet)} value={String(wallet.id)}>{String(wallet.name)}</option>)}
          </select>
        </label>
        {chosen && <p>{walletProviderLabel(chosen.provider)} · الرصيد المتاح <strong>{money(chosen.balance_minor)}</strong></p>}
        <p className="muted">الإيداع: المحل يرسل من المحفظة ويستلم النقد أو يسجّله آجلًا. السحب: المحل يستقبل على المحفظة ويسلّم النقد للعميل.</p>
        <div className="form-actions">
          {canTransact && <><button className="primary" disabled={!chosen} onClick={() => launch('send')}>إيداع للعميل</button>
            <button className="secondary" disabled={!chosen} onClick={() => launch('receive')}>سحب للعميل</button></>}
          <Link className="secondary" to="/wallet-debts">التحصيل الآجل</Link>
          {allowed(user, 'wallets.cash') && <Link className="secondary" to="/wallet-reconciliation">مطابقة الدرج والمحافظ</Link>}
        </div>
      </>}
    </section>
    <DataModule key={revision + ':' + selectedId} config={config} user={user} onChange={() => setBalanceVersion(value => value + 1)}
      renderAction={props => props.action.sharedDrawer ? <SharedDrawerDialog {...props} user={user} /> : <ActionDialog {...props} />} />
    {selectedAction && chosen && <SharedDrawerDialog user={user} action={selectedAction} row={chosen}
      close={() => setSelectedAction(undefined)} done={() => {
        setSelectedAction(undefined)
        setSuccess(true)
        setRevision(value => value + 1)
      }} />}
  </>
}

function DetailTable({ title, rows, columns }: { title: string; rows?: Row[]; columns: Column[] }) {
  return <section className="panel panel-inner form-section section-space">
    <h2>{title}</h2>
    {rows?.length ? <div className="table-scroll" tabIndex={0} role="region" aria-label={title}>
      <table>
        <thead><tr>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={idOf(row)}>
          {columns.map(column => <td key={column.key}>{column.render ? column.render(row) : dataText(row[column.key])}</td>)}
        </tr>)}</tbody>
      </table>
    </div> : <p className="muted">لا توجد سجلات.</p>}
  </section>
}

function useDetail<T>(path: string, revision = 0) {
  const [result, setResult] = useState<T>()
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    setResult(undefined)
    request<T>(path, { signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setResult(response.data) })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [path, revision])
  return { result, error }
}

export function SupplierDetail({ user }: { user: User }) {
  const { id } = useParams()
  const [revision, setRevision] = useState(0)
  const [showPayment, setShowPayment] = useState(false)
  const { result, error } = useDetail<Row & { purchases: Row[]; payments: Row[] }>('/suppliers/' + encodeURIComponent(id || ''), revision)
  return <>
    <Link className="secondary section-space" to="/suppliers">الموردون</Link>
    <PageTitle title={result ? String(result.name) : 'حساب المورد'} action={
      result && allowed(user, 'suppliers.pay') && Number(result.balance_minor) > 0 &&
      <button className="primary" onClick={() => setShowPayment(true)}>سداد على حساب المورد</button>
    } />
    {error ? <Notice error>{error}</Notice> : !result ? <Notice>جارٍ تحميل حساب المورد…</Notice> : <>
      <section className="panel panel-inner form-section section-space">
        <dl className="invoice-summary">
          <div><dt>الهاتف</dt><dd>{dataText(result.phone)}</dd></div>
          <div><dt>البريد الإلكتروني</dt><dd>{dataText(result.email)}</dd></div>
          <div><dt>الرصيد الافتتاحي</dt><dd>{money(result.opening_minor)}</dd></div>
          <div><dt>المستحق</dt><dd>{money(result.balance_minor)}</dd></div>
        </dl>
      </section>
      <DetailTable title="أحدث المشتريات" rows={result.purchases} columns={[
        { key: 'description', label: 'الوصف' }, dateColumn('purchase_date', 'التاريخ'),
        moneyColumn('total_minor', 'قيمة الشراء'), moneyColumn('paid_minor', 'المدفوع'),
      ]} />
      <DetailTable title="أحدث دفعات حساب المورد" rows={result.payments} columns={[
        { key: 'legacy_receipt_number', label: 'مرجع السند الأصلي' },
        dateColumn('payment_date', 'التاريخ'), moneyColumn('amount_minor', 'الدفعة'),
        moneyColumn('opening_applied_minor', 'المخصص للرصيد الافتتاحي'), { key: 'note', label: 'البيان' },
      ]} />
    </>}
    {showPayment && result && <RetailActionDialog user={user} action={supplierPayment} row={result}
      close={() => setShowPayment(false)} done={() => { setShowPayment(false); setRevision(value => value + 1) }} />}
  </>
}

export function DamageDetail() {
  const { id } = useParams()
  const { result, error } = useDetail<Row & { corrections: Row[] }>('/damaged/' + encodeURIComponent(id || ''))
  return <>
    <Link className="secondary section-space" to="/damaged">الهالك</Link>
    <PageTitle title={'قيد الهالك ' + (id || '')} />
    {error ? <Notice error>{error}</Notice> : !result ? <Notice>جارٍ تحميل القيد…</Notice> : <>
      <section className="panel panel-inner form-section section-space">
        <dl className="invoice-summary">
          <div><dt>المنتج</dt><dd>{dataText(result.product_name)}</dd></div>
          <div><dt>الكمية</dt><dd>{dataText(result.quantity)}</dd></div>
          {'unit_value_minor' in result && <div><dt>قيمة الوحدة</dt><dd>{money(result.unit_value_minor)}</dd></div>}
          {'verified_inventory_loss_minor' in result && <div><dt>تكلفة الهالك المثبتة</dt><dd>{result.verified_inventory_loss_minor == null ? 'غير مثبتة' : money(result.verified_inventory_loss_minor)}</dd></div>}
          {result.legacy_stock_before != null && <div><dt>الرصيد وقت تسجيل الهالك</dt>
            <dd>{dataText(result.legacy_stock_before)} ← {dataText(result.legacy_stock_after)}</dd></div>}
          <div><dt>تاريخ الهالك</dt><dd>{formatDate(result.damaged_on)}</dd></div>
          <div><dt>السبب</dt><dd>{dataText(result.reason)}</dd></div>
          <div><dt>الملاحظات</dt><dd>{dataText(result.notes)}</dd></div>
        </dl>
        {Boolean(result.reversed_by) && <Notice>عُكس القيد. {dataText(result.reversal_reason)}</Notice>}
      </section>
      <DetailTable title="التصحيحات المرتبطة" rows={result.corrections} columns={[
        { key: 'id', label: 'رقم التصحيح' }, dateColumn('created_at', 'تاريخ التسجيل'),
        countColumn('previous_quantity', 'الكمية السابقة'), countColumn('quantity', 'الكمية الجديدة'),
        ...('unit_value_minor' in result ? [moneyColumn('unit_value_minor', 'قيمة الوحدة')] : []), { key: 'reason', label: 'السبب' },
      ]} />
    </>}
  </>
}

const ledgerKinds: Record<string, string> = {
  invoice: 'فاتورة', installment: 'قسط', personal_debt: 'دين شخصي',
  wallet_debt: 'مبلغ محفظة آجل', maintenance: 'طلب صيانة',
}
const ledgerStatus: Record<string, string> = {
  open: 'مستحق', paid: 'مسدد', refunded: 'مسترجع', void: 'ملغى', voided: 'ملغى',
  received: 'مستلم', in_progress: 'قيد الصيانة', completed: 'تم الإصلاح', delivered: 'تم التسليم', cancelled: 'ملغى',
}
const ledgerBalances: [string, string][] = [
  ['invoices_due_minor', 'الفواتير المباشرة'], ['installments_due_minor', 'الأقساط'],
  ['personal_receivables_minor', 'ديون شخصية للمتجر'], ['personal_payables_minor', 'ديون شخصية على المتجر'],
  ['wallet_receivables_minor', 'مستحقات المحافظ'], ['wallet_payables_minor', 'التزامات المحافظ'],
  ['maintenance_due_minor', 'مستحقات الصيانة'],
]

export function CustomerLedger() {
  const { id } = useParams()
  const [page, setPage] = useState(1)
  const [last, setLast] = useState(1)
  const [ledger, setLedger] = useState<{ customer: Row; balances: Row; entries: Row[] }>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    request<{ customer: Row; balances: Row; entries: Row[] }>('/customers/' + encodeURIComponent(id || '') + '/ledger?page=' + page,
      { signal: controller.signal })
      .then(result => {
        if (!controller.signal.aborted) {
          setLedger(result.data)
          setLast(result.meta ? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)) : 1)
        }
      })
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id, page])

  return <>
    <Link className="secondary section-space" to="/customers">العملاء</Link>
    <PageTitle title={ledger ? 'دفتر العميل · ' + String(ledger.customer.name) : 'دفتر العميل'} />
    {error && <Notice error>{error}</Notice>}
    {loading && <Notice>جارٍ تحميل السجلات…</Notice>}
    {ledger && <>
      <div className="metric-grid section-space">
        {ledgerBalances.filter(([key]) => key in ledger.balances).map(([key, label]) => (
          <article className="panel metric" key={key}><p>{label}</p><strong>{money(ledger.balances[key])}</strong></article>
        ))}
      </div>
      {!loading && !error && <DetailTable title="سجل حساب العميل" rows={ledger.entries.map(row => ({
        ...row, id: String(row.kind) + '-' + String(row.record_id),
      }))} columns={[
        { key: 'kind', label: 'النوع', render: row => ledgerKinds[String(row.kind)] || dataText(row.kind) },
        { key: 'record_id', label: 'رقم السجل', render: row => row.kind === 'invoice'
          ? <Link to={'/invoices/' + row.record_id}>{dataText(row.record_id)}</Link> : dataText(row.record_id) },
        moneyColumn('amount_minor', 'المبلغ'), moneyColumn('paid_minor', 'المدفوع'),
        moneyColumn('remaining_minor', 'المتبقي'),
        { key: 'status', label: 'الحالة', render: row => ledgerStatus[String(row.status)] || dataText(row.status) },
        dateColumn('due_date', 'الاستحقاق'),
      ]} />}
      {last > 1 && <nav className="pagination" aria-label="صفحات دفتر العميل">
        <button className="secondary" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>السابق</button>
        <span>{page} / {last}</span>
        <button className="secondary" disabled={loading || page >= last} onClick={() => setPage(value => value + 1)}>التالي</button>
      </nav>}
    </>}
  </>
}

export function PurchaseReceipts({ user }: { user: User }) {
  const { id } = useParams()
  const endpoint = '/purchases/' + encodeURIComponent(id || '') + '/receipts'
  const canManage = allowed(user, 'suppliers.manage') && allowed(user, 'inventory.manage')
  const [receiving, setReceiving] = useState(false)
  const [revision, refresh] = useState(0)
  const config: ModuleConfig = {
    title: 'استلام أصناف الشراء',
    description: 'تضيف كل دفعة استلام كميات الأصناف إلى المخزون مع تسجيل مرجع الحركة.',
    endpoint, permission: 'suppliers.view', searchable: false,
    columns: [
      { key: 'reference', label: 'مرجع الاستلام' },
      dateColumn('received_on', 'تاريخ الاستلام'),
      { key: 'items', label: 'الأصناف', render: row => Array.isArray(row.items)
        ? <ul>{row.items.map(item => <li key={item.product_id}>{String(item.name ?? item.product_name ?? item.product_id)} × {item.quantity}
          {Array.isArray(item.devices) && item.devices.length > 0 && <small> · {item.devices.map(deviceLabel).join('، ')}</small>}</li>)}</ul> : '—' },
      { key: 'note', label: 'الملاحظات' },
      { key: 'reversed_by', label: 'الحالة', render: row => row.reversed_by || row.reversed_at ? 'معكوس' : 'مستلم' },
    ],
    actions: canManage ? [{
      label: 'عكس الاستلام', danger: true, financial: true,
      visible: row => !row.reversed_by && !row.reversed_at,
      endpoint: row => endpoint + '/' + idOf(row) + '/reverse',
      confirmation: 'تُخصم كميات هذا الاستلام من المخزون عند نجاح العملية.',
      fields: [required('reason', 'سبب العكس', 'textarea')],
    }] : undefined,
  }
  return <>
    <div className="form-actions section-space"><Link className="secondary" to="/purchases">المشتريات</Link>
      {canManage && <button className="primary" onClick={() => setReceiving(true)}>تسجيل استلام</button>}</div>
    <RetailPurchaseSummary purchaseId={Number(id)} revision={revision} canReturn={canManage} onSaved={() => refresh(value => value + 1)} />
    <DataModule key={revision} config={config} user={user} onChange={() => refresh(value => value + 1)} />
    {receiving && <RetailReceipt endpoint={endpoint} close={() => setReceiving(false)} done={() => { setReceiving(false); refresh(value => value + 1) }} />}
  </>
}
