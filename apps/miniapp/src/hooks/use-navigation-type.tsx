import { createContext, useContext, type ReactNode } from 'react';
import { useNavigationType as useRouterNavigationType, type NavigationType } from 'react-router-dom';

const NavigationTypeContext = createContext<NavigationType | null>(null);

/**
 * Loại điều hướng THẬT của lần đổi route gần nhất (PUSH / REPLACE / POP).
 *
 * Vì sao cần: `useNavigationType()` của react-router, gọi bên trong `<AnimationRoutes>` của zmp-ui, LUÔN trả
 * 'POP' — `<Routes location={…}>` (zmp-ui truyền location tường minh) ghi đè context bằng navigationType Pop.
 * Trang Danh mục dựa vào nó để chỉ khôi phục vị trí cuộn khi Back, nên trước khi có provider này mọi lần mở
 * mới (PUSH) cũng bị khôi phục cuộn và `search_performed` không bao giờ "quên" khoá cũ khi mở lại.
 *
 * `NavigationTypeProvider` phải nằm trong `<ZMPRouter>` và BÊN NGOÀI `<AnimationRoutes>`.
 */
export function NavigationTypeProvider({ children }: { children: ReactNode }) {
  const type = useRouterNavigationType();
  return <NavigationTypeContext.Provider value={type}>{children}</NavigationTypeContext.Provider>;
}

/** Không có provider (test dùng MemoryRouter + Routes thường) → lùi về hook của react-router. */
export function useNavigationType(): NavigationType {
  const fromProvider = useContext(NavigationTypeContext);
  const fromRouter = useRouterNavigationType();
  return fromProvider ?? fromRouter;
}
