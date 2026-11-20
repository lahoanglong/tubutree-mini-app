'use client';

import dynamic from 'next/dynamic';

/**
 * Hai sheet chỉ mở sau khi khách bấm (Mua lại, Định kỳ) tải lười từ một chỗ: kệ Mua lại nằm trong JS tải lần đầu của Trang chủ, mà mỗi lời gọi
 * `next/dynamic` riêng thêm một chunk và một dòng id chunk vào webpack runtime của MỌI trang. Khi chưa tải xong, sheet chưa vẽ gì, giống sheet đang đóng.
 */
export const ReorderSheetLazy = dynamic(() => import('./reorder-sheet').then((m) => m.ReorderSheet), { ssr: false });

/**
 * Tải sẵn chunk sheet Mua lại lúc trình duyệt rảnh, để lần chạm đầu mở gần như ngay dù sheet chỉ gắn vào khi khách bấm. Lỗi tải bỏ qua ở đây:
 * lúc gắn, `dynamic` tự tải lại. Trả hàm huỷ cho `useEffect`.
 */
export function preloadReorderSheet(): () => void {
  const run = () => void import('./reorder-sheet').catch(() => undefined);
  const w = window as { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
  if (w.requestIdleCallback) {
    const id = w.requestIdleCallback(run);
    return () => w.cancelIdleCallback?.(id);
  }
  const timer = setTimeout(run, 2000);
  return () => clearTimeout(timer);
}
export const SubscribeSheetLazy = dynamic(() => import('@/app/san-pham/[slug]/subscribe-sheet').then((m) => m.SubscribeSheet), { ssr: false });
