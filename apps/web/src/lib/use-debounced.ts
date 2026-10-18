'use client';

import { useEffect, useState } from 'react';

/** Debounce giá trị — ô tìm kiếm và bộ đếm bộ lọc không gọi API mỗi phím gõ. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
