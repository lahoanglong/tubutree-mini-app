import type { MiniProductCard } from '@tubutree/shared-types';
import { BASKET_PENDING_KEY, decodeBasketPending, encodeBasketPending } from '@tubutree/app-core/game-mini/basket-cart';

/**
 * Bộ đúng của Giỏ Đúng Việc chờ khách đăng nhập (xem `BASKET_PENDING_KEY`). Bộ nhớ phiên bị chặn hay đầy thì mọi hàm im lặng: khách vẫn sang đăng
 * nhập được, chỉ mất lối hiện lại bộ.
 */
export function savePendingBasket(products: readonly MiniProductCard[]): void {
  try {
    window.sessionStorage.setItem(BASKET_PENDING_KEY, encodeBasketPending(products));
  } catch {
    // Không ghi được thì thôi.
  }
}

export function clearPendingBasket(): void {
  try {
    window.sessionStorage.removeItem(BASKET_PENDING_KEY);
  } catch {
    // Không xoá được thì bộ tự hết hạn.
  }
}

/** Đọc rồi xoá ngay: bộ chỉ hiện lại một lần, tải lại trang không hiện nữa. */
export function takePendingBasket(): MiniProductCard[] | null {
  try {
    const raw = window.sessionStorage.getItem(BASKET_PENDING_KEY);
    window.sessionStorage.removeItem(BASKET_PENDING_KEY);
    return decodeBasketPending(raw);
  } catch {
    return null;
  }
}
