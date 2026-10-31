import type { ProductCard } from '../api/catalog';
import { fillTemplate } from '../copy-template';
import { META_COPY } from './meta-copy';

/** 4.8 → "4,8". Rác hoặc không dương → '' (thẻ chưa có đánh giá không in sao). Kẹp trần 5. */
export function formatRating(avg: number): string {
  if (!Number.isFinite(avg) || avg <= 0) return '';
  return Math.min(5, avg).toFixed(1).replace('.', ',');
}

/** Phần số của "Đã bán": <1 → null; <1000 nguyên số; ≥1000 "1,2k+"; ≥999.950 "1tr+"; ≥999.950.000 "1 tỷ+". */
export function soldCountText(n: number | null | undefined): string | null {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v < 1) return null;
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  if (v < 1000) return String(v);
  // Ngưỡng làm tròn: 999.950 in "1000k+" và 999.950.000 in "1000tr+", nên chuyển sang đơn vị kế trước.
  if (v < 999_950) return `${trim(v / 1000)}k+`;
  if (v < 999_950_000) return `${trim(v / 1_000_000)}tr+`;
  return `${trim(v / 1_000_000_000)} tỷ+`;
}

/** "Đã bán" kiểu Shopee, một bản cho Mini App và web (thay hai bản `formatSold` cũ; spec cũ của hai app vẫn là chứng minh không đổi hành vi). */
export function formatSoldShort(n: number | null | undefined): string | null {
  const count = soldCountText(n);
  return count === null ? null : fillTemplate(META_COPY.sold, { n: count });
}

/**
 * Dòng meta một dòng của thẻ: "★ 4,8 · Đã bán 1,2k+". Thiếu nửa nào thì bỏ nửa đó; thiếu cả hai thì null để thẻ giữ chỗ
 * (chiều cao cố định) thay vì in dòng rỗng. Không in số lượt đánh giá (thiết kế Q13).
 */
export function cardMetaLine(p: Pick<ProductCard, 'ratingAvg' | 'sold'>): string | null {
  const rating = formatRating(p.ratingAvg ?? 0);
  const parts = [rating ? fillTemplate(META_COPY.rating, { avg: rating }) : null, formatSoldShort(p.sold)].filter((x): x is string => x !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}
