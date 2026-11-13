import { Hono } from 'hono'
import { csvCell } from './csv'
import { audit, fail, permit } from './http'
import type { ApiEnv } from './http'

const exportLimit = 500

type CatalogRow = {
  id: number
  name: string
  category: string | null
  barcode: string | null
  price_minor: number
  stock: number
}

export const backup = new Hono<ApiEnv>()

backup.get('/backup/catalog.csv', permit('backup.export'), async (c) => {
  const db = c.env.DB
  const { results } = await db.prepare(`
    SELECT p.id, p.name, c.name AS category, p.barcode, p.price_minor, p.stock
    FROM products p LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.id LIMIT ?
  `).bind(exportLimit + 1).all<CatalogRow>()
  if (results.length > exportLimit) fail(422, 'catalog_export_limit', 'تجاوز الكتالوج حد التصدير من المتصفح. استخدم التصدير الإداري.')
  const columns = ['id', 'name', 'category', 'barcode', 'price_minor', 'stock'] as const
  const rows = results.map(row => columns.map(column => csvCell(row[column])).join(','))
  await audit(db, c.get('actor').id, 'export', 'catalog', 0).run()
  return c.body('\ufeff' + [columns.join(','), ...rows].join('\r\n') + '\r\n', 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="henra-store-catalog.csv"',
    'Cache-Control': 'no-store',
  })
})
