'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export type SheetSize = 'auto' | 'half' | 'full';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  footer?: ReactNode;
  size?: SheetSize;
  dismissible?: boolean;
  children: ReactNode;
}

const SIZE_CLASS: Record<SheetSize, string> = {
  auto: 'max-h-[92vh]',
  half: 'h-[50vh]',
  full: 'h-[92vh]',
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Sheet chuẩn của web: trượt từ đáy trên điện thoại, hộp thoại giữa màn hình từ md trở lên. Cùng API với `BottomSheet`
 * của Mini App (`open`/`onClose`/`title`/`description`/`footer`/`size`/`dismissible`). `dismissible=false` chặn cả nút X,
 * Esc và bấm nền. Không dựng khi đóng nên không có hoạt ảnh đóng; đổi lại không có nội dung ẩn trong cây truy cập.
 */
export function Sheet({ open, onClose, title, description, footer, size = 'auto', dismissible = true, children }: SheetProps) {
  const uid = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const panel = panelRef.current;
    const items = () => Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    // Nút Đóng (nếu có) là phần tử đầu tiên nên nhận focus; sheet không dismissible thì focus khung.
    (items()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const list = items();
      if (list.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0]!;
      const last = list[list.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [open, dismissible]);

  if (!open || typeof document === 'undefined') return null;
  const titleId = `${uid}-title`;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div data-sheet-backdrop className="absolute inset-0 bg-stone-900/50" onClick={dismissible ? onClose : undefined} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`relative flex w-full flex-col overflow-hidden rounded-t-sheet bg-stone-0 shadow-card outline-none md:max-w-lg md:rounded-sheet ${SIZE_CLASS[size]}`}
      >
        <div className="flex items-start justify-between gap-2 px-4 pt-4">
          <div className="min-w-0">
            {title && (
              <h2 id={titleId} className="font-display text-lg font-semibold text-stone-900">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 text-sm text-stone-600">{description}</p>}
          </div>
          {dismissible && (
            <button
              type="button"
              aria-label="Đóng"
              onClick={onClose}
              className="-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-stone-700 hover:bg-stone-50"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </div>
        <div data-sheet-body className="flex-1 overflow-y-auto px-4 pb-4 pt-2">
          {children}
        </div>
        {footer && <div className="border-t border-stone-200 p-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
