/**
 * Ghi nhớ "đang thanh toán những dòng nào trong giỏ".
 *
 * Lựa chọn này đi vào /checkout qua navigation state. Zalo Mini App có thể tải lại trang
 * (back-forward, khôi phục phiên, deep link) — lúc đó state biến mất và màn thanh toán âm
 * thầm chuyển sang TOÀN GIỎ: khách chọn 1 món nhưng bị tính tiền tất cả. Vì vậy lưu lại
 * lựa chọn ở sessionStorage (sống theo phiên, không rò sang lần mở app sau).
 *
 * `null` = cố ý thanh toán toàn giỏ (khác với "không nhớ gì").
 */
const KEY = 'tubu_checkout_selection';

export type RememberedSelection = string[] | null;

export function rememberCheckoutSelection(itemIds: RememberedSelection): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ itemIds }));
  } catch {
    /* private mode / quota — mất trí nhớ chấp nhận được, không được làm hỏng checkout */
  }
}

/** `undefined` = chưa từng ghi nhớ trong phiên này. */
export function recallCheckoutSelection(): RememberedSelection | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { itemIds?: unknown };
    if (parsed.itemIds === null) return null;
    if (Array.isArray(parsed.itemIds) && parsed.itemIds.every((x) => typeof x === 'string')) {
      return parsed.itemIds as string[];
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function clearCheckoutSelection(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Lọc lựa chọn theo giỏ THẬT vừa tải về.
 *
 * Dòng đã nhớ có thể không còn (xoá ở tab/màn khác, hoặc BE gộp dòng cùng phân loại).
 * - còn một phần → chỉ thanh toán phần còn lại
 * - không còn dòng nào → `undefined` (toàn giỏ) thay vì đơn rỗng/lỗi quote
 */
export function reconcileSelection(
  selection: RememberedSelection | undefined,
  cartItemIds: string[],
): string[] | undefined {
  if (selection == null) return undefined;
  const alive = selection.filter((id) => cartItemIds.includes(id));
  if (alive.length > 0) return alive;
  // Không còn dòng nào → lựa chọn đã hết hạn (khách đã xoá món đó khỏi giỏ). Dọn luôn bộ nhớ:
  // giữ lại thì lần vào /checkout sau vẫn phải đối chiếu một danh sách chết. Rơi về toàn giỏ —
  // màn thanh toán liệt kê rõ từng món sẽ trả tiền nên khách vẫn thấy được mình đang mua gì.
  clearCheckoutSelection();
  return undefined;
}
