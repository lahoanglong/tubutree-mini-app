'use client';

import { useAuth } from './auth-context';

export type AuthPhase = 'loading' | 'guest' | 'authenticated';

/**
 * Trang cần đăng nhập dùng cái này thay vì tự đọc `status`: `status` là 'idle' cả TRƯỚC khi khôi phục phiên
 * lẫn SAU khi biết chắc là khách, nên chỉ `initialized` (xem AuthState) phân biệt được "đang kiểm tra" với
 * "chưa đăng nhập". Coi 'idle' là đang tải thì khách chờ vô hạn không có nút đăng nhập.
 */
export function useAuthPhase(): AuthPhase {
  const { status, initialized } = useAuth();
  if (status === 'authenticated') return 'authenticated';
  if (initialized === false || status === 'loading') return 'loading';
  return 'guest';
}
