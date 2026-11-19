'use client';

import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { hasSessionMarker } from './client-api';
import { HomeRestoreHintContext } from './home-restore-context';
import { useHydrated } from './use-hydrated';

export type AuthPhase = 'loading' | 'guest' | 'unavailable' | 'authenticated';

/** `true` trong bản ISR dựng sẵn cho khách (lib/guest-prebuilt.ts): middleware chỉ chuyển tới đó khi request không có cookie phiên. */
const PrebuiltGuestContext = createContext(false);

/** Bọc trang của bản dựng sẵn cho khách: HTML máy chủ và lượt hydrate vẽ luôn giao diện khách thay vì khung chờ đăng nhập. */
export function PrebuiltGuest({ children }: { children: ReactNode }) {
  return createElement(PrebuiltGuestContext.Provider, { value: true }, children);
}

/**
 * Trang cần đăng nhập dùng cái này thay vì tự đọc `status`: `status` là 'idle' cả TRƯỚC khi khôi phục phiên
 * lẫn SAU khi biết chắc là khách, nên chỉ `initialized` (xem AuthState) phân biệt được "đang kiểm tra" với
 * "chưa đăng nhập". Coi 'idle' là đang tải thì khách chờ vô hạn không có nút đăng nhập.
 *
 * 'unavailable' = cờ phiên còn nhưng mất mạng/API tạm lỗi lúc khôi phục: khách KHÔNG phải khách vãng lai, đừng
 * mời đăng nhập lại (vòng OAuth thừa) mà nói mất kết nối và cho thử lại.
 *
 * Lượt vẽ đầu (máy chủ và hydrate) luôn là 'loading': máy chủ không có phiên, còn khối Suspense của trang dựng sẵn hydrate muộn, lúc phiên
 * đã khôi phục xong; trả pha thật ngay lúc đó thì HTML lệch ("Hydration failed", React #418).
 *
 * Trong bản dựng sẵn cho khách (PrebuiltGuest) lượt vẽ đầu là 'guest', và vẫn 'guest' trong lúc khôi phục phiên nếu máy không có cờ phiên:
 * giao diện khách đã vẽ không bị gỡ rồi vẽ lại (LCP tính lại, nháy khung chờ). Máy còn cờ phiên (cookie đã mất) thì về 'loading' như thường.
 */
export function useAuthPhase(): AuthPhase {
  const { status, initialized, sessionUnavailable } = useAuth();
  const hydrated = useHydrated();
  const prebuiltGuest = useContext(PrebuiltGuestContext);
  if (!hydrated) return prebuiltGuest ? 'guest' : 'loading';
  if (status === 'authenticated') return 'authenticated';
  if (initialized === false || status === 'loading') return prebuiltGuest && !hasSessionMarker() ? 'guest' : 'loading';
  return sessionUnavailable ? 'unavailable' : 'guest';
}

const subscribeStorage = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};

/**
 * Đang khôi phục một phiên đã có (cờ `tubu_web_session` còn và chưa biết kết quả). Khách vãng lai không có cờ nên không bao giờ "đang
 * khôi phục" (không thấy khung chờ rồi mất). Đọc cờ bằng useSyncExternalStore; ảnh chụp phía server là `false`, trừ bản Trang chủ dựng sẵn
 * cho khách có cookie phiên (HomeRestoreHintContext) là `true`, để HTML đầu đã mang khung chờ và hydrate không lệch.
 */
export function useAuthRestoring(): boolean {
  const prebuilt = useContext(HomeRestoreHintContext) !== null;
  const marker = useSyncExternalStore(subscribeStorage, hasSessionMarker, () => prebuilt);
  const phase = useAuthPhase();
  return marker && phase === 'loading';
}
