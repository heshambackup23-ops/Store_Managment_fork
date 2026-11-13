import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { request } from './api'
import { FormInput, Modal, Notice } from './ui'
import type { Field, Row } from './ui'
import { trackingOf } from './RetailDevices'
import { BranchSelect } from './RetailBranches'
import type { Tracking } from './RetailDevices'

type CodeDraft = { serial_number: string; imei1: string; imei2: string }
import { formatQuantity, measurementLabel, quantityScale, quantityStep, stockQuantity, validQuantity } from './measurement'

type Line = { id: number; name: string; tracking: Tracking; quantity: number; scale: number; devices: CodeDraft[] }
const productField: Field = { name: 'product_id', label: 'الصنف المستلم', kind: 'reference', reference: { path: '/products' } }
const blankCode = () => ({ serial_number: '', imei1: '', imei2: '' })
const displayLine = (row: number) => new Intl.NumberFormat('ar-EG').format(row)
const invalidCodeCharacters = /[\p{Cc}\p{Cf}]/u

function isImei(value: string) {
  return /^[0-9]{15}$/.test(value) && value !== '000000000000000' &&
    [...value].reduce((sum, digit, index) => {
      const amount = Number(digit) * (index % 2 === 0 ? 1 : 2)
      return sum + (amount > 9 ? amount - 9 : amount)
    }, 0) % 10 === 0
}

function bulkCodes(value: string, tracking: Tracking, quantity: number) {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (lines.length !== quantity) throw new Error(`عدد سطور الأرقام يجب أن يطابق الكمية (${displayLine(quantity)}).`)
  return lines.map((line, index) => {
    if (tracking === 'serial') {
      if (line.length > 100 || invalidCodeCharacters.test(line)) throw new Error(`راجع الرقم المسلسل في السطر ${displayLine(index + 1)}.`)
      return { ...blankCode(), serial_number: line }
    }
    const fields = line.split(/[\t,]/).map(field => field.trim())
    if (fields.length > 3) throw new Error(`السطر ${displayLine(index + 1)} يجب أن يحتوي على IMEI 1 وIMEI 2 والرقم المسلسل بالترتيب.`)
    const [imei1, imei2 = '', serial_number = ''] = fields
    if (!isImei(imei1) || (imei2 && (!isImei(imei2) || imei1 === imei2)) || serial_number.length > 100 || invalidCodeCharacters.test(serial_number)) {
      throw new Error(`راجع الأرقام في السطر ${displayLine(index + 1)}.`)
    }
    return { serial_number, imei1, imei2 }
  })
}

function conflicts(devices: CodeDraft[]) {
  const seen = new Set<string>()
  for (const device of devices) {
    const serial = device.serial_number.trim().toLowerCase()
    const keys = [serial && `serial:${serial}`, device.imei1.trim() && `imei:${device.imei1.trim()}`,
      device.imei2.trim() && `imei:${device.imei2.trim()}`].filter(Boolean)
    for (const key of keys) {
      if (seen.has(key)) return true
      seen.add(key)
    }
  }
  return false
}

function wireCode(code: CodeDraft) {
  return { serial_number: code.serial_number.trim() || undefined, imei1: code.imei1.trim() || undefined, imei2: code.imei2.trim() || undefined }
}

function ReceiptBulkCodes({ line, endpoint, disabled, apply }: { line: Line; endpoint: string; disabled: boolean; apply: (codes: CodeDraft[]) => boolean }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const current = useRef(input)

  async function preview() {
    if (busy || !input.trim()) return
    const source = input
    setBusy(true); setError(''); setMessage('')
    try {
      const codes = bulkCodes(source, line.tracking, line.quantity)
      if (conflicts(codes)) throw new Error('يوجد رقم مكرر ضمن السطور المدخلة.')
      const response = await request<{ duplicate_positions: number[] }>(endpoint + '/validate-devices', {
        method: 'POST', body: { devices: codes.map(wireCode) },
      })
      if (current.current !== source) return
      if (response.data.duplicate_positions.length) {
        throw new Error('أرقام مسجلة من قبل في السطور ' + response.data.duplicate_positions.map(row => displayLine(row + 1)).join('، '))
      }
      if (!apply(codes)) throw new Error('يوجد رقم مكرر مع صنف آخر في السند.')
      setMessage('تمت تعبئة حقول القطع. راجعها قبل حفظ السند.')
    } catch (failure) {
      if (current.current === source) setError(failure instanceof Error ? failure.message : 'تعذّر فحص الأرقام.')
    } finally { setBusy(false) }
  }

  return <details className="form-section">
    <summary>إدخال أرقام القطع دفعة واحدة</summary>
    <label className="field">{line.tracking === 'serial' ? 'رقم مسلسل واحد في كل سطر' : 'IMEI 1 ثم IMEI 2 ثم الرقم المسلسل في كل سطر'}
      {line.tracking === 'imei' && <small>افصل الحقول بفاصلة أو انسخ الأعمدة من جدول. يمكن ترك الحقلين الأخيرين فارغين.</small>}
      <textarea value={input} onChange={event => { current.current = event.target.value; setInput(current.current); setError(''); setMessage('') }}
        rows={4} maxLength={8000} dir="ltr" spellCheck={false} disabled={disabled || busy} />
    </label>
    <button className="secondary" type="button" onClick={preview} disabled={disabled || busy || !input.trim()}>{busy ? 'جارٍ فحص الأرقام…' : 'افحص الأرقام وعبّئ الحقول'}</button>
    {error && <Notice error>{error}</Notice>}
    {message && <Notice>{message}</Notice>}
  </details>
}

export function RetailReceipt({ endpoint, close, done }: { endpoint: string; close: () => void; done: () => void }) {
  const [branch, setBranch] = useState(1)
  const [ref, setRef] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [product, setProduct] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [packSize, setPackSize] = useState(1)
  const [scale, setScale] = useState(1)
  const [pack, setPack] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const latestLines = useRef(lines)
  latestLines.current = lines
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const id = Number(product)
    setPack(false); setPackSize(1); setScale(1)
    if (!Number.isSafeInteger(id) || id < 1) return
    const abort = new AbortController()
    request<Row>('/products/' + id, { signal: abort.signal }).then(result => {
      if (abort.signal.aborted) return
      setScale(quantityScale(result.data.quantity_scale))
      if (trackingOf(result.data.tracking) === 'quantity') setPackSize(Number(result.data.units_per_pack) || 1)
    }).catch(() => { /* Adding the line shows a lookup error if the item is unavailable. */ })
    return () => abort.abort()
  }, [product])

  async function add() {
    if (busy) return
    setError('')
    const id = Number(product), count = Number(quantity) * (pack ? packSize : 1)
    if (!Number.isSafeInteger(id) || id < 1) { setError('اختر الصنف.'); return }
    if (lines.some(line => line.id === id)) { setError('الصنف موجود بالفعل في السند.'); return }
    setBusy(true)
    try {
      const { data } = await request<Row>('/products/' + id)
      const tracking = trackingOf(data.tracking)
      const scale = quantityScale(data.quantity_scale)
      if (!validQuantity(count, scale)) throw new Error('أدخل كمية صالحة بوحدة ' + measurementLabel(scale) + '.')
      if (tracking !== 'quantity' && count > 40) throw new Error('قسّم دفعة الأجهزة إلى سندات أصغر، حتى ٤٠ قطعة للصنف.')
      setLines(previous => [...previous, { id, name: String(data.name), tracking, quantity: count, scale, devices: tracking === 'quantity' ? [] : Array.from({ length: count }, blankCode) }])
      setProduct(''); setQuantity('1')
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر إضافة الصنف.') }
    finally { setBusy(false) }
  }

  function setCode(lineId: number, unit: number, field: keyof CodeDraft, value: string) {
    setLines(previous => previous.map(line => line.id === lineId ? { ...line, devices: line.devices.map((device, index) => index === unit ? { ...device, [field]: value } : device) } : line))
  }

  function applyCodes(lineId: number, devices: CodeDraft[]) {
    const next = latestLines.current.map(line => line.id === lineId ? { ...line, devices } : line)
    if (conflicts(next.flatMap(line => line.devices))) return false
    latestLines.current = next
    setLines(next)
    return true
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !lines.length) return
    setBusy(true); setError('')
    try {
      if (conflicts(lines.flatMap(line => line.devices))) throw new Error('راجع أرقام القطع المكررة قبل حفظ السند.')
      const items = lines.map(line => ({ product_id: line.id, quantity: line.quantity, devices: line.devices.length ? line.devices.map(wireCode) : undefined }))
      await request(endpoint, { method: 'POST', financial: true, body: { reference: ref.trim(), received_on: date || undefined, note: note.trim() || undefined, branch_id: branch, items } })
      done()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر تسجيل سند الاستلام.') }
    finally { setBusy(false) }
  }

  return <Modal title="تسجيل استلام" close={() => { if (!busy) close() }}>
    <form className="modal-form" onSubmit={submit}>
      <BranchSelect label="فرع الاستلام" value={branch} set={setBranch} disabled={busy} />
      <label className="field">مرجع الاستلام<input required maxLength={100} value={ref} disabled={busy} onChange={event => setRef(event.target.value)} /></label>
      <label className="field">تاريخ الاستلام<input type="date" value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></label>
      <fieldset className="panel panel-inner form-section" disabled={busy}><legend>إضافة صنف إلى الاستلام</legend>
        <FormInput field={productField} value={product} set={setProduct} />
      {packSize > 1 && <label className="check-field"><input type="checkbox" checked={pack} onChange={event => setPack(event.target.checked)} /> الكمية بالعبوات ({packSize} قطعة لكل عبوة)</label>}
        <label className="field">الكمية المستلمة ({measurementLabel(scale)})<input type="number" min={quantityStep(scale)} step={quantityStep(scale)} max={1000000 / scale} value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <button className="secondary" type="button" onClick={add} disabled={lines.length >= 40}>أضف صنفًا</button>
      </fieldset>
      {lines.map(line => <fieldset className="panel panel-inner form-section" key={line.id} disabled={busy}>
        <legend>{line.name} · {formatQuantity(stockQuantity(line.quantity, line.scale), line.scale)}</legend>
        {line.devices.length > 0 && <ReceiptBulkCodes line={line} endpoint={endpoint} disabled={busy} apply={codes => applyCodes(line.id, codes)} />}
        {line.devices.map((device, index) => <div className="form-grid" key={index}>
          <label className="field">رقم مسلسل القطعة {index + 1}
            <input required={line.tracking === 'serial'} maxLength={100} value={device.serial_number} onChange={event => setCode(line.id, index, 'serial_number', event.target.value)} />
          </label>
          {line.tracking === 'imei' && <>
            <label className="field">IMEI 1 للقطعة {index + 1}<input required inputMode="numeric" pattern="[0-9]{15}" value={device.imei1} onChange={event => setCode(line.id, index, 'imei1', event.target.value)} /></label>
            <label className="field">IMEI 2 للقطعة {index + 1} (اختياري)<input inputMode="numeric" pattern="[0-9]{15}" value={device.imei2} onChange={event => setCode(line.id, index, 'imei2', event.target.value)} /></label>
          </>}
        </div>)}
        <button type="button" className="link-button" onClick={() => setLines(previous => previous.filter(item => item.id !== line.id))}>احذف {line.name}</button>
      </fieldset>)}
      <label className="field">الملاحظات<textarea maxLength={500} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
      {error && <Notice error>{error}</Notice>}
      <div className="form-actions"><button className="primary" disabled={busy || !lines.length}>{busy ? 'جارٍ التسجيل…' : 'احفظ الاستلام'}</button>
        <button className="secondary" type="button" disabled={busy} onClick={close}>إلغاء</button></div>
    </form>
  </Modal>
}
