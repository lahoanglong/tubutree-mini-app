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
 * Đang chọn Ví Tubu mà số dư không đủ trả tổng đơn → tự rơi về COD, tránh đặt hàng thất bại (BE reject
 * nếu thanh toán vượt số dư). Ví chỉ trả TOÀN BỘ đơn.
 */
export function shouldFallbackToCod(payment: string, walletBalance: number, total: number): boolean {
  return payment === 'WALLET' && walletBalance < total;
}

/**
 * Lý do Ví Tubu bị mờ ở màn thanh toán (null = dùng được). Cùng điều kiện với `shouldFallbackToCod`
 * (số dư < tổng đơn) để dòng bị mờ luôn có lời giải thích và dòng được chọn không bị tự đổi về COD.
 */
export function walletUnavailableReason(balance: number, total: number): string | null {
  if (balance >= total) return null;
  return `Số dư chưa đủ — cần thêm ${formatVnd(total - balance)}`;
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
 * Trần Điểm Xanh của đơn (`quote.pointsMax`, đã gồm số dư dùng được, trần theo giá trị hàng và luật hàng của gian hàng đối tác).
 * Khách chỉ thấy số thật được trừ sau khi tick, nên trước khi tick ô phải nêu trần khi nó thấp hơn số điểm dùng được:
 *  - giỏ có hàng của gian hàng đối tác (Điểm Xanh chỉ trả cho hàng Tubu): luôn nêu trần + câu giải thích báo giá trả về;
 *  - giỏ chỉ hàng Tubu: nêu trần khi nó nhỏ hơn `usable`;
 *  - trần 0: tắt ô (kèm câu giải thích nếu không có câu của hàng đối tác).
 * Báo giá chưa có `pointsMax` (đang tải, API cũ): không đổi gì.
 */
export function pointsCapState(
  quote: { pointsMax?: number; pointsPartnerNote?: string | null } | undefined,
  usable = 0,
): { disabled: boolean; capNote: string | null; partnerNote: string | null } {
  const partnerNote = quote?.pointsPartnerNote ?? null;
  if (!Number.isFinite(quote?.pointsMax)) return { disabled: partnerNote !== null, capNote: null, partnerNote };
  const max = Math.max(0, quote!.pointsMax as number);
  if (max === 0) {
    if (partnerNote) return { disabled: true, capNote: null, partnerNote };
    return usable > 0
      ? { disabled: true, capNote: 'Đơn này chưa dùng được Điểm Xanh', partnerNote: null }
      : { disabled: false, capNote: null, partnerNote: null };
  }
  if (partnerNote) return { disabled: false, capNote: `Đơn này dùng tối đa ${groupThousands(max)} Điểm Xanh`, partnerNote };
  if (max < usable) {
    return { disabled: false, capNote: `Đơn này dùng tối đa ${groupThousands(max)} Điểm Xanh, tính theo giá trị hàng của đơn`, partnerNote: null };
  }
  return { disabled: false, capNote: null, partnerNote: null };
}
