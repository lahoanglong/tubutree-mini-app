import { fillCopy } from '../shop-copy';

/** Số dòng hàng hiện sẵn ở khung tóm tắt web trước khi gập; hơn mức này thì có nút "Xem thêm n sản phẩm". */
export const CHECKOUT_LINES_COLLAPSED = 5;

/**
 * Lý do nút Đặt hàng đang khoá, nói ngay cạnh nút (Mini App và web dùng chung). Thiếu địa chỉ thắng lỗi báo giá vì báo giá
 * chưa được hỏi khi chưa có địa chỉ; null khi không có lý do nào của riêng hai điều kiện này. Máy chủ từ chối địa chỉ
 * (ADDRESS_OUTDATED) thì bấm Thử lại không bao giờ qua: chỉ sửa địa chỉ mới qua.
 */
export function checkoutPlaceHint(i: { hasAddress: boolean; quoteFailed: boolean; addressOutdated?: boolean }): string | null {
  if (!i.hasAddress) return fillCopy('checkout.addressNeeded');
  if (i.quoteFailed && i.addressOutdated) return fillCopy('checkout.addressFix');
  if (i.quoteFailed) return fillCopy('checkout.quoteFailed');
  return null;
}

/**
 * Ô "Tổng cộng". Chỉ số máy chủ báo mới được đứng ở đây: chưa có địa chỉ thì chưa tính phí giao nên không số nào
 * được đóng vai tổng cuối; có địa chỉ mà báo giá chưa về thì "…" (không phải 0đ, trông như đơn không mất tiền).
 */
export function checkoutTotalText(i: { total: number | null; hasAddress: boolean }, formatMoney: (n: number) => string): string {
  if (i.total !== null) return formatMoney(i.total);
  return i.hasAddress ? '…' : fillCopy('checkout.totalPending');
}

/** Gập danh sách dòng hàng: phần ẩn kèm tiền để cộng các dòng thấy được vẫn ra "Tạm tính". */
export function collapseCheckoutLines<T extends { total: number }>(
  lines: readonly T[],
  expanded: boolean,
  max: number = CHECKOUT_LINES_COLLAPSED,
): { shown: T[]; hiddenCount: number; hiddenTotal: number } {
  if (expanded || lines.length <= max) return { shown: [...lines], hiddenCount: 0, hiddenTotal: 0 };
  const hidden = lines.slice(max);
  return { shown: lines.slice(0, max), hiddenCount: hidden.length, hiddenTotal: hidden.reduce((s, l) => s + l.total, 0) };
}
