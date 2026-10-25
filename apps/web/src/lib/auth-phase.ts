'use client';

import { useSyncExternalStore } from 'react';
import { useAuth } from './auth-context';
import { hasSessionMarker } from './client-api';

export type AuthPhase = 'loading' | 'guest' | 'unavailable' | 'authenticated';

/**
 * Trang cần đăng nhập dùng cái này thay vì tự đọc `status`: `status` là 'idle' cả TRƯỚC khi khôi phục phiên
 * lẫn SAU khi biết chắc là khách, nên chỉ `initialized` (xem AuthState) phân biệt được "đang kiểm tra" với
 * "chưa đăng nhập". Coi 'idle' là đang tải thì khách chờ vô hạn không có nút đăng nhập.
 *
 * 'unavailable' = cờ phiên còn nhưng mất mạng/API tạm lỗi lúc khôi phục: khách KHÔNG phải khách vãng lai, đừng
 * mời đăng nhập lại (vòng OAuth thừa) mà nói mất kết nối và cho thử lại.
 */
export function useAuthPhase(): AuthPhase {
  const { status, initialized, sessionUnavailable } = useAuth();
  if (status === 'authenticated') return 'authenticated';
  if (initialized === false || status === 'loading') return 'loading';
  return sessionUnavailable ? 'unavailable' : 'guest';
}

const subscribeStorage = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};

/**
 * Đang khôi phục một phiên đã có (cờ `tubu_web_session` còn và chưa biết kết quả). Khách vãng lai không có cờ nên không bao giờ "đang
 * khôi phục" (không thấy khung chờ rồi mất). Đọc cờ bằng useSyncExternalStore với ảnh chụp phía server là `false` để hydrate không lệch.
 */
export function useAuthRestoring(): boolean {
  const marker = useSyncExternalStore(subscribeStorage, hasSessionMarker, () => false);
  const phase = useAuthPhase();
  return marker && phase === 'loading';
}
