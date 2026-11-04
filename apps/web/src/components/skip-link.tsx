'use client';

import type { MouseEvent } from 'react';

const TARGET_ID = 'main-content';

/**
 * Liên kết bỏ qua là điểm dừng Tab đầu tiên của trang (WCAG 2.4.1); chỉ hiện khi được lấy nét.
 * Vùng đích chỉ nhận tabindex=-1 lúc liên kết được kích hoạt rồi bỏ khi mất focus: để tabindex cố định thì bấm chuột vào chữ bất kỳ
 * trong trang sẽ focus khung bọc và Tab kế tiếp quay về đầu vùng nội dung thay vì đi tiếp từ chỗ khách đang đọc.
 */
export function SkipLink() {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(TARGET_ID);
    if (!target) return;
    e.preventDefault();
    target.setAttribute('tabindex', '-1');
    target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
    target.focus();
  };
  return (
    <a
      href={`#${TARGET_ID}`}
      onClick={onClick}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-control focus:bg-[var(--color-bg-surface)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[color:var(--color-text-primary)] focus:shadow-card"
    >
      Bỏ qua đến nội dung
    </a>
  );
}
