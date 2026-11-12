import { StrictMode, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { allowed, apiUrl, RequestError, request } from './api'
import type { User } from './api'
import { businessModules, CommerceModule, InvoiceDetail, Pos, SalesReport, WalletReport } from './commerce'
import { coreModules, Dashboard, Notifications, Products, Profile, Roles, Settings, Staff } from './core'
import { DataModule, Notice, PageTitle } from './ui'
import './styles.css'

type Theme = 'light' | 'dark'
type NavigationItem = { path: string; label: string; permission?: string }
const navGroups: { title: string; items: NavigationItem[] }[] = [
  { title: 'نظرة عامة', items: [
    { path: '/dashboard', label: 'لوحة التحكم' },
    { path: '/notifications', label: 'الإشعارات' },
  ] },
  { title: 'المبيعات والمخزون', items: [
    { path: '/pos', label: 'نقطة البيع', permission: 'invoices.create' },
    { path: '/invoices', label: 'الفواتير', permission: 'invoices.view' },
    { path: '/products', label: 'المنتجات', permission: 'products.view' },
    { path: '/categories', label: 'التصنيفات', permission: 'categories.view' },
    { path: '/inventory', label: 'حركات المخزون', permission: 'inventory.view' },
    { path: '/damaged', label: 'الهالك', permission: 'damaged.view' },
    { path: '/reports', label: 'تقارير المبيعات', permission: 'reports.view' },
  ] },
  { title: 'الحسابات والخدمات', items: [
    { path: '/customers', label: 'العملاء', permission: 'customers.view' },
    { path: '/installments', label: 'الأقساط', permission: 'installments.view' },
    { path: '/debts', label: 'الديون الشخصية', permission: 'debts.view' },
    { path: '/suppliers', label: 'الموردون', permission: 'suppliers.view' },
    { path: '/purchases', label: 'المشتريات', permission: 'suppliers.view' },
    { path: '/supplier-report', label: 'أرصدة الموردين', permission: 'suppliers.view' },
    { path: '/wallets', label: 'المحافظ', permission: 'wallets.view' },
    { path: '/wallet-transactions', label: 'حركات المحافظ', permission: 'wallets.view' },
    { path: '/wallet-debts', label: 'ديون المحافظ', permission: 'wallets.view' },
    { path: '/wallet-cash', label: 'حركات نقدية المحافظ', permission: 'wallets.cash' },
    { path: '/wallet-report', label: 'تقرير المحافظ', permission: 'wallets.cash' },
    { path: '/maintenance', label: 'الصيانة', permission: 'maintenance.view' },
  ] },
  { title: 'إدارة النظام', items: [
    { path: '/staff', label: 'الموظفون', permission: 'staff.view' },
    { path: '/roles', label: 'الأدوار والصلاحيات', permission: 'roles.view' },
    { path: '/settings', label: 'الإعدادات', permission: 'settings.view' },
    { path: '/backup', label: 'تصدير البيانات', permission: 'backup.export' },
    { path: '/profile', label: 'الملف الشخصي' },
  ] },
]

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const values = new FormData(event.currentTarget)
      const result = await request<{ user: User }>('/auth/login', {
        method: 'POST', body: { email: String(values.get('email')).trim(), password: values.get('password') },
      })
      onLogin(result.data.user)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذر تسجيل الدخول.') }
    finally { setBusy(false) }
  }

  return (
    <main className="login-screen">
      <section className="login-brand" aria-label="هينرا">
        <span className="brand-mark" aria-hidden="true">H</span>
        <h1>هينرا لإدارة المتجر</h1>
        <p>المبيعات والمخزون وحسابات المتجر.</p>
      </section>
      <section className="login-content">
        <ThemeButton theme={theme} toggle={toggle} />
        <form className="login-form panel" onSubmit={submit}>
          <h2>تسجيل الدخول</h2>
          <label className="field">البريد الإلكتروني
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label className="field">كلمة المرور
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
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
      link.download = 'henra-catalog.csv'
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const location = useLocation()
  const sidebar = useRef<HTMLElement>(null)
  const menu = useRef<HTMLButtonElement>(null)
  const groups = navGroups.map(group => ({ ...group, items: group.items.filter(item => allowed(user, item.permission)) })).filter(group => group.items.length > 0)
  const home = '/dashboard'
  const protect = (permission: string, element: ReactNode) => allowed(user, permission) ? element : <Notice error>ليست لديك صلاحية عرض هذه الصفحة.</Notice>

  useEffect(() => { setDrawer(false) }, [location.pathname])
  useEffect(() => {
    if (!drawer) return
    sidebar.current?.querySelector('a')?.focus()
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setDrawer(false)
      menu.current?.focus()
    }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [drawer])

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
    <div className="shell">
      <a className="primary skip-link" href="#main-content">انتقل إلى المحتوى</a>
      {drawer && <button className="overlay" tabIndex={-1} type="button" aria-label="إغلاق القائمة"
        onClick={() => { setDrawer(false); menu.current?.focus() }} />}
      <aside className={'sidebar' + (drawer ? ' open' : '')} id="sidebar" ref={sidebar}>
        <Link className="brand" to={home} onClick={() => setDrawer(false)}>
          <span className="brand-mark" aria-hidden="true">H</span><span><strong>هينرا</strong><small>إدارة المتجر</small></span>
        </Link>
        <nav aria-label="القائمة الرئيسية" className="navigation">
          {groups.map(group => <section className="nav-group" key={group.title}>
            <h2>{group.title}</h2>
            {group.items.map(item => <NavLink key={item.path} className="nav-link" to={item.path} onClick={() => setDrawer(false)}>{item.label}</NavLink>)}
          </section>)}
        </nav>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-start">
            <button ref={menu} className="icon-button mobile-toggle" type="button" aria-label="قائمة المتجر" aria-controls="sidebar"
              aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>☰</button>
            <span>إدارة المتجر</span>
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
        <main className="main" id="main-content" tabIndex={-1}>
          {error && <Notice error>{error}</Notice>}
          <Routes>
            <Route path="/" element={<Navigate to={home} replace />} />
            <Route path="/dashboard" element={<Dashboard user={user} />} />
            <Route path="/products" element={<Products user={user} />} />
            {Object.entries(coreModules).filter(([name]) => !['products', 'staff', 'notifications'].includes(name)).map(([name, config]) => (
              <Route key={name} path={'/' + name} element={<DataModule key={name} user={user} config={config} />} />
            ))}
            {Object.keys(businessModules).map(name => <Route key={name} path={'/' + name} element={<CommerceModule name={name} user={user} />} />)}
            <Route path="/pos" element={<Pos key="sale" user={user} />} />
            <Route path="/pos/reissue/:invoiceId" element={<Pos key="reissue" user={user} />} />
            <Route path="/invoices/:id" element={protect('invoices.view', <InvoiceDetail user={user} />)} />
            <Route path="/reports" element={protect('reports.view', <SalesReport />)} />
            <Route path="/wallet-report" element={protect('wallets.cash', <WalletReport />)} />
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
