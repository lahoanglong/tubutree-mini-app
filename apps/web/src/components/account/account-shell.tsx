'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Bell,
  Gift,
  Heart,
  MapPin,
  Package,
  Settings,
  Sprout,
  User,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthPhase, useAuthRestoring } from '@/lib/auth-phase';
import { isWebRouteReady } from '@/lib/route-map';
import { useShellPathname } from '@/lib/shell-pathname';

interface ShellItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const GROUPS: { group: string; items: ShellItem[] }[] = [
  {
    group: 'Mua sắm',
    items: [
      { to: '/tai-khoan', label: 'Tổng quan', icon: User },
      { to: '/tai-khoan/don-hang', label: 'Đơn hàng', icon: Package },
      { to: '/tai-khoan/yeu-thich', label: 'Yêu thích', icon: Heart },
      { to: '/tai-khoan/dia-chi', label: 'Sổ địa chỉ', icon: MapPin },
    ],
  },
  {
    group: 'Điểm và quà',
    items: [
      { to: '/tai-khoan/diem-xanh', label: 'Điểm Xanh và hạng', icon: Sprout },
      { to: '/tai-khoan/vi-tubu', label: 'Ví Tubu', icon: Wallet },
      { to: '/kho-qua', label: 'Kho quà', icon: Gift },
      { to: '/kho-qua/cua-toi', label: 'Quà của tôi', icon: Gift },
    ],
  },
  {
    group: 'Tài khoản',
    items: [
      { to: '/tai-khoan/ho-so', label: 'Sửa hồ sơ', icon: UserRound },
      { to: '/tai-khoan/thong-bao', label: 'Thông báo', icon: Bell },
      { to: '/tai-khoan/cai-dat', label: 'Cài đặt', icon: Settings },
    ],
  },
];

/** Mục đang mở: khớp đúng đường dẫn, hoặc đường dẫn con của mục (đơn hàng → chi tiết đơn); "Tổng quan" và "Kho quà" chỉ khớp đúng. */
function isActive(pathname: string, to: string): boolean {
  if (pathname === to) return true;
  if (to === '/tai-khoan' || to === '/kho-qua') return false;
  return pathname.startsWith(`${to}/`);
}

/**
 * Khung khu tài khoản cho máy tính (từ lg): cột menu 240px bên trái, nội dung bên phải, để đổi từ Ví sang Điểm, Địa chỉ… không phải
 * về Tài khoản rồi chọn lại. Dưới lg khung không làm gì (children nguyên như cũ, điện thoại giống Mini App). Chỉ hiện menu khi đã
 * đăng nhập (khách thấy màn yêu cầu đăng nhập, không có gì để chuyển mục).
 *
 * Mỗi trang con tự vẽ <main> riêng (khung PAGE_WIDE/PAGE_NARROW nên tự căn giữa và có lề): trong khung này lề đó bỏ đi để nội dung
 * thẳng lề với cột, và liên kết "← Tài khoản" của từng trang (BackLink, có data-back-link) ẩn vì đã có menu.
 */
export function AccountShell({ children }: { children: ReactNode }) {
  const phase = useAuthPhase();
  const pathname = useShellPathname();
  const authed = phase === 'authenticated';
  // Chỉ khi ĐANG KHÔI PHỤC một phiên có sẵn (cờ tubu_web_session) mới dựng khung hai cột với menu khung xương, để phiên về thì nội dung không
  // dịch ngang 264px. Phase 'loading' một mình không đủ: SSR và lần render đầu ai cũng 'loading', khách vãng lai sẽ thấy khung rồi nhảy.
  const restoring = useAuthRestoring();
  const framed = authed || restoring;

  // Cây DOM giữ nguyên khi phiên đổi từ đang kiểm tra sang đã đăng nhập (chỉ lớp và menu thay đổi): trang con không bị dựng lại.
  return (
    <div
      className={`mx-auto w-full max-w-frame ${framed ? 'lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:items-start lg:gap-6 lg:px-6 lg:pt-6' : ''}`}
    >
      {restoring && !authed && (
        <div aria-hidden="true" data-testid="account-shell-nav-skeleton" className="hidden lg:block">
          {[0, 1, 2].map((g) => (
            <div key={g} className="mb-4 space-y-2">
              <Skeleton width={90} height={12} />
              {[0, 1, 2, 3].map((r) => (
                <Skeleton key={r} height={36} />
              ))}
            </div>
          ))}
        </div>
      )}
      {authed && (
        <nav
          aria-label="Menu tài khoản"
          data-testid="account-shell-nav"
          className="hidden lg:sticky lg:top-[calc(var(--header-h)+16px)] lg:block lg:max-h-[calc(100vh-var(--header-h)-32px)] lg:self-start lg:overflow-y-auto"
        >
          {GROUPS.map((g) => {
            const items = g.items.filter((i) => isWebRouteReady(i.to));
            if (items.length === 0) return null;
            return (
              <div key={g.group} className="mb-4">
                <h2 className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-stone-600">
                  {g.group}
                </h2>
                <ul>
                  {items.map((i) => {
                    const active = isActive(pathname, i.to);
                    return (
                      <li key={i.to}>
                        <Link
                          href={i.to}
                          aria-current={active ? 'page' : undefined}
                          className={`flex min-h-11 items-center gap-2.5 rounded-control px-3 text-sm transition hover:bg-forest-50 ${
                            active ? 'bg-forest-50 font-semibold text-forest-800' : 'text-stone-800'
                          }`}
                        >
                          <i.icon
                            className="h-4 w-4 flex-none text-forest-600"
                            aria-hidden="true"
                          />
                          {i.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      )}
      <div
        className={
          framed
            ? 'min-w-0 lg:[&_main]:mx-0 lg:[&_main]:px-0 lg:[&_main.max-w-frame]:max-w-none lg:[&_[data-back-link]]:hidden'
            : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
