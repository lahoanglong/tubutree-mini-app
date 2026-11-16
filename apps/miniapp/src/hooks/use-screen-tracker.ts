import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toRouteTemplate } from '@tubutree/shared-types';
import { trackEvent } from '../services/analytics';

/**
 * Route có tham số của `components/app.tsx`: sự kiện chỉ mang mẫu route (`/product/:slug`), không mang slug hay mã đơn thật.
 * `/feed/events`, `/feed/leaderboard` là route tĩnh nhưng cùng số đoạn với `/feed/:id`, phải ghi riêng để không bị gộp thành bài viết.
 */
export const MINI_DYNAMIC_ROUTES = [
  '/academy/:courseId',
  '/bank-payment/:code',
  '/brand/:slug',
  '/campaign/:slug',
  '/feed/:id',
  '/feed/events',
  '/feed/leaderboard',
  '/group-buy/:id',
  '/order/:code',
  '/product/:slug',
  '/recycle/done/:id',
  '/recycle/r/:id',
  '/recycle/r/:id/edit',
  '/s/:slug',
];

/**
 * Phát `screen_viewed` mỗi khi route (pathname) đổi, kèm mẫu route trước đó và thời gian (ms) kể từ lần đổi route gần nhất.
 * PHẢI được gọi từ một component render BÊN TRONG `<ZMPRouter>` vì `useLocation()` cần Router context (xem `ScreenTracker` trong `components/app.tsx`).
 */
export function useScreenTracker(): void {
  const { pathname } = useLocation();
  const referrerRoute = useRef<string | null>(null);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    const route = toRouteTemplate(pathname, MINI_DYNAMIC_ROUTES);
    trackEvent('screen_viewed', 'miniapp', {
      route,
      referrerRoute: referrerRoute.current,
      msToContent: Date.now() - mountedAt.current,
    });
    referrerRoute.current = route;
    mountedAt.current = Date.now();
  }, [pathname]);
}
