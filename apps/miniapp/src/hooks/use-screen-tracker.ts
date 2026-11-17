import { useEffect, useRef } from 'react';
import { matchPath, useLocation } from 'react-router-dom';
import { trackEvent } from '../services/analytics';

/**
 * Route có tham số của `components/app.tsx`: sự kiện chỉ mang mẫu route (`/product/:slug`), không mang slug hay mã đơn thật.
 * `/feed/events`, `/feed/leaderboard` là route tĩnh cùng số đoạn với `/feed/:id`: đứng TRƯỚC `/feed/:id` để không bị gộp thành bài viết.
 */
export const MINI_DYNAMIC_ROUTES = [
  '/academy/:courseId',
  '/bank-payment/:code',
  '/brand/:slug',
  '/campaign/:slug',
  '/feed/events',
  '/feed/leaderboard',
  '/feed/:id',
  '/game/play/:game',
  '/group-buy/:id',
  '/order/:code',
  '/product/:slug',
  '/recycle/done/:id',
  '/recycle/r/:id',
  '/recycle/r/:id/edit',
  '/s/:slug',
];

/**
 * Cho cùng kết quả với `toRouteTemplate(pathname, MINI_DYNAMIC_ROUTES)` của shared-types trên mọi route của app (spec đối chiếu), nhưng dùng
 * `matchPath` có sẵn trong gói React Router: hàm dùng chung nặng ~470 byte, vượt trần dung lượng gói Mini App. Đường dẫn không khớp route nào
 * (404) giữ đoạn đúng khuôn route tĩnh, thay đoạn khác bằng `:x`.
 */
export function miniRouteTemplate(pathname: string): string {
  return (
    MINI_DYNAMIC_ROUTES.find((p) => matchPath(p, pathname)) ?? pathname.replace(/[^/]+/g, (s) => (/^[a-z][a-z0-9-]{0,39}$/.test(s) ? s : ':x'))
  );
}

/**
 * Phát `screen_viewed` mỗi khi route (pathname) đổi, kèm mẫu route trước đó và thời gian (ms) kể từ lần đổi route gần nhất.
 * PHẢI được gọi từ một component render BÊN TRONG `<ZMPRouter>` vì `useLocation()` cần Router context (xem `ScreenTracker` trong `components/app.tsx`).
 */
export function useScreenTracker(): void {
  const { pathname } = useLocation();
  const referrerRoute = useRef<string | null>(null);
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    const route = miniRouteTemplate(pathname);
    trackEvent('screen_viewed', 'miniapp', {
      route,
      referrerRoute: referrerRoute.current,
      msToContent: Date.now() - mountedAt.current,
    });
    referrerRoute.current = route;
    mountedAt.current = Date.now();
  }, [pathname]);
}
