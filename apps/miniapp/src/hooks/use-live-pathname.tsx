import { createContext, useContext, useLayoutEffect, useRef, type MutableRefObject, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

export const LivePathnameContext = createContext<MutableRefObject<string> | null>(null);

/**
 * Đường dẫn THẬT của router. `useLocation()` bên trong `<AnimationRoutes>` của zmp-ui trả location đóng băng của trang:
 * trang cũ còn mount suốt lúc chạy hiệu ứng thoát (~400 ms) nên không tự biết khách đã rời đi.
 * Phải nằm trong `<ZMPRouter>` và BÊN NGOÀI `<AnimationRoutes>`.
 */
export function LivePathnameProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const ref = useRef(pathname);
  ref.current = pathname;
  useLayoutEffect(() => {
    ref.current = pathname;
  }, [pathname]);
  return <LivePathnameContext.Provider value={ref}>{children}</LivePathnameContext.Provider>;
}

/** null khi không có provider (test dựng riêng): bên gọi coi như vẫn đang ở trang. */
export function useLivePathnameRef(): MutableRefObject<string> | null {
  return useContext(LivePathnameContext);
}
