import { parseTypedVnPhone } from './affiliate-rules';

/**
 * Chuẩn hoá chữ khách dán từ Zalo, Word, ghi chú: tin nhắn Zalo hay kèm ký tự vô hình (khoảng trắng độ rộng 0, dấu đánh hướng chữ) và
 * dấu cách cứng, nên một số điện thoại / mã đơn trông đúng vẫn bị báo sai nếu so thẳng. Chữ thuần, dùng chung Mini App và web.
 */

// U+200B–U+200F (độ rộng 0, dấu hướng chữ), U+2060 (word joiner), U+FEFF (BOM), U+00AD (gạch nối mềm), U+202A–U+202E và U+2066–U+2069 (đánh hướng chữ).
const INVISIBLE = /[\u200B-\u200F\u2060\uFEFF\u00AD\u202A-\u202E\u2066-\u2069]/g;
// Dấu ngăn nhóm số khi người ta gõ/dán SĐT: khoảng trắng, chấm, ngoặc, gạch ngang (cả gạch dài của Word/Zalo).
const PHONE_SEPARATORS = /[\s.()\-\u2010-\u2015\u2212]/g;

/** Bỏ ký tự vô hình, đổi dấu cách cứng thành dấu cách thường rồi cắt khoảng trắng hai đầu. */
export function stripInvisible(raw: string): string {
  return raw.replace(INVISIBLE, '').replace(/\u00A0/g, ' ').trim();
}

const compactPhone = (raw: string): string => stripInvisible(raw).normalize('NFKC').replace(PHONE_SEPARATORS, '');

/**
 * SĐT Việt Nam khách gõ hoặc dán → `0xxxxxxxxx`; không đúng dạng nào thì null. Nhận 0, +84, 84, 0084 rồi 9 số, có hoặc không có dấu
 * cách, chấm, gạch, ngoặc, kể cả số full-width (０９１２…).
 */
export function parseVnPhoneInput(raw: string): string | null {
  const compact = compactPhone(raw);
  return parseTypedVnPhone(compact) ?? parseTypedVnPhone(compact.replace(/^0084/, '84'));
}

/**
 * Dạng chuẩn để kiểm và gửi lên máy chủ: `0xxxxxxxxx` khi phân tích được. Không thì trả chữ khách gõ đã bỏ ký tự vô hình và dấu ngăn
 * nhóm, để ô nhập và lời báo lỗi vẫn phản ánh đúng thứ khách gõ (không mất chữ khác).
 */
export function normalizeVnPhoneInput(raw: string): string {
  return parseVnPhoneInput(raw) ?? compactPhone(raw);
}

/** Từ khoá tìm đơn: bỏ ký tự vô hình, gộp khoảng trắng liên tiếp thành một; giữ nguyên hoa/thường và toàn bộ tên sản phẩm. */
export function normalizeOrderSearchInput(raw: string): string {
  return stripInvisible(raw).replace(/\s+/g, ' ');
}
