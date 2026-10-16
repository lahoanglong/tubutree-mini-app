import { ctvSlugFor, getStorefrontContext } from './storefront-context';

/** Gian hàng CTV đang ghi công: máy chủ tính combo của giỏ theo gian hàng này (không có thì giỏ không combo). */
export function cartStorefrontSlug(): string | null {
  return ctvSlugFor(getStorefrontContext()) ?? null;
}

/**
 * Khoá cache của giỏ: kèm gian hàng vì combo (và mức giảm của mã sau combo) đổi theo gian hàng; một khoá chung sẽ hiện combo của
 * gian hàng trước cho tới lần tải lại. `invalidateQueries({ queryKey: ['cart'] })` vẫn khớp mọi gian hàng (tiền tố).
 */
export function cartKey() {
  return ['cart', cartStorefrontSlug()] as const;
}
