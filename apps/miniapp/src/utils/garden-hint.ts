import { browserStorage, type StorageLike } from './recently-viewed';

export const GARDEN_HINT_KEY = 'tubu_garden_hint_seen';

/** Storage vắng hoặc ném (chế độ riêng tư, WebView lạ) → coi như đã xem: thà không hiện còn hơn hiện lại mỗi lần mở app. */
export function shouldShowGardenHint(storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(GARDEN_HINT_KEY) === null;
  } catch {
    return false;
  }
}

export function markGardenHintSeen(storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(GARDEN_HINT_KEY, '1');
  } catch {
    // Không ghi được thì lần sau shouldShowGardenHint cũng đọc hỏng và không hiện; không có gì để làm thêm.
  }
}
