import type { ProductCard } from '../api/catalog';
import { fillCopy } from '../shop-copy';

/** 4.8 → "4,8". Rác hoặc không dương → '' (thẻ chưa có đánh giá không in sao). Kẹp trần 5. */
export function formatRating(avg: number): string {
  if (!Number.isFinite(avg) || avg <= 0) return '';
  return Math.min(5, avg).toFixed(1).replace('.', ',');
}

/** Phần số của "Đã bán": <1 → null; <1000 nguyên số; ≥1000 "1,2k+"; ≥1tr "1,5tr+". */
export function soldCountText(n: number | null | undefined): string | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v < 1) return null;
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${trim(v / 1000)}k+`;
  return `${trim(v / 1_000_000)}tr+`;
}

/** "Đã bán" kiểu Shopee, một bản cho Mini App và web (thay hai bản `formatSold` cũ; spec cũ của hai app vẫn là chứng minh không đổi hành vi). */
export function formatSoldShort(n: number | null | undefined): string | null {
  const count = soldCountText(n);
  return count === null ? null : fillCopy('meta.sold', { n: count });
}

/**
 * Dòng meta một dòng của thẻ: "★ 4,8 · Đã bán 1,2k+". Thiếu nửa nào thì bỏ nửa đó; thiếu cả hai thì null để thẻ giữ chỗ
 * (chiều cao cố định) thay vì in dòng rỗng. Không in số lượt đánh giá (thiết kế Q13).
 */
export function cardMetaLine(p: Pick<ProductCard, 'ratingAvg' | 'sold'>): string | null {
  const rating = formatRating(p.ratingAvg ?? 0);
  const parts = [rating ? fillCopy('meta.rating', { avg: rating }) : null, formatSoldShort(p.sold)].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}
