import type { MiniProductCard } from '@tubutree/shared-types';
import { BASKET_PENDING_KEY, KITCHEN_PENDING_KEY, decodeBasketPending, encodeBasketPending } from '@tubutree/app-core/game-mini/basket-cart';

/** Game có bộ sản phẩm thêm giỏ ở màn kết quả: Giỏ Đúng Việc (bộ đúng) và Căn Bếp Xanh (3 sản phẩm vừa khám phá). */
export type MiniCartGame = 'basket' | 'kitchen_swap';

const keyOf = (game: MiniCartGame) => (game === 'kitchen_swap' ? KITCHEN_PENDING_KEY : BASKET_PENDING_KEY);

/**
 * Bộ sản phẩm chờ khách đăng nhập (xem `BASKET_PENDING_KEY`), mỗi game một khoá. Bộ nhớ phiên bị chặn hay đầy thì mọi hàm im lặng: khách vẫn
 * sang đăng nhập được, chỉ mất lối hiện lại bộ.
 */
export function savePendingBasket(products: readonly MiniProductCard[], game: MiniCartGame = 'basket'): void {
  try {
    window.sessionStorage.setItem(keyOf(game), encodeBasketPending(products));
  } catch {
    // Không ghi được thì thôi.
  }
}

export function clearPendingBasket(game: MiniCartGame = 'basket'): void {
  try {
    window.sessionStorage.removeItem(keyOf(game));
  } catch {
    // Không xoá được thì bộ tự hết hạn.
  }
}

/** Đọc rồi xoá ngay: bộ chỉ hiện lại một lần, tải lại trang không hiện nữa. */
export function takePendingBasket(game: MiniCartGame = 'basket'): MiniProductCard[] | null {
  try {
    const raw = window.sessionStorage.getItem(keyOf(game));
    window.sessionStorage.removeItem(keyOf(game));
    return decodeBasketPending(raw);
  } catch {
    return null;
  }
}
