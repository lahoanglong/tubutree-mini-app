'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { safeAreaPad } from '@/lib/safe-area';
import { useModalA11y } from '@/lib/use-modal-a11y';
import { ADMIN_TABULAR } from './tabular-nums';
import { useDiscardGuard } from './use-discard-guard';

const SideDrawerContext = createContext<{ requestClose: () => void } | null>(null);

/**
 * Đóng ngăn kéo qua đúng đường của Esc/bấm nền/nút X (có hỏi "Bỏ thay đổi chưa lưu?" khi `dirty`), cho nút "Đóng"
 * nằm trong nội dung hoặc chân ngăn: gọi thẳng `onClose` của trang sẽ bỏ qua hộp hỏi.
 */
export function useSideDrawerClose(): () => void {
  const ctx = useContext(SideDrawerContext);
  if (!ctx) throw new Error('useSideDrawerClose phải dùng bên trong SideDrawer');
  return ctx.requestClose;
}

/**
 * Ngăn kéo phủ màn hình cho web admin: chi tiết đơn/người dùng trên điện thoại (thay vì mở rộng hàng trong bảng cuộn
 * ngang) và menu mục quản trị. Esc / bấm nền / nút Đóng đều đóng; focus vào ngăn khi mở, Tab quay vòng trong ngăn và trả lại
 * chỗ cũ khi đóng (xem `useModalA11y`).
 *
 * `footer`: vùng dính đáy ngoài khung cuộn (nút Lưu/Đóng của form dài luôn thấy được).
 * `dirty`: có chỉnh sửa chưa lưu thì mọi đường đóng đều hỏi xác nhận trước, và đóng/tải lại cả tab cũng bị trình duyệt hỏi.
 */
export function SideDrawer({
  title,
  onClose,
  side = 'right',
  footer,
  dirty = false,
  children,
}: {
  title: string;
  onClose: () => void;
  side?: 'left' | 'right';
  footer?: ReactNode;
  dirty?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const { guard, dialog } = useDiscardGuard(dirty);
  const requestClose = useCallback(() => guard(onClose), [guard, onClose]);
  const panelRef = useModalA11y<HTMLDivElement>(requestClose);
  const ctx = useMemo(() => ({ requestClose }), [requestClose]);
  // Bôi đen chữ trong ngăn rồi thả chuột ra nền thì click rơi vào nền (tổ tiên chung): chỉ đóng khi cả bấm xuống lẫn thả ra đều ở nền.
  const pressedOnBackdrop = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <>
      {createPortal(
        <div
          data-drawer-backdrop
          onMouseDown={(e) => {
            pressedOnBackdrop.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            // detail 0: click không do chuột sinh ra (bàn phím, công cụ hỗ trợ), không có bấm xuống để đối chiếu.
            const fromBackdrop = pressedOnBackdrop.current || e.detail === 0;
            pressedOnBackdrop.current = false;
            if (fromBackdrop) requestClose();
          }}
          className="fixed inset-0 z-[90] flex bg-stone-900/40"
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            // `max-w-*` tách theo phía: để cả hai trong một chuỗi thì Tailwind phát `max-w-xl` sau `max-w-xs` và ngăn trái rộng 576px thay vì 320px.
            className={`flex h-full w-full flex-col bg-stone-50 shadow-raised outline-none ${ADMIN_TABULAR} ${side === 'right' ? 'ml-auto max-w-xl' : 'mr-auto max-w-xs'}`}
            style={{
              paddingTop: 'env(safe-area-inset-top, 0px)',
              // Có chân dính thì chân tự chừa inset đáy; chừa ở cả khung lẫn chân sẽ hở đôi.
              paddingBottom: footer ? '0px' : 'env(safe-area-inset-bottom, 0px)',
              ...safeAreaPad(side, '0px'),
            }}
          >
            <div className="flex items-center justify-between gap-2 border-b border-stone-200 bg-stone-0 px-4 py-2">
              <h2 id={titleId} className="min-w-0 truncate font-display text-base font-semibold text-stone-900">
                {title}
              </h2>
              <button
                type="button"
                onClick={requestClose}
                aria-label="Đóng"
                className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-stone-600 hover:bg-stone-100"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>
            <SideDrawerContext.Provider value={ctx}>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
              {footer && (
                <div data-drawer-footer className="shrink-0 border-t border-stone-200 bg-stone-0 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
                  {footer}
                </div>
              )}
            </SideDrawerContext.Provider>
          </div>
        </div>,
        document.body,
      )}
      {dialog}
    </>
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
