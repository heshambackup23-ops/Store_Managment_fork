import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { allowed, formatDate, money, request } from './api'
import type { User } from './api'
import { visibleDestination, walletDestinations } from './navigation'
import { walletManagementTitle } from './wallet-providers'
import { idOf, Notice, PageTitle } from './ui'
import type { Row } from './ui'
import './wallet-workspace.css'

export function ReturnLookup({ user }: { user: User }) {
  const [query, setQuery] = useState('')
  const [invoices, setInvoices] = useState<Row[]>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const active = useRef<AbortController>(null)
  useEffect(() => { input.current?.focus(); return () => active.current?.abort() }, [])

  async function search(event: FormEvent) {
    event.preventDefault()
    const value = query.trim().replace(/[٠-٩۰-۹]/g, digit => String('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(digit) % 10))
    if (!value) return
    active.current?.abort()
    const controller = new AbortController()
    active.current = controller
    setError('')
    setInvoices(undefined)
    setBusy(true)
    try {
      const result = await request<Row[]>('/invoices?per_page=20&q=' + encodeURIComponent(value), { signal: controller.signal })
      if (!controller.signal.aborted) setInvoices(result.data)
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'تعذر البحث عن الفاتورة.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <>
    <PageTitle title="بحث عن فاتورة للمرتجع" action={<Link className="secondary" to="/invoices">سجل الفواتير</Link>} />
    <form className="panel form-card" onSubmit={search} role="search">
      <label className="field">رقم الفاتورة أو اسم العميل
        <input ref={input} required value={query} maxLength={100} onChange={event => setQuery(event.target.value)} />
      </label>
      <button className="primary" type="submit" disabled={busy}>{busy ? 'جارٍ البحث…' : 'ابحث عن الفاتورة'}</button>
      {allowed(user, 'inventory.view') && <Link to="/retail-devices">البحث عن جهاز بالرقم التسلسلي أو IMEI</Link>}
    </form>
    {error && <Notice error>{error}</Notice>}
    {invoices && (invoices.length ? <ul className="workspace-cards section-space">
      {invoices.map(invoice => <li key={idOf(invoice)} className="panel workspace-card">
        <strong>فاتورة <bdi>#{idOf(invoice)}</bdi></strong>
        <span>{String(invoice.customer_name || 'بيع مباشر')} · {formatDate(invoice.invoice_date ?? invoice.created_at)}</span>
        <span>{money(invoice.net_total_minor ?? invoice.total_minor)}</span>
        <Link className="secondary" to={'/invoices/' + idOf(invoice) + '#retail-return'}>عرض الفاتورة والمرتجع</Link>
      </li>)}
    </ul> : <Notice>لم تظهر فاتورة مطابقة. راجع الرقم أو ابحث باسم العميل.</Notice>)}
  </>
}

export function WalletWorkspace({ user }: { user: User }) {
  const canViewWallets = allowed(user, 'wallets.view')
  const canTransact = allowed(user, 'wallets.transact')
  const canSell = allowed(user, 'invoices.create') && allowed(user, 'retail.shifts.operate')
  const canMatchBank = allowed(user, 'reports.view') && allowed(user, 'retail.shifts.approve')
  const providers = [
    { id: 'vodafone_cash', title: 'فودافون كاش', description: 'سجّل الإيداع والسحب بمرجع المزود، وراجع الرصيد والرسوم والعمولة.' },
    { id: 'fawry', title: 'فوري', description: 'سجّل حركة رصيد حساب التاجر بعد تنفيذها على فوري، واحتفظ بمرجع الحركة.' },
  ]
  return <>
    <PageTitle title={walletManagementTitle}
      description="الحركات اليومية وأرصدة المزودين والتحويلات البنكية ومطابقتها." />
    <section aria-label="قنوات المحافظ والتحويلات" className="wallet-provider-grid section-space">
      {canViewWallets && providers.map(provider => <article key={provider.id} className="panel panel-inner wallet-channel">
        <header><h2>{provider.title}</h2><span className="status-pill">{provider.id === 'fawry' ? 'حساب تاجر' : 'محفظة'}</span></header>
        <p className="muted">{provider.description}</p>
        <div className="form-actions">
          {canTransact && <Link className="primary" to={'/wallet-cashier?provider=' + provider.id}>سجّل حركة {provider.title}</Link>}
          <Link className="secondary" to={'/wallets?provider=' + provider.id}>الحسابات</Link>
          <Link className="secondary" to={'/wallet-transactions?provider=' + provider.id}>سجل الحركات</Link>
        </div>
      </article>)}
      {(canSell || canMatchBank || canViewWallets) && <article className="panel panel-inner wallet-channel">
        <header><h2>إنستا باي</h2><span className="status-pill">تحويل بنكي</span></header>
        <p className="muted">سجّل تحصيل البيع بمرجع التحويل، وطابق العملية مع كشف البنك.</p>
        <div className="form-actions">
          {canSell && <Link className="primary" to="/pos?channel=instapay">سجّل تحصيل بيع عبر إنستا باي</Link>}
          {canMatchBank && <Link className="secondary" to="/retail-finance?view=settlement&method=bank_transfer&channel=instapay">مطابقة تحويلات إنستا باي</Link>}
          {canViewWallets && <Link className="secondary" to="/wallets?provider=instapay">حسابات إنستا باي السابقة</Link>}
        </div>
      </article>}
    </section>
    <nav aria-label="أعمال المحافظ" className="workspace-cards">
      {walletDestinations.filter(item => visibleDestination(user, item)).map(item =>
        <Link className="panel workspace-card" key={item.path} to={item.path}>
          <strong>{item.label}</strong><span>{item.detail}</span>
        </Link>)}
    </nav>
  </>
}
