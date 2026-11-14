import { useAuthStore } from '../store/auth';
import { isGuestUser } from '../utils/guest-user';

/**
 * Đã đăng nhập VÀ là khách thật (có SĐT hoặc zaloId Zalo thật), cùng luật `isRealUser` của máy chủ. Tài khoản khách theo thiết bị (`guest_…`) có phiên
 * 'authenticated' nhưng máy chủ không phát thưởng cho họ (NOT_REAL_USER): nơi nào gửi API thưởng phải hỏi hook này chứ không hỏi `useAuthPhase`.
 */
export function useRealUser(): boolean {
  return useAuthStore((s) => s.status === 'authenticated' && s.user !== null && s.user !== undefined && !isGuestUser(s.user));
}
