import { useCallback, useSyncExternalStore } from 'react';
import { useSnackbar } from 'zmp-ui';

export type NotifyType = 'success' | 'info' | 'warning' | 'error';
export interface NotifyOptions {
  text: string;
  type?: NotifyType;
  duration?: number;
  position?: 'top' | 'bottom';
}

type Kind = 'status' | 'alert';
interface Announcements {
  status: string;
  alert: string;
}

/** Chữ cho trình đọc màn hình: bỏ emoji ("🌿" bị đọc là "thảo mộc"), gộp khoảng trắng. */
export function spokenText(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();
}

// Hàng chờ ghi vùng đọc: module-level để `NotifyRegion` (một nơi, ở app.tsx) và mọi `useNotify` dùng chung mà không cần context.
let snapshot: Announcements = { status: '', alert: '' };
const listeners = new Set<() => void>();
const timers: Partial<Record<Kind, ReturnType<typeof setTimeout>>> = {};
const REWRITE_DELAY_MS = 50;

function publish(kind: Kind, text: string) {
  snapshot = { ...snapshot, [kind]: text };
  listeners.forEach((l) => l());
}

/**
 * Ghi một câu vào vùng `aria-live` polite / assertive. Xoá vùng trước rồi ghi lại sau 50ms: trình đọc màn hình chỉ đọc khi nội
 * dung đổi, nên cùng một câu hai lần liên tiếp (bấm "Chép mã" hai lần) sẽ im nếu không xoá giữa hai lần.
 */
export function announce(kind: Kind, text: string): void {
  clearTimeout(timers[kind]);
  publish(kind, '');
  const spoken = spokenText(text);
  if (!spoken) return;
  timers[kind] = setTimeout(() => publish(kind, spoken), REWRITE_DELAY_MS);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const getSnapshot = () => snapshot;

export function useAnnouncements(): Announcements {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Thông báo cho cả mắt và tai: hiện snackbar của ZaUI (không có aria-live, nên người dùng VoiceOver/TalkBack không nghe gì) và
 * đồng thời ghi vào vùng đọc. Lỗi/cảnh báo vào vùng assertive, còn lại vào vùng polite.
 */
export function useNotify(): { notify: (opts: NotifyOptions) => void } {
  const { openSnackbar } = useSnackbar();
  const notify = useCallback(
    ({ text, type, duration, position }: NotifyOptions) => {
      // Chỉ chuyển khoá được truyền: openSnackbar không nhận `undefined` như "chưa đặt".
      openSnackbar({
        text,
        ...(type ? { type } : null),
        ...(duration !== undefined ? { duration } : null),
        ...(position ? { position } : null),
      });
      announce(type === 'error' || type === 'warning' ? 'alert' : 'status', text);
    },
    [openSnackbar],
  );
  return { notify };
}
