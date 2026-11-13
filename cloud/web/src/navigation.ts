import { allowed } from './api'
import type { User } from './api'
import { walletManagementTitle } from './wallet-providers'

type Destination = { path: string; label: string; permissions?: string[]; requireAll?: boolean }
type Section = { id: string; title: string; items: Destination[]; direct?: boolean }
const item = (path: string, label: string, ...permissions: string[]): Destination => ({ path, label, permissions })
export const walletWorkspace = item('/wallet-workspace', walletManagementTitle, 'wallets.view', 'wallets.cash')

const sections: Section[] = [
  { id: 'today', title: 'اليوم', items: [
    item('/dashboard', 'لوحة التحكم'), item('/notifications', 'الإشعارات'),
  ] },
  { id: 'sales', title: 'البيع', items: [
    item('/pos', 'نقطة البيع', 'invoices.create'),
    { ...item('/returns', 'بحث عن فاتورة للمرتجع', 'invoices.view', 'invoices.refund'), requireAll: true },
    item('/invoices', 'الفواتير', 'invoices.view'),
    item('/retail-shifts', 'ورديات الكاشير', 'retail.shifts.operate', 'retail.shifts.approve', 'retail.shifts.emergency_close'),
    item('/retail-discounts', 'اعتمادات الخصم', 'retail.discounts.approve', 'invoices.discount'),
    item('/retail-hardware', 'اختبار القارئ والطابعة', 'invoices.create'),
  ] },
  { id: 'wallets', title: walletWorkspace.label, items: [walletWorkspace], direct: true },
  { id: 'stock', title: 'المخزون', items: [
    item('/retail-branches', 'مخزون الفروع', 'inventory.view', 'retail.branches.manage', 'retail.branches.transfer'),
    item('/products', 'المنتجات', 'products.view'),
    item('/purchases', 'المشتريات والاستلام', 'suppliers.view'),
    item('/suppliers', 'الموردون', 'suppliers.view'),
    item('/retail-stocktakes', 'جرد المخزون', 'inventory.stocktake.count', 'inventory.stocktake.approve'),
    item('/inventory', 'حركات المخزون', 'inventory.view'),
    item('/retail-used-phones', 'الموبايلات المستعملة', 'inventory.view'),
    item('/categories', 'التصنيفات', 'categories.view'),
    item('/damaged', 'الهالك', 'damaged.view'),
  ] },
  { id: 'service', title: 'العملاء والخدمة', items: [
    item('/customers', 'العملاء', 'customers.view'),
    item('/retail-devices', 'الأجهزة المتتبعة', 'inventory.view'),
    item('/maintenance', 'الصيانة', 'maintenance.view'),
    item('/retail-installations', 'مواعيد التركيب', 'retail.installations.view'),
    item('/installments', 'الأقساط', 'installments.view'),
  ] },
  { id: 'accounts', title: 'الحسابات', items: [
    item('/retail-ledger', 'دفتر الأستاذ وإقفال الشهر', 'retail.ledger.view'),
    item('/retail-finance', 'تقارير مالية للمتجر', 'reports.view'),
    item('/reports', 'تقارير المبيعات', 'reports.view'),
    item('/retail-safe', 'خزنة المتجر', 'retail.safe.manage', 'retail.shifts.approve'),
    item('/supplier-report', 'أرصدة الموردين', 'suppliers.view'),
    item('/debts', 'الديون الشخصية', 'debts.view'),
  ] },
  { id: 'admin', title: 'الإدارة', items: [
    item('/staff', 'الموظفون', 'staff.view'), item('/roles', 'الأدوار والصلاحيات', 'roles.view'),
    item('/settings', 'الإعدادات', 'settings.view'), item('/backup', 'تصدير البيانات', 'backup.export'),
    item('/profile', 'الملف الشخصي'),
  ] },
]

export const walletDestinations = [
  { ...item('/wallet-cashier', 'الإيداع والسحب', 'wallets.view'), detail: 'تسجيل عملية العميل بعد تأكيدها لدى المزود.' },
  { ...item('/wallets', 'أرصدة المحافظ وحدودها', 'wallets.view'), detail: 'رصيد كل مزود وحدود الاستخدام.' },
  { ...item('/wallet-transactions', 'حركات المحافظ', 'wallets.view'), detail: 'المرجع والرسوم وحالة العملية.' },
  { ...item('/wallet-reconciliation', 'مطابقة الدرج والمحافظ', 'wallets.cash'), detail: 'مقارنة الرصيد المسجل بالعدّ أو بكشف المزود.' },
  { ...item('/wallet-cash', 'حركات نقدية المحافظ', 'wallets.cash'), detail: 'حركات النقد المخصصة لخدمات المحافظ.' },
  { ...item('/wallet-debts', 'تحصيل آجل المحافظ', 'wallets.view'), detail: 'متابعة وتحصيل عمليات المحافظ الآجلة.' },
  { ...item('/wallet-report', 'تقرير المحافظ', 'wallets.cash'), detail: 'مراجعة مجاميع الحركات والأرصدة.' },
]

export function visibleDestination(user: User, destination: Destination) {
  if (destination.path === walletWorkspace.path && allowed(user, 'reports.view') && allowed(user, 'retail.shifts.approve')) return true
  const permissions = destination.permissions ?? []
  if (!permissions.length) return true
  const check = (permission: string) => allowed(user, permission)
  return destination.requireAll ? permissions.every(check) : permissions.some(check)
}

export function navigationFor(user: User) {
  return sections.map(section => ({ ...section, items: section.items.filter(destination => visibleDestination(user, destination)) }))
    .filter(section => section.items.length)
}

export function currentSection(path: string, navigation: Section[]) {
  if (path.startsWith('/wallet')) return navigation.find(section => section.id === 'wallets')
  return navigation.find(section => section.items.some(item => path === item.path || path.startsWith(item.path + '/')))
}

export function workFor(user: User) {
  const manager = ['retail.shifts.approve', 'retail.discounts.approve', 'inventory.stocktake.approve'].some(p => allowed(user, p))
  const cashier = allowed(user, 'invoices.create')
  const stock = ['inventory.stocktake.count', 'retail.branches.transfer', 'suppliers.manage'].some(p => allowed(user, p))
  const accountant = allowed(user, 'retail.ledger.view')
  const paths = manager ? ['/pos', '/wallet-workspace', '/retail-shifts', '/retail-discounts', '/retail-stocktakes', '/retail-ledger', '/retail-branches']
    : cashier ? ['/pos', '/wallet-workspace', '/returns', '/retail-shifts', '/invoices', '/products']
    : stock ? ['/purchases', '/retail-branches', '/retail-stocktakes', '/retail-devices', '/products', '/wallet-workspace']
    : accountant ? ['/retail-ledger', '/retail-finance', '/retail-safe', '/supplier-report', '/wallet-workspace']
    : ['/retail-devices', '/retail-installations', '/maintenance', '/customers', '/wallet-workspace', '/products']
  const available = navigationFor(user).flatMap(section => section.items)
  return { manager, cashier, stock, accountant, shortcuts: paths.flatMap(path => available.filter(destination => destination.path === path)) }
}
