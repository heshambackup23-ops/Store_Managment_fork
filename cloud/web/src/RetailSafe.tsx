import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { allowed, formatDate, money, readMoney, request } from './api'
import type { User } from './api'
import { Notice, PageTitle } from './ui'

type Count = { id: number; expected_minor: number; observed_minor: number; difference_minor: number; reason: string; actor_name: string; created_at: string }
type Transfer = { id: number; shift_id: number; delta_minor: number; reason: string; reference: string | null; actor_name: string; created_at: string }
type Position = { active: boolean; opening_minor: number | null; expected_minor: number | null; opened_by_name: string | null; opening_reason: string | null; latest_count: Count | null }

export function RetailSafe({ user }: { user: User }) {
  const canManage = allowed(user, 'retail.safe.manage')
  const [position, setPosition] = useState<Position>()
  const [counts, setCounts] = useState<Count[]>([])
  const [transfers, setTransfers] = useState<Transfer[]>([])
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [revision, refresh] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      request<Position>('/retail/safe', { signal: controller.signal }),
      request<Count[]>('/retail/safe/counts?per_page=20', { signal: controller.signal }),
      request<Transfer[]>('/retail/safe/movements?per_page=20', { signal: controller.signal }),
    ]).then(([latest, history, movement]) => {
      if (controller.signal.aborted) return
      setPosition(latest.data); setCounts(history.data); setTransfers(movement.data)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [revision])
  let variance: number | undefined
  if (position?.active && amount && position.expected_minor !== null) {
    try { variance = readMoney(amount) - position.expected_minor } catch { /* Show validation on submission. */ }
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (busy || !position) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const value = readMoney(amount)
      const body = position.active ? { observed_minor: value, expected_minor: position.expected_minor, reason: reason.trim() }
        : { opening_minor: value, reason: reason.trim() }
      await request(position.active ? '/retail/safe/count' : '/retail/safe/open', { method: 'POST', financial: true, body })
      setSuccess(position.active ? 'تم تسجيل جرد الخزنة.' : 'تم توثيق الرصيد الافتتاحي للخزنة.')
      setAmount(''); setReason('')
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر حفظ العملية.') }
    finally { setBusy(false); refresh(value => value + 1) }
  }
  return <>
    <PageTitle title="خزنة المتجر" description="رصيد مستقل للخزنة، وتحويلات موثقة مع درج الوردية، وجرد للنقد الفعلي." />
    {error && <Notice error>{error}</Notice>}{success && <Notice>{success}</Notice>}
    {position && <>
      {position.active && <dl className="panel panel-inner invoice-summary section-space">
        <div><dt>الرصيد الافتتاحي</dt><dd>{money(position.opening_minor)}</dd></div><div><dt>النقدية المتوقعة في الخزنة</dt><dd>{money(position.expected_minor)}</dd></div>
        <div><dt>آخر فرق جرد</dt><dd>{money(position.latest_count?.difference_minor)}</dd></div><div><dt>وثّق الافتتاح</dt><dd>{position.opened_by_name} · {position.opening_reason}</dd></div>
      </dl>}
      {!position.active && <p>سجّل النقد الموجود في الخزنة وقت التفعيل ومرجع العدّ الافتتاحي. يبدأ سجل التحويلات من لحظة التفعيل.</p>}
      {canManage && <form className="panel form-card section-space" onSubmit={save}>
        <h2>{position.active ? 'جرد الخزنة' : 'تفعيل الخزنة'}</h2>
        <label className="field">{position.active ? 'المبلغ المعدود بالجنيه' : 'الرصيد الافتتاحي بالجنيه'}<input required inputMode="decimal" value={amount} disabled={busy} onChange={event => setAmount(event.target.value)} /></label>
        {variance !== undefined && <p>فرق الجرد · {money(variance)}</p>}
        <label className="field">{position.active ? 'ملاحظة الجرد أو سبب الفرق' : 'محضر العد أو مرجع الافتتاح'}<textarea required={!position.active || Boolean(variance)} maxLength={1000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        <button className="primary" disabled={busy}>{position.active ? 'احفظ نتيجة الجرد' : 'سجّل الافتتاح'}</button>
      </form>}
      {position.active && <>
        <section className="panel panel-inner section-space"><h2>آخر ٢٠ تحويلًا للخزنة</h2>
          {!transfers.length ? <p>لا توجد تحويلات مسجلة.</p> : <ul className="dash-list">{transfers.map(row => <li key={row.id}>
            {money(row.delta_minor)} · وردية {row.shift_id} · {row.actor_name} · {row.reason}{row.reference && ` · ${row.reference}`} · {formatDate(row.created_at)}
          </li>)}</ul>}
        </section>
        <section className="panel panel-inner"><h2>آخر ٢٠ نتيجة جرد</h2>
          {!counts.length ? <p>لا توجد نتائج جرد.</p> : <div className="table-scroll"><table><thead><tr>{['الدفتري', 'المعدود', 'الفرق', 'البيان', 'الموظف والتاريخ'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
            <tbody>{counts.map(row => <tr key={row.id}><td>{money(row.expected_minor)}</td><td>{money(row.observed_minor)}</td><td>{money(row.difference_minor)}</td><td>{row.reason}</td><td>{row.actor_name} · {formatDate(row.created_at)}</td></tr>)}</tbody>
          </table></div>}
        </section>
      </>}
    </>}
  </>
}
