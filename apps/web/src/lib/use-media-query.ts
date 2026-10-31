'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Khớp một media query ở trình duyệt. Phía máy chủ và lần render hydrate đầu luôn là `false` (khổ điện thoại) để khớp HTML dựng sẵn,
 * sau đó React đọc lại giá trị thật nên không lệch hydrate.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
      const mq = window.matchMedia(query);
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    },
    [query],
  );
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, get, () => false);
}
