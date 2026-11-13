import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { allowed, formatDate, integer, money, readMoney, request } from './api'
import type { User } from './api'
import { Modal, Notice, PageTitle } from './ui'

const base = '/retail/ledger'
const books = { operating: 'دفتر المتجر', practice: 'دفتر التدريب' }
const issueNames = { cost_unknown: 'التكلفة غير مثبتة', payment_unknown: 'وسيلة السداد غير مصنفة', account_required: 'الحساب المقابل يحتاج مراجعة' }
const kindNames = { source: 'حركة متجر', manual: 'يدوي', reversal: 'قيد عكسي', resolution: 'تصحيح حركة' }
type BookName = keyof typeof books
type Account = { code: string; name: string; account_type: string }
type TrialLine = Account & { opening_minor: string; debit_minor: string; credit_minor: string; closing_minor: string }
type Settings = { today: string; accounts: Account[]; books: { book: BookName; first_period: string }[] }
type Period = { status: 'open' | 'closed' | 'before_start'; entry_count: number; next_close: string; unresolved: number;
  pending: number; more_pending: boolean; trial_balance: TrialLine[];
  closure?: { operation_id: number; actor_name: string; reason: string; created_at: string } }
type Line = { account: string; debit_minor: number; credit_minor: number }
type Entry = { id: number; posting_day: string; description: string; kind: keyof typeof kindNames;
  source?: string; source_ref: string | null; actor_name: string; reversed: number; reverses_id: number | null; lines: Line[] }
type Issue = { source: string; source_ref: string; posting_day: string; description: string; issue: keyof typeof issueNames;
  unclassified_minor: number; resolution_reason: string | null }
type Action = { mode: 'start' | 'entry' | 'close' } | { mode: 'reverse'; entry: Entry } | { mode: 'resolve'; issue: Issue }
type InputLine = { account: string; side: 'debit' | 'credit'; amount: string }
type View = 'trial' | 'entries' | 'issues'

function displayMoney(value: string | bigint) {
  const minor = BigInt(value)
  if (minor >= -BigInt(Number.MAX_SAFE_INTEGER) && minor <= BigInt(Number.MAX_SAFE_INTEGER)) return money(Number(minor))
  const absolute = minor < 0n ? -minor : minor
  return `${minor < 0n ? '−' : ''}${(absolute / 100n).toLocaleString('ar-EG')}٫${String(absolute % 100n).padStart(2, '0').replace(/\d/g, digit => '٠١٢٣٤٥٦٧٨٩'[Number(digit)])} ج.م.`
}

function ledgerDay(period: string, today: string) {
  if (today.startsWith(period)) return today
  const end = new Date(period + '-01T00:00:00Z')
  end.setUTCMonth(end.getUTCMonth() + 1, 0)
  return end.toISOString().slice(0, 10)
}

function newLine(side: InputLine['side']): InputLine { return { account: '', side, amount: '' } }

function LedgerForm({ action, book, period, today, accounts, close, save }: { action: Action; book: BookName; period: string; today: string;
  accounts: Account[]; close: () => void; save: (value: { note: string; day: string; lines?: Line[] }) => Promise<void> }) {
  const [day, setDay] = useState(action.mode === 'reverse' ? today : ledgerDay(period, today))
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<InputLine[]>([newLine('debit'), newLine('credit')])
  const [skip, setSkip] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const showLines = action.mode === 'entry' || (action.mode === 'resolve' && !skip)
  const titles = { start: 'بدء الدفتر', entry: 'إضافة قيد يومية', close: 'إقفال الشهر', reverse: 'عكس قيد يدوي', resolve: 'معالجة حركة المصدر' }
  const paymentDifference = action.mode === 'resolve' ? action.issue.unclassified_minor : 0

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const items = showLines ? lines.map(line => {
        const minor = readMoney(line.amount)
        if (!minor) throw new Error('أدخل مبلغًا أكبر من صفر لكل سطر.')
        return { account: line.account, debit_minor: line.side === 'debit' ? minor : 0, credit_minor: line.side === 'credit' ? minor : 0 }
      }) : undefined
      await save({ note, day, lines: items })
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تعذر حفظ العملية.')
    } finally {
      setBusy(false)
    }
  }

  function updateLine(index: number, change: Partial<InputLine>) {
    setLines(current => current.map((line, position) => position === index ? { ...line, ...change } : line))
  }

  return <Modal title={titles[action.mode]} close={() => { if (!busy) close() }}>
    <form onSubmit={submit} className="form-card">
      {error && <Notice error>{error}</Notice>}
      <p><strong>{books[book]}</strong> · شهر <bdi>{period}</bdi></p>
      {action.mode === 'close' && <p>يُحفظ ميزان المراجعة عند الإقفال. سجّل أي تصحيح لاحق في شهر مفتوح.</p>}
      {action.mode === 'start' && <p>سجّل الأرصدة الافتتاحية من المستندات المعتمدة بعد بدء الدفتر.</p>}
      {action.mode === 'reverse' && <p>سيُنشأ قيد يعكس القيد #{action.entry.id} بالكامل.</p>}
      {action.mode === 'resolve' && <>
        <p>{action.issue.description} · <bdi>#{action.issue.source_ref}</bdi> · {issueNames[action.issue.issue]}</p>
        {paymentDifference !== 0 && <p>أعد تصنيف {money(Math.abs(paymentDifference))} من حساب ١٠٩٠ إلى حساب وسيلة السداد المثبتة.</p>}
        {action.issue.issue === 'cost_unknown' && <label className="check-field"><input type="checkbox" checked={skip}
          onChange={event => setSkip(event.target.checked)} /> مستند المراجعة يثبت عدم الحاجة إلى قيد إضافي</label>}
      </>}
      {(action.mode === 'entry' || action.mode === 'reverse') && <label className="field"><span>تاريخ القيد</span>
        <input type="date" value={day} max={today} required onChange={event => setDay(event.target.value)} /></label>}
      <label className="field"><span>{action.mode === 'resolve' ? 'النتيجة ومرجع المستند' : 'البيان ومرجع المستند'}</span>
        <textarea rows={2} required minLength={5} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} />
      </label>
      {showLines && <>
        {lines.map((line, index) => <fieldset className="form-grid" key={index}>
          <legend>سطر القيد {integer(index + 1)}</legend>
          <label className="field"><span>الحساب</span><select value={line.account} required onChange={event => updateLine(index, { account: event.target.value })}>
            <option value="">اختر حسابًا</option>
            {accounts.map(account => <option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}
          </select></label>
          <label className="field"><span>الطرف</span><select value={line.side} onChange={event => updateLine(index, { side: event.target.value === 'debit' ? 'debit' : 'credit' })}>
            <option value="debit">مدين</option><option value="credit">دائن</option>
          </select></label>
          <label className="field"><span>المبلغ بالجنيه</span><input inputMode="decimal" required value={line.amount}
            onChange={event => updateLine(index, { amount: event.target.value })} /></label>
          {lines.length > 2 && <button type="button" className="secondary" onClick={() => setLines(current => current.filter((_, i) => i !== index))}>حذف السطر {integer(index + 1)}</button>}
        </fieldset>)}
        {lines.length < 30 && <button type="button" className="secondary" onClick={() => setLines(current => [...current, newLine('debit')])}>إضافة سطر</button>}
      </>}
      <div className="actions"><button className="primary" type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : titles[action.mode]}</button>
        <button className="secondary" type="button" disabled={busy} onClick={close}>إلغاء</button></div>
    </form>
  </Modal>
}

export function RetailLedger({ user }: { user: User }) {
  const [params, setParams] = useSearchParams()
  const [settings, setSettings] = useState<Settings>()
  const book: BookName = params.get('book') === 'practice' ? 'practice' : 'operating'
  const requestedPeriod = params.get('period') || ''
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriod) ? requestedPeriod : settings?.today.slice(0, 7) || ''
  const [report, setReport] = useState<Period>()
  const requestedView = params.get('view')
  const view: View = requestedView === 'entries' || requestedView === 'issues' && book === 'operating' ? requestedView : 'trial'
  const [rows, setRows] = useState<(Entry | Issue)[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [revision, refresh] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [action, setAction] = useState<Action>()
  const [busy, setBusy] = useState(false)
  const canPost = allowed(user, 'retail.ledger.post')
  const canClose = allowed(user, 'retail.ledger.close')
  const started = settings?.books.find(row => row.book === book)
  const periodPath = `${base}/${book}/periods/${period}`
  const accountNames = new Map(settings?.accounts.map(account => [account.code, account.name]))
  function changeScope(values: Record<string, string>, replace = false) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    setParams(next, { replace })
    setPage(1)
    setError('')
    setSuccess('')
  }

  useEffect(() => {
    const controller = new AbortController()
    request<Settings>(base, { signal: controller.signal }).then(({ data }) => {
      setSettings(data)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [revision])

  useEffect(() => {
    setReport(undefined)
    if (!started || !period) return
    const controller = new AbortController()
    request<Period>(periodPath, { signal: controller.signal }).then(({ data }) => setReport(data))
      .catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [started?.book, periodPath, period, revision])

  useEffect(() => {
    setRows([])
    if (!started || view === 'trial' || !period || (view === 'issues' && book !== 'operating')) return
    const controller = new AbortController()
    request<(Entry | Issue)[]>(`${periodPath}/${view}?page=${page}`, { signal: controller.signal }).then(result => {
      setRows(result.data)
      setPages(result.meta ? Math.max(1, Math.ceil(result.meta.total / result.meta.per_page)) : 1)
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [started?.book, periodPath, period, view, page, revision, book])

  async function sync() {
    setBusy(true)
    setError('')
    setSuccess('')
    try {
      const { data } = await request<{ reviewed: number }>(periodPath + '/sync', { method: 'POST', body: {}, financial: true })
      setSuccess(`تمت مراجعة وترحيل ${integer(data.reviewed)} حركة مصدر.`)
      refresh(current => current + 1)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'تعذر ترحيل حركات المتجر.')
    } finally {
      setBusy(false)
    }
  }

  async function save(value: { note: string; day: string; lines?: Line[] }) {
    if (!action) return
    const scope = `${base}/${book}`
    let endpoint: string
    let data: unknown
    switch (action.mode) {
      case 'start': endpoint = scope + '/start'; data = { first_period: period, reason: value.note }; break
      case 'entry': endpoint = scope + '/entries'; data = { posting_day: value.day, description: value.note, lines: value.lines }; break
      case 'close': endpoint = periodPath + '/close'; data = { reason: value.note }; break
      case 'reverse': endpoint = scope + `/entries/${action.entry.id}/reverse`; data = { posting_day: value.day, description: value.note }; break
      case 'resolve': endpoint = periodPath + '/issues/resolve'; data = { reason: value.note, lines: value.lines,
        source: action.issue.source, source_ref: action.issue.source_ref, code: action.issue.issue }; break
    }
    await request(endpoint, { method: 'POST', body: data, financial: true })
    if ((action.mode === 'entry' || action.mode === 'reverse') && value.day.slice(0, 7) !== period) {
      changeScope({ period: value.day.slice(0, 7) }, true)
    }
    setSuccess(action.mode === 'close' ? 'تم إقفال الشهر وحفظ ميزان المراجعة.' : 'تم حفظ العملية في دفتر الأستاذ.')
    setError('')
    setAction(undefined)
    refresh(current => current + 1)
  }

  const total = report?.trial_balance.reduce((sum, row) => ({ debit: sum.debit + BigInt(row.debit_minor), credit: sum.credit + BigInt(row.credit_minor) }), { debit: 0n, credit: 0n })
  const activeMonth = report?.status === 'open'
  const canCloseMonth = activeMonth && report.next_close === period && period < (settings?.today.slice(0, 7) ?? '')
    && report.pending === 0 && report.unresolved === 0 && total?.debit === total?.credit
  const previousMonth = Boolean(period && period < (settings?.today.slice(0, 7) ?? ''))

  function documentLink(source: string | undefined, ref: string | null) {
    if (!ref || !/^\d+$/.test(ref)) return null
    if (source && ['sale', 'sale_cost', 'historical_invoice_payment'].includes(source) && allowed(user, 'invoices.view')) {
      return <Link to={'/invoices/' + ref}>فاتورة <bdi>#{ref}</bdi></Link>
    }
    if (source === 'purchase' && allowed(user, 'suppliers.view')) return <Link to={'/purchases/' + ref + '/receipts'}>شراء <bdi>#{ref}</bdi></Link>
    if (source === 'wallet_transaction' && allowed(user, 'wallets.view')) return <Link to={'/wallet-transactions?q=%23' + ref}>حركة محفظة <bdi>#{ref}</bdi></Link>
    return <bdi>#{ref}</bdi>
  }

  return <>
    <PageTitle title="دفتر الأستاذ وإقفال الشهر" description="تُرحّل حركات المتجر بتاريخ تسجيلها بتوقيت القاهرة، وتُعرض القيود بالجنيه المصري." />
    <div className="panel toolbar">
      <label className="field"><span>الدفتر</span><select value={book} onChange={event => changeScope({ book: event.target.value, view: '' })}>
        {Object.entries(books).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      <label className="field"><span>شهر العمل</span><input type="month" value={period} min="2000-01" max={settings?.today.slice(0, 7)}
        onChange={event => changeScope({ period: event.target.value }, true)} /></label>
    </div>
    {book === 'practice' && <Notice>دفتر التدريب مستقل عن حركات المتجر ويقبل قيود التدريب اليدوية.</Notice>}
    {error && <Notice error>{error}</Notice>}
    {success && <Notice>{success}</Notice>}
    {settings && !started && <section className="panel form-card section-space">
      <p>اختر أول شهر للدفتر، ثم سجّل القيم الافتتاحية المعتمدة عند الحاجة.</p>
      {canClose && <button className="primary" disabled={!period} onClick={() => setAction({ mode: 'start' })}>بدء الدفتر</button>}
    </section>}
    {report && <>
      <section className="panel form-card section-space">
        <h2 className="ledger-scope">{books[book]} · <bdi>{period}</bdi></h2>
        {report.closure ? <Notice>مقفل بواسطة {report.closure.actor_name} في {formatDate(report.closure.created_at)} · {report.closure.reason}</Notice>
          : report.status === 'before_start' ? <p>الفترة تسبق أول شهر للدفتر.</p>
          : <p>شهر مفتوح · {integer(report.entry_count)} قيد{book === 'operating' && ` · ${integer(report.pending)}${report.more_pending ? '+' : ''} حركة للترحيل · ${integer(report.unresolved)} حركة للمراجعة`}</p>}
        <div className="actions">
          {activeMonth && canPost && <button className="primary" onClick={() => setAction({ mode: 'entry' })}>إضافة قيد يومية</button>}
          {activeMonth && canPost && book === 'operating' && <button className="secondary" disabled={busy || report.pending === 0} onClick={() => void sync()}>رحّل حركات المتجر</button>}
          {canCloseMonth && canClose && <button className="secondary" disabled={busy} onClick={() => setAction({ mode: 'close' })}>إقفال الشهر</button>}
        </div>
        {activeMonth && <section className="form-section" aria-label="الجاهزية للإقفال">
          <h3>الجاهزية للإقفال</h3>
          <ul className="worklist">
            <li><span>ميزان المراجعة</span><strong>{total?.debit === total?.credit ? 'متوازن' : 'يحتاج مراجعة'}</strong></li>
            <li><span>نهاية الفترة</span><strong>{previousMonth ? 'الشهر منتهٍ' : 'الشهر ما زال جاريًا'}</strong></li>
            {book === 'operating' && <>
              <li><span>حركات للترحيل</span><strong>{integer(report.pending)}{report.more_pending ? '+' : ''}</strong></li>
              <li><button className="link-button" type="button" onClick={() => changeScope({ view: 'issues' })}>حركات تحتاج مراجعة</button><strong>{integer(report.unresolved)}</strong></li>
            </>}
            {report.next_close !== period && <li>الشهر التالي المطلوب إقفاله <bdi>{report.next_close}</bdi></li>}
          </ul>
        </section>}
      </section>
      <div className="panel toolbar section-space" aria-label="عرض الدفتر">
        {([['trial', 'ميزان المراجعة'], ['entries', 'قيود اليومية'], ...(book === 'operating' ? [['issues', 'حركات تحتاج مراجعة']] : [])] as [View, string][])
          .map(([value, label]) => <button type="button" key={value} aria-pressed={view === value} className={view === value ? 'primary' : 'secondary'}
            onClick={() => changeScope({ view: value })}>{label}</button>)}
      </div>
      {view === 'trial' && <div className="panel table-wrap section-space"><table>
        <thead><tr><th>الحساب</th><th>رصيد أول المدة</th><th>مدين خلال الشهر</th><th>دائن خلال الشهر</th><th>رصيد آخر المدة</th></tr></thead>
        <tbody>{report.trial_balance.map(row => <tr key={row.code}><td><bdi>{row.code}</bdi> · {row.name}</td>
          <td>{displayMoney(row.opening_minor)}</td><td>{displayMoney(row.debit_minor)}</td><td>{displayMoney(row.credit_minor)}</td><td>{displayMoney(row.closing_minor)}</td></tr>)}</tbody>
        {total && <tfoot><tr><th colSpan={2}>إجمالي حركة الشهر</th><td>{displayMoney(total.debit)}</td><td>{displayMoney(total.credit)}</td><td></td></tr></tfoot>}
      </table></div>}
      {view === 'entries' && <div className="panel table-wrap section-space"><table>
        <thead><tr><th>رقم القيد</th><th>التاريخ</th><th>البيان</th><th>الحسابات</th><th>الإجراء</th></tr></thead>
        <tbody>{(rows as Entry[]).map(row => <tr key={row.id}><td><bdi>#{row.id}</bdi></td><td><bdi>{row.posting_day}</bdi></td>
          <td>{row.description}<br /><small>{kindNames[row.kind]} · {row.actor_name} {documentLink(row.source, row.source_ref)}</small></td>
          <td>{row.lines.map((line, index) => <div key={index}>{accountNames.get(line.account)} · {line.debit_minor ? 'مدين' : 'دائن'} {money(line.debit_minor || line.credit_minor)}</div>)}</td>
          <td>{row.kind === 'manual' && !row.reversed && canPost && <button className="secondary" onClick={() => setAction({ mode: 'reverse', entry: row })}>عكس</button>}
            {row.reversed ? 'معكوس' : row.reverses_id ? <bdi>#{row.reverses_id}</bdi> : null}</td></tr>)}</tbody>
      </table>{rows.length === 0 && <Notice>لا توجد قيود في هذا الشهر.</Notice>}</div>}
      {view === 'issues' && <div className="panel table-wrap section-space"><table>
        <thead><tr><th>حركة المصدر</th><th>التاريخ</th><th>المراجعة</th><th>الإجراء</th></tr></thead>
        <tbody>{(rows as Issue[]).map(row => <tr key={`${row.source}/${row.source_ref}`}><td>{row.description} · {documentLink(row.source, row.source_ref)}</td>
          <td><bdi>{row.posting_day}</bdi></td><td>{issueNames[row.issue]}{row.resolution_reason && <p>{row.resolution_reason}</p>}</td>
          <td>{!row.resolution_reason && activeMonth && canPost && <button className="secondary" onClick={() => setAction({ mode: 'resolve', issue: row })}>معالجة</button>}</td></tr>)}</tbody>
      </table>{rows.length === 0 && <Notice>لا توجد حركات معلّقة للمراجعة.</Notice>}</div>}
      {view !== 'trial' && pages > 1 && <div className="toolbar section-space"><button className="secondary" disabled={page <= 1}
        onClick={() => setPage(page - 1)}>السابق</button><span>{integer(page)} / {integer(pages)}</span>
        <button className="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>التالي</button></div>}
    </>}
    {settings && action && <LedgerForm action={action} book={book} period={period} today={settings.today} accounts={settings.accounts}
      close={() => setAction(undefined)} save={save} />}
  </>
}
