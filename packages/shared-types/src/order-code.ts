/**
 * Khuôn mã đơn Tubu. Mã mới là mã ngắn: tiền tố 2 chữ theo loại đơn (TB bán lẻ, DL đại lý, TS định kỳ) + 4 ký tự (5 khi 4 ký tự
 * trùng nhiều lần), lấy từ bảng 32 ký tự bỏ 0/1/I/O để đọc qua điện thoại không nhầm. Mã dài cũ (TUBU…, TUBUSUB…, DLR… + số) vẫn
 * nằm trên đơn, hoá đơn, Pancake và tin nhắn đã gửi, nên mọi chỗ đọc mã phải nhận cả hai dạng.
 */

/** 32 ký tự in hoa, không có 0, 1, I, O. Đúng 32 nên `randomInt(0, 32)` chọn đều, không lệch ký tự nào. */
export const ORDER_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Mã ngắn: TB/DL/TS + 4 hoặc 5 ký tự của ORDER_CODE_ALPHABET. */
export const SHORT_ORDER_CODE_RE = /^(?:TB|DL|TS)[2-9A-HJ-NP-Z]{4,5}$/;

/** Mã dài cũ: TUBU + ngày + số, TUBUSUB + số, DLR + số. */
export const LEGACY_ORDER_CODE_RE = /^(?:TUBUSUB|TUBU|DLR)\d+$/;

/** Mã đơn Tubu, dạng cũ hoặc dạng ngắn. */
export const ANY_TUBU_ORDER_CODE_RE = /^(?:(?:TUBUSUB|TUBU|DLR)\d+|(?:TB|DL|TS)[2-9A-HJ-NP-Z]{4,5})$/;

/**
 * "Order code: <mã>" do Tubu ghi đầu ghi chú đơn Pancake. Ký tự ngay sau mã không được là chữ hoa hay số: mã ngắn có chữ ở giữa
 * (TB7K4M) nên khuôn kiểu "chữ rồi số" sẽ cắt còn TB7, và mã dài thừa chữ phía sau không phải mã của ta.
 */
export const NOTE_ORDER_CODE_RE = /Order code:\s*((?:TUBUSUB|TUBU|DLR)\d+|(?:TB|DL|TS)[2-9A-HJ-NP-Z]{4,5})(?![A-Z0-9])/;
