'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { safeAreaPadX } from '@/lib/safe-area';

/**
 * Thanh hành động dính đáy cho điện thoại (giá/tổng + nút mua). Mặc định chỉ hiện dưới màn md; từ md trở lên các trang giữ nút
 * ở khung tóm tắt như cũ. Giỏ hàng và Thanh toán truyền `hideFrom="lg"`: ở khổ máy tính bảng (md) khung tóm tắt nằm cuối trang một cột,
 * nút Đặt hàng phải còn trong tầm nhìn nên thanh dính giữ tới hết md, cột tóm tắt dính bên phải chỉ có từ lg.
 *
 * Dùng `fixed` thay vì `sticky`: `sticky` bị giới hạn trong khung cha của nó, mà nút mua nằm sâu trong cột thông tin
 * nên thanh sẽ biến mất khi khách cuộn qua phần mô tả/đánh giá. Đổi lại thanh che mất đáy trang, nên lúc đang hiện nó
 * thêm lớp `has-sticky-bar` vào <body> để globals.css chừa chỗ dưới chân trang (không thì dòng liên hệ cuối cùng bị che).
 * Chiều cao thanh đổi theo nội dung (dòng báo vì sao nút khoá làm nó cao thêm), nên đo bằng ResizeObserver rồi đặt vào
 * biến `--sticky-bar-h` thay vì chừa một con số cố định.
 */
export function StickyActionBar({ children, label, hideFrom = 'md' }: { children: ReactNode; label: string; hideFrom?: 'md' | 'lg' }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const bar = ref.current;
    document.body.classList.add('has-sticky-bar');
    if (hideFrom === 'lg') document.body.classList.add('has-sticky-bar-lg');
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
      document.body.classList.remove('has-sticky-bar-lg');
    };
  }, [hideFrom]);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      data-testid="sticky-bar"
      data-sticky-bar
      className={`fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-stone-0 pt-3 shadow-raised ${hideFrom === 'lg' ? 'lg:hidden' : 'md:hidden'}`}
      style={{ ...safeAreaPadX('1rem'), paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      {children}
    </div>
  );
}
