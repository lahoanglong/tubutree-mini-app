'use client';

import { ShoppingCart } from 'lucide-react';
import { BackAwareLink } from '@/components/back-aware-link';
import { useCartBadgeCount } from '@/lib/guest-cart/use-cart-badge-count';
import { CountBadge } from '@/components/mini/badge';

/** Nút giỏ tròn như `CartButton` của Mini App, chỉ ở điện thoại (từ md thanh đầu website đã có giỏ). */
export function PhoneCartButton() {
  const count = useCartBadgeCount();
  return (
    <BackAwareLink
      href="/gio-hang"
      data-cart-target=""
      aria-label={count > 0 ? `Giỏ hàng, ${count} sản phẩm` : 'Giỏ hàng'}
      className="relative grid h-11 w-11 flex-none place-items-center rounded-full bg-[var(--color-action-secondary-bg)] text-[var(--color-text-primary)] md:hidden"
    >
      <ShoppingCart className="h-5 w-5" aria-hidden="true" />
      <CountBadge count={count} bump />
    </BackAwareLink>
  );
}
