'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Phần tử bấm/gõ được bên trong `panel`, theo thứ tự Tab (bỏ phần bị ẩn bằng `hidden`/`inert`). */
export function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.closest('[hidden],[inert]'));
}

/** Có `role="alertdialog"` nằm sau khung trong DOM (portal gắn vào cuối body, tức đang phủ lên khung) hay không. */
function alertOpenAbove(panel: HTMLElement): boolean {
  return Array.from(document.querySelectorAll('[role="alertdialog"]')).some(
    (a) => !panel.contains(a) && (panel.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
}

// Nhiều hộp thoại có thể chồng nhau: chỉ hộp trên cùng nhận phím, và nền chỉ được mở cuộn lại khi hộp cuối đóng.
const stack: symbol[] = [];
let savedOverflow = '';

/**
 * Hành vi bàn phím/đọc màn hình chung cho hộp thoại `aria-modal` tự dựng (ngăn kéo, form trong lớp phủ): focus vào khung khi
 * mở, Tab/Shift+Tab quay vòng trong khung, Esc gọi `onClose`, khóa cuộn nền, trả focus về chỗ đã mở khi đóng. Gắn `ref` trả về
 * vào khung `role="dialog"` (khung cần `tabIndex={-1}`). Esc bị bỏ qua khi đang gõ tiếng Việt (IME), khi phím đã bị xử lý, và
 * khi một `role="alertdialog"` (ConfirmDialog) đang mở phía trên: hộp đó tự xử Esc/Tab, nếu không Esc sẽ đóng cả hai và mất lý
 * do khách vừa gõ.
 */
export function useModalA11y<T extends HTMLElement = HTMLDivElement>(onClose: () => void): RefObject<T> {
  const panelRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const token = Symbol('modal');
    const opener = document.activeElement as HTMLElement | null;
    if (stack.length === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    stack.push(token);
    panelRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel || e.defaultPrevented || e.isComposing || stack[stack.length - 1] !== token) return;
      if (alertOpenAbove(panel)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusableIn(panel);
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      const inside = !!active && panel.contains(active);
      if (e.shiftKey) {
        if (!inside || active === first || active === panel) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const at = stack.indexOf(token);
      if (at >= 0) stack.splice(at, 1);
      if (stack.length === 0) document.body.style.overflow = savedOverflow;
      opener?.focus?.();
    };
  }, []);

  return panelRef;
}
