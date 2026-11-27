'use client';

import Link from 'next/link';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { meSummaryQuery } from '@tubutree/app-core/api/me-summary';
import { coreHttp } from '@/lib/core-http';
import { isWebRootPath, readyNavTabs } from '@/lib/web-nav';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { useOffersDot } from '@/lib/use-offers-dot';
import { useEngagementDots } from '@/lib/use-engagement-dots';
import { CountBadge } from './mini/badge';
import { useShellPathname } from '@/lib/shell-pathname';

/** Bấm lại tab đang mở thì cuộn mượt về đầu trang (như Mini App). Khách bật giảm chuyển động thì nhảy thẳng. */
function scrollToTop() {
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

/**
 * Thanh đáy 5 mục cho điện thoại (từ md thì thanh đầu trang đảm nhiệm). Tab Ưu đãi có chấm đỏ khi chưa điểm danh hôm nay hoặc có mã
 * sắp hết hạn; tab Cá nhân mang huy hiệu số đơn đang xử lý. Chỉ hiện ở 5 route gốc; ẩn khi trang có `sticky-action-bar` (globals.css, theo lớp `has-sticky-bar` của <body>). Khối đệm cùng chiều cao giữ chân trang không bị che.
 * Chuyển tab gốc dùng replace (như `navigate(..., { replace: true })` ở Mini App): Back không tua qua từng tab đã bấm.
 */
export default function BottomNav() {
  const pathname = useShellPathname();
  const { status } = useAuth();
  const isRoot = isWebRootPath(pathname);
  const tabs = readyNavTabs();
  // Cùng query /me/summary với Cá nhân và chuông (số đơn đang xử lý); đặt/huỷ đơn làm mới nó (TubuQueryClient).
  const activeQ = useQuery({
    ...meSummaryQuery(coreHttp),
    select: (s) => s.orders.active,
    enabled: isRoot && status === 'authenticated' && tabs.some((t) => t.badge === 'active-orders'),
    staleTime: 30_000,
    retry: false,
  });
  const activeOrders = activeQ.data ?? 0;
  const reminders = useEngagementDots(isRoot, activeOrders);
  // Lý do "chưa điểm danh" chỉ nhường cho chấm thẻ Vườn Xanh ở Trang chủ (W42); tab gốc khác không có chấm đó nên Ưu đãi giữ lý do này.
  const offersDot = useOffersDot(isRoot && tabs.some((t) => t.badge === 'offers-dot'), reminders.checkInElsewhere && pathname === '/');
  if (!isRoot) return null;

  return (
    <div data-bottom-nav className="md:hidden">
      {/* Chừa cả phần nút Quét mã nhô 22px trên thanh: cuộn hết trang thì dòng chữ cuối của chân trang không nằm dưới nút. */}
      <div aria-hidden="true" data-testid="bottom-nav-spacer" style={{ height: 'calc(60px + 22px + env(safe-area-inset-bottom, 0px))' }} />
      <nav
        aria-label="Thanh điều hướng dưới"
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch bg-stone-0 shadow-nav"
        style={{ height: 'calc(60px + env(safe-area-inset-bottom, 0px))', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {tabs.map((t) => {
          const active = pathname === t.path;
          const count = t.badge === 'active-orders' ? activeOrders : 0;
          const dot = t.badge === 'offers-dot' && offersDot !== null;
          // Mỗi tab tối đa một dấu: số đơn đang xử lý thắng chấm nhắc, để hai dấu đỏ không chồng lên một biểu tượng 24px.
          const remind = t.badge === 'active-orders' && reminders.profile && count === 0;
          const label =
            count > 0
              ? `${t.label}, ${count} đơn đang xử lý`
              : dot
                ? `${t.label}, có việc cần làm`
                : remind
                  ? fillCopy('nav.profileDot', { name: t.label })
                  : t.label;
          return (
            <Link
              key={t.path}
              href={t.path}
              replace
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              data-center={t.center ? 'true' : undefined}
              onClick={(e) => {
                if (!active) return;
                e.preventDefault();
                scrollToTop();
              }}
              className={`relative flex min-h-11 min-w-0 flex-1 flex-col items-center gap-[3px] justify-center ${active ? 'font-semibold text-forest-700' : 'font-medium text-stone-500'}`}
            >
              {t.center ? (
                <>
                  <span aria-hidden="true" className="h-6 shrink-0" />
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-[-22px] grid h-[54px] w-[54px] -translate-x-1/2 place-items-center rounded-full border-[3px] border-stone-0 bg-forest-600 text-stone-0 shadow-card"
                  >
                    <t.Icon className="h-6 w-6" />
                  </span>
                </>
              ) : (
                <span aria-hidden="true" className={`relative grid place-items-center${active ? ' tubu-tab-pop' : ''}`}>
                  <t.Icon className="h-6 w-6" {...(active ? { fill: 'currentColor', fillOpacity: 0.16, strokeWidth: 2 } : null)} />
                  <CountBadge count={count} />
                  {remind && <RemindDot testId="profile-dot" />}
                  {dot && <RemindDot testId="offers-dot" />}
                </span>
              )}
              <span className="text-label">{t.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Chấm nhắc 8px (tab Cá nhân: thông báo chưa đọc; tab Ưu đãi: việc cần làm): đứng yên, không nhấp nháy; nghĩa nằm ở aria-label của tab. */
function RemindDot({ testId }: { testId: string }) {
  return <span data-testid={testId} aria-hidden="true" className="tubu-remind-dot" />;
}
