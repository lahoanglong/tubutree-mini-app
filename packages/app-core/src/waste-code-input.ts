// Bảng ký tự và độ dài khớp mã máy chủ sinh ra (apps/api waste.constants: WASTE_CODE_ALPHABET, waste-codes.ts).
const BODY = '[2-9A-HJKMNP-TV-Z]';
const REQUEST_BODY = new RegExp(`^${BODY}{5}$`);
const GIFT_BODY = new RegExp(`^${BODY}{8}$`);
const SCAN_TOKEN = new RegExp(`(?:^|[^A-Z0-9])(TR|QG)[-\\s]?(${BODY}{5}|${BODY}{8})(?![A-Z0-9])`);

/**
 * Đưa mã gõ tay về dạng máy chủ nhận: bỏ khoảng trắng và gạch, viết hoa, tự thêm "TR-" (5 ký tự) hoặc "QG-" (8 ký tự).
 * Phần thân 5 ký tự có thể tự nó bắt đầu bằng "TR" nên chỉ cắt tiền tố khi độ dài còn lại đúng khớp; chuỗi không giống mã giữ nguyên.
 */
export function normalizeWasteLookupCode(raw: string): string {
  const text = raw.toUpperCase().replace(/[\s-]+/g, '');
  if (REQUEST_BODY.test(text)) return `TR-${text}`;
  if (GIFT_BODY.test(text)) return `QG-${text}`;
  if (text.startsWith('TR') && REQUEST_BODY.test(text.slice(2))) return `TR-${text.slice(2)}`;
  if (text.startsWith('QG') && GIFT_BODY.test(text.slice(2))) return `QG-${text.slice(2)}`;
  return raw.toUpperCase().replace(/\s+/g, '');
}

/** Nội dung quét từ mã QR (có thể là cả đường dẫn hoặc đoạn chữ): lấy mã TR-/QG- đầu tiên, không thấy thì trả null. */
export function extractWasteLookupCode(content: string): string | null {
  const text = content.toUpperCase();
  const m = SCAN_TOKEN.exec(text);
  if (m) return `${m[1]}-${m[2]}`;
  const whole = normalizeWasteLookupCode(content);
  return /^(TR-[2-9A-HJKMNP-TV-Z]{5}|QG-[2-9A-HJKMNP-TV-Z]{8})$/.test(whole) ? whole : null;
}
