'use client';

import { useSyncExternalStore } from 'react';

function mediaList(query: string): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  } catch {
    return null;
  }
}

/**
 * Khớp một media query. Chỉ dùng khi MỘT thành phần phải nằm ở hai chỗ khác nhau theo khổ màn (không nhân đôi được vì mang trạng thái);
 * còn lại cứ dùng lớp `md:`/`max-md:`. Phía server và nơi không có `matchMedia` (jsdom) là `false`.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = mediaList(query);
      list?.addEventListener?.('change', onChange);
      return () => list?.removeEventListener?.('change', onChange);
    },
    () => mediaList(query)?.matches ?? false,
    () => false,
  );
}
