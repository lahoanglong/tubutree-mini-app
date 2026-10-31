/** Số món tối đa mỗi bộ sưu tập hiện ở tab Shop theo bố cục; quá thì có lối "Tất cả (n)" sang tab Sản phẩm. */
export const SECTION_BUDGET = { rail: 10, grid: 6, line: 5 } as const;
/** Trần số khối ở tab Shop; quá thì màn dựng cảnh báo. */
export const SHOP_MAX_SECTIONS = 6;

export interface SectionView<T> {
  layout: 'rail' | 'grid' | 'line' | 'combo';
  items: T[];
  total: number;
  hasMore: boolean;
  comboPct: number | null;
}

const LAYOUT_OF = { CAROUSEL: 'rail', GRID: 'grid', STACK: 'line' } as const;

/**
 * Bộ sưu tập của gian hàng/thương hiệu thành thứ cần vẽ: bố cục theo `layout` của API (trước đây bị bỏ qua, mọi thứ thành lưới
 * hiện hết món), cắt theo ngân sách. COMBO vẽ đủ món vì khoản giảm tính trên cả bộ; `layout` lạ rơi về lưới như màn hiện nay.
 */
export function collectionView<T>(c: { kind: string; layout: string; items: T[]; comboDiscountPct?: number | null }): SectionView<T> {
  const total = c.items.length;
  if (c.kind === 'COMBO') {
    const pct = c.comboDiscountPct;
    return { layout: 'combo', items: [...c.items], total, hasMore: false, comboPct: typeof pct === 'number' && Number.isFinite(pct) && pct > 0 ? pct : null };
  }
  const layout = (LAYOUT_OF as Record<string, 'rail' | 'grid' | 'line'>)[c.layout] ?? 'grid';
  const budget = SECTION_BUDGET[layout];
  return { layout, items: c.items.slice(0, budget), total, hasMore: total > budget, comboPct: null };
}
