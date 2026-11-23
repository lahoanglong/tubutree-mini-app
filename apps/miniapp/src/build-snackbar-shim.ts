import { createContext, createElement as h, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, XCircle } from 'lucide-react';
import { announce, announceKind } from './lib/announce';

/**
 * Bản build Mini thay `zmp-ui/esm/components/snackbar-provider` (SnackbarProvider + useSnackbar, kéo theo `zmp-ui` Icon với bảng ~5,5 KB
 * nét `zi_*` và Progress) bằng hộp thông báo này (`build-vendor-shims.ts`). Cùng API mà app dùng: `openSnackbar({ text, type, duration,
 * position, action, onClose })`, `closeSnackbar()`, `setDownloadProgress()` (không dùng, giữ cho đủ hình); `icon`, `prefixIcon`,
 * `verticalAction`, kiểu `loading`/`download`/`countdown` app không dùng nên không vẽ. Hành vi giữ như zmp-ui 1.11.14: mặc định 2 giây ở
 * đáy, `type` success/error/warning/info có icon đầu câu (icon lucide đặc thay bảng nét `zi_*`) và khi đó, hoặc khi có nút hành động, hộp
 * rộng hết khổ, chữ trái; chỉ có chữ thì hộp co theo chữ, chữ giữa. Mở câu mới khi câu cũ còn hiện thì ẩn câu cũ rồi 250ms sau mới hiện câu
 * mới, `onClose` gọi lúc bắt đầu ẩn, nút hành động gọi `onClick` rồi đóng nếu `close`, và `useSnackbar()` trả hàm mới mỗi lần gọi như bản
 * gốc (effect của app có hàm này trong deps chạy y như cũ).
 * Thêm so với bản gốc: mỗi câu được ghi vào vùng đọc `aria-live` (`lib/announce.ts`), nên mọi lệnh `openSnackbar` trực tiếp cũng tới được
 * VoiceOver/TalkBack; `useNotify` báo cùng câu trong cùng nhịp nên chỉ đọc một lần. Hộp không mang `role="status"` để khỏi đọc hai lần.
 * Chỉ áp cho build (dev và Vitest vẫn chạy zmp-ui thật hoặc `vi.mock('zmp-ui')`); `build-snackbar-shim.spec.tsx` dựng thẳng tệp này.
 */
export interface SnackbarAction {
  text?: string;
  close?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}
export interface SnackbarOptions {
  text?: string;
  type?: string;
  duration?: number;
  position?: 'top' | 'bottom';
  action?: SnackbarAction;
  onClose?: () => void;
}
interface SnackbarApi {
  openSnackbar: (options: SnackbarOptions) => void;
  closeSnackbar: () => void;
}
interface Toast {
  key: number;
  opts: SnackbarOptions;
  leaving: boolean;
}

export const SNACKBAR_DEFAULT_DURATION = 2000;
export const SNACKBAR_SWAP_GAP_MS = 250;
export const SNACKBAR_EXIT_MS = 150;

const TYPE_ICON: Partial<Record<string, typeof Info>> = { success: CheckCircle2, error: XCircle, warning: TriangleAlert, info: Info };

const SnackbarContext = createContext<SnackbarApi | null>(null);
let seq = 0;

export default function SnackbarProvider({ children }: { children?: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const current = useRef<Toast | null>(null);
  const timers = useRef<{ hide?: ReturnType<typeof setTimeout>; swap?: ReturnType<typeof setTimeout>; unmount?: ReturnType<typeof setTimeout> }>({});

  const commit = (next: Toast | null) => {
    current.current = next;
    setToast(next);
  };

  const closeSnackbar = useCallback(() => {
    const t = timers.current;
    const cur = current.current;
    clearTimeout(t.hide);
    if (!cur || cur.leaving) return;
    commit({ ...cur, leaving: true });
    cur.opts.onClose?.();
    t.unmount = setTimeout(() => {
      if (current.current?.key === cur.key) commit(null);
    }, SNACKBAR_EXIT_MS);
  }, []);

  const openSnackbar = useCallback(
    (opts: SnackbarOptions) => {
      const t = timers.current;
      if (opts.text) announce(announceKind(opts.type), opts.text);
      const show = () => {
        clearTimeout(t.unmount);
        commit({ key: ++seq, opts, leaving: false });
        t.hide = setTimeout(closeSnackbar, opts.duration || SNACKBAR_DEFAULT_DURATION);
      };
      clearTimeout(t.swap);
      if (current.current && !current.current.leaving) {
        closeSnackbar();
        t.swap = setTimeout(show, SNACKBAR_SWAP_GAP_MS);
      } else show();
    },
    [closeSnackbar],
  );

  useEffect(() => {
    const t = timers.current;
    return () => {
      clearTimeout(t.hide);
      clearTimeout(t.swap);
      clearTimeout(t.unmount);
    };
  }, []);

  const api = useMemo(() => ({ openSnackbar, closeSnackbar }), [openSnackbar, closeSnackbar]);
  const action = toast?.opts.action;
  const icon = toast?.opts.type ? TYPE_ICON[toast.opts.type] : undefined;
  return h(
    SnackbarContext.Provider,
    { value: api },
    children,
    toast &&
      h(
        'div',
        {
          key: toast.key,
          className: 'tubu-toast',
          'data-position': toast.opts.position === 'top' ? 'top' : 'bottom',
          'data-leaving': toast.leaving || undefined,
          'data-wide': icon || action?.text ? '' : undefined,
          'data-testid': 'tubu-toast',
        },
        icon && h(icon, { size: 24, 'aria-hidden': true, className: `tubu-toast__icon tubu-toast__icon--${toast.opts.type}` }),
        h('span', { className: 'tubu-toast__text' }, toast.opts.text),
        action?.text &&
          h(
            'button',
            {
              type: 'button',
              className: 'tubu-toast__action touch-target',
              onClick: (e: MouseEvent<HTMLElement>) => {
                action.onClick?.(e);
                if (action.close) closeSnackbar();
              },
            },
            action.text,
          ),
      ),
  );
}

export function useSnackbar() {
  const ctx = useContext(SnackbarContext);
  return {
    openSnackbar: (options: SnackbarOptions) => ctx?.openSnackbar(options),
    closeSnackbar: () => ctx?.closeSnackbar(),
    setDownloadProgress: () => {},
  };
}
