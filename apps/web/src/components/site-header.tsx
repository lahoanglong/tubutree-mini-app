'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag, User } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useAuthPhase } from '@/lib/auth-phase';
import { getCart } from '@/lib/shop-client';
import SiteSearch from '@/components/site-search';
import { useCartKey } from '@/lib/cart-key';
import { readyNavTabs } from '@/lib/web-nav';
import tubuLogo from '@/assets/tubu-logo.png';

export default function SiteHeader() {
  const { user, status } = useAuth();
  const sessionDown = useAuthPhase() === 'unavailable';
  const cartQ = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: status === 'authenticated' });
  const count = cartQ.data?.itemCount ?? 0;

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-stone-0/90 backdrop-blur-md" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2">
        {/* Logo thật của thương hiệu (đã có sẵn khẩu hiệu), không dựng lại bằng biểu tượng + chữ. */}
        <Link href="/" aria-label="Tubu Tree — trang chủ" className="flex min-h-11 items-center">
          <Image src={tubuLogo} alt="Tubu Tree" width={99} height={36} priority className="h-9 w-auto" />
        </Link>

        {/* Tìm kiếm: hàng riêng ở điện thoại để ô nhập đủ rộng, nằm giữa logo và giỏ hàng từ màn sm. */}
        {/* data-site-search: html[data-tenant-host] ẩn khung này từ khung hình đầu trên host gian hàng CTV (globals.css). */}
        <div data-site-search className="order-last flex w-full empty:hidden sm:order-none sm:w-auto sm:max-w-md sm:flex-1">
          <SiteSearch />
        </div>

        {/* Máy tính: cùng các mục gốc với thanh đáy điện thoại (mục chưa làm xong bị ẩn). */}
        <nav aria-label="Mục chính" data-desktop-nav className="hidden items-center gap-1 text-sm md:flex">
          {readyNavTabs().map((t) => (
            <Link key={t.path} href={t.path} className="flex min-h-11 items-center rounded-control px-3 font-medium text-stone-700 transition hover:bg-forest-50 hover:text-forest-700">
              {t.label}
            </Link>
          ))}
        </nav>

        {/* Giỏ hàng & tài khoản */}
        <nav aria-label="Điều hướng chính" className="flex items-center gap-2 text-sm sm:gap-3">
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
    </header>
  );
}
