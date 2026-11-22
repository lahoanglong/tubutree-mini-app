import { parseMeasure } from '../product-compare.unit';

/** Trần số cặp trang "Tiết kiệm với Refill" trả về (PROD có 12 cặp): đủ cho một trang danh sách, không thành bản sao danh mục. */
export const REFILL_LANDING_MAX = 60;

type Priced = { name: string; price: number };

/**
 * Phần trăm gói Refill rẻ hơn mua chai cùng lượng, làm tròn xuống để không nói quá. Cùng công thức với `computeRefillValueComparison`
 * (packages/app-core/src/commerce/cart-progress.ts) mà thẻ gói Refill ở trang chi tiết chai dùng: gói phải thay được ít nhất một chai và rẻ hơn
 * ít nhất 1%. Null khi một bên không ghi lượng, khác chiều (ml với g), là gói nhiều món, hay giá không dương.
 */
export function refillSavingPct(bottle: Priced, refill: Priced): number | null {
  const b = parseMeasure(bottle.name);
  const r = parseMeasure(refill.name);
  if (!b || !r || b.unit !== r.unit || !(b.qty > 0) || !(r.qty > 0) || !(bottle.price > 0) || !(refill.price > 0)) return null;
  if (Math.floor(r.qty / b.qty + 1e-9) < 1) return null;
  const sameVolumeInBottles = (bottle.price * r.qty) / b.qty;
  const pct = Math.floor((1 - refill.price / sameVolumeInBottles) * 100 + 1e-9);
  return pct >= 1 ? pct : null;
}

type Ordered = { bottle: { name: string }; refill: { inStock: boolean }; savingPct: number | null };

/** Thứ tự trang: gói còn hàng trước, rồi rẻ hơn nhiều nhất trước (không so được thì cuối), cùng mức thì theo tên chai. */
export function compareRefillLandingPairs(a: Ordered, b: Ordered): number {
  if (a.refill.inStock !== b.refill.inStock) return a.refill.inStock ? -1 : 1;
  const pa = a.savingPct ?? -1;
  const pb = b.savingPct ?? -1;
  if (pa !== pb) return pb - pa;
  return a.bottle.name.localeCompare(b.bottle.name, 'vi');
}
