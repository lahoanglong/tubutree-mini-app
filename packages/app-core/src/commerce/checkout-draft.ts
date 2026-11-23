/**
 * Địa chỉ giao và ghi chú khách đã chọn ở màn Thanh toán giữ qua một lần rời sang Giỏ hàng để sửa món hết hàng hay giá vừa đổi rồi quay lại
 * (WCAG 2.2 3.3.7: không bắt nhập lại). Nơi gọi chỉ ghi khi khách bấm một lối "về giỏ hàng" của chính màn Thanh toán; màn mở lại đọc đúng một lần
 * rồi xoá, nên lựa chọn không rò sang lần mua sau. Chỉ lưu id địa chỉ (không lưu địa chỉ hay SĐT), theo tài khoản, tối đa 30 phút.
 * Không giữ cách trả tiền, như nháp của khách chưa đăng nhập (`guest-checkout/draft.ts`): tổng đã đổi ở giỏ, và Ví trừ tiền ngay nên chỉ dùng khi khách tự chọn lại.
 */
export const CHECKOUT_DRAFT_KEY = 'tubu_checkout_draft';
export const CHECKOUT_DRAFT_TTL_MS = 30 * 60_000;
/** Bằng trần ô ghi chú của đơn (máy chủ cắt ở 500 ký tự). */
const NOTE_MAX = 500;

export interface CheckoutDraft {
  addressId: string | null;
  note: string;
}

export interface DraftStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const draftKey = (userId: string) => `${CHECKOUT_DRAFT_KEY}:${userId}`;

export function saveCheckoutDraft(storage: DraftStorageLike | null, userId: string | null | undefined, draft: CheckoutDraft, nowMs: number): void {
  if (!storage || !userId) return;
  try {
    storage.setItem(
      draftKey(userId),
      JSON.stringify({ addressId: draft.addressId, note: draft.note.slice(0, NOTE_MAX), at: nowMs }),
    );
  } catch {
    /* chế độ riêng tư hoặc bộ nhớ đầy: quay lại thì chọn lại, không được làm hỏng việc sang giỏ */
  }
}

/** Đọc rồi xoá bản nháp của tài khoản này. Hết hạn, hỏng hay của tài khoản khác thì null. */
export function takeCheckoutDraft(storage: DraftStorageLike | null, userId: string | null | undefined, nowMs: number): CheckoutDraft | null {
  if (!storage || !userId) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(draftKey(userId));
    if (raw !== null) storage.removeItem(draftKey(userId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const at = typeof v.at === 'number' ? v.at : NaN;
    if (!(nowMs - at >= 0 && nowMs - at <= CHECKOUT_DRAFT_TTL_MS)) return null;
    const addressId = typeof v.addressId === 'string' && v.addressId.length > 0 && v.addressId.length <= 64 ? v.addressId : null;
    const note = typeof v.note === 'string' ? v.note.slice(0, NOTE_MAX) : '';
    return { addressId, note };
  } catch {
    return null;
  }
}

/** Id địa chỉ của bản nháp nếu địa chỉ đó còn trong sổ (có thể đã bị xoá ở nơi khác trong lúc khách ở giỏ); không thì null để nơi gọi dùng địa chỉ mặc định. */
export function draftAddressId(draft: CheckoutDraft | null | undefined, addresses: readonly { id: string }[]): string | null {
  const id = draft?.addressId;
  return id && addresses.some((a) => a.id === id) ? id : null;
}
