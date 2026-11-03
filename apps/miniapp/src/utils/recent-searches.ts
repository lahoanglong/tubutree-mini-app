import { browserStorage, type StorageLike } from './recently-viewed';

/** Từ khoá đã tìm (chuyển từ pages/browse.tsx, GIỮ khoá cũ để khách không mất lịch sử). */
export const RECENT_SEARCHES_KEY = 'tubu_recent_searches';
export const RECENT_SEARCHES_MAX = 8;
/** Chủ của lịch sử đang lưu (mã khách đăng nhập gần nhất). */
export const RECENT_SEARCHES_OWNER_KEY = 'tubu_recent_searches_owner';

/**
 * Định dạng lưu = mảng JSON các chuỗi, mới nhất trước (giống bản cũ trong browse.tsx). Dữ liệu hỏng/lạ
 * không được làm sập: phần tử không phải chuỗi hoặc rỗng bị bỏ, trùng (không phân biệt hoa thường) giữ bản đầu.
 */
export function readRecentSearches(storage: StorageLike | null = browserStorage()): string[] {
  try {
    const raw = storage?.getItem(RECENT_SEARCHES_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of arr) {
      if (typeof x !== 'string' || x.trim() === '') continue;
      const key = x.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(x);
      if (out.length >= RECENT_SEARCHES_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function pushRecentSearch(term: string, storage: StorageLike | null = browserStorage()): string[] {
  const t = term.trim();
  if (t.length < 2) return readRecentSearches(storage);
  const next = [t, ...readRecentSearches(storage).filter((x) => x.trim().toLowerCase() !== t.toLowerCase())].slice(
    0,
    RECENT_SEARCHES_MAX,
  );
  try {
    storage?.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    /* hết quota — vẫn trả danh sách trong bộ nhớ */
  }
  return next;
}

export function clearRecentSearches(storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    /* bỏ qua */
  }
}

/**
 * Lịch sử chỉ thuộc về MỘT tài khoản: máy dùng chung đổi sang tài khoản khác thì xoá lịch sử của người trước. Chỉ so khi biết đang là ai
 * (lúc khôi phục phiên `userId` còn rỗng, so lúc đó sẽ xoá nhầm lịch sử của chính khách). Trả true nếu đã xoá.
 * Khách (guest) được gộp sang tài khoản thật vẫn là một người: chủ ghi `guest:<id>` để nhận ra ca đó và giữ lịch sử.
 */
export function scopeRecentSearchesToUser(
  userId: string | undefined,
  storage: StorageLike | null = browserStorage(),
  isGuest = false,
): boolean {
  if (!userId) return false;
  try {
    const owner = storage?.getItem(RECENT_SEARCHES_OWNER_KEY);
    const mine = isGuest ? `guest:${userId}` : userId;
    if (owner === mine) return false;
    // Chưa có chủ (lịch sử cũ trước bản này, hoặc khách vừa tìm lúc chưa đăng nhập): nhận cho tài khoản đầu tiên, chỉ xoá khi đổi chủ.
    const mergedFromGuest = !isGuest && owner != null && owner.startsWith('guest:');
    if (owner != null && !mergedFromGuest) clearRecentSearches(storage);
    storage?.setItem(RECENT_SEARCHES_OWNER_KEY, mine);
    return owner != null && !mergedFromGuest;
  } catch {
    return false;
  }
}

/**
 * Đã đăng xuất (không còn tài khoản): lịch sử của người trước không được hiện cho người kế tiếp dùng máy. Chỉ xoá khi có chủ; trả true nếu đã xoá.
 */
export function forgetRecentSearchesOfSignedOutUser(storage: StorageLike | null = browserStorage()): boolean {
  try {
    if (storage?.getItem(RECENT_SEARCHES_OWNER_KEY) == null) return false;
    clearRecentSearches(storage);
    storage.removeItem(RECENT_SEARCHES_OWNER_KEY);
    return true;
  } catch {
    return false;
  }
}
