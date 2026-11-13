import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { z } from 'zod'
import { body, fail, ok, timestamp } from './http'
import type { Actor, ApiContext, ApiEnv } from './http'

const cookieName = 'henra_store_session'
const sessionSeconds = 8 * 60 * 60
const rounds = 100000
const encoder = new TextEncoder()
const tokenPattern = /^[a-zA-Z0-9_-]{43}$/
const hashPattern = /^pbkdf2-sha256\$100000\$([a-zA-Z0-9_-]{22})\$([a-zA-Z0-9_-]{43})$/
const accessKeyPattern = /^hilal-ak1_[a-zA-Z0-9_-]{43}$/
const accessKeyHash = /^hmac-sha256\$1\$([a-zA-Z0-9_-]{22})\$([a-zA-Z0-9_-]{43})$/
const currentCredential = z.string().min(1).max(256)

export const emailSchema = z.string().trim().max(254).email().transform((value) => value.toLowerCase())
export const usernameSchema = z.string().trim().toLowerCase().min(1).max(80).regex(/^[a-z0-9._-]+$/)
export const passwordSchema = currentCredential.min(12).refine((value) => !accessKeyPattern.test(value))
const name = z.string().trim().min(1).max(150)
const login = z.union([
  z.object({ email: emailSchema, password: currentCredential }).strict(),
  z.object({ username: usernameSchema, password: currentCredential }).strict(),
])
const legacyLogin = z.object({
  username: usernameSchema,
  password: currentCredential,
  device_name: z.string().trim().min(1).max(80),
}).strict()
const passwordChange = z.object({
  current_password: currentCredential,
  new_password: passwordSchema,
}).strict()
const mobileProfile = z.object({
  name,
  email: emailSchema.nullish(),
  current_password: currentCredential.nullish(),
  password: passwordSchema.nullish(),
  password_confirmation: z.string().max(256).nullish(),
}).strict().refine((data) => !data.password || data.password === data.password_confirmation, {
  path: ['password_confirmation'],
})

function b64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding), (char) => char.charCodeAt(0))
}

function authPepper(c: ApiContext) {
  const secret = c.env.AUTH_PEPPER
  if (!secret || secret.length < 32) fail(503, 'auth_unconfigured', 'خدمة تسجيل الدخول غير مهيأة.')
  return secret
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', key, encoder.encode(value))
}

async function derive(password: string, pepper: string, salt: Uint8Array<ArrayBuffer>) {
  const input = await hmac(pepper, 'password-v1\0' + password)
  const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits'])
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, key, 256)
  return b64(new Uint8Array(hash))
}

export async function hashPassword(c: ApiContext, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(password, authPepper(c), salt)
  return `pbkdf2-sha256$${rounds}$${b64(salt)}$${hash}`
}

async function deriveAccessKey(secret: string, key: string, salt: string) {
  return b64(new Uint8Array(await hmac(secret, `access-key-v1\0${salt}\0${key}`)))
}

export async function issueAccessKey(c: ApiContext) {
  const key = 'hilal-ak1_' + b64(crypto.getRandomValues(new Uint8Array(32)))
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)))
  const digest = await deriveAccessKey(authPepper(c), key, salt)
  return { key, hash: `hmac-sha256$1$${salt}$${digest}` }
}

function matchesHash(hash: string, expected: string | undefined) {
  if (!expected) return false
  let difference = 0
  for (let i = 0; i < hash.length; i++) difference |= hash.charCodeAt(i) ^ expected.charCodeAt(i)
  return difference === 0
}

async function verify(c: ApiContext, credential: string, stored?: string) {
  const pepper = authPepper(c)
  const passwordMatch = stored?.match(hashPattern)
  if (accessKeyPattern.test(credential) && !passwordMatch) {
    const match = stored?.match(accessKeyHash)
    const hash = await deriveAccessKey(pepper, credential, match?.[1] ?? 'AAAAAAAAAAAAAAAAAAAAAA')
    return matchesHash(hash, match?.[2])
  }
  const salt = passwordMatch ? unb64(passwordMatch[1]) : new Uint8Array(16)
  const hash = await derive(credential, pepper, salt)
  return matchesHash(hash, passwordMatch?.[2])
}

async function hashToken(token: string) {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))))
}

function secureCookie(c: ApiContext) {
  return c.req.url.startsWith('https://') || c.env.WEB_ORIGIN?.startsWith('https://') === true
}

export function allowedOrigin(c: ApiContext, origin: string) {
  return origin === new URL(c.req.url).origin || origin === c.env.WEB_ORIGIN
}

async function throttle(c: ApiContext, account: string, action: string) {
  const ip = c.req.header('CF-Connecting-IP')?.slice(0, 80) ?? 'local'
  const secret = authPepper(c)
  const buckets = await Promise.all([
    hmac(secret, `throttle-v1\0${action}\0ip\0${ip}`),
    hmac(secret, `throttle-v1\0${action}\0account\0${account}`),
  ])
  const now = Math.floor(Date.now() / 1000)
  const windowStart = now - now % 300
  const db = c.env.DB
  const increment = `
    INSERT INTO auth_attempts (bucket, window_start, attempts) VALUES (?, ?, 1)
    ON CONFLICT (bucket) DO UPDATE SET
      attempts = CASE WHEN window_start = excluded.window_start THEN min(attempts + 1, 1000) ELSE 1 END,
      window_start = excluded.window_start
    RETURNING attempts
  `
  const [ipLimit, accountLimit] = await db.batch<{ attempts: number }>([
    ...buckets.map((bucket) => db.prepare(increment).bind(b64(new Uint8Array(bucket)), windowStart)),
    db.prepare('DELETE FROM auth_attempts WHERE window_start < ?').bind(now - 900),
  ])
  if (Number(ipLimit.results[0].attempts) > 60 || Number(accountLimit.results[0].attempts) > 10) {
    c.header('Retry-After', String(windowStart + 300 - now))
    fail(429, 'rate_limited', 'تجاوزت عدد المحاولات المسموح. حاول بعد بضع دقائق.')
  }
}

type Identity = {
  id: number
  name: string
  email: string
  username: string | null
  role: string
  credential_mode: Actor['credential_mode']
  permissions_json: string
}

export const credentialMode = `CASE WHEN u.password_hash GLOB 'hmac-sha256$1$*' THEN 'access_key' ELSE 'password' END`

const fields = `u.id, u.name, u.email, u.username, r.name AS role, ${credentialMode} AS credential_mode,
  (SELECT json_group_array(permission) FROM role_permissions WHERE role_id = r.id) AS permissions_json`

function actor(identity: Identity): Actor {
  const { permissions_json, ...user } = identity
  return { ...user, permissions: JSON.parse(permissions_json) as string[] }
}

export const authRequired: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const header = c.req.header('Authorization')
  const cookie = header === undefined
  const token = cookie ? getCookie(c, cookieName) : header.match(/^Bearer (\S+)$/i)?.[1]
  if (!token || !tokenPattern.test(token)) fail(401, 'unauthorized', 'سجل الدخول للمتابعة.')
  const hash = await hashToken(token)
  const identity = await c.env.DB.prepare(`
    SELECT ${fields} FROM auth_sessions s JOIN users u ON u.id = s.user_id
    JOIN roles r ON r.id = u.role_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
  `).bind(hash, Math.floor(Date.now() / 1000)).first<Identity>()
  if (!identity) fail(401, 'unauthorized', 'سجل الدخول للمتابعة.')
  if (cookie && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin')
    if (!origin || !allowedOrigin(c, origin) || c.req.header('X-CSRF') !== '1') {
      fail(403, 'csrf', 'مصدر الطلب غير مسموح.')
    }
  }
  c.set('actor', actor(identity))
  c.set('sessionHash', hash)
  c.set('credential', cookie ? 'cookie' : 'bearer')
  await next()
}

async function signIn(c: ApiContext, field: 'email' | 'username', identifier: string, password: string) {
  const db = c.env.DB
  const row = await db.prepare(`
    SELECT ${fields}, u.password_hash FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.${field} = ? AND u.active = 1
  `).bind(identifier).first<Identity & { password_hash: string }>()
  await throttle(c, row ? `user:${row.id}` : `${field}:${identifier}`, 'login')
  const verified = await verify(c, password, row?.password_hash)
  if (!row || !verified) fail(401, 'invalid_credentials', 'اسم الدخول أو بيانات الاعتماد غير صحيحة.')
  const token = b64(crypto.getRandomValues(new Uint8Array(32)))
  const now = Math.floor(Date.now() / 1000)
  const expires = now + sessionSeconds
  const [session] = await db.batch([
    db.prepare(`
      INSERT INTO auth_sessions (token_hash, user_id, expires_at)
      SELECT ?, id, ? FROM users WHERE id = ? AND active = 1 AND password_hash = ? AND ${field} = ?
    `).bind(await hashToken(token), expires, row.id, row.password_hash, identifier),
    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').bind(now),
    db.prepare(`
      DELETE FROM auth_sessions WHERE user_id = ? AND token_hash NOT IN
      (SELECT token_hash FROM auth_sessions WHERE user_id = ? ORDER BY expires_at DESC, rowid DESC LIMIT 10)
    `).bind(row.id, row.id),
  ])
  if (session.meta.changes !== 1) fail(401, 'invalid_credentials', 'اسم الدخول أو بيانات الاعتماد غير صحيحة.')
  const { password_hash: _, ...identity } = row
  return { user: actor(identity), token, expires_at: new Date(expires * 1000).toISOString() }
}

function mobileActor(user: Actor, hilalClient: boolean) {
  const permits = new Set<string>()
  for (const module of ['categories', 'customers', 'notifications', 'products']) {
    if (user.permissions.includes('*') || user.permissions.includes(`${module}.view`) || module === 'notifications') {
      permits.add(`page.${module}.view`)
    }
    if (['categories', 'customers'].includes(module)
      && (user.permissions.includes('*') || ['create', 'update', 'delete'].every((action) => user.permissions.includes(`${module}.${action}`)))) {
      permits.add(`page.${module}.manage`)
    }
  }
  if (hilalClient) {
    permits.add('hilal.android.v1')
    for (const [module, ...required] of [
      ['invoices', 'invoices.view'], ['installments', 'installments.view', 'debts.view'],
      ['maintenance', 'maintenance.view'], ['suppliers', 'suppliers.view'], ['sales', 'reports.view'],
      ['wallets', 'wallets.view'], ['wallet_cashier', 'wallets.view'], ['damaged', 'damaged.view'],
    ]) {
      if (user.permissions.includes('*') || required.every(permission => user.permissions.includes(permission))) permits.add(`page.${module}.view`)
    }
    for (const [clientPermission, permission] of [
      ['wallets.manage', 'wallets.manage'], ['wallet_cashier.manage', 'wallets.transact'],
      ['wallet_cashier.reverse', 'wallets.reverse'], ['damaged.manage', 'damaged.manage'],
      ['suppliers.manage', 'suppliers.manage'], ['maintenance.manage', 'maintenance.manage'],
      ['invoices.pay', 'invoices.pay'], ['invoices.refund', 'invoices.refund'],
      ['retail_shifts.operate', 'retail.shifts.operate'], ['retail_shifts.approve', 'retail.shifts.approve'],
      ['retail_devices.view', 'inventory.view'],
    ]) {
      if (user.permissions.includes('*') || user.permissions.includes(permission)) permits.add('page.' + clientPermission)
    }
    if (user.permissions.includes('*') || ['installments.manage', 'installments.pay', 'debts.manage', 'debts.pay'].every(permission => user.permissions.includes(permission))) {
      permits.add('page.installments.manage')
    }
    if (user.permissions.includes('*') || ['create', 'update', 'delete'].every(action => user.permissions.includes(`products.${action}`))) {
      permits.add('page.products.manage')
    }
  }
  if (user.permissions.includes('*') || user.permissions.includes('invoices.create')) {
    permits.add('page.invoices.manage')
  }
  return { id: user.id, name: user.name, username: user.username, roles: [user.role], permissions: [...permits] }
}

export const publicAuth = new Hono<ApiEnv>()

publicAuth.post('/auth/login', async (c) => {
  const credentials = await body(c, login)
  const session = 'email' in credentials
    ? await signIn(c, 'email', credentials.email, credentials.password)
    : await signIn(c, 'username', credentials.username, credentials.password)
  setCookie(c, cookieName, session.token, { path: '/', httpOnly: true, secure: secureCookie(c), sameSite: 'Lax', maxAge: sessionSeconds })
  return ok(c, { user: session.user, expires_at: session.expires_at })
})

publicAuth.post('/auth/token', async (c) => {
  const { username, password } = await body(c, legacyLogin)
  const session = await signIn(c, 'username', username, password)
  return c.json({
    data: { user: mobileActor(session.user, c.req.header('X-Store-Client') === 'android'), access_token: session.token, token_type: 'Bearer', expires_at: session.expires_at },
  }, 201)
})

export const protectedAuth = new Hono<ApiEnv>()

protectedAuth.get('/auth/me', (c) => ok(c, c.get('actor')))
protectedAuth.get('/me', (c) => c.json({ data: mobileActor(c.get('actor'), c.req.header('X-Store-Client') === 'android') }))
protectedAuth.get('/profile', (c) => ok(c, c.get('actor')))

protectedAuth.post('/auth/logout', async (c) => {
  await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(c.get('sessionHash')).run()
  deleteCookie(c, cookieName, { path: '/', httpOnly: true, secure: secureCookie(c), sameSite: 'Lax' })
  return ok(c, { logged_out: true })
})

protectedAuth.delete('/auth/token', async (c) => {
  if (c.get('credential') !== 'bearer') fail(401, 'token_required', 'أرسل رمز الوصول في ترويسة Authorization.')
  await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(c.get('sessionHash')).run()
  return c.body(null, 204)
})

async function renameProfile(c: ApiContext, displayName: string) {
  const user = c.get('actor')
  const db = c.env.DB
  await db.batch([
    db.prepare(`UPDATE users SET name = ?, updated_at = ${timestamp} WHERE id = ?`).bind(displayName, user.id),
    db.prepare("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id) VALUES (?, 'update', 'profile', ?)").bind(user.id, user.id),
  ])
  return { ...user, name: displayName }
}

protectedAuth.patch('/profile', async (c) => {
  const changes = await body(c, z.object({ name }).strict())
  return ok(c, await renameProfile(c, changes.name))
})

type CredentialChange = { password: string } | { generateAccessKey: true }

async function updateCredentials(
  c: ApiContext,
  current: string,
  change: CredentialChange | null,
  displayName: string | null,
  email: string,
) {
  const user = c.get('actor')
  await throttle(c, String(user.id), 'password')
  const db = c.env.DB
  const oldHash = await db.prepare('SELECT password_hash FROM users WHERE id = ? AND active = 1')
    .bind(user.id).first<string>('password_hash')
  if (!await verify(c, current, oldHash ?? undefined)) fail(403, 'invalid_credentials', 'بيانات الدخول الحالية غير صحيحة.')
  const key = change && 'generateAccessKey' in change ? await issueAccessKey(c) : null
  const hash = key?.hash ?? (change && 'password' in change ? await hashPassword(c, change.password) : oldHash)
  const action = key ? 'access_key_rotated' : change ? 'password_changed' : 'email_changed'
  const [updated] = await db.batch([
    db.prepare(`UPDATE users SET name = coalesce(?, name), email = ?, password_hash = ?, updated_at = ${timestamp}
      WHERE id = ? AND email = ? AND password_hash = ? AND active = 1`)
      .bind(displayName, email, hash, user.id, user.email, oldHash),
    db.prepare(`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
      SELECT ?, ?, 'profile', ? WHERE changes() = 1
    `).bind(user.id, action, user.id),
    db.prepare(`DELETE FROM auth_sessions WHERE user_id = ? AND token_hash <> ?
      AND EXISTS (SELECT 1 FROM users WHERE id = ? AND email = ? AND password_hash = ?)`)
      .bind(user.id, c.get('sessionHash'), user.id, email, hash),
  ])
  if (!updated.meta.changes) fail(409, 'password_changed', 'تغيرت بيانات الدخول. أعد المحاولة.')
  const mode = key ? 'access_key' as const : change ? 'password' as const : user.credential_mode
  return { user: { ...user, name: displayName ?? user.name, email, credential_mode: mode }, accessKey: key?.key }
}

protectedAuth.post('/profile/password', async (c) => {
  const { current_password, new_password } = await body(c, passwordChange)
  const user = c.get('actor')
  await updateCredentials(c, current_password, { password: new_password }, null, user.email)
  return ok(c, { password_changed: true })
})

protectedAuth.post('/profile/access-key', async (c) => {
  const { current_password } = await body(c, z.object({ current_password: currentCredential }).strict())
  const result = await updateCredentials(c, current_password, { generateAccessKey: true }, null, c.get('actor').email)
  return ok(c, { access_key: result.accessKey, credential_mode: 'access_key' })
})

protectedAuth.put('/profile', async (c) => {
  const data = await body(c, mobileProfile)
  const user = c.get('actor')
  const email = data.email ?? user.email
  if (email !== user.email || data.password) {
    if (!data.current_password) fail(422, 'current_password_required', 'أدخل كلمة المرور الحالية.')
    const { user: updated } = await updateCredentials(c, data.current_password, data.password ? { password: data.password } : null, data.name, email)
    return ok(c, updated)
  }
  return ok(c, await renameProfile(c, data.name))
})
