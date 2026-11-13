import { Link, useSearchParams } from 'react-router-dom'
import { allowed, formatDate, money } from './api'
import type { User } from './api'
import { DataModule, dataText, idOf } from './ui'
import type { Field, ModuleConfig, Row } from './ui'

const usedPhones = '/retail/used-phones'
const grades = { excellent: 'ممتاز', good: 'جيد', fair: 'مقبول' }
const statuses: Record<string, string> = { passed: 'جاهز للشراء', failed: 'لم يجتز الفحص', superseded: 'يوجد فحص أحدث', acquired: 'تم الشراء' }
const deviceStates: Record<string, string> = { available: 'متاح للبيع', sold: 'مباع', quarantined: 'معزول للفحص', stocktake_missing: 'مفقود بالجرد',
  in_repair: 'صيانة', written_off: 'هالك', returned_to_supplier: 'مرتجع' }

export function RetailUsedPhones({ user }: { user: User }) {
  const [parameters] = useSearchParams()
  const lookup = parameters.get('q')
  const canAcquire = allowed(user, 'products.cost.manage') && allowed(user, 'retail.used_phones.acquire')
  const canUseDrawer = allowed(user, 'retail.shifts.operate') && allowed(user, 'retail.cash.manage')
  const paymentMethods = [
    { value: 'bank_transfer', label: 'تحويل بنكي تم بالفعل' },
    ...(canUseDrawer ? [{ value: 'cash', label: 'نقدًا من درج الوردية' }] : []),
  ]
  const acquisitionFields: Field[] = [
    { name: 'acquisition_cost_minor', label: 'تكلفة الشراء بالجنيه', kind: 'money', required: true },
    { name: 'payment_method', label: 'وسيلة الدفع', kind: 'select', required: true, options: paymentMethods },
    { name: 'payment_reference', label: 'مرجع التحويل البنكي', required: true, visible: values => values.payment_method === 'bank_transfer' },
    { name: 'shift_id', label: 'وردية الصرف بالفرع الرئيسي', kind: 'reference', min: 1, reference: { path: usedPhones + '/open-shifts', label: 'register_name' },
      required: true, visible: values => values.payment_method === 'cash' },
  ]
  const config: ModuleConfig = {
    title: 'الموبايلات المستعملة',
    description: 'سجّل فحص الجهاز وإثبات ملكيته، ثم أثبت دفع الشراء لإتاحته للبيع برقم IMEI.',
    endpoint: lookup ? usedPhones + '?q=' + encodeURIComponent(lookup) : usedPhones,
    permission: 'inventory.view',
    columns: [
      { key: 'product_name', label: 'الصنف' },
      { key: 'imei1', label: 'IMEI', render: row => <bdi>{dataText(row.imei1)}{row.imei2 ? ' / ' + row.imei2 : ''}</bdi> },
      { key: 'grade', label: 'الحالة', render: row => grades[row.grade as keyof typeof grades] ?? '—' },
      { key: 'inspection', label: 'الفحص', render: row => <>
        {row.battery_percent != null && <div>البطارية {Number(row.battery_percent)}%</div>}
        {Boolean(row.accessories) && <div>الملحقات: {dataText(row.accessories)}</div>}
        {Boolean(row.defects) && <div>العيوب: {dataText(row.defects)}</div>}
        {(!row.functional || !row.reset_verified || !row.lock_cleared) && <div>
          {[!row.functional && 'لم يجتز اختبار التشغيل', !row.reset_verified && 'لم تُثبت إعادة الضبط', !row.lock_cleared && 'قفل الحساب لم يُرفع']
            .filter(Boolean).join('، ')}
        </div>}
      </> },
      ...(allowed(user, 'inventory.manage') || allowed(user, 'retail.used_phones.acquire')
        ? [{ key: 'ownership_reference', label: 'مرجع إثبات الملكية' }] : []),
      ...(allowed(user, 'products.cost.view') || allowed(user, 'products.cost.manage') ? [{
        key: 'acquisition_cost_minor', label: 'تكلفة الشراء', render: (row: Row) => row.acquisition_cost_minor != null ? money(row.acquisition_cost_minor) : '—',
      }] : []),
      { key: 'status', label: 'حالة الشراء', render: row => <>
        {statuses[String(row.status)]}
        {Boolean(row.acquired_on) && <div>{formatDate(row.acquired_on)}</div>}
      </> },
      { key: 'device_status', label: 'سجل الجهاز', render: row => row.device_id ? <Link to={'/retail-devices/' + row.device_id}>
        {deviceStates[String(row.device_status)] ?? 'افتح سجل الجهاز'}
      </Link> : '—' },
    ],
    create: {
      label: 'سجّل فحص هاتف', endpoint: () => usedPhones, permission: 'inventory.manage', financial: true,
      fields: [
        { name: 'product_id', label: 'صنف المستعمل بتتبع IMEI', kind: 'reference', min: 1,
          reference: { path: usedPhones + '/products', searchable: true }, required: true },
        { name: 'imei1', label: 'IMEI الأساسي', required: true },
        { name: 'imei2', label: 'IMEI الثاني' },
        { name: 'serial_number', label: 'الرقم التسلسلي' },
        { name: 'ownership_reference', label: 'مرجع إثبات الملكية أو فاتورة الشراء', required: true },
        { name: 'grade', label: 'درجة حالة الجهاز', kind: 'select', required: true,
          options: Object.entries(grades).map(([value, label]) => ({ value, label })) },
        { name: 'battery_percent', label: 'صحة البطارية (%)', kind: 'number', min: 0, nullable: true },
        { name: 'accessories', label: 'الملحقات المستلمة' },
        { name: 'defects', label: 'العيوب الظاهرة', kind: 'textarea' },
        { name: 'functional', label: 'اجتاز اختبار التشغيل', kind: 'check' },
        { name: 'reset_verified', label: 'تحققت من إعادة الضبط ومسح بيانات المالك', kind: 'check' },
        { name: 'lock_cleared', label: 'تم رفع قفل الحساب أو التنشيط', kind: 'check' },
      ],
      transform: ({ imei1, imei2, serial_number, ...rest }) => ({ ...rest, device: { imei1, imei2, serial_number } }),
    },
    actions: canAcquire ? [{
      label: 'أثبت الشراء', endpoint: row => usedPhones + '/' + idOf(row) + '/acquire', financial: true,
      fields: acquisitionFields, visible: row => row.status === 'passed',
      confirmation: 'يضيف إثبات الشراء الجهاز إلى مخزون الفرع الرئيسي ويسجل التكلفة والدفع.',
    }] : [],
  }
  return <DataModule key={lookup ?? ''} config={config} user={user}
    extra={lookup && <p>نتائج IMEI <bdi>{lookup}</bdi> · <Link to="/retail-used-phones">عرض كل الأجهزة</Link></p>} />
}
