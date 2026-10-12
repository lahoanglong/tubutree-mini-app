/**
 * "Đã xem gần đây" (spec 5b.4): 20 SP mới xem nhất, chỉ lưu ở máy (localStorage), không đồng bộ
 * server. Ghi ở PDP khi mở thành công; đọc ở Trang chủ + trang Danh mục. Storage có thể vắng
 * (chế độ riêng tư, WebView lạ) hoặc ném (hết quota) → mọi đường đọc/ghi đều không được ném.
 */
export interface RecentlyViewedItem {
  slug: string;
  name: string;
  thumbnail: string | null;
  price: number;
  viewedAt: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const RECENTLY_VIEWED_KEY = 'tubu_recently_viewed';
export const RECENTLY_VIEWED_MAX = 20;
/** Bắn trên `window` sau mỗi lần ghi để các hook cùng tab cập nhật (sự kiện `storage` chỉ tới tab KHÁC). */
export const RECENTLY_VIEWED_EVENT = 'tubu:recently-viewed';

export function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isItem(x: unknown): x is RecentlyViewedItem {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.slug === 'string' && r.slug !== '' &&
    typeof r.name === 'string' &&
    (r.thumbnail === null || typeof r.thumbnail === 'string') &&
    typeof r.price === 'number' && Number.isFinite(r.price) &&
    typeof r.viewedAt === 'number' && Number.isFinite(r.viewedAt)
  );
}

/** Chỉ giữ đúng 5 trường của spec (PDP có thể truyền cả object sản phẩm dư trường). */
function pick(x: RecentlyViewedItem): RecentlyViewedItem {
  return { slug: x.slug, name: x.name, thumbnail: x.thumbnail, price: x.price, viewedAt: x.viewedAt };
}

export function parseRecentlyViewed(raw: string | null): RecentlyViewedItem[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: RecentlyViewedItem[] = [];
    for (const x of arr) {
      // Trùng slug (dữ liệu sửa tay / bản cũ): giữ bản đầu tiên = bản mới nhất.
      if (!isItem(x) || seen.has(x.slug)) continue;
      seen.add(x.slug);
      out.push(pick(x));
      if (out.length >= RECENTLY_VIEWED_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function readRecentlyViewed(storage: StorageLike | null = browserStorage()): RecentlyViewedItem[] {
  if (!storage) return [];
  try {
    return parseRecentlyViewed(storage.getItem(RECENTLY_VIEWED_KEY));
  } catch {
    return [];
  }
}

function notifyChange(): void {
  try {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(RECENTLY_VIEWED_EVENT));
  } catch {
    /* môi trường không có window.dispatchEvent — hook sẽ cập nhật ở lần mount sau */
  }
}

export function recordRecentlyViewed(
  item: Omit<RecentlyViewedItem, 'viewedAt'>,
  now: number = Date.now(),
  storage: StorageLike | null = browserStorage(),
): RecentlyViewedItem[] {
  const entry = { slug: item.slug, name: item.name, thumbnail: item.thumbnail, price: item.price, viewedAt: now };
  // Mục không hợp lệ (slug rỗng, giá NaN…) sẽ bị loại ở lần đọc kế tiếp → không ghi, tránh làm bẩn khoá.
  if (!isItem(entry)) return readRecentlyViewed(storage);
  const next = [entry, ...readRecentlyViewed(storage).filter((x) => x.slug !== entry.slug)].slice(0, RECENTLY_VIEWED_MAX);
  if (!storage) return next;
  try {
    storage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    return next;
  }
  notifyChange();
  return next;
}

export function clearRecentlyViewed(storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(RECENTLY_VIEWED_KEY);
  } catch {
    return;
  }
  notifyChange();
}
