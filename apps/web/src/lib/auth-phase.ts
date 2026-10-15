'use client';

import { useAuth } from './auth-context';

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
