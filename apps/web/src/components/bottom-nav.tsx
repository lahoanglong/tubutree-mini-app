'use client';

import Link from 'next/link';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { apiFetch } from '@/lib/client-api';
import { isWebRootPath, readyNavTabs } from '@/lib/web-nav';
import { useOffersDot } from '@/lib/use-offers-dot';
import { GardenHintBubble } from './garden-hint-bubble';
import { CountBadge } from './mini/badge';
import { useShellPathname } from '@/lib/shell-pathname';

/** Khoá nằm dưới tiền tố ['orders'] nên mọi lần làm mới ['orders'] (đặt đơn, huỷ đơn) cũng làm mới badge, như Mini App. */
const ACTIVE_ORDER_COUNT_KEY = ['orders', 'active-count'] as const;

/** Dữ liệu lạ (route khác trả nhầm) → 0 thay vì NaN, như `fetchActiveOrderCount` của Mini App. */
const fetchActiveOrderCount = async () => {
  const body = await apiFetch<{ count?: unknown }>('/orders/active-count');
  return typeof body?.count === 'number' ? body.count : 0;
};

/**
 * Thanh đáy 5 mục cho điện thoại (từ md thì thanh đầu trang đảm nhiệm). Tab Ưu đãi có chấm đỏ khi chưa điểm danh hôm nay hoặc có mã
 * sắp hết hạn; tab Cá nhân mang huy hiệu số đơn đang xử lý. Chỉ hiện ở 5 route gốc; ẩn khi trang có `sticky-action-bar` (globals.css, theo lớp `has-sticky-bar` của <body>). Khối đệm cùng chiều cao giữ chân trang không bị che.
 */
export default function BottomNav() {
  const pathname = useShellPathname();
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
  const offersDot = useOffersDot(isRoot && tabs.some((t) => t.badge === 'offers-dot'));
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
        <GardenHintBubble onGardenTab={pathname === '/vuon-xanh'} />
        {tabs.map((t) => {
          const active = pathname === t.path;
          const count = t.badge === 'active-orders' ? activeOrders : 0;
          const dot = t.badge === 'offers-dot' && offersDot !== null;
          return (
            <Link
              key={t.path}
              href={t.path}
              aria-label={count > 0 ? `${t.label}, ${count} đơn đang xử lý` : dot ? `${t.label}, có việc cần làm` : t.label}
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
                  <CountBadge count={count} />
                  {dot && (
                    <span
                      data-testid="offers-dot"
                      aria-hidden="true"
                      className="absolute -right-[3px] -top-px h-2.5 w-2.5 rounded-full border-2 border-stone-0 bg-[var(--color-action-danger-bg)] box-border"
                    />
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
