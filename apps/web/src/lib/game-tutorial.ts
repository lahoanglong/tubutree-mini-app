import { TUTORIAL_DISMISSED_KEY } from '@tubutree/app-core/game-newbie';

/** localStorage vắng hoặc ném (chế độ riêng tư, SSR) → coi như đã xem: thà không hiện thẻ còn hơn hiện lại mỗi lần mở. */
export function isGameTutorialDismissed(): boolean {
  try {
    return window.localStorage.getItem(TUTORIAL_DISMISSED_KEY) !== null;
  } catch {
    return true;
  }
}

export function dismissGameTutorial(): void {
  try {
    window.localStorage.setItem(TUTORIAL_DISMISSED_KEY, '1');
  } catch {
    // Không ghi được thì lần sau đọc cũng hỏng và thẻ không hiện; không còn gì để làm.
  }
}
