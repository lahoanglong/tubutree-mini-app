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
 * Còn một phần → chỉ thanh toán phần còn lại. Không còn dòng nào → mảng RỖNG, không phải `undefined`: khách đã chọn một phần thì
 * không được tính tiền phần khác; nơi gọi báo "món đã chọn không còn" kèm lối về giỏ. Hàm thuần, không dọn bộ nhớ: nơi gọi dọn
 * khi khách rời màn báo.
 */
export function reconcileSelection(
  selection: RememberedSelection | undefined,
  cartItemIds: string[],
): string[] | undefined {
  if (selection == null) return undefined;
  return selection.filter((id) => cartItemIds.includes(id));
}
