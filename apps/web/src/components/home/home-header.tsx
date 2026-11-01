'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell, Search, ShoppingCart } from 'lucide-react';
import { isWebRouteReady } from '@/lib/route-map';
import { useAuth } from '@/lib/auth-context';
import { useCartKey } from '@/lib/cart-key';
import { getCart } from '@/lib/shop-client';
import { homeText } from '@/lib/home-text';
import { CountBadge } from '@/components/mini/badge';
import tubuLogo from '@/assets/tubu-logo-home.png';

const BUTTON = 'relative grid h-11 w-11 flex-none place-items-center rounded-full bg-[var(--color-action-secondary-bg)] text-[var(--color-text-primary)]';

// Chỉ lấy dấu logo (khối vuông có lá) ở mép trái ảnh: chữ "Tubu Tree" đi kèm sẽ chiếm chỗ của ô tìm ở 375px (giống Mini App). Dấu hết ở
// cột 58/249 của ảnh, chữ bắt đầu ở cột 63: 20px (= cột 60) cắt đúng khe trống; rộng hơn sẽ lộ một dải chữ "T"/"S" bên phải.
const LOGO_MARK_WIDTH = 20;

/**
 * Đầu Trang chủ ở điện thoại, như `HomeHeader` của Mini App: MỘT hàng cao 56px gồm dấu logo (tên trang cho trình đọc màn hình), ô tìm, chuông
 * thông báo và giỏ. Thay hàng logo cuộn mất và ô tìm tách riêng: cuộn xuống vẫn còn lối vào tìm kiếm và giỏ. Tính dính do vỏ khối `search` ở
 * home-view lo. Từ md thanh đầu website đảm nhiệm nên khối này ẩn; trang đã có một h1 ở page.tsx nên ở đây không thêm.
 * Ô tìm chỉ là vỏ: mở thẳng bàn phím ở ô thật bên /san-pham (?focus=search). Chuông hiện cả với khách chưa đăng nhập như Mini App.
 */
export function HomeHeader({ unreadCount }: { unreadCount: number }) {
  const { status } = useAuth();
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: status === 'authenticated' });
  const count = cartQ.data?.itemCount ?? 0;
  return (
    <div data-testid="home-header" className="flex h-14 items-center gap-2 md:hidden">
      <Link href="/" aria-label="Tubu Tree — trang chủ" className="block h-[30px] flex-none overflow-hidden" style={{ width: LOGO_MARK_WIDTH }}>
        <Image src={tubuLogo} alt="Tubu Tree" width={83} height={30} priority className="block h-[30px] w-[83px] max-w-none object-contain" />
      </Link>
      <Link
        href="/san-pham?focus=search"
        aria-label={homeText.searchPlaceholder}
        className="tubu-press flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] px-3.5"
      >
        <Search className="h-4 w-4 flex-none text-stone-600" aria-hidden="true" />
        <span className="min-w-0 truncate text-sm text-stone-600">{homeText.searchPlaceholder}</span>
      </Link>
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
  );
}
