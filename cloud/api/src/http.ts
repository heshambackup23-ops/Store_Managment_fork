import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { z } from 'zod'

export type Actor = {
  id: number
  name: string
  email: string
  username: string | null
  role: string
  credential_mode: 'password' | 'access_key'
  permissions: string[]
}

export type ApiEnv = {
  Bindings: { DB: D1Database; AUTH_PEPPER?: string; WEB_ORIGIN?: string }
  Variables: { actor: Actor; sessionHash: string; credential: 'cookie' | 'bearer' }
}

export type ApiContext = Context<ApiEnv>
export type Paging = { page: number; limit: number; offset: number }
export const timestamp = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')"

export class ApiError extends Error {
  constructor(public status: ContentfulStatusCode, public code: string, message: string) {
    super(message)
  }
}

export function fail(status: ContentfulStatusCode, code: string, message: string): never {
  throw new ApiError(status, code, message)
}

export function ok<T>(c: ApiContext, data: T, status: 200 | 201 = 200) {
  return c.json({ success: true as const, data }, status)
}

export function paginated<T>(c: ApiContext, data: T[], total: number, paging: Paging) {
  return c.json({ success: true as const, data, meta: {
    page: paging.page, current_page: paging.page, per_page: paging.limit, total,
    last_page: Math.max(1, Math.ceil(total / paging.limit)),
  } })
}

export function hasPermission(actor: Actor, permission: string) {
  return actor.permissions.includes('*') || actor.permissions.includes(permission)
}

export function permit(permission: string): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    if (!hasPermission(c.get('actor'), permission)) {
      fail(403, 'forbidden', 'ليست لديك صلاحية لتنفيذ هذه العملية.')
    }
    await next()
  }
}

export function page(c: ApiContext): Paging {
  const query = z.object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    per_page: z.coerce.number().int().min(1).max(100).default(25),
  }).parse(c.req.query())
  return { page: query.page, limit: query.per_page, offset: (query.page - 1) * query.per_page }
}

export const identifier = z.coerce.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const searchText = z.string().trim().max(100)

export function searchPrefix(value: string) {
  return value.replace(/[\\%_]/g, (match) => '\\' + match) + '%'
}

export async function body<T>(c: ApiContext, schema: z.ZodType<T>): Promise<T> {
  if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    fail(415, 'content_type', 'نوع محتوى الطلب يجب أن يكون JSON.')
  }
  const stream = c.req.raw.body
  if (!stream) fail(400, 'invalid_json', 'أرسل بيانات JSON صالحة.')
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let length = 0
  let raw = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.length
      if (length > 65536) {
        await reader.cancel()
        fail(413, 'body_limit', 'حجم بيانات الطلب يتجاوز الحد المسموح.')
      }
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()
  } catch (error) {
    if (error instanceof ApiError) throw error
    fail(400, 'invalid_json', 'أرسل بيانات JSON صالحة.')
  } finally {
    reader.releaseLock()
  }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    fail(400, 'invalid_json', 'أرسل بيانات JSON صالحة.')
  }
  return schema.parse(value)
}

export async function selectPage(
  c: ApiContext,
  columns: string,
  from: string,
  where: string,
  parameters: unknown[],
  order: string,
  map?: (row: Record<string, unknown>) => Record<string, unknown>,
) {
  const paging = page(c)
  const db = c.env.DB
  const [items, total] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT ${columns} FROM ${from} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .bind(...parameters, paging.limit, paging.offset),
    db.prepare(`SELECT count(*) AS total FROM ${from} ${where}`).bind(...parameters),
  ])
  return paginated(c, map ? items.results.map(map) : items.results, Number(total.results[0].total), paging)
}

export function audit(db: D1Database, actorId: number, action: string, entity: string, id: number) {
  return db.prepare('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id) VALUES (?, ?, ?, ?)')
    .bind(actorId, action, entity, id)
}

export async function auditedWrite(
  c: ApiContext,
  statement: D1PreparedStatement,
  action: string,
  entity: string,
  id: number | null,
) {
  const db = c.env.DB
  const [result] = await db.batch([
    statement,
    db.prepare(`
      INSERT INTO audit_logs (actor_id, action, entity_type, entity_id)
      SELECT ?, ?, ?, ${id === null ? 'last_insert_rowid()' : '?'} WHERE changes() > 0
    `).bind(c.get('actor').id, action, entity, ...(id === null ? [] : [id])),
  ])
  return result
}

export function patchStatement(db: D1Database, table: string, changes: Record<string, unknown>, id: number) {
  const fields = Object.keys(changes)
  if (fields.length === 0) fail(400, 'no_changes', 'أدخل حقلًا واحدًا على الأقل لتحديثه.')
  return db.prepare(`UPDATE ${table} SET ${fields.map((field) => `${field} = ?`).join(', ')},
    updated_at = ${timestamp} WHERE id = ?`).bind(...Object.values(changes), id)
}

export function notFoundIfUnchanged(result: D1Result) {
  if (!result.meta.changes) fail(404, 'not_found', 'السجل غير موجود.')
}

export function readBytes(c: ApiContext, limit: number): Promise<ArrayBuffer> {
  return readLimitedStream(c.req.raw.body, limit)
}

async function readLimitedStream(stream: ReadableStream<Uint8Array> | null, limit: number) {
  if (!stream) fail(400, 'missing_body', 'لم تُرسل بيانات.')
  const reader = stream.getReader()
  const data = new Uint8Array(limit)
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return data.slice(0, length).buffer
      if (length + value.byteLength > limit) {
        await reader.cancel()
        fail(413, 'body_limit', 'حجم بيانات الطلب يتجاوز الحد المسموح.')
      }
      data.set(value, length)
      length += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
}
