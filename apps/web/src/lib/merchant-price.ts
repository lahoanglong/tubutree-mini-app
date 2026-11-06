/** Giá bán đối tác nhập tay (đồng). Hai trần này khớp `MIN_MERCHANT_PRICE` và `MAX_PRICE` ở `merchant.controller.ts`. */
export const MERCHANT_PRICE_MIN = 1_000;
export const MERCHANT_PRICE_MAX = 100_000_000;

/** Ngăn nghìn kiểu Việt Nam: nhóm đầu 1-3 chữ số khác 0, rồi các nhóm đúng ba chữ số ("5.000", "120.000", "1.250.000"). */
const GROUPED = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const PLAIN = /^\d+$/;

/**
 * "120.000", "120000" hay "120.000đ" → 120000. Ô giá để người Việt gõ nên dấu chấm là ngăn nghìn, không phải dấu thập phân
 * ("5.000" là 5000, không phải 5). Số lẻ ("12.5"), dấu phẩy, chữ khác → null.
 */
export function parseMerchantPrice(raw: string): number | null {
  const s = raw.trim().replace(/\s*[đ₫]$/i, '');
  if (GROUPED.test(s)) return Number(s.replace(/\./g, ''));
  if (PLAIN.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/** Câu báo lỗi cho giá đã đọc (null = đọc không được); không lỗi thì null. */
export function merchantPriceError(n: number | null): string | null {
  if (n === null) return 'Nhập giá bằng số đồng, ví dụ 120.000 hoặc 120000.';
  if (n < MERCHANT_PRICE_MIN) return 'Giá bán tối thiểu 1.000đ.';
  if (n > MERCHANT_PRICE_MAX) return 'Giá bán tối đa 100.000.000đ.';
  return null;
}
