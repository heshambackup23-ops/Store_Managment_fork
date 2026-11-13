import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { formatDate, integer, money, readMoney, request, RequestError } from './api'
import { Notice, PageTitle } from './ui'

type Position = { target: 'drawer' | 'wallet'; wallet_id: number | null; wallet_name: string | null; expected_minor: number }
type Count = Position & {
  id: number; observed_minor: number; difference_minor: number; reason: string; actor_name: string; created_at: string
}
type Target = Position & { latest: Count | null }
type Overview = { business_day: string; targets: Target[] }

const targetKey = (position: Position) => position.target === 'drawer' ? 'drawer' : `wallet:${position.wallet_id}`
const targetLabel = (position: Position) => position.target === 'drawer' ? 'الدرج النقدي' : position.wallet_name || 'محفظة'
const clock = new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Cairo' })
const countTime = (count: Count) => clock.format(new Date(count.created_at))
const differenceLabel = (difference: number) => difference === 0 ? 'مطابق' : difference < 0 ? 'عجز' : 'زيادة'

export function WalletReconciliation() {
  const [overview, setOverview] = useState<Overview>()
  const [targetId, setTargetId] = useState('drawer')
  const [observed, setObserved] = useState('')
  const [reason, setReason] = useState('')
  const [saved, setSaved] = useState<Count>()
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  const [revision, refresh] = useState(0)
  const [page, setPage] = useState(1)
  const [onlySelected, setOnlySelected] = useState(false)
  const [history, setHistory] = useState<Count[]>()
  const [historyError, setHistoryError] = useState('')
  const [total, setTotal] = useState(0)
  const target = overview?.targets.find(position => targetKey(position) === targetId)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    request<Overview>('/wallet-reconciliation', { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setOverview(result.data) })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision])

  const filter = onlySelected ? targetId : ''
  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ page: String(page), per_page: '20' })
    if (filter === 'drawer') query.set('target', 'drawer')
    else if (filter.startsWith('wallet:')) query.set('wallet_id', filter.slice(7))
    setHistoryError('')
    setHistory(undefined)
    request<Count[]>('/wallet-reconciliation/history?' + query, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return
        setHistory(result.data)
        setTotal(result.meta?.total ?? result.data.length)
      })
      .catch(error => { if (!controller.signal.aborted) setHistoryError(error.message) })
    return () => controller.abort()
  }, [filter, page, revision])

  let actual: number | undefined
  try { actual = readMoney(observed) } catch { /* Wait until the amount is valid. */ }
  const difference = target && actual !== undefined ? actual - target.expected_minor : undefined

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!target || busy || loading || loadError) return
    setSaveError('')
    setSaved(undefined)
    if (actual === undefined) { setSaveError('أدخل الرصيد الفعلي بالجنيه، أو صفرًا إذا لم يتبقَّ رصيد.'); return }
    if (difference && !reason.trim()) { setSaveError('اذكر سبب الفرق قبل تسجيل المطابقة.'); return }
    setBusy(true)
    try {
      const result = await request<Count>('/wallet-reconciliation', {
        method: 'POST', financial: true,
        body: { target: target.target, ...(target.target === 'wallet' ? { wallet_id: target.wallet_id } : {}),
          expected_minor: target.expected_minor, observed_minor: actual, reason: reason.trim() },
      })
      setSaved(result.data)
      setObserved('')
      setReason('')
      setPage(1)
      refresh(value => value + 1)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'تعذّر تسجيل المطابقة.')
      if (error instanceof RequestError && error.status === 409) refresh(value => value + 1)
    } finally {
      setBusy(false)
    }
  }

  const lastPage = Math.max(1, Math.ceil(total / 20))
  return <>
    <PageTitle title="مطابقة الدرج والمحافظ" description="عدّ النقد في الدرج أو اقرأ الرصيد من تطبيق المزود، ثم قارنه برصيد هلال. تسجيل المطابقة لا يغيّر الأرصدة."
      action={<Link className="secondary" to="/wallet-report">تقرير المحافظ</Link>} />
    {saved && <Notice>تم تسجيل مطابقة {targetLabel(saved)}: {differenceLabel(saved.difference_minor)}{saved.difference_minor !== 0 ? ` (${money(saved.difference_minor)})` : ''}.</Notice>}
    {loadError && <Notice error>{loadError}</Notice>}
    {loading && <Notice>جارٍ تحديث الأرصدة…</Notice>}
    <form className="panel form-card section-space" onSubmit={submit}>
      <h2>جرد رصيد</h2>
      <label className="field">الحساب الذي تتم مطابقته
        <select value={targetId} disabled={busy || !overview} onChange={event => {
          setTargetId(event.target.value); setObserved(''); setReason(''); setSaveError(''); setSaved(undefined); setPage(1)
        }}>
          {overview?.targets.map(position => <option key={targetKey(position)} value={targetKey(position)}>{targetLabel(position)}</option>)}
        </select>
      </label>
      {target && <>
        <div className="metric-grid">
          <div className="panel metric"><p>الرصيد الدفتري الحالي</p><strong>{money(target.expected_minor)}</strong><p>{formatDate(overview?.business_day)}</p></div>
          <div className="panel metric"><p>آخر نتيجة مسجّلة</p><strong>{target.latest ? differenceLabel(target.latest.difference_minor) : 'لا يوجد جرد سابق'}</strong>
            {target.latest && <p>{money(target.latest.difference_minor)} · {countTime(target.latest)}</p>}
          </div>
          <div className="panel metric"><p>الفرق في الجرد الحالي</p><strong>{difference === undefined ? '—' : `${differenceLabel(difference)} · ${money(difference)}`}</strong></div>
        </div>
        <label className="field">الرصيد الفعلي بالجنيه
          <input type="text" inputMode="decimal" autoComplete="off" required value={observed} disabled={busy}
            onChange={event => setObserved(event.target.value)} />
        </label>
        <label className="field">{difference ? 'سبب الفرق (إلزامي)' : 'ملاحظة (اختيارية)'}
          <textarea maxLength={500} required={Boolean(difference)} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} />
        </label>
      </>}
      {saveError && <Notice error>{saveError}</Notice>}
      <div className="form-actions">
        <button className="primary" type="submit" disabled={busy || loading || !target || Boolean(loadError)}>{busy ? 'جارٍ التسجيل…' : 'سجّل المطابقة'}</button>
        <button className="secondary" type="button" disabled={busy || loading} onClick={() => refresh(value => value + 1)}>حدّث الأرصدة</button>
      </div>
    </form>
    <section className="panel panel-inner form-section section-space">
      <h2>سجل المطابقات</h2>
      <label className="check-field"><input type="checkbox" checked={onlySelected} onChange={event => { setOnlySelected(event.target.checked); setPage(1) }} /> الحساب المحدد فقط</label>
      {historyError ? <Notice error>{historyError}</Notice> : !history ? <Notice>جارٍ تحميل سجل المطابقات…</Notice> : !history.length ? <p>لا توجد مطابقات مسجّلة.</p> :
        <div className="table-scroll" role="region" aria-label="سجل المطابقات" tabIndex={0}>
          <table><thead><tr>{['الحساب', 'الدفتري وقت الجرد', 'الفعلي', 'الفرق', 'السبب أو الملاحظة', 'سجّله', 'الوقت (القاهرة)'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{history.map(count => <tr key={count.id}>
              <th scope="row">{targetLabel(count)}</th><td>{money(count.expected_minor)}</td><td>{money(count.observed_minor)}</td>
              <td>{differenceLabel(count.difference_minor)} · {money(count.difference_minor)}</td><td>{count.reason || '—'}</td>
              <td>{count.actor_name}</td><td><time dateTime={count.created_at}>{countTime(count)}</time></td>
            </tr>)}</tbody>
          </table>
        </div>}
      {lastPage > 1 && <nav className="pagination" aria-label="صفحات سجل المطابقات">
        <button className="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</button>
        <span>{integer(page)} / {integer(lastPage)}</span>
        <button className="secondary" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>التالي</button>
      </nav>}
    </section>
  </>
}
