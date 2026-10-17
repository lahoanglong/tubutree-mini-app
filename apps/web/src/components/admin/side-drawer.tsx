'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { safeAreaPad } from '@/lib/safe-area';
import { useModalA11y } from '@/lib/use-modal-a11y';

/**
 * Ngăn kéo phủ màn hình cho web admin: chi tiết đơn/người dùng trên điện thoại (thay vì mở rộng hàng trong bảng cuộn
 * ngang) và menu mục quản trị. Esc / bấm nền / nút Đóng đều đóng; focus vào ngăn khi mở, Tab quay vòng trong ngăn và trả lại
 * chỗ cũ khi đóng (xem `useModalA11y`).
 */
export function SideDrawer({
  title,
  onClose,
  side = 'right',
  children,
}: {
  title: string;
  onClose: () => void;
  side?: 'left' | 'right';
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useModalA11y<HTMLDivElement>(onClose);

  return createPortal(
    <div data-drawer-backdrop onClick={onClose} className="fixed inset-0 z-[90] flex bg-stone-900/40">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`flex h-full w-full max-w-xl flex-col bg-stone-50 shadow-raised outline-none ${side === 'right' ? 'ml-auto' : 'mr-auto max-w-xs'}`}
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
          ...safeAreaPad(side, '0px'),
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-stone-200 bg-stone-0 px-4 py-2">
          <h2 id={titleId} className="min-w-0 truncate font-display text-base font-semibold text-stone-900">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-stone-600 hover:bg-stone-100"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** true khi màn hẹp hơn `px` (mặc định dưới md = điện thoại). Không có matchMedia (SSR/jsdom) → false. */
export function useNarrowScreen(px = 768): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(`(max-width: ${px - 0.02}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    return () => mq.removeEventListener?.('change', update);
  }, [px]);
  return narrow;
}
