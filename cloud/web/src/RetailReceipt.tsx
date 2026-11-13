import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { request } from './api'
import { FormInput, Modal, Notice } from './ui'
import type { Field, Row } from './ui'
import { trackingOf } from './RetailDevices'
import type { Tracking } from './RetailDevices'

type CodeDraft = { serial_number: string; imei1: string; imei2: string }
type Line = { id: number; name: string; tracking: Tracking; quantity: number; devices: CodeDraft[] }
const productField: Field = { name: 'product_id', label: 'الصنف المستلم', kind: 'reference', reference: { path: '/products' } }
const blankCode = () => ({ serial_number: '', imei1: '', imei2: '' })

export function RetailReceipt({ endpoint, close, done }: { endpoint: string; close: () => void; done: () => void }) {
  const [ref, setRef] = useState('')
  const [date, setDate] = useState('')
  const [note, setNote] = useState('')
  const [product, setProduct] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [packSize, setPackSize] = useState(1)
  const [pack, setPack] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const id = Number(product)
    setPack(false); setPackSize(1)
    if (!Number.isSafeInteger(id) || id < 1) return
    const abort = new AbortController()
    request<Row>('/products/' + id, { signal: abort.signal }).then(result => {
      if (!abort.signal.aborted && trackingOf(result.data.tracking) === 'quantity') setPackSize(Number(result.data.units_per_pack) || 1)
    }).catch(() => { /* Adding the line shows a lookup error if the item is unavailable. */ })
    return () => abort.abort()
  }, [product])

  async function add() {
    if (busy) return
    setError('')
    const id = Number(product), count = Number(quantity) * (pack ? packSize : 1)
    if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(count) || count < 1 || count > 1_000_000) { setError('اختر الصنف والكمية الصحيحة.'); return }
    if (lines.some(line => line.id === id)) { setError('الصنف موجود بالفعل في السند.'); return }
    setBusy(true)
    try {
      const { data } = await request<Row>('/products/' + id)
      const tracking = trackingOf(data.tracking)
      if (tracking !== 'quantity' && count > 40) throw new Error('قسّم دفعة الأجهزة إلى سندات أصغر، حتى ٤٠ قطعة للصنف.')
      setLines(previous => [...previous, { id, name: String(data.name), tracking, quantity: count, devices: tracking === 'quantity' ? [] : Array.from({ length: count }, blankCode) }])
      setProduct(''); setQuantity('1')
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر إضافة الصنف.') }
    finally { setBusy(false) }
  }

  function setCode(lineId: number, unit: number, field: keyof CodeDraft, value: string) {
    setLines(previous => previous.map(line => line.id === lineId ? { ...line, devices: line.devices.map((device, index) => index === unit ? { ...device, [field]: value } : device) } : line))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy || !lines.length) return
    setBusy(true); setError('')
    try {
      const items = lines.map(line => ({ product_id: line.id, quantity: line.quantity, devices: line.devices.length ? line.devices.map(code => ({
        serial_number: code.serial_number.trim() || undefined, imei1: code.imei1.trim() || undefined, imei2: code.imei2.trim() || undefined,
      })) : undefined }))
      await request(endpoint, { method: 'POST', financial: true, body: { reference: ref.trim(), received_on: date || undefined, note: note.trim() || undefined, items } })
      done()
    } catch (error) { setError(error instanceof Error ? error.message : 'تعذّر تسجيل سند الاستلام.') }
    finally { setBusy(false) }
  }

  return <Modal title="تسجيل استلام" close={() => { if (!busy) close() }}>
    <form className="modal-form" onSubmit={submit}>
      <label className="field">مرجع الاستلام<input required maxLength={100} value={ref} disabled={busy} onChange={event => setRef(event.target.value)} /></label>
      <label className="field">تاريخ الاستلام<input type="date" value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></label>
      <fieldset className="panel panel-inner form-section" disabled={busy}><legend>إضافة صنف إلى الاستلام</legend>
        <FormInput field={productField} value={product} set={setProduct} />
      {packSize > 1 && <label className="check-field"><input type="checkbox" checked={pack} onChange={event => setPack(event.target.checked)} /> الكمية بالعبوات ({packSize} قطعة لكل عبوة)</label>}
        <label className="field">الكمية المستلمة<input type="number" min={1} max={1000000} value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
        <button className="secondary" type="button" onClick={add} disabled={lines.length >= 40}>أضف صنفًا</button>
      </fieldset>
      {lines.map(line => <fieldset className="panel panel-inner form-section" key={line.id} disabled={busy}>
        <legend>{line.name} · {line.quantity}</legend>
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
