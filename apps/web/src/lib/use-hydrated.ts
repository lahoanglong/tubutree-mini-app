'use client';

import { useSyncExternalStore } from 'react';

const noop = () => () => {};

/**
 * false ở máy chủ và ở lượt hydrate đầu, true ngay sau đó. Khối bọc Suspense (trang dựng sẵn ISR) hydrate muộn, lúc phiên đăng nhập
 * đã khôi phục xong, nên nội dung theo phiên mà vẽ ngay sẽ lệch HTML máy chủ ("Hydration failed"); chờ cờ này rồi mới vẽ.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}
