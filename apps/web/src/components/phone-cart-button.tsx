'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { useAuthPhase } from '@/lib/auth-phase';
import { useCartKey } from '@/lib/cart-key';
import { getCart } from '@/lib/shop-client';
import { CountBadge } from '@/components/mini/badge';

/** Nút giỏ tròn như `CartButton` của Mini App, chỉ ở điện thoại (từ md thanh đầu website đã có giỏ). */
export function PhoneCartButton() {
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: useAuthPhase() === 'authenticated' });
  const count = cartQ.data?.itemCount ?? 0;
  return (
    <Link
      href="/gio-hang"
      aria-label={count > 0 ? `Giỏ hàng, ${count} sản phẩm` : 'Giỏ hàng'}
      className="relative grid h-11 w-11 flex-none place-items-center rounded-full bg-[var(--color-action-secondary-bg)] text-[var(--color-text-primary)] md:hidden"
    >
      <ShoppingCart className="h-5 w-5" aria-hidden="true" />
      <CountBadge count={count} />
    </Link>
  );
}
