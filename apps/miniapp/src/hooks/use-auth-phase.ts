import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/auth';

export type AuthPhase = 'loading' | 'guest' | 'unavailable' | 'authenticated';

/**
 * Trang cần đăng nhập dùng cái này thay vì tự đọc `status` của store: `status` có 4 giá trị mà trang hay chỉ xử lý 2
 * ('authenticated' / 'loading'), nên 'error' rơi vào nhánh "khách" hoặc "rỗng" và khách có đơn, có giỏ thấy mình
 * "chưa có gì" chỉ vì lúc mở app mất sóng (R5-BUYER-1).
 *
 * 'unavailable' = chưa khôi phục được phiên vì mất mạng/API tạm lỗi: khách KHÔNG phải khách vãng lai, trang phải nói
 * mất kết nối và cho thử lại (components/ui/auth-gate.tsx), không bao giờ vẽ màn "trống".
 */
export function useAuthPhase(): AuthPhase {
  const status = useAuthStore((s) => s.status);
  if (status === 'authenticated') return 'authenticated';
  if (status === 'loading') return 'loading';
  if (status === 'error') return 'unavailable';
  return 'guest';
}

/** Nhịp tự thử lại phiên khi webview không báo `online` (Zalo hay làm rơi sự kiện này): tăng dần để API đang sập không bị dồn request. */
export const SESSION_RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000, 60_000] as const;

/**
 * Gắn một lần ở gốc app. Phiên đang ở 'error' thì khôi phục lại khi có mạng (`online`), khi quay lại app
 * (`visibilitychange`), và theo nhịp tăng dần lúc app đang mở; dừng ngay khi vào lại được. Giống web (auth-context.tsx).
 */
export function useSessionRecovery(): void {
  const status = useAuthStore((s) => s.status);
  const attempts = useRef(0);

  useEffect(() => {
    if (status === 'authenticated' || status === 'idle') attempts.current = 0;
    if (status !== 'error') return;

    const retry = () => {
      if (document.visibilityState !== 'visible') return;
      const { status: current, restore } = useAuthStore.getState();
      if (current === 'error') void restore();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delay = SESSION_RETRY_DELAYS_MS[Math.min(attempts.current, SESSION_RETRY_DELAYS_MS.length - 1)]!;
      timer = setTimeout(() => {
        attempts.current += 1;
        retry();
        schedule();
      }, delay);
    };
    schedule();
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [status]);
}
