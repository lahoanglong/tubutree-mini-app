import type { BrandCount } from '../api/catalog';
import { brandTagline, journeyBrandHref, normalizeBrandKey, SHELL_BRAND_KEY } from '../brand-origins';
import { liveRoute } from './route-fallback';

/**
 * Thanh nhảy nhanh theo thương hiệu (trong khối Danh mục) và khối "Khám phá theo Thương hiệu" (khối `suggest`) của Trang chủ, Mini App và web. Hàm thuần:
 * app chỉ vẽ, thứ tự nhãn, câu giới thiệu, đích và món của từng mục đều tính ở đây.
 */

/** Trần số nhãn của thanh và khối (PROD 24/11/2026 có 9 nhãn): nhiều hơn thì cắt nhãn ít sản phẩm, "Tubu Tree" vẫn giữ ở cuối. */
export const BRAND_SHOWCASE_MAX = 12;
/** Số món mỗi nhãn: lưới 2 cột điện thoại (hai hàng), 4 cột từ md (một hàng). */
export const BRAND_SHOWCASE_ITEMS = 4;
/** Số món tải mỗi nhãn (`GET /products?brand=&sort=best_seller_30d`): dư để còn đủ 4 món sau khi bỏ món đã hiện ở kệ trên (`brandShowcaseItems`). */
export const BRAND_SHOWCASE_FETCH = 8;
/** Số nhãn đầu tải ngay khi khối dựng; nhãn sau chỉ tải khi gần khung nhìn. */
export const BRAND_SHOWCASE_EAGER = 2;
/** Tiền tố id neo của từng nhãn trong khối: chip của thanh nhảy nhanh cuộn tới `#home-brand-<slug>`. */
export const BRAND_ANCHOR_PREFIX = 'home-brand-';

export interface BrandShowcaseEntry {
  /** Tên nhãn đã chuẩn hoá (`normalizeBrandKey`): khoá React và khoá query. */
  key: string;
  /** Tên đúng như `GET /brands` trả: chữ hiển thị và tham số `?brand=` của danh sách sản phẩm. */
  brand: string;
  count: number;
  /** Có khi nhãn đã công khai trang `/brand/<slug>`. */
  slug: string | null;
  /** Câu của admin (`GET /brands`), không có thì câu dự phòng (`brandTagline`); null thì khối chỉ ghi tên nhãn. */
  tagline: string | null;
  /** Id phần tử neo của nhãn trong khối (`home-brand-<slug>`); slug thiếu thì dùng tên đã chuẩn hoá. */
  anchorId: string;
}

const isShell = (e: BrandShowcaseEntry) => e.key === SHELL_BRAND_KEY;

/**
 * Nhãn của thanh và khối: bỏ nhãn trống hay không còn sản phẩm, gộp nhãn trùng sau khi chuẩn hoá, xếp theo số sản phẩm giảm dần (hoà thì theo tên),
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
    const slug = b.slug?.trim() || null;
    const anchor = (slug ?? key).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    list.push({ key, brand, count: b.count, slug, tagline: b.tagline?.trim() || brandTagline(brand), anchorId: `${BRAND_ANCHOR_PREFIX}${anchor}` });
  }
  const shell = list.find(isShell);
  const ranked = list
    .filter((e) => !isShell(e))
    .sort((a, b) => b.count - a.count || a.brand.localeCompare(b.brand, 'vi'))
    .slice(0, Math.max(0, shell ? max - 1 : max));
  return shell && max > 0 ? [...ranked, shell] : ranked;
}

/** "Tất cả (n)" của một nhãn: danh sách sản phẩm lọc đúng nhãn đó (cùng `?brand=` mà khối đã tải), route theo nền. */
export function brandShowcaseHref(entry: Pick<BrandShowcaseEntry, 'brand'>, platform: 'mini' | 'web'): string {
  return `${liveRoute('/browse', platform)}?${new URLSearchParams({ brand: entry.brand }).toString()}`;
}

/** Đích dự phòng của chip thanh nhảy nhanh khi khối thương hiệu không có nhãn đó (nhãn tải lỗi, hết món, hay chờ khối dựng quá lâu): trang nhãn nếu có slug, không thì lọc theo nhãn. */
export function brandJumpHref(entry: Pick<BrandShowcaseEntry, 'key' | 'brand' | 'slug'>, platform: 'mini' | 'web'): string {
  return journeyBrandHref({ key: entry.key, label: entry.brand, origin: null, slug: entry.slug, apiBrand: entry.brand }, platform === 'web' ? '/san-pham' : '/browse');
}

/**
 * Món vẽ ở một nhãn: ưu tiên món chưa hiện ở kệ trên (`exclude`, cùng hạng chống trùng với Gợi ý: 6), thiếu thì bù bằng món đã hiện để nhãn vẫn đủ
 * `max` món khi nhãn có đủ; rồi xếp còn hàng trước (giữ thứ tự máy chủ trong mỗi phần).
 */
export function brandShowcaseItems<T extends { slug: string; inStock: boolean }>(items: readonly T[], exclude: ReadonlySet<string>, max: number = BRAND_SHOWCASE_ITEMS): T[] {
  const fresh = items.filter((p) => !exclude.has(p.slug));
  const picked = fresh.length >= max ? fresh.slice(0, max) : [...fresh, ...items.filter((p) => exclude.has(p.slug)).slice(0, max - fresh.length)];
  return [...picked.filter((p) => p.inStock), ...picked.filter((p) => !p.inStock)];
}

/** Số khung chờ của một nhãn: bằng số món sẽ vẽ (nhãn ít món thì một hàng) để khối không nhảy khi món về. */
export function brandShowcaseSkeletonCount(entry: Pick<BrandShowcaseEntry, 'count'>): number {
  return Math.max(1, Math.min(BRAND_SHOWCASE_ITEMS, entry.count));
}
