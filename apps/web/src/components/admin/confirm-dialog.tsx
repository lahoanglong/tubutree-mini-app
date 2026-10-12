'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { INPUT_CLASS } from './ui';

export interface ConfirmOptions {
  title: string;
  /** Nội dung giải thích hậu quả; `\n` được giữ nguyên xuống dòng. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = thao tác không hoàn tác được (huỷ đơn, từ chối rút tiền...): nút xác nhận màu đỏ. */
  tone?: 'default' | 'danger';
  /** Có thì hộp thoại kèm ô nhập lý do (dùng qua `ask`, thay cho window.prompt). */
  input?: { label: string; placeholder?: string; maxLength?: number; required?: boolean };
}

const DEFAULT_INPUT_MAX = 500;

type Answer = { ok: boolean; text: string };

/**
 * Thay `window.confirm`/`window.prompt` của trình duyệt (không đồng bộ giao diện, không đổi được câu chữ/nút, bị
 * chặn khi tab nền). `confirm()` trả Promise<boolean>; `ask()` là hộp thoại có ô nhập lý do, trả chuỗi đã cắt
 * khoảng trắng ('' khi để trống) hoặc null khi huỷ. Component gắn `dialog` vào JSX. Hỏi lần hai khi lần một còn mở
 * thì lần một coi như huỷ, gỡ component khi đang hỏi cũng coi như huỷ — nên không có thao tác nào chạy ngoài ý muốn.
 */
export function useConfirm() {
  const [pending, setPending] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((a: Answer) => void) | null>(null);

  const settle = useCallback((ok: boolean, text = '') => {
    const r = resolver.current;
    resolver.current = null;
    setPending(null);
    r?.({ ok, text: text.trim() });
  }, []);

  const open = useCallback((options: ConfirmOptions | string, onAnswer: (a: Answer) => void) => {
    resolver.current?.({ ok: false, text: '' });
    resolver.current = onAnswer;
    setPending(typeof options === 'string' ? { title: 'Xác nhận', message: options } : options);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions | string) => new Promise<boolean>((resolve) => open(options, (a) => resolve(a.ok))),
    [open],
  );

  const ask = useCallback(
    (options: ConfirmOptions) => new Promise<string | null>((resolve) => open(options, (a) => resolve(a.ok ? a.text : null))),
    [open],
  );

  useEffect(
    () => () => {
      resolver.current?.({ ok: false, text: '' });
      resolver.current = null;
    },
    [],
  );

  const dialog: ReactNode = pending ? <ConfirmDialog options={pending} onAnswer={settle} /> : null;
  return { confirm, ask, dialog };
}

export function ConfirmDialog({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (ok: boolean, text?: string) => void }) {
  const titleId = useId();
  const bodyId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState('');
  const danger = options.tone === 'danger';
  const input = options.input;
  const blocked = !!input?.required && text.trim().length === 0;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // Mặc định focus "Huỷ": Enter/Space lỡ tay không thực hiện thao tác nặng. Hộp thoại nhập lý do thì focus ô nhập.
    (inputRef.current ?? cancelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onAnswer(false);
      } else if (e.key === 'Tab') {
        const order = [inputRef.current, cancelRef.current, acceptRef.current].filter(
          (b): b is HTMLTextAreaElement | HTMLButtonElement => !!b && !(b as HTMLButtonElement).disabled,
        );
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
      className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-900/40 p-4 sm:items-center"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-sheet bg-stone-0 p-5 shadow-raised"
      >
        <h2 id={titleId} className="font-display text-base font-semibold text-stone-900">
          {options.title}
        </h2>
        <p id={bodyId} className="mt-2 whitespace-pre-line text-sm leading-relaxed text-stone-600">
          {options.message}
        </p>
        {input && (
          <div className="mt-3">
            <label htmlFor={inputId} className="mb-1 block text-xs font-medium text-stone-700">
              {input.label}
              {input.required ? ' *' : ''}
            </label>
            <textarea
              id={inputId}
              ref={inputRef}
              rows={3}
              maxLength={input.maxLength ?? DEFAULT_INPUT_MAX}
              placeholder={input.placeholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={`${INPUT_CLASS} w-full`}
            />
          </div>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            data-confirm="cancel"
            onClick={() => onAnswer(false)}
            className="min-h-[44px] rounded-control border border-stone-450 bg-stone-0 px-4 text-sm font-medium text-stone-800 hover:bg-stone-50"
          >
            {options.cancelLabel ?? 'Huỷ'}
          </button>
          <button
            ref={acceptRef}
            type="button"
            data-confirm="accept"
            disabled={blocked}
            onClick={() => onAnswer(true, text)}
            className={`min-h-[44px] rounded-control px-4 text-sm font-medium text-stone-0 disabled:cursor-not-allowed disabled:opacity-50 ${
              danger ? 'bg-danger-fg hover:brightness-90' : 'bg-forest-600 hover:bg-forest-700'
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
