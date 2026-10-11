/**
 * SĐT Việt Nam về dạng nội địa 0xxxxxxxxx (cùng dạng User.phone luôn lưu). Có 3 hàm vì 3 nơi dùng
 * cần mức chặt khác nhau; gộp thành một sẽ đổi hành vi của ít nhất một nơi.
 */

const LOCAL_MOBILE = /^0\d{9}$/;

/**
 * Khoá gộp khách (Order.endCustomerKey, đích hoàn tiền đơn hộ). Chỉ bỏ ký tự không phải số và đổi
 * 84+9 số thành 0+9 số, KHÔNG kiểm độ dài: form lên đơn hộ nhận cả 0xxxxxxxxx lẫn +84xxxxxxxxx, và
 * nếu bỏ bước 84→0 thì một khách thật bị tách thành 2 khoá tuỳ CTV gõ kiểu nào.
 */
export function toLocalPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const local = digits.replace(/^84(\d{9})$/, '0$1');
  return local || null;
}

/** Số Zalo trả về (thường 84xxxxxxxxx): bỏ ký tự không phải số, thêm 0 đầu nếu thiếu, bắt buộc 0 + 9 số. */
export function normalizeZaloPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;
  let formatted = digits;
  if (digits.startsWith('84')) formatted = `0${digits.slice(2)}`;
  else if (!digits.startsWith('0')) formatted = `0${digits}`;
  if (!LOCAL_MOBILE.test(formatted)) return null;
  return formatted;
}

/**
 * Chuỗi nhân viên gõ/quét ở quầy: chỉ nhận `+?<số>`, 84+11 số đổi thành 0+9 số, KHÔNG tự thêm 0 đầu
 * (một dãy 9 số không có 0 đầu có thể là mã thành viên, không được coi là SĐT). Không hợp lệ → null.
 */
export function parseVnPhoneStrict(s: string): string | null {
  const m = /^\+?(\d+)$/.exec(s);
  if (!m) return null;
  let digits = m[1]!;
  if (digits.startsWith('84') && digits.length === 11) digits = `0${digits.slice(2)}`;
  return LOCAL_MOBILE.test(digits) ? digits : null;
}
