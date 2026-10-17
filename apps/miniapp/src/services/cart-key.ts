import { useStorefrontContext } from '../store/storefront-context';

/** Gian hàng CTV đang ghi công: máy chủ tính combo của giỏ theo gian hàng này (không có thì giỏ không combo). */
export function cartStorefrontSlug(): string | null {
  const ctx = useStorefrontContext.getState();
  return ctx.kind === 'ctv' && ctx.slug ? ctx.slug : null;
}

/**
 * Khoá cache của giỏ: kèm gian hàng vì combo (và mức giảm của mã sau combo) đổi theo gian hàng; một khoá chung sẽ hiện combo của
 * gian hàng trước cho tới lần tải lại. `invalidateQueries({ queryKey: ['cart'] })` vẫn khớp mọi gian hàng (tiền tố).
 */
export function cartKey() {
  return ['cart', cartStorefrontSlug()] as const;
}

/** Như `cartKey` nhưng theo dõi gian hàng để màn đang mở đổi khoá khi khách sang gian hàng khác. */
export function useCartKey() {
  const slug = useStorefrontContext((s) => (s.kind === 'ctv' && s.slug ? s.slug : null));
  return ['cart', slug] as const;
}
