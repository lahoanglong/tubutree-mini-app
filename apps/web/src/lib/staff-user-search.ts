/** Luật tìm khách của CSKH, khớp assertStaffUserListQuery bên API (máy chủ vẫn kiểm lại): SĐT đủ 10 số, mã khách, hoặc tên từ 3 ký tự. */
export const STAFF_USER_MAX_PAGE = 5;
export const STAFF_USER_SEARCH_HINT = 'Nhập số điện thoại đủ 10 số, mã khách hàng, hoặc ít nhất 3 ký tự của tên để tìm khách.';
const PHONE_LIKE = /^\+?[\d\s.\-()]+$/;

/** Chuẩn hoá SĐT gõ tay về dạng 0xxxxxxxxx (cả +84, 84, dấu chấm, khoảng trắng); không phải SĐT thì null. */
function normalizePhone(s: string): string | null {
  if (!PHONE_LIKE.test(s)) return null;
  const digits = s.replace(/\D/g, '');
  return digits.replace(/^840?(\d{9})$/, '0$1').replace(/^([1-9]\d{8})$/, '0$1');
}

/** null khi từ khoá hợp lệ cho CSKH; ngược lại là câu nói rõ cần gõ gì. */
export function staffUserSearchProblem(raw: string): string | null {
  const s = raw.trim();
  if (!s) return STAFF_USER_SEARCH_HINT;
  if (PHONE_LIKE.test(s)) {
    const phone = normalizePhone(s);
    return phone && /^0\d{9}$/.test(phone) ? null : 'Số điện thoại cần đủ 10 số để tìm khách. Gõ thiếu số thì không tìm được.';
  }
  return [...s].length < 3 ? STAFF_USER_SEARCH_HINT : null;
}
