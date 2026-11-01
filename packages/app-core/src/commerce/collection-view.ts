/** Số món tối đa mỗi bộ sưu tập hiện ở tab Shop theo bố cục; quá thì có lối "Tất cả (n)" sang tab Sản phẩm. */
export const SECTION_BUDGET = { rail: 10, grid: 6, line: 5 } as const;
/**
 * Kệ ngang có từ ngần này món trở xuống thì ở màn rộng (web từ lg) không vẽ thành kệ cuộn mà thành lưới cùng số cột với lưới Sản phẩm (5 cột lg, 6 cột xl), để thẻ cùng
 * bề rộng với mọi lưới khác; hàng chưa đầy dồn trái như hàng cuối của lưới đó. Ngưỡng 6 vừa một hàng ở xl nhưng ở lg (5 cột) là 5 + 1: thẻ lẻ ở hàng hai
 * là chủ ý (đúng như hàng cuối của lưới Sản phẩm), không hạ ngưỡng về 5 vì kệ sáu món sẽ lại thành kệ cuộn với thẻ khác bề rộng. Mini App và web dưới lg luôn là kệ ngang.
 */
export const RAIL_AS_GRID_MAX = 6;
export const railFitsRow = (count: number): boolean => Number.isInteger(count) && count >= 0 && count <= RAIL_AS_GRID_MAX;
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
