import type { RemindIntent } from '@tubutree/app-core/commerce/flash-remind-intent';

// "Nhắc tôi" của Giờ vàng khi khách chưa đăng nhập: đi qua trang đăng nhập (chuyển hướng cả trang) rồi quay lại, nên ý định nằm ở sessionStorage
// như `rememberPendingAdd` của return-to.ts (file riêng để không đụng gói khác). Hạn ngắn: khách bỏ dở đăng nhập thì lần đăng nhập sau đó
// không được tự đặt một nhắc mà khách đã quên.
export const PENDING_REMIND_KEY = 'tubu_pending_remind';
export const PENDING_REMIND_TTL_MS = 10 * 60_000;

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberPendingRemind(intent: RemindIntent, now: number = Date.now()): void {
  try {
    store()?.setItem(PENDING_REMIND_KEY, JSON.stringify({ itemId: intent.itemId, startAt: intent.startAt, at: now }));
  } catch {
    /* không có storage thì khách tự bấm lại sau khi đăng nhập */
  }
}

/** Đọc rồi xoá (dùng đúng một lần). Quá hạn, hỏng hay sai dạng thì xoá và trả null. */
export function takePendingRemind(now: number = Date.now()): RemindIntent | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(PENDING_REMIND_KEY);
    if (raw === null) return null;
    s.removeItem(PENDING_REMIND_KEY);
    const v = JSON.parse(raw) as Partial<RemindIntent> & { at?: number };
    if (!v || typeof v.itemId !== 'string' || typeof v.startAt !== 'string' || typeof v.at !== 'number') return null;
    if (now - v.at > PENDING_REMIND_TTL_MS) return null;
    return { itemId: v.itemId, startAt: v.startAt };
  } catch {
    return null;
  }
}

export function clearPendingRemind(): void {
  try {
    store()?.removeItem(PENDING_REMIND_KEY);
  } catch {
    /* không có storage thì không có gì để xoá */
  }
}
