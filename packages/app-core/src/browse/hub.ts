import { applyShelfDedupe } from '../merch/shelves';

export const HUB_CATEGORY_MAX = 8;
export const HUB_BRAND_MAX = 12;
export const HUB_BRAND_MIN = 4;

/** Thương hiệu cho lưới logo ở hub: nhiều sản phẩm trước, tối đa 12; dưới 4 nhãn thì ẩn cả khối (không để tiêu đề trơ). */
export function hubBrands<T extends { brand: string; count: number }>(list: T[] | undefined): T[] {
  if (!list || list.length < HUB_BRAND_MIN) return [];
  return [...list].sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand, 'vi')).slice(0, HUB_BRAND_MAX);
}

/** Kệ Bán chạy nhất của hub: trần và sàn theo `SHELVES` (`browse.bestSellers`: 10, dưới 3 món thì ẩn). */
export function hubBestSellers<T extends { id: string }>(items: T[] | undefined): T[] {
  return applyShelfDedupe([{ id: 'browse.bestSellers', items: items ?? [] }])[0]!.items;
}
