const MIN_CUSTOMER_SEARCH_LENGTH = 3;

/**
 * Câu gợi ý khi ô tìm đổi/trả hoặc hoàn tiền không ra gì. Máy chủ chỉ tìm theo khách khi chuỗi từ 3 ký tự, bỏ nhánh này nếu
 * chuỗi khớp quá nhiều khách, và với người bị che SĐT chỉ khớp đúng 10 số, nên "không khớp" dễ bị hiểu nhầm là chưa có dữ liệu.
 */
export function searchEmptyHint(search: string, opts: { phoneMasked: boolean }): string | null {
  const s = search.trim().replace(/^#+\s*/, '');
  if (!s) return null;
  const digits = s.replace(/[\s.\-()]/g, '').replace(/^\+/, '');
  if (/^\d+$/.test(digits) && opts.phoneMasked && digits.length < 10) return 'Gõ đủ 10 số SĐT để tìm theo khách.';
  if (s.length < MIN_CUSTOMER_SEARCH_LENGTH) return 'Gõ ít nhất 3 ký tự để tìm theo khách.';
  if (!/\d/.test(s)) return 'Nếu tên quá phổ biến, gõ họ tên đầy đủ hơn.';
  return null;
}
