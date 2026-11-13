import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ZodError } from 'zod'
import { adminPermissions, adminRoutes, notifications } from './admin'
import { allowedOrigin, authRequired, protectedAuth, publicAuth } from './auth'
import { backup } from './backup'
import { business, businessPermissions } from './business'
import { catalog, catalogPermissions } from './catalog'
import { customerLedger } from './customer-ledger'
import { dashboard } from './dashboard'
import { ApiError, fail, ok } from './http'
import type { ApiEnv } from './http'
import { mobileCompatibility } from './mobile-compat'
import { mobileWriteCompatibility } from './mobile-write-compat'
import { retailDeviceErrors } from './retail-devices'
import { retailMargin } from './retail-margin'
import { retailAccountant, retailAccountantPermissions } from './retail-accountant'

const app = new Hono<ApiEnv>()

app.use('*', async (c, next) => {
  c.header('Cache-Control', 'private, no-store')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  const origin = c.req.header('Origin')
  if (origin && !allowedOrigin(c, origin)) fail(403, 'origin_denied', 'مصدر الطلب غير مسموح.')
  await next()
})

app.use('/api/*', cors({
  origin: (origin, c) => origin && allowedOrigin(c, origin) ? origin : undefined,
  allowHeaders: ['Content-Type', 'Authorization', 'X-CSRF', 'Idempotency-Key'],
  allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  maxAge: 600,
}))

app.get('/health', async (c) => {
  const settings = await c.env.DB.prepare('SELECT 1 FROM settings WHERE id = 1').first()
  if (!settings) fail(503, 'database_not_ready', 'قاعدة البيانات قيد التهيئة.')
  return ok(c, { status: 'ok', database: 'ready' })
})

const api = new Hono<ApiEnv>()
api.route('/', publicAuth)
api.use('*', authRequired)
api.route('/', mobileWriteCompatibility)
api.route('/', mobileCompatibility)
api.route('/', protectedAuth)
api.route('/', dashboard)
api.route('/', catalog)
api.route('/', customerLedger)
api.route('/', adminRoutes([...catalogPermissions, ...adminPermissions, ...businessPermissions, ...retailAccountantPermissions, 'backup.export']))
api.route('/', notifications)
api.route('/', business)
api.route('/', retailMargin)
api.route('/', retailAccountant)
api.route('/', backup)
app.route('/api/v1', api)

app.notFound((c) => c.json({ success: false, code: 'not_found', message: 'المسار المطلوب غير موجود.' }, 404))

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json({ success: false, code: error.code, message: error.message }, error.status)
  }
  if (error instanceof ZodError) {
    return c.json({
      success: false, code: 'validation', message: 'راجع بيانات الطلب.',
      fields: error.issues.map((issue) => issue.path.join('.')),
    }, 422)
  }
  const message = error instanceof Error ? error.message : ''
  if (message.includes('RETAIL_PACK_BARCODE') || message.includes('products.pack_barcode')) {
    return c.json({ success: false, code: 'RETAIL_PACK_BARCODE', message: 'استخدم باركود عبوة فريدًا، وصنفًا بالكمية يحتوي على قطعتين على الأقل في العبوة.' }, 409)
  }
  const deviceRule = retailDeviceErrors.find(([code]) => message.includes(code))
  if (deviceRule) {
    const [code, message] = deviceRule
    return c.json({ success: false, code, message }, 409)
  }
  if (message.includes('last_active_superadmin')) {
    return c.json({ success: false, code: 'last_admin', message: 'يجب أن يبقى حساب مسؤول عام نشط واحد على الأقل.' }, 409)
  }
  if (message.includes('product_has_stock')) {
    return c.json({ success: false, code: 'product_has_stock', message: 'سجّل حركة لتصفير المخزون قبل أرشفة المنتج.' }, 409)
  }
  if (message.includes('product_images_demo_limit')) {
    return c.json({ success: false, code: 'image_limit', message: 'بلغت النسخة التجريبية حد الصور المسموح.' }, 409)
  }
  if (/UNIQUE constraint failed/i.test(message)) {
    return c.json({ success: false, code: 'duplicate', message: 'هذه القيمة مسجلة بالفعل.' }, 409)
  }
  if (/FOREIGN KEY constraint failed/i.test(message)) {
    return c.json({ success: false, code: 'linked_record', message: 'لا يمكن تنفيذ العملية بسبب ارتباط السجل ببيانات أخرى.' }, 409)
  }
  if (/SQLITE_(BUSY|LOCKED|FULL)|exceeded.*(?:limit|quota)|(?:limit|quota).*exceeded/i.test(message)) {
    return c.json({ success: false, code: 'service_capacity', message: 'الخدمة غير متاحة الآن. تحقّق من نتيجة العملية قبل إعادة المحاولة.' }, 503)
  }
  return c.json({ success: false, code: 'unexpected', message: 'حدث خطأ غير متوقع.' }, 500)
})

export default app
