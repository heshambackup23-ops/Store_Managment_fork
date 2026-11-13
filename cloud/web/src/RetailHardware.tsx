import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Notice, PageTitle } from './ui'

const sample = 'HILAL-TEST-001'

export function RetailHardware() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const scan = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState('')
  const [outcome, setOutcome] = useState<'match' | 'different'>()
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let active = true
    import('jsbarcode').then(({ default: JsBarcode }) => {
      if (!active || !canvas.current) return
      JsBarcode(canvas.current, sample, { format: 'CODE128', margin: 10, height: 42, width: 2, fontSize: 16 })
      setReady(true)
    }).catch(() => { if (active) setError('تعذّر تجهيز الباركود التجريبي.') })
    return () => { active = false }
  }, [])
  function check(event: FormEvent) {
    event.preventDefault()
    if (!code.trim()) return
    setOutcome(code.trim() === sample ? 'match' : 'different')
  }
  return <div className="retail-hardware">
    <PageTitle title="اختبار قارئ الباركود والطابعة" description="اختبار محلي للقارئ والطباعة، مستقل عن المبيعات والمخزون." />
    <div className="form-actions no-print section-space">
      <button className="primary" disabled={!ready} onClick={() => window.print()}>اطبع ورقة الاختبار</button>
      <button className="secondary" onClick={() => { setCode(''); setOutcome(undefined); scan.current?.focus() }}>جهّز حقل المسح</button>
    </div>
    <section className="panel panel-inner retail-hardware-print" aria-label="ورقة اختبار هلال">
      <h2>هلال لإدارة المتجر</h2><p>إيصال اختبار · لا يوجد بيع</p>
      {error ? <Notice error>{error}</Notice> : <canvas ref={canvas} className="barcode-canvas" role="img" aria-label={'باركود ' + sample} />}
      <p>العربية · ١٢٣٤٥٦٧٨٩٠ · ١٢٣٫٤٥ ج.م.</p>
      <p>بداية السطر | نهاية السطر</p>
    </section>
    <form className="panel form-card section-space no-print" onSubmit={check}>
      <label className="field">امسح الباركود المطبوع
        <input ref={scan} dir="ltr" autoComplete="off" spellCheck={false} maxLength={120} value={code} onChange={event => { setCode(event.target.value); setOutcome(undefined) }} />
      </label>
      <button className="secondary" disabled={!code.trim()}>تحقّق من الرمز</button>
      {outcome && <Notice error={outcome === 'different'}>{outcome === 'match' ? 'الرمز المقروء مطابق لعينة الطباعة.' : 'الرمز المقروء مختلف. راجع إعداد لغة لوحة المفاتيح ونوع الباركود.'}</Notice>}
    </form>
    <p className="muted no-print">اختر طابعة المحل ومقاس الورق من نافذة الطباعة، وأوقف رؤوس الصفحات وتذييلاتها. قارن الورقة المطبوعة بالمعاينة وتأكد أن آخر سطر والباركود ظاهرين بالكامل.</p>
  </div>
}
