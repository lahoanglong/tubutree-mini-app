import { useSyncExternalStore } from 'react';

/**
 * Hàng chờ ghi hai vùng `aria-live` của `NotifyRegion`. Tách khỏi `hooks/use-notify.ts` (nơi nhập `zmp-ui`) để hộp thông báo của bản build
 * (`build-snackbar-shim.ts`, được nạp từ bên trong barrel `zmp-ui`) dùng chung mà không tạo vòng import zmp-ui → shim → use-notify → zmp-ui.
 */
export type AnnounceKind = 'status' | 'alert';
interface Announcements {
  status: string;
  alert: string;
}

/** Chữ cho trình đọc màn hình: bỏ emoji ("🌿" bị đọc là "thảo mộc"), gộp khoảng trắng. */
export function spokenText(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();
}

// Module-level để `NotifyRegion` (một nơi, ở app.tsx), mọi `useNotify` và hộp thông báo dùng chung mà không cần context.
let snapshot: Announcements = { status: '', alert: '' };
const listeners = new Set<() => void>();
const timers: Partial<Record<AnnounceKind, ReturnType<typeof setTimeout>>> = {};
const REWRITE_DELAY_MS = 50;

function publish(kind: AnnounceKind, text: string) {
  snapshot = { ...snapshot, [kind]: text };
  listeners.forEach((l) => l());
}

/**
 * Ghi một câu vào vùng `aria-live` polite / assertive. Xoá vùng trước rồi ghi lại sau 50ms: trình đọc màn hình chỉ đọc khi nội
 * dung đổi, nên cùng một câu hai lần liên tiếp (bấm "Chép mã" hai lần) sẽ im nếu không xoá giữa hai lần. Hai lệnh gọi cùng loại trong
 * cùng một nhịp (hộp thông báo và `useNotify` cùng báo một câu) gộp thành một lần đọc vì lệnh sau huỷ hẹn ghi của lệnh trước.
 */
export function announce(kind: AnnounceKind, text: string): void {
  clearTimeout(timers[kind]);
  publish(kind, '');
  const spoken = spokenText(text);
  if (!spoken) return;
  timers[kind] = setTimeout(() => publish(kind, spoken), REWRITE_DELAY_MS);
}

/** Lỗi/cảnh báo vào vùng assertive, còn lại vào vùng polite. */
export const announceKind = (type: string | undefined): AnnounceKind => (type === 'error' || type === 'warning' ? 'alert' : 'status');

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
