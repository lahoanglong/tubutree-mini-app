'use client';

import { useCallback, useSyncExternalStore } from 'react';

function mediaList(query: string): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  } catch {
    return null;
  }
}

/**
 * Khớp một media query. Chỉ dùng khi MỘT thành phần phải nằm ở hai chỗ khác nhau theo khổ màn (không nhân đôi được vì mang trạng thái);
 * còn lại cứ dùng lớp `md:`/`max-md:`. Phía server, lượt hydrate đầu và nơi không có `matchMedia` (jsdom) là `false` để khớp HTML dựng sẵn.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaList(query);
      list?.addEventListener?.('change', onChange);
      return () => list?.removeEventListener?.('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => mediaList(query)?.matches ?? false, () => false);
}
