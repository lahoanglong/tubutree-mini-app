'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]';

/**
 * Giữ bàn phím trong hộp thoại (role="dialog" aria-modal): khi mở focus vào phần tử `[data-dialog-initial]` (mặc định nút Đóng, để Enter lỡ tay
 * không chạy thao tác), Tab/Shift+Tab xoay vòng trong hộp, Esc gọi `onEscape`, đóng hộp trả focus về chỗ cũ. `onEscape` đọc qua ref nên effect chỉ
 * chạy một lần lúc mở: không trả focus ra ngoài mỗi lần trạng thái hộp đổi.
 */
export function useDialogFocusTrap(boxRef: RefObject<HTMLElement | null>, onEscape: () => void): void {
  const escRef = useRef(onEscape);
  escRef.current = onEscape;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    boxRef.current?.querySelector<HTMLElement>('[data-dialog-initial]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        escRef.current();
      } else if (e.key === 'Tab' && boxRef.current) {
        const items = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
        e.preventDefault();
        items[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
    // Chỉ chạy lúc mở hộp: boxRef ổn định suốt đời hộp.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
