/**
 * Địa chỉ giao và ghi chú khách đã chọn ở màn Thanh toán giữ qua một lần rời sang Giỏ hàng để sửa món hết hàng hay giá vừa đổi rồi quay lại
 * (WCAG 2.2 3.3.7: không bắt nhập lại). Nơi gọi chỉ ghi khi khách bấm lối "về giỏ hàng để sửa" của chính màn Thanh toán; màn mở lại đọc đúng một lần
 * rồi xoá. Hạn ngắn (10 phút) vì màn mở lại không biết khách vào từ giỏ hay từ "Mua ngay" món khác: bỏ dở quá hạn thì lần mua sau về địa chỉ mặc định.
 * Chỉ lưu id địa chỉ (không lưu địa chỉ hay SĐT), theo tài khoản; mỗi lần ghi hay đọc đều xoá nháp của tài khoản khác trên cùng tab (máy dùng chung).
 * Không giữ cách trả tiền, như nháp của khách chưa đăng nhập (`guest-checkout/draft.ts`): tổng đã đổi ở giỏ, và Ví trừ tiền ngay nên chỉ dùng khi khách tự chọn lại.
 */
export const CHECKOUT_DRAFT_KEY = 'tubu_checkout_draft';
export const CHECKOUT_DRAFT_TTL_MS = 10 * 60_000;
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
  /** Có ở `Storage` thật: dùng để dọn nháp của tài khoản khác. */
  readonly length?: number;
  key?(index: number): string | null;
}

const draftKey = (userId: string) => `${CHECKOUT_DRAFT_KEY}:${userId}`;

function dropOtherDrafts(storage: DraftStorageLike, keep: string): void {
  if (typeof storage.key !== 'function' || typeof storage.length !== 'number') return;
  const stale: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k !== keep && k.startsWith(`${CHECKOUT_DRAFT_KEY}:`)) stale.push(k);
  }
  for (const k of stale) storage.removeItem(k);
}

export function saveCheckoutDraft(storage: DraftStorageLike | null, userId: string | null | undefined, draft: CheckoutDraft, nowMs: number): void {
  if (!storage || !userId) return;
  try {
    dropOtherDrafts(storage, draftKey(userId));
    storage.setItem(
      draftKey(userId),
      JSON.stringify({ addressId: draft.addressId, note: draft.note.slice(0, NOTE_MAX), at: nowMs }),
    );
  } catch {
    /* chế độ riêng tư hoặc bộ nhớ đầy: quay lại thì chọn lại, không được làm hỏng việc sang giỏ */
  }
}

/** Đọc rồi xoá bản nháp của tài khoản này (và nháp sót của tài khoản khác). Hết hạn, hỏng hay không có thì null. */
export function takeCheckoutDraft(storage: DraftStorageLike | null, userId: string | null | undefined, nowMs: number): CheckoutDraft | null {
  if (!storage || !userId) return null;
  let raw: string | null = null;
  try {
    dropOtherDrafts(storage, draftKey(userId));
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
