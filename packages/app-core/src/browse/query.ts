/** Độ dài tối đa của từ khoá tìm (API từ chối trên 100 ký tự). */
export const MAX_QUERY_LENGTH = 100;

/**
 * Cắt từ khoá theo điểm mã, không theo đơn vị UTF-16: `slice` có thể bỏ lại nửa cặp thay thế của emoji ở ký tự 100, khiến
 * `encodeURIComponent` ném lỗi và truy vấn không được gửi.
 */
export function clipQuery(q: string, max = MAX_QUERY_LENGTH): string {
  const chars = Array.from(q);
  return chars.length > max ? chars.slice(0, max).join('') : q;
}

/** Link sai kiểu `minPrice=500000&maxPrice=100000`: đổi chỗ như API (`priceRange`), để chip giá và danh sách nói cùng một khoảng. */
export function orderedPriceBounds(min?: number, max?: number): { minPrice?: number; maxPrice?: number } {
  return min != null && max != null && min > max ? { minPrice: max, maxPrice: min } : { minPrice: min, maxPrice: max };
}
