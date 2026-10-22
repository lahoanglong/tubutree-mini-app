'use client';

import { useEffect, type RefObject } from 'react';

/** Cho thanh `fixed` tự vẽ (không dùng StickyActionBar) chừa chỗ đáy trang như StickyActionBar: gắn `has-sticky-bar` vào <body>
 * và ghi chiều cao thanh vào `--sticky-bar-h` để globals.css đệm đáy body, chân trang (hotline, chính sách) không bị che. */
export function useStickyBarOffset(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = document.documentElement;
    const bar = ref.current;
    document.body.classList.add('has-sticky-bar');
    const measure = () => {
      if (bar) root.style.setProperty('--sticky-bar-h', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' && bar ? new ResizeObserver(measure) : null;
    if (bar) observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--sticky-bar-h');
      document.body.classList.remove('has-sticky-bar');
    };
  }, [ref]);
}
