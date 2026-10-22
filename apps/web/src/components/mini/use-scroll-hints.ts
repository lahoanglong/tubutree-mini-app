// Nguồn: apps/miniapp/src/components/ui/use-scroll-hints.ts
import { useCallback, useEffect, useRef, useState } from 'react';

/** Phần tử mà bàn phím tới được — nếu hàng cuộn có ít nhất một thì bản thân hàng không cần điểm dừng Tab. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Hint {
  start: boolean;
  end: boolean;
  needsFocus: boolean;
}

/**
 * Gợi ý cho vùng cuộn ngang (audit A4-029): còn nội dung bên trái/phải (để CSS `.tubu-scroll-fade`
 * mờ mép tương ứng) và hàng có tràn mà không có gì focus được bên trong (axe
 * scrollable-region-focusable → hàng phải tự `tabIndex=0`, nếu không người dùng bàn phím không cuộn được).
 * Đo lại sau mỗi lần render (nội dung đổi → độ rộng đổi), khi cuộn và khi khung đổi kích thước.
 */
export function useScrollHints<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [hint, setHint] = useState<Hint>({ start: false, end: false, needsFocus: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const overflowing = max > 1;
    const next: Hint = {
      start: overflowing && el.scrollLeft > 1,
      end: overflowing && el.scrollLeft < max - 1,
      needsFocus: overflowing && !el.querySelector(FOCUSABLE),
    };
    setHint((h) => (h.start === next.start && h.end === next.end && h.needsFocus === next.needsFocus ? h : next));
  }, []);

  useEffect(() => {
    measure();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return {
    ref,
    onScroll: measure,
    tabIndex: hint.needsFocus ? 0 : undefined,
    'data-fade-start': hint.start ? 'true' : undefined,
    'data-fade-end': hint.end ? 'true' : undefined,
  } as const;
}
