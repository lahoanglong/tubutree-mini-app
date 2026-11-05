/**
 * Ô bắt buộc của màn quản trị chỉ coi là đã nhập khi có ít nhất một ký tự nhìn thấy được. `String.trim` bỏ khoảng trắng nhưng
 * để lại ký tự rộng 0 (U+200B, U+2060, U+FEFF...), nên ô chỉ chứa chúng từng làm nút Tạo/Lưu mở và đẩy lỗi xuống API.
 * Cùng tập ký tự với `trimInvisible` của API (apps/api/src/common/text-trim.ts); phía API vẫn là nơi quyết định cuối cùng.
 */
const INVISIBLE_CHARS = '\u00ad\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff';
const INVISIBLE_OR_SPACE = new RegExp(`^[\\s${INVISIBLE_CHARS}]*$`);
const INVISIBLE_ANYWHERE = new RegExp(`[${INVISIBLE_CHARS}]`, 'g');

export const hasVisibleText = (text: string): boolean => !INVISIBLE_OR_SPACE.test(text);

const INVISIBLE_EDGE = new RegExp(`^[\\s${INVISIBLE_CHARS}]+|[\\s${INVISIBLE_CHARS}]+$`, 'g');

/** Cắt khoảng trắng và ký tự vô hình ở hai đầu, như `trimInvisible` của API; chuỗi chỉ toàn chúng thành rỗng. */
export const trimVisible = (text: string): string => text.replace(INVISIBLE_EDGE, '');

/** Bỏ ký tự vô hình ở mọi vị trí (khoảng trắng thường giữ nguyên): SĐT dán từ Zalo hay Word hay kèm chúng giữa số. */
export const stripInvisible = (text: string): string => text.replace(INVISIBLE_ANYWHERE, '');

const PHONE_CHARS = /^\+?[\d\s.\-()]+$/;
const PHONE_MIN_DIGITS = 3;

/**
 * Chuỗi có phải SĐT mà API cấp vai trò nhận (cùng luật với `searchPhone`, apps/api/src/modules/admin/admin-order-filter.ts): sau khi bỏ
 * ký tự vô hình và khoảng trắng hai đầu, chỉ gồm chữ số, khoảng trắng, dấu chấm, gạch, ngoặc, dấu + ở đầu, và có ít nhất 3 chữ số.
 */
export const isPhoneInput = (text: string): boolean => {
  const s = stripInvisible(text).trim();
  return PHONE_CHARS.test(s) && s.replace(/\D/g, '').length >= PHONE_MIN_DIGITS;
};
