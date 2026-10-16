'use client';

import { useSyncExternalStore } from 'react';
import { ctvSlugFor, getStorefrontContext, subscribeStorefrontContext } from './storefront-context';

/** Gian hàng CTV đang ghi công: máy chủ tính combo của giỏ theo gian hàng này (không có thì giỏ không combo). */
export function cartStorefrontSlug(): string | null {
  return ctvSlugFor(getStorefrontContext()) ?? null;
}

/**
 * Khoá cache của giỏ: kèm gian hàng vì combo (và mức giảm của mã sau combo) đổi theo gian hàng; một khoá chung sẽ hiện combo của
 * gian hàng trước cho tới lần tải lại. `invalidateQueries({ queryKey: ['cart'] })` vẫn khớp mọi gian hàng (tiền tố).
 * Dùng trong hàm xử lý sự kiện/mutation (đọc đúng lúc gọi); màn đọc giỏ dùng `useCartKey`.
 */
export function cartKey() {
  return ['cart', cartStorefrontSlug()] as const;
}

/** Như `cartKey` nhưng render lại khi gian hàng ghi công đổi (layout gốc như header không remount khi điều hướng phía khách). */
export function useCartKey() {
  const slug = useSyncExternalStore(subscribeStorefrontContext, cartStorefrontSlug, () => null);
  return ['cart', slug] as const;
}
