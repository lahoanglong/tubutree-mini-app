'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  tone?: 'danger';
  disabled?: boolean;
}

/**
 * Menu "⋯" cuối hàng bảng: gom thao tác phụ để hàng không kéo dài ba nút chữ. Không phải menu ứng dụng đầy đủ: đóng khi chọn,
 * bấm ra ngoài hoặc Escape (trả tiêu điểm về nút); các mục là nút bình thường nên Tab đi qua được.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative inline-block text-left"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
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
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-20 mt-1 min-w-40 rounded-card border border-stone-200 bg-stone-0 py-1 shadow-raised"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex min-h-[44px] w-full items-center px-3 text-left text-sm hover:bg-stone-50 disabled:opacity-50 sm:min-h-9 ${
                item.tone === 'danger' ? 'text-danger-fg' : 'text-stone-800'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
