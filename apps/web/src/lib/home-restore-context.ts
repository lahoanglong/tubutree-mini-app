'use client';

import { createContext } from 'react';
import type { HomeRestoreHint } from './home-restore-hint';

/**
 * Có giá trị khi trang là bản "đang khôi phục phiên" (HTML dựng sẵn cho khách đã có cookie phiên). Server và lần hydrate đầu coi là đang
 * khôi phục với đúng gợi ý này, để HTML khớp lần render đầu của trình duyệt.
 */
export const HomeRestoreHintContext = createContext<HomeRestoreHint | null>(null);

/** Server thấy cookie `tubu_web_session` (layout khu tài khoản/kho quà đọc cookies()): ảnh chụp phía server của useAuthRestoring là true. */
export const SessionCookieContext = createContext(false);

/** Đăng ký sự kiện `storage` (tab khác ghi localStorage) cho useSyncExternalStore. */
export const subscribeStorageEvent = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};
