'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Phía nào của một điểm gãy đang hiện. `both`: HTML server, lượt hydrate đầu và nơi không có `matchMedia` (jsdom). */
export type BreakpointSide = 'both' | 'below' | 'above';

function mediaList(query: string): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
  } catch {
    return null;
  }
}

/**
 * Phần chỉ hiện ở một phía điểm gãy (ẩn bằng lớp `md:`/`lg:`): HTML server và lượt hydrate dựng cả hai phía để khổ nào cũng đúng ngay khung hình đầu,
 * sau đó chỉ giữ phía của khổ đang xem. Bỏ một khối đang `display:none` không dịch chuyển gì mà bớt nút DOM (Trang chủ điện thoại có trần 1.200 nút);
 * đổi khổ qua điểm gãy thì phía kia dựng lại. Cùng cách `useShelfLayout` của kệ Bán chạy nhất.
 */
export function useBreakpointSide(query: string): BreakpointSide {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = mediaList(query);
      if (!list) return () => {};
      // Safari dưới 14 chỉ có addListener: không nghe được thì xoay máy qua điểm gãy vẫn kẹt phía cũ (phần cần hiện đã rời DOM).
      if (typeof list.addEventListener === 'function') {
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
      }
      list.addListener?.(onChange);
      return () => list.removeListener?.(onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    (): BreakpointSide => {
      const list = mediaList(query);
      return list ? (list.matches ? 'above' : 'below') : 'both';
    },
    (): BreakpointSide => 'both',
  );
}
