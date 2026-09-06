'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ShoppingBag, User, Store } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getCart } from '@/lib/shop-client';

export default function SiteHeader() {
  const { user, status } = useAuth();
  const cartQ = useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: status === 'authenticated' });
  const count = cartQ.data?.itemCount ?? 0;

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200/80 bg-white/90 backdrop-blur-md transition-all">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-2.5">
        {/* Logo & Brand */}
        <Link href="/" className="group flex items-center gap-2.5 focus:outline-none">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-leaf-600 to-leaf-700 shadow-sm transition-transform duration-200 group-hover:scale-105">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 22v-9" />
              <path d="M9 13a4 4 0 0 1-5-3.87A4 4 0 0 1 7.2 5.5 5 5 0 0 1 16.8 5.5 4 4 0 0 1 20 9.13 4 4 0 0 1 15 13" />
              <path d="M12 13a3 3 0 0 0 3-3" />
            </svg>
          </div>
          <div>
            <span className="text-lg font-bold tracking-tight text-neutral-900 transition-colors group-hover:text-primary-700">
              Tubu Tree
            </span>
            <span className="hidden text-[10px] font-medium tracking-wide text-leaf-700 sm:block">
              SỐNG XANH AN LÀNH
            </span>
          </div>
        </Link>

        {/* Navigation & Action Controls */}
        <nav className="flex items-center gap-2 sm:gap-3 text-sm">
          {/* Merchant Portal Shortcut */}
          <Link
            href="/merchant"
            className="hidden items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50/80 px-2.5 py-1.5 text-xs font-medium text-neutral-700 transition hover:border-leaf-600 hover:bg-leaf-50 hover:text-leaf-900 sm:flex"
            title="Cổng quản trị gian hàng đối tác"
          >
            <Store className="h-3.5 w-3.5 text-leaf-700" />
            <span>Kênh Đối Tác</span>
          </Link>

          {/* Cart Icon Button */}
          <Link
            href="/gio-hang"
            aria-label="Giỏ hàng"
            className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200/80 bg-neutral-50/50 text-neutral-700 transition hover:border-primary-600 hover:bg-primary-50 hover:text-primary-700"
          >
            <ShoppingBag className="h-4 w-4" />
            {count > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>

          {/* User Account / Auth */}
          {status === 'authenticated' ? (
            <Link
              href="/tai-khoan"
              className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 transition hover:border-neutral-300 hover:bg-neutral-50 shadow-sm"
            >
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-100 text-[10px] font-bold text-primary-900">
                {user?.fullName ? user.fullName.slice(0, 1).toUpperCase() : <User className="h-3 w-3" />}
              </div>
              <span className="max-w-[100px] truncate">
                {user?.fullName ? user.fullName.split(' ').slice(-1)[0] : 'Tài khoản'}
              </span>
            </Link>
          ) : (
            <Link
              href="/dang-nhap"
              className="rounded-lg bg-primary-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-primary-700 active:scale-95"
            >
              Đăng nhập
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

