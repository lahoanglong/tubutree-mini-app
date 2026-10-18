'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  tone?: 'danger';
  disabled?: boolean;
}

const GAP = 4;

/**
 * Menu "⋯" cuối hàng bảng: gom thao tác phụ để hàng không kéo dài ba nút chữ. Menu dựng ra `body` với `position: fixed` vì
 * khung bảng (ScrollRegion) có overflow-x nên menu `absolute` bị cắt ở các hàng cuối. Vì menu nằm ngoài vị trí của nút trong
 * DOM, thứ tự Tab không tự đi vào menu: mở ra thì tiêu điểm vào mục đầu, mũi tên/Home/End di chuyển, Tab hoặc Escape đóng
 * (Escape trả tiêu điểm về nút). Cuộn hoặc đổi cỡ cửa sổ cũng đóng, vì vị trí cố định được tính một lần lúc mở.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const enabledItems = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
    [],
  );

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 0;
    const roomBelow = window.innerHeight - rect.bottom;
    const opensDown = roomBelow >= height + GAP || rect.top < height + GAP;
    setPos({
      top: opensDown ? rect.bottom + GAP : rect.top - height - GAP,
      right: document.documentElement.clientWidth - rect.right,
    });
  }, [open]);

  useEffect(() => {
    if (open && pos) enabledItems()[0]?.focus({ preventScroll: true });
  }, [open, pos, enabledItems]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'Escape') {
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    const list = enabledItems();
    if (list.length === 0) return;
    const current = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (current + 1) % list.length;
    else if (e.key === 'ArrowUp') next = current === -1 ? list.length - 1 : (current - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    if (next === null) return;
    e.preventDefault();
    list[next]!.focus({ preventScroll: true });
  };

  return (
    <div ref={rootRef} className="relative inline-block text-left" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control border border-stone-450 bg-stone-0 text-stone-700 hover:bg-stone-50 sm:min-h-9 sm:min-w-9"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={label}
            style={{ position: 'fixed', top: pos?.top ?? 0, right: pos?.right ?? 0, visibility: pos ? 'visible' : 'hidden' }}
            className="z-50 min-w-40 rounded-card border border-stone-200 bg-stone-0 py-1 shadow-raised"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  item.onSelect();
                }}
                className={`flex min-h-[44px] w-full items-center px-3 text-left text-sm hover:bg-stone-50 disabled:opacity-50 sm:min-h-9 ${
                  item.tone === 'danger' ? 'text-danger-fg' : 'text-stone-800'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
