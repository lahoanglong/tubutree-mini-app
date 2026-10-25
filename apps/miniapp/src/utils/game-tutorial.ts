import { TUTORIAL_DISMISSED_KEY } from '@tubutree/app-core/game-newbie';
import { browserStorage, type StorageLike } from './recently-viewed';

/** Storage vắng hoặc ném (chế độ riêng tư, WebView lạ) → coi như đã xem: thà không hiện thẻ còn hơn hiện lại mỗi lần mở. */
export function isGameTutorialDismissed(storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(TUTORIAL_DISMISSED_KEY) !== null;
  } catch {
    return true;
  }
}

export function dismissGameTutorial(storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(TUTORIAL_DISMISSED_KEY, '1');
  } catch {
    // Không ghi được thì lần sau đọc cũng hỏng và thẻ không hiện; không còn gì để làm.
  }
}
