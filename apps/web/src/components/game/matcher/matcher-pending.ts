import { decodeMatcherPending, encodeMatcherPending, MATCHER_PENDING_KEY, type MatcherResult } from '@tubutree/app-core/game-mini/matcher';

/**
 * Bộ Chọn Chuẩn Xanh chờ khách đăng nhập (xem `MATCHER_PENDING_KEY`). Bộ nhớ phiên bị chặn hay đầy thì mọi hàm im lặng: khách vẫn sang đăng nhập
 * được, chỉ mất lối hiện lại bộ.
 */
export function savePendingMatcher(result: MatcherResult): void {
  try {
    window.sessionStorage.setItem(MATCHER_PENDING_KEY, encodeMatcherPending(result));
  } catch {
    // Không ghi được thì thôi.
  }
}

export function clearPendingMatcher(): void {
  try {
    window.sessionStorage.removeItem(MATCHER_PENDING_KEY);
  } catch {
    // Không xoá được thì bộ tự hết hạn.
  }
}

/** Đọc rồi xoá ngay: bộ chỉ hiện lại một lần, tải lại trang không hiện nữa. */
export function takePendingMatcher(): MatcherResult | null {
  try {
    const raw = window.sessionStorage.getItem(MATCHER_PENDING_KEY);
    window.sessionStorage.removeItem(MATCHER_PENDING_KEY);
    return decodeMatcherPending(raw);
  } catch {
    return null;
  }
}
