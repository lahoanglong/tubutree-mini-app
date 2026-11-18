import { createHash } from 'node:crypto';

/**
 * Xếp kệ (tubu-w4-06). Cờ tắt thì không ai đọc bảng `merch_shelf_pins` và mọi kệ giữ đúng thứ tự cũ. File này chỉ có hằng và hàm thuần để
 * `catalog.service.ts` ghép thứ tự mà không kéo theo service admin.
 */
export const MERCH_SHELVES_ENABLED_KEY = 'merch.shelves_enabled';
export const MERCH_BEST_SELLER_MIN_PRODUCTS_KEY = 'merch.best_seller_min_products';
export const MERCH_BEST_SELLER_MIN_SOLD_KEY = 'merch.best_seller_min_sold';
export const MERCH_BEST_SELLER_MIN_PRODUCTS_DEFAULT = 6;
export const MERCH_BEST_SELLER_MIN_SOLD_DEFAULT = 3;

/** Trần món ghim của một kệ. */
export const MERCH_SHELF_MAX_PINS = 12;
/** Trần ghi chú của một món ghim (chỉ admin đọc). */
export const MERCH_PIN_NOTE_MAX = 200;
/** Số món của nút "Gợi ý 8 món sẵn sàng". */
export const MERCH_SUGGEST_COUNT = 8;

export const HOME_FEATURED_SHELF = 'home_featured';
export const BEST_SELLERS_SHELF = 'best_sellers';
const CATEGORY_PREFIX = 'category:';
/** Cùng dạng slug mà admin danh mục tạo (`categorySlugBase`): chữ thường không dấu, số và gạch nối. */
const CATEGORY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type MerchShelfKey = typeof HOME_FEATURED_SHELF | typeof BEST_SELLERS_SHELF | `category:${string}`;

export const categoryShelfKey = (slug: string): MerchShelfKey => `${CATEGORY_PREFIX}${slug}`;

/** Khoá kệ hợp lệ, hoặc null. `category:<slug>` chỉ kiểm dạng; danh mục có thật hay không do nơi gọi kiểm. */
export function parseShelfKey(raw: unknown): { key: MerchShelfKey; categorySlug: string | null } | null {
  if (typeof raw !== 'string') return null;
  if (raw === HOME_FEATURED_SHELF || raw === BEST_SELLERS_SHELF) return { key: raw, categorySlug: null };
  if (!raw.startsWith(CATEGORY_PREFIX)) return null;
  const slug = raw.slice(CATEGORY_PREFIX.length);
  return slug.length > 0 && slug.length <= 120 && CATEGORY_SLUG.test(slug) ? { key: categoryShelfKey(slug), categorySlug: slug } : null;
}

export interface PinWindow {
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Trong khung giờ hiệu lực: chưa tới `startsAt` hoặc đã tới `endsAt` thì món tự rơi khỏi đầu kệ. */
export function pinInWindow(p: PinWindow, now: Date): boolean {
  return (!p.startsAt || p.startsAt.getTime() <= now.getTime()) && (!p.endsAt || p.endsAt.getTime() > now.getTime());
}

/** Món ghim còn qua bộ lọc (`allowed`), theo thứ tự ghim, không lặp, tối đa `limit`. */
export function leadPins(allowed: readonly string[], pins: readonly string[], limit: number): string[] {
  const ok = new Set(allowed);
  const out: string[] = [];
  for (const id of pins) {
    if (out.length >= Math.max(0, limit)) break;
    if (ok.has(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Thứ tự sau khi ghép ghim: món ghim (theo thứ tự ghim) chỉ khi nó có trong `ranked` (tức là qua mọi bộ lọc của khách), tối đa `limit` món để mọi món ghim
 * nằm ở trang 1; sau đó là phần còn lại của `ranked` giữ nguyên thứ tự, bỏ món đã đứng đầu. Tổng số món không đổi nên phân trang không lặp, không sót.
 */
export function pinFirst(ranked: readonly string[], pins: readonly string[], limit: number): string[] {
  const lead = leadPins(ranked, pins, limit);
  if (lead.length === 0) return [...ranked];
  const taken = new Set(lead);
  return [...lead, ...ranked.filter((id) => !taken.has(id))];
}

/** Số nguyên dương trong khoảng, sai dạng thì dùng mặc định: admin sửa tay ở tab Cấu hình không làm hỏng kệ. */
export function sanitizeCount(raw: unknown, fallback: number, max: number): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= max ? raw : fallback;
}

/** Chưa đủ số bán để xếp hạng thật: số sản phẩm có lượt bán 30 ngày đạt ngưỡng ít hơn `minProducts`. */
export function isCuratedBasis(productsWithSales: number, minProducts: number): boolean {
  return productsWithSales < minProducts;
}

export interface VersionedPin extends PinWindow {
  productId: string;
  position: number;
  note: string | null;
  updatedAt: Date;
}

/**
 * Dấu phiên bản của một kệ: băm các dòng hiện có. Mọi lần lưu ghi lại `updatedAt` của mọi dòng còn giữ, nên dấu đổi sau mỗi lần lưu có món (kể cả lưu không
 * đổi gì); kệ trống luôn cùng một dấu, nên hai admin cùng mở một kệ trống thì người lưu sau nhận 409 khi người trước đã thêm món.
 */
export function shelfVersion(rows: readonly VersionedPin[]): string {
  const canon = [...rows]
    .sort((a, b) => a.position - b.position || (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0))
    .map((r) => [r.productId, r.position, r.startsAt?.toISOString() ?? null, r.endsAt?.toISOString() ?? null, r.note ?? null, r.updatedAt.toISOString()]);
  return createHash('sha1').update(JSON.stringify(canon)).digest('hex').slice(0, 16);
}

export type PinWarning = 'NOT_ON_SALE' | 'OUT_OF_STOCK' | 'NO_IMAGE' | 'NO_SHORT_DESC' | 'NO_CATEGORY' | 'OUTSIDE_CATEGORY';

export interface PinReadiness {
  isPublic: boolean;
  inStock: boolean;
  hasImage: boolean;
  hasShortDesc: boolean;
  hasCategory: boolean;
  /** Kệ `category:<slug>`: món có thuộc danh mục đó (gồm con cháu) không. Không thuộc thì bộ lọc danh mục của khách loại nó ra. Kệ khác bỏ trống. */
  inCategory?: boolean;
}

/** Cảnh báo sẵn sàng của một món ghim. Chỉ `NO_IMAGE` chặn lưu (ô ảnh trống ở đầu kệ trông như trang hỏng); còn lại chỉ nhắc. */
export function pinWarnings(p: PinReadiness): PinWarning[] {
  const out: PinWarning[] = [];
  if (!p.isPublic) out.push('NOT_ON_SALE');
  if (!p.inStock) out.push('OUT_OF_STOCK');
  if (!p.hasImage) out.push('NO_IMAGE');
  if (!p.hasShortDesc) out.push('NO_SHORT_DESC');
  if (!p.hasCategory) out.push('NO_CATEGORY');
  if (p.inCategory === false) out.push('OUTSIDE_CATEGORY');
  return out;
}

export interface SuggestCandidate {
  id: string;
  brand: string;
  categoryIds: readonly string[];
}

/**
 * Chọn `count` món trải đều nhãn và danh mục từ danh sách đã xếp sẵn (bán chạy trước): mỗi lượt lấy món đầu tiên chưa trùng cả nhãn lẫn danh mục chính với
 * món đã chọn, hết thì nới dần (khác nhãn, rồi khác danh mục, rồi bất kỳ). Kết quả theo thứ tự chọn.
 */
export function spreadPick<T extends SuggestCandidate>(ranked: readonly T[], count: number): T[] {
  const picked: T[] = [];
  const brands = new Set<string>();
  const cats = new Set<string>();
  const brandOf = (c: T) => c.brand.trim().toLowerCase();
  const catOf = (c: T) => c.categoryIds[0] ?? '';
  const passes: ((c: T) => boolean)[] = [
    (c) => !brands.has(brandOf(c)) && !cats.has(catOf(c)),
    (c) => !brands.has(brandOf(c)),
    (c) => !cats.has(catOf(c)),
    () => true,
  ];
  const left = [...ranked];
  while (picked.length < count && left.length > 0) {
    let idx = -1;
    for (const ok of passes) {
      idx = left.findIndex(ok);
      if (idx >= 0) break;
    }
    const [c] = left.splice(idx, 1);
    picked.push(c!);
    brands.add(brandOf(c!));
    cats.add(catOf(c!));
  }
  return picked;
}
