'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/client-api';
import { isWebRootPath, readyNavTabs } from '@/lib/web-nav';

/** Khoá nằm dưới tiền tố ['orders'] nên mọi lần làm mới ['orders'] (đặt đơn, huỷ đơn) cũng làm mới badge, như Mini App. */
const ACTIVE_ORDER_COUNT_KEY = ['orders', 'active-count'] as const;

/** Dữ liệu lạ (route khác trả nhầm) → 0 thay vì NaN, như `fetchActiveOrderCount` của Mini App. */
const fetchActiveOrderCount = async () => {
  const body = await apiFetch<{ count?: unknown }>('/orders/active-count');
  return typeof body?.count === 'number' ? body.count : 0;
};

/**
 * Thanh đáy 5 mục cho điện thoại (từ md thì thanh đầu trang đảm nhiệm). Chỉ hiện ở 5 route gốc; ẩn khi trang có
 * `sticky-action-bar` (globals.css, theo lớp `has-sticky-bar` của <body>). Khối đệm cùng chiều cao giữ chân trang không bị che.
 */
export default function BottomNav() {
  const pathname = usePathname();
  const { status } = useAuth();
  const isRoot = isWebRootPath(pathname);
  const tabs = readyNavTabs();
  const activeQ = useQuery({
    queryKey: ACTIVE_ORDER_COUNT_KEY,
    queryFn: fetchActiveOrderCount,
    enabled: isRoot && status === 'authenticated' && tabs.some((t) => t.badge === 'active-orders'),
    staleTime: 30_000,
    retry: false,
  });
  if (!isRoot) return null;
  const activeOrders = activeQ.data ?? 0;

  return (
    <div data-bottom-nav className="md:hidden">
      <div aria-hidden="true" style={{ height: 'calc(60px + env(safe-area-inset-bottom, 0px))' }} />
      <nav
        aria-label="Thanh điều hướng dưới"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-stone-200 bg-stone-0 shadow-card"
        style={{ height: 'calc(60px + env(safe-area-inset-bottom, 0px))', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {tabs.map((t) => {
          const active = pathname === t.path;
          const count = t.badge === 'active-orders' ? activeOrders : 0;
          return (
            <Link
              key={t.path}
              href={t.path}
              aria-label={count > 0 ? `${t.label}, ${count} đơn đang xử lý` : t.label}
              aria-current={active ? 'page' : undefined}
              data-center={t.center ? 'true' : undefined}
              className={`relative flex min-h-11 min-w-0 flex-1 flex-col items-center gap-0.5 ${t.center ? 'justify-end pb-1.5' : 'justify-center'} ${active ? 'font-bold text-forest-700' : 'font-medium text-stone-500'}`}
            >
              {t.center ? (
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-[-22px] grid h-[54px] w-[54px] -translate-x-1/2 place-items-center rounded-full border-[3px] border-stone-0 bg-forest-600 text-stone-0 shadow-card"
                >
                  <t.Icon className="h-6 w-6" />
                </span>
              ) : (
                <span aria-hidden="true" className="relative grid place-items-center">
                  <t.Icon className="h-6 w-6" />
                  {count > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-forest-600 px-1 text-xs font-bold text-stone-0 ring-2 ring-stone-0">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </span>
              )}
              <span className="text-xs">{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
