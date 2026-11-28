import type { BrandCount } from '../api/catalog';
import { brandTagline, journeyBrandHref, normalizeBrandKey, SHELL_BRAND_KEY } from '../brand-origins';

/**
 * Thanh chip thương hiệu của Trang chủ (trong khối Danh mục, lối duyệt theo thương hiệu duy nhất của Trang chủ từ W47) và luật ẩn lối duyệt theo thương
 * hiệu khi cửa hàng không có lựa chọn (`hasBrandChoice`), Mini App và web. Hàm thuần: app chỉ vẽ, thứ tự nhãn, câu giới thiệu và đích đều tính ở đây.
 */

/** Trần số nhãn của thanh (PROD 24/11/2026 có 9 nhãn): nhiều hơn thì cắt nhãn ít sản phẩm, "Tubu Tree" vẫn giữ ở cuối. */
export const BRAND_SHOWCASE_MAX = 12;

export interface BrandShowcaseEntry {
  /** Tên nhãn đã chuẩn hoá (`normalizeBrandKey`): khoá React và khoá query. */
  key: string;
  /** Tên đúng như `GET /brands` trả: chữ hiển thị và tham số `?brand=` của danh sách sản phẩm. */
  brand: string;
  count: number;
  /** Có khi nhãn đã công khai trang `/brand/<slug>`. */
  slug: string | null;
  /** Câu của admin (`GET /brands`), không có thì câu dự phòng (`brandTagline`); null thì chỉ có tên nhãn. */
  tagline: string | null;
}

const isShell = (e: BrandShowcaseEntry) => e.key === SHELL_BRAND_KEY;

/** Số thương hiệu thật: khác nhau sau chuẩn hoá, còn sản phẩm, không tính nhãn vỏ chung "Tubu Tree" (hàng chưa tách được nhãn riêng). */
export function realBrandCount(list: readonly { brand: string; count?: number }[] | undefined): number {
  const keys = new Set<string>();
  for (const b of list ?? []) {
    const key = normalizeBrandKey(b.brand ?? '');
    if (key && key !== SHELL_BRAND_KEY && !(typeof b.count === 'number' && b.count <= 0)) keys.add(key);
  }
  return keys.size;
}

/**
 * Có đáng cho khách duyệt theo thương hiệu không (W47): cửa hàng chỉ có một nhãn thật, hay chỉ có nhãn vỏ "Tubu Tree", thì lưới logo ở hub, nhóm
 * "Thương hiệu" của bộ lọc và thanh chip thương hiệu ở Trang chủ đều ẩn, không vẽ một lựa chọn duy nhất hay nhãn dựng tạm.
 */
export function hasBrandChoice(list: readonly { brand: string; count?: number }[] | undefined): boolean {
  return realBrandCount(list) >= 2;
}

/**
 * Nhãn của thanh: bỏ nhãn trống hay không còn sản phẩm, gộp nhãn trùng sau khi chuẩn hoá, xếp theo số sản phẩm giảm dần (hoà thì theo tên),
 * "Tubu Tree" (hàng chưa tách được nhãn riêng) luôn đứng cuối và không bị cắt bởi `max`. Chưa tải hay lỗi thì rỗng.
 */
export function brandShowcase(brands: readonly BrandCount[] | undefined, max: number = BRAND_SHOWCASE_MAX): BrandShowcaseEntry[] {
  const seen = new Set<string>();
  const list: BrandShowcaseEntry[] = [];
  for (const b of Array.isArray(brands) ? brands : []) {
    const brand = b.brand?.trim() ?? '';
    const key = normalizeBrandKey(brand);
    if (!key || !(b.count > 0) || seen.has(key)) continue;
    seen.add(key);
    list.push({ key, brand, count: b.count, slug: b.slug?.trim() || null, tagline: b.tagline?.trim() || brandTagline(brand) });
  }
  const shell = list.find(isShell);
  const ranked = list
    .filter((e) => !isShell(e))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand, 'vi'))
    .slice(0, Math.max(0, shell ? max - 1 : max));
  return shell && max > 0 ? [...ranked, shell] : ranked;
}

/** Đích của chip thương hiệu: trang nhãn nếu có slug, không thì danh sách lọc theo nhãn. */
export function brandJumpHref(entry: Pick<BrandShowcaseEntry, 'key' | 'brand' | 'slug'>, platform: 'mini' | 'web'): string {
  return journeyBrandHref({ key: entry.key, label: entry.brand, origin: null, slug: entry.slug, apiBrand: entry.brand }, platform === 'web' ? '/san-pham' : '/browse');
}
