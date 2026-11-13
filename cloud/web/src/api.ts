const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || ''

export const apiUrl = (path: string) => baseUrl + '/api/v1' + path

export interface User {
  id: number
  name: string
  email: string
  role: string
  permissions: string[]
  credential_mode?: 'password' | 'access_key'
}

export interface Pagination {
  page: number
  per_page: number
  total: number
}

interface Envelope<T> {
  success: boolean
  data: T
  meta?: Pagination
  message?: string
  code?: string
  error?: { message?: string } | string
}

export class RequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

const transientOperations = new Map<string, string>()

async function prepareOperation(path: string, payload: string) {
  const bytes = new TextEncoder().encode(path + '\n' + payload)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const fingerprint = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
  const storageKey = 'henra-operation-' + fingerprint
  let key = transientOperations.get(storageKey)
  try {
    key ??= sessionStorage.getItem(storageKey) || undefined
  } catch { /* In-memory fallback for restricted browser storage. */ }
  key ??= crypto.randomUUID()
  transientOperations.set(storageKey, key)
  try {
    sessionStorage.setItem(storageKey, key)
  } catch { /* In-memory fallback for restricted browser storage. */ }
  return {
    key,
    clear() {
      transientOperations.delete(storageKey)
      try {
        sessionStorage.removeItem(storageKey)
      } catch { /* No persistent key is accessible. */ }
    },
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  file?: File
  financial?: boolean
  idempotencyKey?: string
  signal?: AbortSignal
}

const errors: Record<number, string> = {
  400: 'تعذر تنفيذ الطلب. راجع البيانات المدخلة.',
  401: 'تعذر تسجيل الدخول. تحقق من اسم الدخول وكلمة المرور أو سجّل الدخول مجددًا.',
  403: 'ليست لديك صلاحية لتنفيذ هذا الإجراء.',
  404: 'السجل المطلوب غير موجود.',
  409: 'تعارضت العملية مع حالة السجل أو المخزون. راجع أحدث البيانات قبل المتابعة.',
  422: 'راجع البيانات المدخلة وحاول مجددًا.',
  429: 'تم بلوغ حد الطلبات مؤقتًا. حاول مجددًا بعد قليل.',
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  const method = options.method || 'GET'
  const body = options.file ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  const operation = options.financial && !options.idempotencyKey ? await prepareOperation(path, typeof body === 'string' ? body : '') : undefined
  const operationKey = options.idempotencyKey || operation?.key
  const headers = new Headers({ Accept: 'application/json' })
  if (body !== undefined) headers.set('Content-Type', options.file?.type || 'application/json')
  if (method !== 'GET') headers.set('X-CSRF', '1')
  if (operationKey) headers.set('Idempotency-Key', operationKey)
  let response: Response
  try {
    response = await fetch(apiUrl(path), {
      method,
      body,
      headers,
      credentials: 'include',
      cache: 'no-store',
      signal: options.signal,
    })
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new RequestError(
      operationKey ? 'تعذر تأكيد العملية. أعد المحاولة بالبيانات نفسها أو راجع سجل العمليات.' : 'تعذر الاتصال بالخادم.',
      0,
    )
  }

  const result: Envelope<T> | null = await response.json().catch(() => null)
  if (!response.ok || result?.success === false) {
    if (response.status === 401 && path !== '/auth/login') {
      window.dispatchEvent(new Event('henra-session-expired'))
    }
    if (response.status < 500 && ![408, 409, 429].includes(response.status)) operation?.clear()
    const detail = typeof result?.error === 'string' ? result.error : result?.error?.message
    const fallback = errors[response.status] || 'الخدمة غير متاحة مؤقتًا.'
    const message = operationKey && response.status >= 500
      ? 'تعذر تأكيد العملية. أعد المحاولة بالبيانات نفسها أو راجع سجل العمليات.'
      : [fallback, result?.message || detail].filter(Boolean).join(' ')
    throw new RequestError(message, response.status, result?.code)
  }
  if (!result) {
    if (response.status === 204) {
      operation?.clear()
      return { success: true, data: undefined as T }
    }
    throw new RequestError(
      operationKey ? 'تعذر قراءة نتيجة العملية. أعد المحاولة بالبيانات نفسها أو راجع سجل العمليات.' : 'تعذر قراءة استجابة الخادم.',
      response.status,
    )
  }
  operation?.clear()
  return result
}

const currency = new Intl.NumberFormat('ar-EG', { style: 'currency', currency: 'EGP' })
const fractionDigits = new Intl.NumberFormat('ar-EG', { minimumIntegerDigits: 2, useGrouping: false })

function splitMinor(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined
  const minor = BigInt(value)
  const absolute = minor < 0n ? -minor : minor
  return { negative: minor < 0n, whole: absolute / 100n, fraction: absolute % 100n }
}

export function money(value: unknown): string {
  const amount = splitMinor(value)
  if (!amount) return '—'
  const whole = amount.negative ? (amount.whole ? -amount.whole : -0) : amount.whole
  return currency.formatToParts(whole).map(part => part.type === 'fraction' ? fractionDigits.format(amount.fraction) : part.value).join('')
}

export function decimal(value: unknown): string {
  const amount = splitMinor(value)
  if (!amount) return ''
  return (amount.negative ? '-' : '') + amount.whole.toString() + '.' + amount.fraction.toString().padStart(2, '0')
}
export const integer = (value: unknown) => Number.isSafeInteger(value) ? Number(value).toLocaleString('ar-EG') : '—'

export function readMoney(value: string): number {
  const normalized = value.trim().replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632)).replace('٫', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new Error('أدخل مبلغًا صالحًا بمنزلتين عشريتين على الأكثر.')
  const [whole, fraction = ''] = normalized.split('.')
  const minor = Number(whole + fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(minor)) throw new Error('المبلغ المدخل خارج النطاق المسموح.')
  return minor
}

export function formatDate(value: unknown): string {
  if (typeof value !== 'string' || value === '') return '—'
  const parsed = new Date(value.includes(' ') ? value.replace(' ', 'T') + 'Z' : value)
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo' })
}

export function allowed(user: User, permission?: string): boolean {
  return !permission || user.permissions?.includes('*') || user.permissions?.includes(permission)
}
