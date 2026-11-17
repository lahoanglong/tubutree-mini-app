import type { RestockIntent } from '@tubutree/app-core/commerce/restock-intent';

// "Báo tôi khi có hàng" khi khách chưa đăng nhập: đi qua trang đăng nhập (chuyển hướng cả trang) rồi quay lại trang sản phẩm, nên ý định nằm
// ở sessionStorage như `rememberPendingRemind`. Hạn ngắn: khách bỏ dở đăng nhập thì lần đăng nhập sau đó không tự đăng ký điều khách đã quên.
export const PENDING_RESTOCK_KEY = 'tubu_pending_restock';
export const PENDING_RESTOCK_TTL_MS = 10 * 60_000;

function store(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberPendingRestock(intent: RestockIntent, now: number = Date.now()): void {
  try {
    store()?.setItem(PENDING_RESTOCK_KEY, JSON.stringify({ variationId: intent.variationId, at: now }));
  } catch {
    /* không có storage thì khách tự bấm lại sau khi đăng nhập */
  }
}

/**
 * Lấy ý định của một trong các phân loại `variationIds` (sản phẩm đang xem) rồi xoá, dùng đúng một lần. Ý định của sản phẩm khác giữ nguyên;
 * quá hạn, hỏng hay sai dạng thì xoá và trả null.
 */
export function takePendingRestock(variationIds: readonly string[], now: number = Date.now()): RestockIntent | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(PENDING_RESTOCK_KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<RestockIntent> & { at?: number };
    if (!v || typeof v.variationId !== 'string' || typeof v.at !== 'number' || now - v.at > PENDING_RESTOCK_TTL_MS) {
      s.removeItem(PENDING_RESTOCK_KEY);
      return null;
    }
    if (!variationIds.includes(v.variationId)) return null;
    s.removeItem(PENDING_RESTOCK_KEY);
    return { variationId: v.variationId };
  } catch {
    return null;
  }
}

export function clearPendingRestock(): void {
  try {
    store()?.removeItem(PENDING_RESTOCK_KEY);
  } catch {
    /* không có storage thì không có gì để xoá */
  }
}
