/**
 * Ghi nhớ "đang thanh toán những dòng nào trong giỏ" giữa trang Giỏ hàng và trang Thanh toán.
 *
 * Web không có navigation state như Mini App, và khách có thể tải lại trang thanh toán (F5, mở lại tab):
 * không nhớ thì trang âm thầm chuyển từ "1 món đã chọn" sang TOÀN GIỎ và tính tiền cả những món khách không
 * chọn. Lưu ở sessionStorage (sống theo tab, không rò sang lần mở sau).
 *
 * `null` = cố ý thanh toán toàn giỏ (khác với `undefined` = chưa từng chọn).
 */
const KEY = 'tubu_checkout_selection';

export type RememberedSelection = string[] | null;

export function rememberCheckoutSelection(itemIds: RememberedSelection): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ itemIds }));
  } catch {
    /* chế độ riêng tư/hết dung lượng: mất trí nhớ chấp nhận được, không được làm hỏng thanh toán */
  }
}

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
    /* bỏ qua */
  }
}

/**
 * Lọc lựa chọn theo giỏ THẬT vừa tải về: dòng đã nhớ có thể không còn (xoá ở tab khác, API gộp dòng).
 * Còn một phần → chỉ thanh toán phần còn lại; không còn dòng nào → `undefined` (toàn giỏ) và dọn bộ nhớ, thay vì
 * tạo đơn rỗng. Màn thanh toán liệt kê từng món sẽ trả tiền nên khách vẫn thấy mình đang mua gì.
 */
export function reconcileSelection(
  selection: RememberedSelection | undefined,
  cartItemIds: string[],
): string[] | undefined {
  if (selection == null) return undefined;
  const alive = selection.filter((id) => cartItemIds.includes(id));
  if (alive.length > 0) return alive;
  clearCheckoutSelection();
  return undefined;
}
