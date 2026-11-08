'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { safeAreaPadX } from '@/lib/safe-area';

type WebBar = { el: HTMLElement; hideFrom: 'md' | 'lg' };

// `--sticky-bar-h` và lớp `has-sticky-bar*` nằm ở <html>/<body> nên dùng chung cho cả cây. Chuyển trang (hoặc mở lớp phủ) có lúc hai thanh cùng gắn:
// thanh của trang mới gắn trước, thanh cũ tháo sau. Tháo mà xoá biến và lớp vô điều kiện thì trang mới mất đệm đáy, thanh dính che dòng cuối.
// Giữ danh sách thanh đang gắn theo thứ tự gắn; chỉ thanh gắn sau cùng được ghi biến, hết thanh mới xoá biến và lớp.
const mountedWebBars: WebBar[] = [];

function syncWebStickyBarState(): void {
  const root = document.documentElement;
  const body = document.body;
  const top = mountedWebBars[mountedWebBars.length - 1];
  if (!top) {
    root.style.removeProperty('--sticky-bar-h');
    body.classList.remove('has-sticky-bar', 'has-sticky-bar-lg');
    return;
  }
  root.style.setProperty('--sticky-bar-h', `${Math.ceil(top.el.getBoundingClientRect().height)}px`);
  body.classList.add('has-sticky-bar');
  if (mountedWebBars.some((bar) => bar.hideFrom === 'lg')) body.classList.add('has-sticky-bar-lg');
  else body.classList.remove('has-sticky-bar-lg');
}

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
    const bar = ref.current;
    if (!bar) return;
    const entry: WebBar = { el: bar, hideFrom };
    mountedWebBars.push(entry);
    syncWebStickyBarState();
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => {
        if (mountedWebBars[mountedWebBars.length - 1] === entry) syncWebStickyBarState();
      })
      : null;
    // border-box: vùng an toàn đáy nằm trong đệm, đổi (xoay máy) thì chỉ hộp ngoài đổi cỡ, hộp nội dung (mặc định của ResizeObserver) đứng yên.
    observer?.observe(bar, { box: 'border-box' });
    return () => {
      observer?.disconnect();
      mountedWebBars.splice(mountedWebBars.indexOf(entry), 1);
      syncWebStickyBarState();
    };
  }, [hideFrom]);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      data-testid="sticky-bar"
      data-sticky-bar
      className={`fixed inset-x-0 bottom-0 z-30 bg-[var(--color-bg-surface)] pt-3 tabular-nums [box-shadow:var(--elevation-3)] ${hideFrom === 'lg' ? 'lg:hidden' : 'md:hidden'}`}
      style={{ ...safeAreaPadX('1rem'), paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      {children}
    </div>
  );
}
