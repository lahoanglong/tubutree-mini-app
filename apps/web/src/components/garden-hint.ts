export const GARDEN_HINT_KEY = 'tubu_garden_hint_seen';

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Storage vắng hoặc ném (chế độ riêng tư, WebView lạ) → coi như đã xem: thà không hiện còn hơn hiện lại mỗi lần mở trang. */
export function shouldShowGardenHint(storage: Storage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(GARDEN_HINT_KEY) === null;
  } catch {
    return false;
  }
}

export function markGardenHintSeen(storage: Storage | null = browserStorage()): void {
  try {
    storage?.setItem(GARDEN_HINT_KEY, '1');
  } catch {
    // Không ghi được thì lần sau shouldShowGardenHint cũng đọc hỏng và không hiện; không có gì để làm thêm.
  }
}
