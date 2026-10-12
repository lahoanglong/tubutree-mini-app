import { browserStorage, type StorageLike } from './recently-viewed';

/** Từ khoá đã tìm (chuyển từ pages/browse.tsx, GIỮ khoá cũ để khách không mất lịch sử). */
export const RECENT_SEARCHES_KEY = 'tubu_recent_searches';
export const RECENT_SEARCHES_MAX = 8;

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
