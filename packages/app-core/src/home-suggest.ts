import type { CategoryDTO } from './api/catalog';

/** Gợi ý hôm nay dừng ở chừng này món (điện thoại) rồi mời vào Danh mục; máy tính dừng sớm hơn và có nút "Xem thêm". */
export const SUGGEST_MAX = 100;
export const SUGGEST_MAX_DESKTOP = 48;
/** Số chip danh mục ngoài "Tất cả". */
export const SUGGEST_CHIP_MAX = 4;

const VN_OFFSET_MS = 7 * 3_600_000;

/**
 * Hạt giống xoay thứ tự Gợi ý hôm nay: ngày theo giờ Việt Nam dạng `YYYYMMDD`. Cùng ngày VN thì cùng thứ tự (cuộn, quay lại, mở lại app không
 * làm lưới xáo trộn), sang ngày khác thì đổi. Không dùng ngày UTC: 0–7 giờ sáng VN vẫn là ngày UTC hôm trước.
 */
export function vnDateSeed(now: number): string {
  const t = Number.isFinite(now) ? now : Date.now();
  const d = new Date(t + VN_OFFSET_MS);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${d.getUTCFullYear()}${mm}${dd}`;
}

export interface SuggestChip {
  key: string;
  label: string;
  /** null = "Tất cả". */
  categoryId: string | null;
}

/** "Tất cả" rồi tối đa 4 danh mục tầng 1 có nhiều sản phẩm nhất; danh mục không có sản phẩm (hoặc API cũ thiếu số đếm) không thành chip. */
export function suggestChips(categories: Pick<CategoryDTO, 'id' | 'name' | 'productCount'>[]): SuggestChip[] {
  const top = categories
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => (c.productCount ?? 0) > 0)
    .sort((a, b) => (b.c.productCount ?? 0) - (a.c.productCount ?? 0) || a.i - b.i)
    .slice(0, SUGGEST_CHIP_MAX)
    .map(({ c }) => ({ key: c.id, label: c.name, categoryId: c.id }));
  return [{ key: 'all', label: 'Tất cả', categoryId: null }, ...top];
}

/** Còn tải thêm được không và trần món theo khổ. */
export function suggestLimit(loaded: number, desktop: boolean): { hasMore: boolean; max: number } {
  const max = desktop ? SUGGEST_MAX_DESKTOP : SUGGEST_MAX;
  return { hasMore: loaded < max, max };
}
