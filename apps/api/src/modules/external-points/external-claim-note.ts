/**
 * Ký tự không hiện ra nhưng không phải khoảng trắng: nhóm Cf (zero-width, đánh dấu chiều chữ, soft hyphen, ký hiệu toán ẩn, BOM) và
 * các ký tự Hangul/Khmer/Mông Cổ/Braille trống mà Unicode xếp vào nhóm khác. Web dùng cùng biểu thức (`lib/external-claims.ts`).
 */
// Cố ý liệt kê ký tự kết hợp (U+034F): chính nó là thứ cần loại.
// eslint-disable-next-line no-misleading-character-class
export const INVISIBLE = /[\p{Cf}\u034F\u115F\u1160\u17B4\u17B5\u180E\u2800\u3164\uFFA0]/gu;

/** Ghi chú duyệt claim SĐT cũ phải có ít nhất chừng này ký tự thật (không tính khoảng trắng và ký tự vô hình). */
export const MIN_NOTE_CHARS = 3;

export const stripInvisible = (note: string): string => note.replace(INVISIBLE, '');

export const noteContentLength = (note: string): number => stripInvisible(note).replace(/\s/g, '').length;
