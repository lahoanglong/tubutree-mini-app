import { FREESHIP_UPSELL_EXCLUDE_MAX } from '@tubutree/shared-types';
import type { HttpClient } from '../http';
import type { ProductCard } from './catalog';

export interface FreeshipUpsellParams {
  /** Số còn thiếu để Miễn phí giao hàng (đồng nguyên, > 0). */
  gap: number;
  /** Slug món đã có trong giỏ: không trùng, xếp theo bảng chữ, tối đa `FREESHIP_UPSELL_EXCLUDE_MAX` (giỏ đông hơn thì app tự lọc phần còn lại). */
  exclude: string[];
}

/**
 * Tham số của `GET /upsell/freeship` từ số còn thiếu và các dòng giỏ. Slug được bỏ trùng và xếp lại để hai giỏ cùng món (khác thứ tự dòng) dùng chung một
 * khoá query và một bản cache công khai. Còn thiếu không phải số dương thì null: đã đạt mốc, không hỏi.
 */
export function freeshipUpsellParams(remaining: number, lines: readonly { slug: string }[]): FreeshipUpsellParams | null {
  if (!(remaining > 0)) return null;
  const exclude = [...new Set(lines.map((l) => l.slug).filter(Boolean))].sort().slice(0, FREESHIP_UPSELL_EXCLUDE_MAX);
  return { gap: Math.ceil(remaining), exclude };
}

export const freeshipUpsellQueryKey = (p: FreeshipUpsellParams) => ['upsell', 'freeship', p.gap, p.exclude.join(',')] as const;

/** Thẻ gợi ý bù đơn đã xếp ở máy chủ (món đóng khoảng thiếu bán chạy trước). Cờ tắt thì máy chủ trả 404: nơi gọi coi mọi lỗi là "không có dải". */
export const fetchFreeshipUpsell = (http: HttpClient, p: FreeshipUpsellParams) =>
  http.get<ProductCard[]>('/upsell/freeship', { query: p.exclude.length > 0 ? { gap: p.gap, exclude: p.exclude.join(',') } : { gap: p.gap } });
