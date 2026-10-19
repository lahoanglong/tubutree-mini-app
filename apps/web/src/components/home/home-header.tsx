'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell, ShoppingCart } from 'lucide-react';
import { isWebRouteReady } from '@/lib/route-map';
import { useAuth } from '@/lib/auth-context';
import { useCartKey } from '@/lib/cart-key';
import { getCart } from '@/lib/shop-client';
import { homeText } from '@/lib/home-text';
import { CountBadge } from '@/components/mini/badge';
import tubuLogo from '@/assets/tubu-logo.png';

const BUTTON = 'relative grid h-11 w-11 flex-none place-items-center rounded-full bg-[var(--color-action-secondary-bg)] text-[var(--color-text-primary)]';

/**
 * Đầu Trang chủ ở điện thoại, như `HomeHeader` của Mini App: logo (tên trang cho trình đọc màn hình), chuông thông báo, giỏ.
 * Từ md thanh đầu website đảm nhiệm nên khối này ẩn. Chuông hiện cả với khách chưa đăng nhập như Mini App; trang Thông báo tự đòi đăng nhập.
 */
export function HomeHeader({ unreadCount }: { unreadCount: number }) {
  const { status } = useAuth();
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: status === 'authenticated' });
  const count = cartQ.data?.itemCount ?? 0;
  return (
    <div className="flex items-center justify-between pb-2.5 pt-3.5 md:hidden">
      <Link href="/" aria-label="Tubu Tree — trang chủ" className="block">
        <Image src={tubuLogo} alt="Tubu Tree" width={83} height={30} priority className="block h-[30px] w-[83px] object-contain" />
      </Link>
      <div className="flex items-center gap-2">
        {isWebRouteReady('/tai-khoan/thong-bao') && (
          <Link href="/tai-khoan/thong-bao" aria-label={unreadCount > 0 ? homeText.notificationsUnread(unreadCount) : homeText.notifications} className={BUTTON}>
            <Bell className="h-5 w-5" aria-hidden="true" />
            <CountBadge count={unreadCount} label={homeText.unreadBadge(unreadCount)} />
          </Link>
        )}
        <Link href="/gio-hang" aria-label={count > 0 ? `Giỏ hàng, ${count} sản phẩm` : 'Giỏ hàng'} className={BUTTON}>
          <ShoppingCart className="h-5 w-5" aria-hidden="true" />
          <CountBadge count={count} />
        </Link>
      </div>
    </div>
  );
}
