import { StrictMode, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { allowed, apiUrl, RequestError, request } from './api'
import type { User } from './api'
import { businessModules, CommerceModule, DamageReport, InvoiceDetail, Pos, SalesReport, WalletReport } from './commerce'
import { coreModules, Dashboard, Notifications, Products, Profile, Roles, Settings, Staff } from './core'
import { CustomerLedger, DamageDetail, PurchaseReceipts, SupplierDetail, WalletCashier } from './detail'
import { WalletReconciliation } from './WalletReconciliation'
import { RetailShifts, useOpenShift } from './RetailShifts'
import { RetailSafe } from './RetailSafe'
import { RetailHardware } from './RetailHardware'
import { DeviceDetail, DeviceList } from './RetailDevices'
import { RetailStocktakes } from './RetailStocktakes'
import { RetailFinance } from './RetailFinance'
import { RetailDiscounts } from './RetailDiscounts'
import { RetailBranches } from './RetailBranches'
import { RetailUsedPhones } from './RetailUsedPhones'
import { RetailInstallations } from './RetailInstallations'
import { RetailLedger } from './RetailLedger'
import { DataModule, idOf, Notice, PageTitle } from './ui'
import { WalletLedger } from './WalletOperations'
import { currentSection, navigationFor } from './navigation'
import { ReturnLookup, WalletWorkspace } from './Workspaces'
import './styles.css'
import './workspace.css'

type Theme = 'light' | 'dark'
function startTheme(): Theme {
  try {
    const stored = localStorage.getItem('henra-theme')
    if (stored === 'dark' || stored === 'light') return stored
  } catch { /* Follow the system theme when storage is restricted. */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function ThemeButton({ theme, toggle }: { theme: Theme; toggle: () => void }) {
  const label = theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'
  return <button className="icon-button" type="button" onClick={toggle} aria-label={label} title={label}>
    <span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span>
  </button>
}

function Login({ onLogin, theme, toggle, startupError }: {
  onLogin: (user: User) => void; theme: Theme; toggle: () => void; startupError: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(startupError)
  const [showPassword, setShowPassword] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const values = new FormData(event.currentTarget)
      const identifier = String(values.get('identifier')).trim()
      const result = await request<{ user: User }>('/auth/login', {
        method: 'POST',
        body: { [identifier.includes('@') ? 'email' : 'username']: identifier, password: values.get('password') },
      })
      onLogin(result.data.user)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تسجيل الدخول.') }
    finally { setBusy(false) }
  }

  return (
    <main className="login-screen">
      <section className="login-brand" aria-label="هلال">
        <span className="brand-mark" aria-hidden="true">ه</span>
        <h1>هلال لإدارة المتجر</h1>
        <p>المبيعات والمخزون وحسابات المتجر.</p>
      </section>
      <section className="login-content">
        <ThemeButton theme={theme} toggle={toggle} />
        <form className="login-form panel" onSubmit={submit}>
          <h2>تسجيل الدخول</h2>
          <label className="field">اسم المستخدم أو البريد الإلكتروني
            <input name="identifier" type="text" dir="ltr" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
          </label>
          <div className="password-field">
            <label className="field">كلمة المرور أو مفتاح الدخول
              <input name="password" type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="current-password" required />
            </label>
            <button className="secondary" type="button" onClick={() => setShowPassword(value => !value)}
              aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>{showPassword ? 'إخفاء' : 'إظهار'}</button>
          </div>
          {error && <Notice error>{error}</Notice>}
          <button className="primary" disabled={busy}>{busy ? 'جارٍ تسجيل الدخول…' : 'دخول'}</button>
        </form>
      </section>
    </main>
  )
}

function Backup() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(apiUrl('/backup/catalog.csv'), { credentials: 'include', headers: { Accept: 'text/csv' } })
      if (response.status === 422) throw new Error('تجاوز الكتالوج الحد المتاح للتصدير من المتصفح. استخدم إجراءات النسخ الاحتياطي الإدارية.')
      if (response.status === 401) window.dispatchEvent(new Event('henra-session-expired'))
      if (response.status === 403) throw new Error('ليست لديك صلاحية تصدير الكتالوج.')
      if (!response.ok || !response.headers.get('Content-Type')?.includes('text/csv')) throw new Error('تعذر تنزيل ملف الكتالوج.')
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = 'hilal-catalog.csv'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر الاتصال بالخادم.') }
    finally { setBusy(false) }
  }

  return <>
    <PageTitle title="تصدير البيانات" description="تنزيل كتالوج المنتجات بصيغة CSV." />
    <section className="panel form-card">
      <h2>كتالوج المنتجات</h2>
      <p className="muted">يدعم التصدير حتى ٥٠٠ سجل. النسخ الاحتياطي الكامل والاستعادة متاحان عبر أدوات إدارة قاعدة البيانات.</p>
      {error && <Notice error>{error}</Notice>}
      <div className="form-actions">
        <button className="primary" onClick={() => void download()} disabled={busy}>{busy ? 'جارٍ التنزيل…' : 'تنزيل الكتالوج'}</button>
      </div>
    </section>
  </>
}

function Shell({ user, update, clear, theme, toggle }: {
  user: User; update: (user: User) => void; clear: () => void; theme: Theme; toggle: () => void
}) {
  const [drawer, setDrawer] = useState(false)
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 820px)').matches)
  const [expanded, setExpanded] = useState<string>()
  const [compact, setCompact] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const location = useLocation()
  const sidebar = useRef<HTMLElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const groups = navigationFor(user)
  const active = currentSection(location.pathname, groups)
  const openSection = expanded ?? active?.id ?? 'today'
  const shift = useOpenShift(user, location.key)
  const home = '/dashboard'
  const protect = (permission: string, element: ReactNode) => allowed(user, permission) ? element : <Notice error>ليست لديك صلاحية عرض هذه الصفحة.</Notice>

  useEffect(() => { setDrawer(false); setExpanded(undefined) }, [location.pathname])
  useEffect(() => {
    const query = matchMedia('(max-width: 820px)')
    const change = () => { setMobile(query.matches); if (!query.matches) setDrawer(false) }
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (!drawer || !mobile) return
    sidebar.current?.querySelector('a')?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrawer(false)
      requestAnimationFrame(() => menu.current?.focus())
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [drawer, mobile])

  function finishNavigation(path: string) {
    setDrawer(false)
    if (path === location.pathname) document.getElementById('main-content')?.focus()
    else if (mobile) requestAnimationFrame(() => document.getElementById('main-content')?.focus({ preventScroll: true }))
  }

  async function logout() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await request('/auth/logout', { method: 'POST' })
      clear()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تسجيل الخروج.') }
    finally { setBusy(false) }
  }

  return (
    <div className={'shell' + (compact ? ' shell-compact' : '')}>
      <a className="primary skip-link" href="#main-content" inert={mobile && drawer}>انتقل إلى المحتوى</a>
      {drawer && <button className="overlay" tabIndex={-1} type="button" aria-label="إغلاق القائمة"
        onClick={() => { setDrawer(false); requestAnimationFrame(() => menu.current?.focus()) }} />}
      <aside className={'sidebar' + (drawer ? ' open' : '')} id="sidebar" ref={sidebar}
        role={mobile && drawer ? 'dialog' : undefined} aria-modal={mobile && drawer ? true : undefined} aria-label="قائمة المتجر"
        inert={mobile && !drawer}>
        <Link className="brand" to={home} onClick={() => finishNavigation(home)}>
          <span className="brand-mark" aria-hidden="true">ه</span><span><strong>هلال</strong><small>إدارة المتجر</small></span>
        </Link>
        <button className="sidebar-close" type="button" onClick={() => { setDrawer(false); requestAnimationFrame(() => menu.current?.focus()) }}>إغلاق القائمة</button>
        <nav aria-label="القائمة الرئيسية" className="navigation">
          {groups.map(group => <section className="nav-group" key={group.id}>
            <h2><button className={'nav-section' + (active?.id === group.id ? ' current' : '')} type="button"
              aria-controls={'nav-' + group.id} aria-expanded={openSection === group.id}
              onClick={() => { setCompact(false); setExpanded(openSection === group.id ? '' : group.id) }}>
              <span>{group.title}</span><span aria-hidden="true">{openSection === group.id ? '−' : '+'}</span>
            </button></h2>
            <div id={'nav-' + group.id} hidden={openSection !== group.id}>
              {group.items.map(item => <NavLink key={item.path} className="nav-link" to={item.path}
                onClick={() => finishNavigation(item.path)}>{item.label}</NavLink>)}
            </div>
          </section>)}
        </nav>
      </aside>
      <div className="workspace" inert={mobile && drawer}>
        <header className="topbar">
          <div className="topbar-start">
            <button ref={menu} className="icon-button mobile-toggle" type="button" aria-label="قائمة المتجر" aria-controls="sidebar"
              aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>☰</button>
            <button className="secondary desktop-nav-toggle" type="button" aria-controls="sidebar" aria-expanded={!compact}
              onClick={() => setCompact(value => !value)}>{compact ? 'عرض القائمة' : 'طي القائمة'}</button>
            <span className="current-section">{active?.title || 'إدارة المتجر'}</span>
          </div>
          <div className="topbar-end">
            <Link className="identity" to="/profile" aria-label={'الملف الشخصي · ' + user.name}>
              <span className="avatar" aria-hidden="true">{user.name.trim().slice(0, 1).toUpperCase()}</span>
              <strong>{user.name}</strong>
            </Link>
            <ThemeButton theme={theme} toggle={toggle} />
            <button className="secondary" disabled={busy} onClick={() => void logout()}>خروج</button>
          </div>
        </header>
        {shift.canOperate && <div className="work-context" aria-label="الفرع والوردية">
          {shift.shift ? <>
            <span>الفرع <strong>{shift.shift.branch_name ?? '—'}</strong></span>
            <span>الدرج <strong>{shift.shift.register_name}</strong></span>
            <Link className="shift-indicator" to="/retail-shifts">وردية مفتوحة</Link>
          </> : shift.loading ? <span role="status">جارٍ التحقق من الوردية…</span>
            : <Link className="shift-indicator" to="/retail-shifts">{shift.error ? 'تحقق من الوردية' : 'افتح وردية'}</Link>}
        </div>}
        <main className="main" id="main-content" tabIndex={-1}>
          {error && <Notice error>{error}</Notice>}
          <Routes>
            <Route path="/" element={<Navigate to={home} replace />} />
            <Route path="/dashboard" element={<Dashboard user={user} />} />
            <Route path="/products" element={<Products user={user} />} />
            {Object.entries(coreModules).filter(([name]) => !['products', 'staff', 'notifications'].includes(name)).map(([name, config]) => (
              <Route key={name} path={'/' + name} element={<DataModule key={name} user={user} config={config} rowActions={name === 'customers' ? row =>
                <Link className="link-button" to={'/customers/' + idOf(row) + '/ledger'}>دفتر العميل</Link> : undefined} />} />
            ))}
            {Object.keys(businessModules).filter(name => name !== 'wallet-transactions').map(name =>
              <Route key={name} path={'/' + name} element={<CommerceModule name={name} user={user} />} />)}
            <Route path="/wallet-transactions" element={protect('wallets.view', <WalletLedger user={user} config={businessModules['wallet-transactions']} />)} />
            <Route path="/pos" element={<Pos key="sale" user={user} />} />
            <Route path="/returns" element={protect('invoices.view', protect('invoices.refund', <ReturnLookup user={user} />))} />
            <Route path="/retail-hardware" element={protect('invoices.create', <RetailHardware />)} />
            <Route path="/retail-shifts" element={['retail.shifts.operate', 'retail.shifts.approve', 'retail.shifts.emergency_close'].some(permission => allowed(user, permission)) ? <RetailShifts user={user} /> : <Notice error>ليست لديك صلاحية عرض الورديات.</Notice>} />
            <Route path="/retail-discounts" element={allowed(user, 'invoices.discount') || allowed(user, 'retail.discounts.approve') ? <RetailDiscounts user={user} /> : <Notice error>ليست لديك صلاحية عرض الاعتمادات.</Notice>} />
            <Route path="/retail-safe" element={allowed(user, 'retail.safe.manage') || allowed(user, 'retail.shifts.approve') ? <RetailSafe user={user} /> : <Notice error>ليست لديك صلاحية عرض الخزنة.</Notice>} />
            <Route path="/retail-devices" element={protect('inventory.view', <DeviceList />)} />
            <Route path="/retail-branches" element={['inventory.view', 'retail.branches.manage', 'retail.branches.transfer'].some(permission => allowed(user, permission)) ? <RetailBranches user={user} /> : <Notice error>ليست لديك صلاحية عرض مخزون الفروع.</Notice>} />
            <Route path="/retail-used-phones" element={protect('inventory.view', <RetailUsedPhones user={user} />)} />
            <Route path="/retail-installations" element={protect('retail.installations.view', <RetailInstallations user={user} />)} />
            <Route path="/retail-stocktakes" element={allowed(user, 'inventory.stocktake.count') || allowed(user, 'inventory.stocktake.approve') ? <RetailStocktakes user={user} /> : <Notice error>ليست لديك صلاحية عرض الجرد.</Notice>} />
            <Route path="/retail-devices/:id" element={protect('inventory.view', <DeviceDetail user={user} />)} />
            <Route path="/pos/reissue/:invoiceId" element={<Pos key="reissue" user={user} />} />
            <Route path="/invoices/:id" element={protect('invoices.view', <InvoiceDetail user={user} />)} />
            <Route path="/reports" element={protect('reports.view', <SalesReport />)} />
            <Route path="/retail-finance" element={protect('reports.view', <RetailFinance user={user} />)} />
            <Route path="/retail-ledger" element={protect('retail.ledger.view', <RetailLedger user={user} />)} />
            <Route path="/wallet-report" element={protect('wallets.cash', <WalletReport user={user} />)} />
            <Route path="/wallet-workspace" element={['wallets.view', 'wallets.cash'].some(permission => allowed(user, permission)) ? <WalletWorkspace user={user} /> : <Notice error>ليست لديك صلاحية عرض المحافظ.</Notice>} />
            <Route path="/wallet-reconciliation" element={protect('wallets.cash', <WalletReconciliation />)} />
            <Route path="/wallet-cashier" element={protect('wallets.view', <WalletCashier user={user} />)} />
            <Route path="/customers/:id/ledger" element={protect('customers.view', <CustomerLedger key={location.pathname} />)} />
            <Route path="/suppliers/:id" element={protect('suppliers.view', <SupplierDetail user={user} />)} />
            <Route path="/purchases/:id/receipts" element={protect('suppliers.view', <PurchaseReceipts user={user} />)} />
            <Route path="/damaged/:id" element={protect('damaged.view', <DamageDetail />)} />
            <Route path="/damage-report" element={protect('damaged.view', <DamageReport />)} />
            <Route path="/staff" element={<Staff user={user} />} />
            <Route path="/notifications" element={<Notifications user={user} />} />
            <Route path="/roles" element={<Roles user={user} />} />
            <Route path="/settings" element={<Settings user={user} />} />
            <Route path="/profile" element={<Profile user={user} update={update} />} />
            <Route path="/backup" element={protect('backup.export', <Backup />)} />
            <Route path="*" element={<><PageTitle title="الصفحة غير موجودة" /><Link className="secondary" to={home}>العودة إلى البداية</Link></>} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function App() {
  const [user, setUser] = useState<User | null>()
  const [startupError, setStartupError] = useState('')
  const [theme, setTheme] = useState<Theme>(startTheme)
  const toggle = () => setTheme(value => value === 'dark' ? 'light' : 'dark')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('henra-theme', theme) } catch { /* Theme is still applied for this page. */ }
  }, [theme])
  useEffect(() => {
    const controller = new AbortController()
    const expired = () => setUser(null)
    window.addEventListener('henra-session-expired', expired)
    request<User>('/auth/me', { signal: controller.signal }).then(result => setUser(result.data)).catch(error => {
      if (controller.signal.aborted) return
      if (!(error instanceof RequestError) || error.status !== 401) setStartupError(error.message)
      setUser(null)
    })
    return () => { controller.abort(); window.removeEventListener('henra-session-expired', expired) }
  }, [])

  if (user === undefined) return <main className="main"><Notice>جارٍ التحقق من الجلسة…</Notice></main>
  if (!user) return <Login startupError={startupError} theme={theme} toggle={toggle} onLogin={setUser} />
  return <Shell user={user} update={setUser} clear={() => setUser(null)} theme={theme} toggle={toggle} />
}

createRoot(document.getElementById('root')!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>)
