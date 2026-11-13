import { Hono } from 'hono'
import { z } from 'zod'
import { credentialMode, emailSchema, hashPassword, issueAccessKey, passwordSchema, usernameSchema } from './auth'
import {
  auditedWrite, body, fail, hasPermission, identifier, notFoundIfUnchanged, ok,
  patchStatement, permit, searchPrefix, searchText, selectPage, timestamp,
} from './http'
import type { ApiContext, ApiEnv } from './http'

export const adminPermissions = [
  'staff.view', 'staff.create', 'staff.update', 'staff.reset_password',
  'roles.view', 'roles.create', 'roles.update', 'roles.delete',
  'settings.view', 'settings.update', 'notifications.create', 'notifications.delete',
]

const humanName = z.string().trim().min(1).max(150)
const nullableText = z.string().trim().max(500).nullable().optional()
const active = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform(Number)
const staffDetails = z.object({
  name: humanName,
  username: usernameSchema.nullable().optional(),
  email: emailSchema,
  role_id: z.number().int().positive(),
  active: active.optional(),
}).strict()
const staffCreate = z.union([
  staffDetails.extend({ credential_mode: z.literal('password').optional(), password: passwordSchema }),
  staffDetails.extend({ credential_mode: z.literal('access_key') }),
])
const staffEdit = staffDetails.partial()
const staffTable = 'users u JOIN roles r ON r.id = u.role_id'
const staffFields = `u.id, u.name, u.username, u.email, u.role_id, r.name AS role, u.active, u.created_at, u.updated_at,
  ${credentialMode} AS credential_mode`
const roleFields = `r.id, r.name, r.is_system, r.created_at,
  (SELECT json_group_array(permission) FROM role_permissions WHERE role_id = r.id) AS permissions_json`
const settings = z.object({
  store_name: z.string().trim().min(1).max(200),
  currency: z.literal('EGP'),
  store_phone: nullableText,
  store_address: nullableText,
  receipt_footer: nullableText,
}).strict().partial()

function requireSuperadmin(c: ApiContext) {
  if (!hasPermission(c.get('actor'), '*')) fail(403, 'superadmin_required', 'هذه العملية متاحة للمسؤول العام فقط.')
}

async function staffMember(c: ApiContext, id: number) {
  const member = await c.env.DB.prepare(`SELECT ${staffFields} FROM ${staffTable} WHERE u.id = ?`).bind(id).first()
  if (!member) fail(404, 'not_found', 'الموظف غير موجود.')
  return member
}

function roleView<T extends { permissions_json: string }>(row: T) {
  const { permissions_json, ...record } = row
  return { ...record, permissions: JSON.parse(permissions_json) as string[] }
}

type RoleRow = { id: number; name: string; is_system: number; created_at: string; permissions_json: string }

async function editableRole(c: ApiContext, id: number) {
  const record = await c.env.DB.prepare(`SELECT ${roleFields} FROM roles r WHERE id = ?`).bind(id).first<RoleRow>()
  if (!record) fail(404, 'not_found', 'الدور غير موجود.')
  if (record.is_system) fail(409, 'protected_role', 'لا يمكن تعديل دور النظام.')
  return roleView(record)
}

export function adminRoutes(allPermissions: string[]) {
  const admin = new Hono<ApiEnv>()
  const known = new Set(allPermissions)
  const role = z.object({
    name: z.string().trim().min(1).max(80),
    permissions: z.array(z.string().refine((value) => known.has(value))).max(90)
      .transform((values) => [...new Set(values)]),
  }).strict()

  admin.get('/staff', permit('staff.view'), (c) => {
    const q = searchText.optional().parse(c.req.query('q'))
    return selectPage(c, staffFields, staffTable, q ? "WHERE u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\'" : '',
      q ? [searchPrefix(q), searchPrefix(q)] : [], 'u.id DESC')
  })

  admin.post('/staff', permit('staff.create'), async (c) => {
    requireSuperadmin(c)
    const data = await body(c, staffCreate)
    const db = c.env.DB
    const credential = data.credential_mode === 'access_key'
      ? await issueAccessKey(c)
      : { hash: await hashPassword(c, data.password), key: undefined }
    const result = await auditedWrite(c, db.prepare(`
      INSERT INTO users (name, username, email, password_hash, role_id, active) VALUES (?, ?, ?, ?, ?, ?)
    `).bind(data.name, data.username ?? null, data.email, credential.hash, data.role_id, data.active ?? 1),
    'create', 'staff', null)
    return ok(c, { ...await staffMember(c, result.meta.last_row_id), access_key: credential.key }, 201)
  })

  admin.patch('/staff/:id', permit('staff.update'), async (c) => {
    requireSuperadmin(c)
    const id = identifier.parse(c.req.param('id'))
    const changes = await body(c, staffEdit)
    const db = c.env.DB
    const [result] = await db.batch([
      patchStatement(db, 'users', changes, id),
      db.prepare(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
        SELECT ?, 'update', 'staff', ? WHERE changes() > 0`).bind(c.get('actor').id, id),
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND active = 0)').bind(id, id),
    ])
    notFoundIfUnchanged(result)
    return ok(c, await staffMember(c, id))
  })

  async function resetCredential(c: ApiContext, id: number, hash: string, action: 'reset_password' | 'reset_access_key') {
    const db = c.env.DB
    const [result] = await db.batch([
      db.prepare(`UPDATE users SET password_hash = ?, updated_at = ${timestamp} WHERE id = ?`)
        .bind(hash, id),
      db.prepare(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
        SELECT ?, ?, 'staff', ? WHERE changes() > 0`).bind(c.get('actor').id, action, id),
      db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(id),
    ])
    notFoundIfUnchanged(result)
  }

  admin.post('/staff/:id/password', permit('staff.reset_password'), async (c) => {
    requireSuperadmin(c)
    const id = identifier.parse(c.req.param('id'))
    const { password } = await body(c, z.object({ password: passwordSchema }).strict())
    await resetCredential(c, id, await hashPassword(c, password), 'reset_password')
    return ok(c, { id })
  })

  admin.post('/staff/:id/access-key', permit('staff.reset_password'), async (c) => {
    requireSuperadmin(c)
    const id = identifier.parse(c.req.param('id'))
    if (id === c.get('actor').id) fail(422, 'use_profile', 'جدّد مفتاح حسابك من الملف الشخصي.')
    const credential = await issueAccessKey(c)
    await resetCredential(c, id, credential.hash, 'reset_access_key')
    return ok(c, { id, access_key: credential.key })
  })

  admin.get('/roles', permit('roles.view'), async (c) => {
    const records = await c.env.DB.prepare(`SELECT ${roleFields} FROM roles r ORDER BY id LIMIT 100`).all<RoleRow>()
    return ok(c, records.results.map(roleView))
  })

  admin.get('/roles/permissions', permit('roles.view'), (c) => ok(c, [...known].sort()))

  admin.post('/roles', permit('roles.create'), async (c) => {
    requireSuperadmin(c)
    const { name, permissions } = await body(c, role)
    const db = c.env.DB
    const [result] = await db.batch([
      db.prepare('INSERT INTO roles (name) VALUES (?)').bind(name),
      db.prepare(`INSERT INTO role_permissions (role_id, permission)
        SELECT r.id, j.value FROM roles r CROSS JOIN json_each(?) j WHERE r.name = ?`)
        .bind(JSON.stringify(permissions), name),
      db.prepare(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
        SELECT ?, 'create', 'role', id FROM roles WHERE name = ?`).bind(c.get('actor').id, name),
    ])
    return ok(c, await editableRole(c, result.meta.last_row_id), 201)
  })

  admin.patch('/roles/:id', permit('roles.update'), async (c) => {
    requireSuperadmin(c)
    const id = identifier.parse(c.req.param('id'))
    const data = await body(c, role)
    await editableRole(c, id)
    const db = c.env.DB
    const [result] = await db.batch([
      db.prepare('UPDATE roles SET name = ? WHERE id = ? AND is_system = 0').bind(data.name, id),
      db.prepare('DELETE FROM role_permissions WHERE role_id = ?').bind(id),
      db.prepare(`INSERT INTO role_permissions (role_id, permission)
        SELECT r.id, j.value FROM roles r CROSS JOIN json_each(?) j WHERE r.id = ? AND r.is_system = 0`)
        .bind(JSON.stringify(data.permissions), id),
      db.prepare(`INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
        SELECT ?, 'update', 'role', id FROM roles WHERE id = ?`).bind(c.get('actor').id, id),
    ])
    notFoundIfUnchanged(result)
    return ok(c, await editableRole(c, id))
  })

  admin.delete('/roles/:id', permit('roles.delete'), async (c) => {
    requireSuperadmin(c)
    const id = identifier.parse(c.req.param('id'))
    await editableRole(c, id)
    const result = await auditedWrite(c, c.env.DB.prepare('DELETE FROM roles WHERE id = ? AND is_system = 0').bind(id),
      'delete', 'role', id)
    notFoundIfUnchanged(result)
    return ok(c, { id })
  })

  admin.get('/settings', permit('settings.view'), async (c) =>
    ok(c, await c.env.DB.prepare('SELECT * FROM settings WHERE id = 1').first()))

  admin.patch('/settings', permit('settings.update'), async (c) => {
    const changes = await body(c, settings)
    const db = c.env.DB
    await auditedWrite(c, patchStatement(db, 'settings', changes, 1), 'update', 'settings', 1)
    return ok(c, await db.prepare('SELECT * FROM settings WHERE id = 1').first())
  })

  return admin
}

const notification = z.object({
  user_id: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
}).strict()

export const notifications = new Hono<ApiEnv>()

notifications.get('/notifications', (c) => {
  const id = c.get('actor').id
  return selectPage(c,
    'n.id, n.user_id, n.title, n.body, n.body AS message, n.created_at, r.read_at',
    'notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?',
    'WHERE n.user_id IS NULL OR n.user_id = ?', [id, id], 'n.id DESC',
    (record) => ({ ...record, is_read: record.read_at != null }))
})

notifications.post('/notifications', permit('notifications.create'), async (c) => {
  const data = await body(c, notification)
  const db = c.env.DB
  const actorId = c.get('actor').id
  const result = await auditedWrite(c,
    db.prepare('INSERT INTO notifications (user_id, title, body, created_by) VALUES (?, ?, ?, ?)')
      .bind(data.user_id ?? null, data.title, data.body, actorId),
    'create', 'notification', null)
  return ok(c, await db.prepare('SELECT id, user_id, title, body, created_at FROM notifications WHERE id = ?')
    .bind(result.meta.last_row_id).first(), 201)
})

notifications.post('/notifications/read-all', async (c) => {
  const userId = c.get('actor').id
  await c.env.DB.prepare(`INSERT INTO notification_reads (notification_id, user_id)
    SELECT id, ? FROM notifications WHERE user_id = ? OR user_id IS NULL
    ON CONFLICT DO NOTHING`).bind(userId, userId).run()
  return ok(c, { read: true })
})

notifications.post('/notifications/:id/read', async (c) => {
  const id = identifier.parse(c.req.param('id'))
  const userId = c.get('actor').id
  const db = c.env.DB
  const [marked, existing] = await db.batch([
    db.prepare(`INSERT INTO notification_reads (notification_id, user_id)
      SELECT id, ? FROM notifications WHERE id = ? AND (user_id = ? OR user_id IS NULL)
      ON CONFLICT DO NOTHING`).bind(userId, id, userId),
    db.prepare('SELECT 1 FROM notification_reads WHERE notification_id = ? AND user_id = ?').bind(id, userId),
  ])
  if (!marked.meta.changes && !existing.results.length) fail(404, 'not_found', 'الإشعار غير موجود.')
  return ok(c, { id, read: true })
})

notifications.delete('/notifications/:id', permit('notifications.delete'), async (c) => {
  const id = identifier.parse(c.req.param('id'))
  const result = await auditedWrite(c, c.env.DB.prepare('DELETE FROM notifications WHERE id = ?').bind(id),
    'delete', 'notification', id)
  notFoundIfUnchanged(result)
  return ok(c, { id })
})
