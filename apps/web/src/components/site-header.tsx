'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag, User } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { getCart } from '@/lib/shop-client';
import SiteSearch from '@/components/site-search';
import { HeaderBell } from '@/components/header-bell';
import { useCartKey } from '@/lib/cart-key';
import { PAGE_WIDE } from '@/lib/page-frame';
import { useShellPathname } from '@/lib/shell-pathname';
import { readyDesktopNav } from '@/lib/web-nav';
import tubuLogo from '@/assets/tubu-logo.png';

export default function SiteHeader() {
  const { user, status } = useAuth();
  const sessionDown = useAuthPhase() === 'unavailable';
  const pathname = useShellPathname();
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: status === 'authenticated' });
  const count = cartQ.data?.itemCount ?? 0;

  return (
    <header
      data-site-header
      className="sticky top-0 z-40 hidden md:block border-b border-stone-200 bg-stone-0/90 backdrop-blur-md"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Hàng 1 luôn một hàng cao 64px (logo, ô tìm, chuông, giỏ, tài khoản); hàng 2 là điều hướng mục chính. Chiều cao tổng
          cố định 108px = --header-h trong globals.css, để cột dính của các trang đặt đúng dưới thanh. */}
      <div className={`${PAGE_WIDE} flex h-16 items-center gap-3`}>
        {/* Logo thật của thương hiệu (đã có sẵn khẩu hiệu), không dựng lại bằng biểu tượng + chữ. */}
        <Link href="/" aria-label="Tubu Tree — trang chủ" className="flex min-h-11 flex-none items-center">
          <Image src={tubuLogo} alt="Tubu Tree" width={99} height={36} priority className="h-9 w-auto" />
        </Link>

        {/* data-site-search: html[data-tenant-host] ẩn khung này từ khung hình đầu trên host gian hàng CTV (globals.css).
            Ở /san-pham ô tìm của header không vẽ (trang có ô tìm riêng kèm gợi ý) nhưng khung vẫn giữ chỗ, để chuông, giỏ, tài khoản không nhảy giữa các trang. */}
        <div data-site-search className="flex min-w-0 flex-1 md:max-w-2xl">
          <SiteSearch />
        </div>

        {/* Chuông, giỏ hàng & tài khoản */}
        <nav aria-label="Điều hướng chính" className="ml-auto flex items-center gap-2 text-sm sm:gap-3">
          <HeaderBell authed={status === 'authenticated'} />
          <Link
            href="/gio-hang"
            aria-label={count > 0 ? `Giỏ hàng, ${count} sản phẩm` : 'Giỏ hàng'}
            className="relative flex h-11 w-11 items-center justify-center rounded-control border border-stone-200 bg-stone-25 text-stone-700 transition hover:border-forest-600 hover:bg-forest-50 hover:text-forest-700"
          >
            <ShoppingBag className="h-5 w-5" aria-hidden="true" />
            {count > 0 && (
              <span
                aria-hidden="true"
                className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-forest-600 px-1 text-xs font-bold text-stone-0 shadow-card ring-2 ring-stone-0"
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>

          {status === 'authenticated' || sessionDown ? (
            <Link
              href="/tai-khoan"
              className="flex min-h-11 items-center gap-1.5 rounded-control border border-stone-200 bg-stone-0 px-3 text-xs font-semibold text-stone-800 shadow-card transition hover:border-stone-300 hover:bg-stone-50"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-forest-100 text-xs font-bold text-forest-800">
                {user?.fullName ? user.fullName.slice(0, 1).toUpperCase() : <User className="h-3.5 w-3.5" aria-hidden="true" />}
              </div>
              <span className="max-w-[100px] truncate">
                {user?.fullName ? user.fullName.split(' ').slice(-1)[0] : 'Tài khoản'}
              </span>
            </Link>
          ) : (
            <Link
              href="/dang-nhap"
              className="flex min-h-11 items-center rounded-control bg-forest-600 px-4 text-sm font-semibold text-stone-0 shadow-card transition hover:bg-forest-700 active:scale-95"
            >
              Đăng nhập
            </Link>
          )}
        </nav>
      </div>

      {/* Máy tính: các mục gốc và chức năng chương trình (mục chưa làm xong bị ẩn). Trang chủ là logo, Cá nhân là nút tài khoản nên không lặp. */}
      <nav aria-label="Mục chính" data-desktop-nav className="border-t border-stone-100">
        <ul className={`${PAGE_WIDE} flex h-11 items-center gap-1 overflow-x-auto text-sm`}>
          {readyDesktopNav().map((t) => {
            const active = pathname === t.path || pathname.startsWith(`${t.path}/`);
            return (
              <li key={t.path} className="flex-none">
                <Link
                  href={t.path}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-9 items-center rounded-control px-3 font-medium transition hover:bg-forest-50 hover:text-forest-700 ${active ? 'text-forest-700' : 'text-stone-700'}`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
