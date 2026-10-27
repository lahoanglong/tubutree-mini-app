'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { notificationsQuery } from '@tubutree/app-core/queries/account';
import { coreHttp } from '@/lib/core-http';
import { homeText } from '@/lib/home-text';
import { isWebRouteReady } from '@/lib/route-map';

/**
 * Chuông thông báo ở thanh đầu máy tính, mọi trang. Dùng chung queryKey ['notifications'] với trang Thông báo và HomeHeader
 * của điện thoại nên không thêm request. Khách chưa đăng nhập không có chuông.
 */
export function HeaderBell({ authed }: { authed: boolean }) {
  // Thanh đầu chỉ hiện từ md; điện thoại có chuông riêng ở Trang chủ, nên không gọi thêm request ở đó (giữ như trước khi có chuông này).
  const [wide, setWide] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setWide(true);
      return;
    }
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const q = useQuery({ ...notificationsQuery(coreHttp), enabled: authed && wide });
  if (!authed || !isWebRouteReady('/tai-khoan/thong-bao')) return null;
  const unread = Array.isArray(q.data) ? q.data.filter((n) => n.status !== 'READ').length : 0;
  return (
    <Link
      href="/tai-khoan/thong-bao"
      aria-label={unread > 0 ? homeText.notificationsUnread(unread) : homeText.notifications}
      className="relative flex h-11 w-11 items-center justify-center rounded-control border border-stone-200 bg-stone-25 text-stone-700 transition hover:border-forest-600 hover:bg-forest-50 hover:text-forest-700"
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {unread > 0 && (
        <span
          role="img"
          aria-label={homeText.unreadBadge(unread)}
          className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-promo-solid px-1 text-xs font-bold text-stone-900 shadow-card ring-2 ring-stone-0"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
