import { applyShelfDedupe } from '../merch/shelves';

export const HUB_CATEGORY_MAX = 8;
export const HUB_BRAND_MAX = 12;
export const HUB_BRAND_MIN = 4;

/**
 * Chiều cao ô danh mục ở hub: đệm 8 + ảnh 40 + cách 6 + nhãn 2 dòng (caption 13px x 1,54 = 20px mỗi dòng) + đệm 8 = 102. Ô thật đặt
 * `min-height` bằng đúng số này và khung chờ cao bằng nó, nên nhãn một hay hai dòng đều không làm hàng nhảy khi dữ liệu về.
 */
export const HUB_TILE_HEIGHT = 102;

/** Số khung chờ của lưới ô danh mục: số ô thật sẽ có (trần `HUB_CATEGORY_MAX`) cộng ô "Tất cả"; số lần tải trước có thể lớn hơn trần. */
export function hubPlaceholderTiles(placeholderCount: number): number {
  const n = Number.isFinite(placeholderCount) ? Math.max(0, Math.floor(placeholderCount)) : 0;
  return Math.min(n, HUB_CATEGORY_MAX) + 1;
}

/** Thương hiệu cho lưới logo ở hub: nhiều sản phẩm trước, tối đa 12; dưới 4 nhãn thì ẩn cả khối (không để tiêu đề trơ). */
export function hubBrands<T extends { brand: string; count: number }>(list: T[] | undefined): T[] {
  if (!list || list.length < HUB_BRAND_MIN) return [];
  return [...list].sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand, 'vi')).slice(0, HUB_BRAND_MAX);
}

/** Kệ Bán chạy nhất của hub: trần và sàn theo `SHELVES` (`browse.bestSellers`: 10, dưới 3 món thì ẩn). */
export function hubBestSellers<T extends { id: string }>(items: T[] | undefined): T[] {
  return applyShelfDedupe([{ id: 'browse.bestSellers', items: items ?? [] }])[0]!.items;
}
