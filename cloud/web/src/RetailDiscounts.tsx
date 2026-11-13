import { useEffect, useState } from 'react'
import { allowed, integer, money, request } from './api'
import type { User } from './api'
import { Modal, Notice, PageTitle } from './ui'

type Discount = { id: number; cashier_id: number; cashier_name: string; total_minor: number; discount_minor: number; reason: string; status: string }
const labels: Record<string, string> = { pending: 'بانتظار الاعتماد', approved: 'معتمد', expired: 'منتهي', used: 'استُخدم' }

export function RetailDiscounts({ user }: { user: User }) {
  const [rows, setRows] = useState<Discount[]>([])
  const [target, setTarget] = useState<Discount>()
  const [reason, setReason] = useState('')
  const [limit, setLimit] = useState('')
  const [page, setPage] = useState(1)
  const [last, setLast] = useState(1)
  const [revision, refresh] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const policyAccess = allowed(user, 'settings.update') && allowed(user, 'invoices.create')
  useEffect(() => {
    const controller = new AbortController()
    request<Discount[]>(`/retail/discounts?page=${page}`, { signal: controller.signal }).then(result => {
      setRows(result.data); setLast(Math.max(1, Math.ceil((result.meta?.total ?? 0) / (result.meta?.per_page ?? 25))))
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    if (policyAccess) request<{ limit_bps: number }>('/retail/discount-policy', { signal: controller.signal }).then(result => {
      setLimit(String(result.data.limit_bps / 100))
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [page, revision, policyAccess])

  async function save(path: string, method: 'PATCH' | 'POST', body: object, message: string) {
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await request(path, { method, body, financial: true })
      setTarget(undefined); setNotice(message); refresh(value => value + 1)
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر حفظ الخصم.') }
    finally { setBusy(false) }
  }

  return <>
    <PageTitle title="اعتمادات الخصم" />
    {!target && error && <Notice error>{error}</Notice>}
    {notice && <Notice>{notice}</Notice>}
    {policyAccess && <form className="panel panel-inner form-section section-space" onSubmit={event => {
      event.preventDefault()
      void save('/retail/discount-policy', 'PATCH', { limit_bps: Math.round(Number(limit) * 100) }, 'تم تحديث حد الخصم.')
    }}>
      <label className="field">حد الخصم بدون اعتماد (%)<input type="number" min="0" max="100" step="0.01" value={limit} required disabled={busy} onChange={event => setLimit(event.target.value)} /></label>
      <div><button className="secondary" disabled={busy}>احفظ الحد</button></div>
    </form>}
    <section className="panel panel-inner section-space">
      <p>طلب الاعتماد مرتبط بالسلة والكاشير، ويصلح لمرة واحدة خلال ساعة من تقديمه.</p>
      <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={() => refresh(value => value + 1)}>تحديث الطلبات</button></div>
      {!rows.length ? <p>لا توجد طلبات في هذه الصفحة.</p> : <div className="table-scroll"><table><thead><tr>
        <th>الطلب</th><th>الكاشير</th><th>الخصم</th><th>بعد الخصم</th><th>السبب</th><th>الحالة</th>
      </tr></thead><tbody>{rows.map(row => <tr key={row.id}>
        <td>{integer(row.id)}</td><td>{row.cashier_name}</td><td>{money(row.discount_minor)}</td><td>{money(row.total_minor)}</td><td>{row.reason}</td>
        <td>{labels[row.status]}{' '}{row.status === 'pending' && row.cashier_id !== user.id && allowed(user, 'retail.discounts.approve') &&
          <button type="button" className="link-button" onClick={() => { setTarget(row); setReason(''); setError('') }}>راجع واعتمد</button>}</td>
      </tr>)}</tbody></table></div>}
      {last > 1 && <nav className="pagination" aria-label="صفحات الاعتمادات"><button className="secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>السابق</button>
        <button className="secondary" disabled={page >= last} onClick={() => setPage(page + 1)}>التالي</button></nav>}
    </section>
    {target && <Modal title="اعتماد خصم" close={() => { if (!busy) setTarget(undefined) }}><form className="modal-form" onSubmit={event => {
      event.preventDefault(); void save(`/retail/discounts/${target.id}/approve`, 'POST', { reason }, 'تم اعتماد الخصم.')
    }}>
      <p>{target.cashier_name} · خصم {money(target.discount_minor)} · إجمالي {money(target.total_minor)}</p>
      <label className="field">سبب الاعتماد<textarea required maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
      {error && <Notice error>{error}</Notice>}
      <div className="form-actions"><button className="primary" disabled={busy}>اعتمد الخصم</button></div>
    </form></Modal>}
  </>
}
