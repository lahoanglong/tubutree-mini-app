'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Leaf, LogOut, Store } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { isPortalPath } from '@/lib/site';
import { BTN_SECONDARY } from './ui';

/** Nhãn cổng theo đường dẫn; null ở trang khách. /admin gồm cả POS (/admin/pos). */
export function portalLabel(pathname: string | null | undefined): string | null {
  if (!isPortalPath(pathname)) return null;
  return pathname === '/admin' || pathname!.startsWith('/admin/') ? 'Quản trị' : 'Đối tác';
}

/**
 * Thanh đầu riêng của quản trị, POS và đối tác. Thay SiteHeader (giỏ hàng, tìm sản phẩm, tài khoản khách) vốn vô nghĩa ở đây
 * và chiếm chỗ của bảng làm việc. Không có h1: mỗi trang tự giữ tiêu đề của mình.
 */
export default function PortalHeader() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const label = portalLabel(pathname);
  if (!label) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200 bg-stone-0/90 backdrop-blur-md" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 py-1 sm:gap-3 sm:py-2">
        <Link href="/" className="flex min-h-[44px] min-w-0 items-center gap-2 whitespace-nowrap sm:gap-2.5" aria-label={`Tubu Tree, cổng ${label}`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-control bg-forest-600 text-stone-0 shadow-card">
            <Leaf className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="font-display text-base font-semibold leading-tight tracking-tight text-stone-900 max-[399px]:sr-only sm:text-lg">Tubu Tree</span>
          <span data-portal-label className="shrink-0 rounded-control bg-forest-50 px-2 py-0.5 text-xs font-semibold text-forest-700">
            {label}
          </span>
        </Link>

        <nav aria-label="Điều hướng cổng" className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Link href="/" className={`${BTN_SECONDARY} inline-flex items-center gap-1.5 min-h-[44px] min-w-[44px] justify-center text-xs max-sm:px-3`}>
            <Store className="h-4 w-4" aria-hidden="true" />
            <span className="max-sm:sr-only">Về cửa hàng</span>
          </Link>
          {user && (
            <>
              <span data-portal-user className="hidden max-w-[120px] truncate text-xs font-semibold text-stone-800 sm:block">
                {user.fullName ? user.fullName.split(' ').slice(-1)[0] : 'Tài khoản'}
              </span>
              <button type="button" onClick={() => void logout()} className={`${BTN_SECONDARY} inline-flex items-center gap-1.5 min-h-[44px] min-w-[44px] justify-center text-xs max-sm:px-3`}>
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>Đăng xuất</span>
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
