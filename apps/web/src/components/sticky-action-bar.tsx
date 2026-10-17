'use client';

import { useEffect, type ReactNode } from 'react';

/**
 * Thanh hành động dính đáy cho điện thoại (giá/tổng + nút mua). Chỉ hiện dưới màn md; từ md trở lên các trang giữ nút
 * ở khung tóm tắt như cũ.
 *
 * Dùng `fixed` thay vì `sticky`: `sticky` bị giới hạn trong khung cha của nó, mà nút mua nằm sâu trong cột thông tin
 * nên thanh sẽ biến mất khi khách cuộn qua phần mô tả/đánh giá. Đổi lại thanh che mất đáy trang, nên lúc đang hiện nó
 * thêm lớp `has-sticky-bar` vào <body> để globals.css chừa chỗ dưới chân trang (không thì dòng liên hệ cuối cùng bị che).
 */
export function StickyActionBar({ children, label }: { children: ReactNode; label: string }) {
  useEffect(() => {
    document.body.classList.add('has-sticky-bar');
    return () => document.body.classList.remove('has-sticky-bar');
  }, []);

  return (
    <div
      role="region"
      aria-label={label}
      data-testid="sticky-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-stone-0 px-4 pt-3 shadow-raised md:hidden"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      {children}
    </div>
  );
}
