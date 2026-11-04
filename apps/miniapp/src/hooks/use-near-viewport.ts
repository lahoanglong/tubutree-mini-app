import { useCallback, useEffect, useState } from 'react';

/**
 * Báo `near` (một chiều: đã true thì giữ true) khi phần tử gắn `ref` sắp vào khung nhìn, để khối nằm dưới màn đầu chỉ bắt đầu tải dữ liệu lúc đó.
 * Không có IntersectionObserver (webview cũ, test) thì coi như đã gần: khối vẫn tải, chỉ mất lợi ích hoãn.
 */
export function useNearViewport(rootMargin = '200px 0px'): { ref: (el: Element | null) => void; near: boolean } {
  const [node, setNode] = useState<Element | null>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  const ref = useCallback((el: Element | null) => setNode(el), []);
  useEffect(() => {
    if (near || !node) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [near, node, rootMargin]);
  return { ref, near };
}
