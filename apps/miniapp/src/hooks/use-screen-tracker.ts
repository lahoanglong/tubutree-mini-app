import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { trackEvent } from '../services/analytics';

/**
 * Phát sự kiện `screen_viewed` mỗi khi route (pathname) đổi, kèm route trước đó và thời gian
 * (ms) kể từ lần đổi route gần nhất — dùng để dựng phễu điều hướng + đo tốc độ chuyển màn.
 * PHẢI được gọi từ một component render BÊN TRONG `<ZMPRouter>` vì `useLocation()` cần Router
 * context (xem `ScreenTracker` trong `components/app.tsx`).
 */
export function useScreenTracker(): void {
  const location = useLocation();
  const prevRoute = useRef<string | null>(null);
  const mountedAt = useRef<number>(Date.now());

  useEffect(() => {
    trackEvent('screen_viewed', 'miniapp', {
      route: location.pathname,
      prevRoute: prevRoute.current,
      msToContent: Date.now() - mountedAt.current,
    });
    prevRoute.current = location.pathname;
    mountedAt.current = Date.now();
  }, [location.pathname]);
}
