import { z } from 'zod';
import { fail } from './http';

export const measurementUnit = z.enum(['piece', 'meter']);
export const saleQuantity = z.number().positive().max(1_000_000);
export const quantityScale = (unit: string) => unit === 'meter' ? 1000 : 1;

export function toStockQuantity(value: number, scale: number, max = 1_000_000) {
  const stock = Math.round(value * scale);
  if (!Number.isFinite(value) || stock / scale !== value || Math.abs(stock) > max) {
    return fail(422, 'RETAIL_MEASUREMENT', scale === 1000
      ? 'أدخل الكمية بالمتر بدقة تصل إلى ثلاث خانات عشرية وضمن الحد المسموح.'
      : 'أدخل عددًا صحيحًا من القطع ضمن الحد المسموح.');
  }
  return stock;
}

export async function withStockQuantities<Item extends { product_id: number; quantity: number }>(
  db: D1Database, items: Item[], missingStatus: 409 | 422 = 422,
) {
  if (items.length === 0) return [];
  const ids = [...new Set(items.map(item => item.product_id))];
  const result = await db.prepare(`SELECT id, quantity_scale FROM products WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all<{ id: number; quantity_scale: number }>();
  const scales = new Map(result.results.map(row => [row.id, row.quantity_scale]));
  return items.map(item => {
    const scale = scales.get(item.product_id);
    if (!scale) return fail(missingStatus, 'RETAIL_MEASUREMENT_PRODUCT', 'الصنف المحدد غير موجود.');
    return { ...item, quantity: toStockQuantity(item.quantity, scale), quantity_scale: scale };
  });
}

// Round positive line amounts to the nearest piastre. Multiplication uses integer quantities.
export function roundedLineMinor(rate: number, stockQuantity: number, scale: number) {
  return (BigInt(rate) * BigInt(stockQuantity) + BigInt(Math.floor(scale / 2))) / BigInt(scale);
}

export function roundedLineSql(rate: string, quantity: string, scale: string) {
  return `((${rate}) * (${quantity}) + (${scale}) / 2) / (${scale})`;
}
