/** 1234567 → "1.234.567" (dấu chấm ngăn nghìn, không phụ thuộc ICU của máy). Dùng cho biến mẫu tin mà lời mẫu đã có sẵn chữ "đ". */
export const formatVndDigits = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** 1234567 → "1.234.567đ" (dấu chấm ngăn nghìn, như màn hình khách). */
export const formatVndText = (n: number): string => `${formatVndDigits(n)}đ`;
