'use client';

import { createContext, useContext } from 'react';
import type { GuestCheckoutConfig } from '@/lib/guest-checkout/flag';

const ServerGuestConfigContext = createContext<GuestCheckoutConfig | undefined>(undefined);

/**
 * Hai trường cấu hình mà `/thanh-toan` cần để chọn giữa form đặt không đăng nhập và lời mời đăng nhập, đọc sẵn ở máy chủ (layout).
 * Khách chưa đăng nhập thấy ngay đúng màn thay vì khung chờ tới khi `/config/public` của trình duyệt về; bản của trình duyệt về thì theo bản đó.
 */
export function ServerGuestConfigProvider({ value, children }: { value: GuestCheckoutConfig | undefined; children: React.ReactNode }) {
  return <ServerGuestConfigContext.Provider value={value}>{children}</ServerGuestConfigContext.Provider>;
}

/** undefined: máy chủ không đọc được cấu hình (hoặc trang dựng ngoài layout), trang chờ bản của trình duyệt như trước. */
export function useServerGuestConfig(): GuestCheckoutConfig | undefined {
  return useContext(ServerGuestConfigContext);
}
