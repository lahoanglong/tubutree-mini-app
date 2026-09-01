'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { getCart } from '@/lib/shop-client';

export default function SiteHeader() {
  const { user, status } = useAuth();
  const cartQ = useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: status === 'authenticated' });
  const count = cartQ.data?.itemCount ?? 0;

  return (
    <header className="sticky top-0 z-40 border-b border-neutral-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-primary-700">
          <span className="text-xl">🌳</span> Tubu Tree
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/gio-hang" className="relative">
            🛒
            {count > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white">
                {count}
              </span>
            )}
          </Link>
          {status === 'authenticated' ? (
            <Link href="/tai-khoan" className="font-medium text-primary-700">
              {user?.fullName ? user.fullName.split(' ').slice(-1)[0] : 'Tài khoản'}
            </Link>
          ) : (
            <Link href="/dang-nhap" className="font-medium text-primary-700">
              Đăng nhập
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
