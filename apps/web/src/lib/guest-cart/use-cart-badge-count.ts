'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuthPhase } from '../auth-phase';
import { useCartKey } from '../cart-key';
import { getCart } from '../shop-client';
import { useGuestCartFlag } from './flag';
import { guestCartCount } from './store';
import { useGuestCartLines } from './use-guest-cart';

/**
 * Số món trên huy hiệu giỏ của thanh đầu (website, Trang chủ điện thoại, nút giỏ tròn): giỏ tài khoản khi đã đăng nhập, giỏ trong trình duyệt khi
 * khách chưa đăng nhập và cờ `web.guest_cart_enabled` bật. Cờ tắt hay chưa về thì giữ 0 như trước (khách không thể có giỏ ở đó).
 * HTML máy chủ và lượt hydrate đầu luôn ra 0: pha đăng nhập là 'loading' (hoặc 'guest' ở bản dựng sẵn) còn `useGuestCartLines` trả giỏ trống, nên không lệch.
 */
export function useCartBadgeCount(): number {
  const phase = useAuthPhase();
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: phase === 'authenticated' });
  const guestFlag = useGuestCartFlag({ enabled: phase === 'guest' });
  const guestLines = useGuestCartLines();
  if (phase === 'guest' && guestFlag.enabled) return guestCartCount(guestLines);
  return cartQ.data?.itemCount ?? 0;
}
