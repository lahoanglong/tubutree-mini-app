'use client';

import { createContext } from 'react';
import type { HomeRestoreHint } from './home-restore-hint';

/**
 * Có giá trị khi trang là bản "đang khôi phục phiên" (HTML dựng sẵn cho khách đã có cookie phiên). Server và lần hydrate đầu coi là đang
 * khôi phục với đúng gợi ý này, để HTML khớp lần render đầu của trình duyệt.
 */
export const HomeRestoreHintContext = createContext<HomeRestoreHint | null>(null);

/** Đăng ký sự kiện `storage` (tab khác ghi localStorage) cho useSyncExternalStore. */
export const subscribeStorageEvent = (cb: () => void) => {
  window.addEventListener('storage', cb);
  return () => window.removeEventListener('storage', cb);
};
