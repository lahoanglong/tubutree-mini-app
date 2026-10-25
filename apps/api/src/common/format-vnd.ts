/** 1234567 → "1.234.567đ" (dấu chấm ngăn nghìn, như màn hình khách). */
export const formatVndText = (n: number): string => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}đ`;
