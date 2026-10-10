'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmOptions {
  title: string;
  /** Nội dung giải thích hậu quả; `\n` được giữ nguyên xuống dòng. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = thao tác không hoàn tác được (huỷ đơn, từ chối rút tiền...): nút xác nhận màu đỏ. */
  tone?: 'default' | 'danger';
}

/**
 * Thay `window.confirm` của trình duyệt (không đồng bộ giao diện, không đổi được câu chữ/nút, bị chặn khi tab nền).
 * `confirm()` trả Promise<boolean>; component gắn `dialog` vào JSX. Hỏi lần hai khi lần một còn mở thì lần một coi
 * như huỷ, gỡ component khi đang hỏi cũng coi như huỷ — nên không có thao tác nào chạy ngoài ý muốn.
 */
export function useConfirm() {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const settle = useCallback((ok: boolean) => {
    const r = resolver.current;
    resolver.current = null;
    setPending(null);
    r?.(ok);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions | string) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setPending(typeof options === 'string' ? { title: 'Xác nhận', message: options } : options);
      }),
    [],
  );

  useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );

  const dialog: ReactNode = pending ? <ConfirmDialog options={pending} onAnswer={settle} /> : null;
  return { confirm, dialog };
}

export function ConfirmDialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (ok: boolean) => void }) {
  const titleId = useId();
  const bodyId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const danger = options.tone === 'danger';

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Mặc định focus "Huỷ": Enter/Space lỡ tay không thực hiện thao tác nặng.
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onAnswer(false);
      } else if (e.key === 'Tab') {
        const order = [cancelRef.current, acceptRef.current].filter((b): b is HTMLButtonElement => !!b);
        const at = order.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.shiftKey ? (at <= 0 ? order.length - 1 : at - 1) : at === order.length - 1 ? 0 : at + 1;
        e.preventDefault();
        order[next]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onAnswer]);

  return createPortal(
    <div
      data-confirm-backdrop
      onClick={() => onAnswer(false)}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-base font-semibold text-neutral-900">
          {options.title}
        </h2>
        <p id={bodyId} className="mt-2 whitespace-pre-line text-sm leading-relaxed text-neutral-600">
          {options.message}
        </p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            data-confirm="cancel"
            onClick={() => onAnswer(false)}
            className="min-h-[44px] rounded-lg border border-neutral-300 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            {options.cancelLabel ?? 'Huỷ'}
          </button>
          <button
            ref={acceptRef}
            type="button"
            data-confirm="accept"
            onClick={() => onAnswer(true)}
            className={`min-h-[44px] rounded-lg px-4 text-sm font-medium text-white ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            {options.confirmLabel ?? 'Xác nhận'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
