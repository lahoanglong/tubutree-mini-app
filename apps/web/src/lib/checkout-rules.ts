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

/** Lý do Ví Tubu bị mờ ở màn thanh toán (null = dùng được): số dư < tổng đơn, đúng điều kiện máy chủ từ chối lúc đặt. */
export function walletUnavailableReason(balance: number, total: number): string | null {
  if (balance >= total) return null;
  return `Số dư chưa đủ — cần thêm ${formatVnd(total - balance)}`;
}

/** Các cách thanh toán màn thanh toán cho chọn, cùng Mini App. */
export const CHECKOUT_PAYMENT_METHODS = ['COD', 'BANK_TRANSFER', 'WALLET'] as const;
/** Cách được tự chọn khi lựa chọn hiện tại không dùng được. Ví trừ tiền ngay khi đặt nên chỉ dùng khi khách tự chọn. */
const AUTO_PICK_METHODS = ['COD', 'BANK_TRANSFER'] as const;

export interface PaymentQuote {
  total: number;
  blockedPaymentMethods?: Record<string, string>;
}

/**
 * Lý do một cách thanh toán không dùng được cho đơn này (null = dùng được). COD và chuyển khoản theo đúng blockedPaymentMethods
 * của báo giá (hạn mức COD từng đơn, giỏ tách đơn): máy chủ từ chối đặt đúng các cách đó, cùng câu. Ví so số dư mới nhất.
 */
export function paymentUnavailableReason(method: string, quote: PaymentQuote, walletBalance: number): string | null {
  const blocked = quote.blockedPaymentMethods?.[method];
  if (blocked) return blocked;
  return method === 'WALLET' ? walletUnavailableReason(walletBalance, quote.total) : null;
}

/**
 * Cách thanh toán sau mỗi lần báo giá: giữ lựa chọn của khách khi còn dùng được, không thì COD hoặc chuyển khoản nếu dùng được.
 * '' = chưa chọn: nút Đặt hàng khoá và `paymentMissingNote` nói khách cần làm gì.
 */
export function pickPaymentMethod(current: string, quote: PaymentQuote, walletBalance: number): string {
  const usable = (m: string) => paymentUnavailableReason(m, quote, walletBalance) === null;
  if ((CHECKOUT_PAYMENT_METHODS as readonly string[]).includes(current) && usable(current)) return current;
  return AUTO_PICK_METHODS.find(usable) ?? '';
}

/** Câu dưới danh sách cách thanh toán khi chưa có cách nào được chọn. */
export function paymentMissingNote(quote: PaymentQuote, walletBalance: number): string {
  return CHECKOUT_PAYMENT_METHODS.some((m) => paymentUnavailableReason(m, quote, walletBalance) === null)
    ? 'Chọn một cách thanh toán cho đơn này để đặt hàng.'
    : 'Đơn này chưa có cách thanh toán dùng được. Xem hướng dẫn dưới từng cách thanh toán ở trên.';
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
