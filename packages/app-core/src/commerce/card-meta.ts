import type { ProductCard } from '../api/catalog';
import { fillTemplate } from '../copy-template';
import { formatVnNumber } from '../number-format';
import { META_COPY } from './meta-copy';
import { fillTileCopy } from './tile-copy';

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

/**
 * Bản gọn của dòng meta cho thẻ hẹp (kệ hạng 128px: chữ nhìn thấy rộng 112px, "★ 4,7 · Đã bán 8,2k+" cần ~120px nên bị cắt giữa số): chỉ nói lượt bán,
 * vì kệ hạng nói về doanh số, và giữ chữ "Đã bán" để "8,2k+" không mất nghĩa. Chưa có lượt bán thì còn lại sao. Có bản gọn khi và chỉ khi có `cardMetaLine`.
 */
export function cardMetaCompact(p: Pick<ProductCard, 'ratingAvg' | 'sold'>): string | null {
  const sold = formatSoldShort(p.sold);
  if (sold !== null) return sold;
  const rating = formatRating(p.ratingAvg ?? 0);
  return rating ? fillTemplate(META_COPY.rating, { avg: rating }) : null;
}

const UNIT: Record<string, number> = { k: 1e3, tr: 1e6, tỷ: 1e9 };

/**
 * Bản đọc của dòng meta: "★" bị đọc thành "ngôi sao đen" và "1,2k+" thành "một phẩy hai ca cộng" (a11y P2-4, P2-6), nên đọc "4,8 sao, đã bán
 * hơn 1.200". Số "hơn" suy từ đúng chữ đang hiện (1,2k+ → 1.200) để người nghe và người nhìn nhận cùng một con số. Null khi dòng meta null.
 */
export function cardMetaSpoken(p: Pick<ProductCard, 'ratingAvg' | 'sold'>): string | null {
  const rating = formatRating(p.ratingAvg ?? 0);
  const shown = soldCountText(p.sold);
  const parts: string[] = [];
  if (rating) parts.push(fillTileCopy('meta.ratingSpoken', { avg: rating }));
  if (shown !== null) {
    const m = /^([\d,]+)\s?(k|tr|tỷ)\+$/.exec(shown);
    parts.push(
      m
        ? fillTileCopy('meta.soldSpokenOver', { n: formatVnNumber(Math.round(parseFloat(m[1]!.replace(',', '.')) * UNIT[m[2]!]!)) })
        : fillTileCopy('meta.soldSpoken', { n: shown }),
    );
  }
  return parts.length > 0 ? parts.join(', ') : null;
}
