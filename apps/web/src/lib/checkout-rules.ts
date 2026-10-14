import { formatVnd } from './shop-client';

/** Trần ghi chú đơn của API (PlaceOrderDto.note @MaxLength(500)) và của Mini App. */
export const ORDER_NOTE_MAX = 500;

export interface InvoiceInfo {
  taxCode: string;
  companyName: string;
  address: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Hoá đơn VAT hợp lệ khi không yêu cầu xuất, hoặc đủ 4 trường và email đúng định dạng (API validate IsEmail). */
export function isInvoiceValid(wantInvoice: boolean, invoice: InvoiceInfo): boolean {
  if (!wantInvoice) return true;
  return (
    invoice.taxCode.trim().length > 0 &&
    invoice.companyName.trim().length > 0 &&
    invoice.address.trim().length > 0 &&
    EMAIL_RE.test(invoice.email.trim())
  );
}

/** Đang chọn Ví Tubu mà số dư không đủ trả tổng đơn → rơi về COD thay vì để lệnh đặt bị từ chối. Ví chỉ trả TOÀN BỘ đơn. */
export function shouldFallbackToCod(payment: string, walletBalance: number, total: number): boolean {
  return payment === 'WALLET' && walletBalance < total;
}

/** Lý do Ví Tubu bị mờ ở màn thanh toán (null = dùng được); cùng điều kiện với `shouldFallbackToCod`. */
export function walletUnavailableReason(balance: number, total: number): string | null {
  if (balance >= total) return null;
  return `Số dư chưa đủ — cần thêm ${formatVnd(total - balance)}`;
}

/** Mã gửi kèm đơn: mã khách vừa nhập ở thanh toán thắng mã còn trong phiên từ link giới thiệu. */
export function effectiveReferralCode(
  applied: string | null,
  contextReferral: string | null | undefined,
): string | undefined {
  return applied ?? contextReferral ?? undefined;
}

/** Lỗi đặt đơn mà khách chỉ sửa được bằng cách đổi/bỏ dòng ở giỏ hàng. */
export function isCartFixableError(message: string): boolean {
  return /không đủ tồn kho/.test(message) || message === 'Vượt giới hạn mua ưu đãi.' || message === 'Hết suất ưu đãi.';
}

/** Dòng đầu tiên hết hàng hoặc vượt tồn kho (API sẽ từ chối đặt dòng này). */
export function outOfStockLine<T extends { quantity: number; stock: number }>(items: T[]): T | undefined {
  return items.find((it) => it.quantity > it.stock);
}

/** Câu báo dòng hết hàng/vượt tồn ở màn thanh toán, cùng lời với Mini App (vi.checkout.overStock). */
export function overStockMessage(productName: string, stock: number): string {
  return stock > 0
    ? `Sản phẩm "${productName}" chỉ còn ${stock} sản phẩm. Vui lòng sửa số lượng trong giỏ.`
    : `Sản phẩm "${productName}" đã hết hàng. Vui lòng bỏ khỏi giỏ để đặt các món còn lại.`;
}
