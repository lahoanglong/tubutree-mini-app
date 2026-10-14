import { formatNumber, formatPoints, formatVnd } from './format';
import { convertedPointsNote, pointsSummary } from './points-lots';

export interface InvoiceInfo {
  taxCode: string;
  companyName: string;
  address: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Hoá đơn VAT hợp lệ khi không yêu cầu xuất, hoặc đủ 4 trường + email đúng định dạng. */
export function isInvoiceValid(wantInvoice: boolean, invoice: InvoiceInfo): boolean {
  if (!wantInvoice) return true;
  return (
    invoice.taxCode.trim().length > 0 &&
    invoice.companyName.trim().length > 0 &&
    invoice.address.trim().length > 0 &&
    EMAIL_RE.test(invoice.email.trim())
  );
}

/**
 * Lý do Ví Tubu bị mờ ở màn thanh toán (null = dùng được): số dư < tổng đơn, đúng điều kiện máy chủ từ chối lúc đặt.
 * Ví chỉ trả TOÀN BỘ đơn.
 */
export function walletUnavailableReason(balance: number, total: number): string | null {
  if (balance >= total) return null;
  return `Số dư chưa đủ — cần thêm ${formatVnd(total - balance)}`;
}

/** Các cách thanh toán màn thanh toán cho chọn. ZALOPAY chưa mở (chưa nối cổng thanh toán thật). */
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
 * '' = chưa chọn: nút đặt hàng khoá và `paymentMissingNote` nói khách cần làm gì.
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

/**
 * Đơn 0đ (điểm hoặc mã giảm giá phủ hết cả hàng lẫn phí ship): BE ép COD và xác nhận luôn, không thu tiền,
 * nên màn thanh toán ẩn lựa chọn phương thức và nói rõ lý do. null = còn tiền cần trả.
 */
export function zeroTotalNote(q: { total: number; pointsDiscount: number }): string | null {
  if (q.total > 0) return null;
  return q.pointsDiscount > 0
    ? 'Đơn đã được trả đủ bằng Điểm Xanh. Bạn không cần thanh toán thêm.'
    : 'Đơn không còn số tiền cần thanh toán.';
}

const groupThousands = (n: number) => formatNumber(n);

/** "Dùng 1.250 điểm — giảm 12.500đ" (số điểm có dấu nghìn như mọi màn khác). */
export function pointsUseLabel(points: number, discount: string): string {
  return `Dùng ${formatPoints(points)} — giảm ${discount}`;
}

/** "Nhận +1.250 Điểm Xanh khi giao thành công". */
export function pointsEarnLabel(points: number): string {
  return `Nhận +${groupThousands(points)} Điểm Xanh khi giao thành công`;
}

/**
 * Điểm Xanh màn thanh toán được đề nghị dùng. Khách thấy MỘT con số (lô thường + lô quy đổi), nhưng:
 *  - lô thường: chỉ phần DÙNG ĐƯỢC (`redeemablePoints` = số dư − điểm đơn còn trong hạn đổi/trả hoặc đang chờ
 *    xử lý đổi/trả); backend kẹp báo giá + đặt đơn đúng luật này và áp trần % giá trị hàng;
 *  - lô quy đổi từ xu cũ: không hết hạn, không bị khoá, dùng tới 100% giá trị hàng → cộng nguyên vào `usable`.
 * `usable` được gửi làm `pointsToUse`; backend tự chia hai lô và trả `pointsUsed` thật trong báo giá.
 *  - API cũ chưa trả `redeemablePoints` → số dư − `lockedPoints` (≥ 0).
 *  - Chưa tải xong overview → số dư từ hồ sơ đăng nhập (`fallbackBalance`, `fallbackConverted`); backend vẫn
 *    tự kẹp khi báo giá.
 * `label` = dòng mô tả khi công tắc đang tắt (null = chưa có điểm nào → màn hình hiện lời mời tích điểm);
 * `lockNote` = phần chưa dùng được, chỉ có khi vẫn còn điểm dùng được (không thì đã nằm trong `label`);
 * `convertedNote` = nói rõ phần không hết hạn khi khách có điểm quy đổi.
 */
export function checkoutPoints(
  ov: { pointsBalance: number; pointsConvertedBalance?: number; lockedPoints?: number; redeemablePoints?: number } | undefined,
  fallbackBalance: number,
  fallbackConverted = 0,
): { balance: number; converted: number; usable: number; label: string | null; lockNote: string | null; convertedNote: string | null } {
  const lots = pointsSummary({
    pointsBalance: ov?.pointsBalance ?? fallbackBalance,
    pointsConvertedBalance: ov?.pointsConvertedBalance ?? fallbackConverted,
  });
  const standardUsable = Math.min(
    lots.standard,
    Math.max(0, ov?.redeemablePoints ?? lots.standard - (ov?.lockedPoints ?? 0)),
  );
  const usable = standardUsable + lots.converted;
  const balance = lots.total;
  const held = lots.standard - standardUsable;
  const heldText = `${formatPoints(held)} từ đơn còn trong hạn hoặc đang chờ xử lý đổi/trả chưa dùng được`;
  const convertedNote = lots.converted > 0 ? `${convertedPointsNote(lots.converted)}, trả tới 100% giá trị hàng` : null;
  const base = { balance, converted: lots.converted, usable, convertedNote };
  if (balance === 0) return { ...base, label: null, lockNote: null };
  if (usable === 0) return { ...base, label: heldText, lockNote: null };
  if (held === 0) return { ...base, label: `Bạn đang có ${formatPoints(usable)}`, lockNote: null };
  return { ...base, label: `Dùng được ${groupThousands(usable)}/${formatPoints(balance)}`, lockNote: heldText };
}

/**
 * Ô Điểm Xanh khi giỏ có hàng của gian hàng đối tác (Điểm Xanh chỉ trả cho hàng Tubu): nêu trần điểm của đơn và câu giải thích
 * báo giá trả về; trần 0 (giỏ chỉ hàng đối tác) thì tắt ô. Giỏ chỉ hàng Tubu hoặc API cũ: không đổi gì.
 */
export function partnerPointsState(
  quote: { pointsMax?: number; pointsPartnerNote?: string | null } | undefined,
): { disabled: boolean; capNote: string | null; partnerNote: string | null } {
  const partnerNote = quote?.pointsPartnerNote ?? null;
  if (!partnerNote) return { disabled: false, capNote: null, partnerNote: null };
  const max = Math.max(0, Number.isFinite(quote?.pointsMax) ? (quote!.pointsMax as number) : 0);
  if (max === 0) return { disabled: true, capNote: null, partnerNote };
  return { disabled: false, capNote: `Đơn này dùng tối đa ${groupThousands(max)} Điểm Xanh`, partnerNote };
}
