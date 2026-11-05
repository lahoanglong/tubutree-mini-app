/**
 * Cỡ chữ của số trong ô thống kê trang Cá nhân (Điểm Xanh, Ví Tubu, Mã giảm giá). Ba ô chia đều bề ngang nên ở 320px mỗi ô chỉ còn 85px chữ.
 * Số có từ 10 ký tự liền nhau (vd "1.234.567đ", ví từ một triệu) không có chỗ ngắt dòng và tràn khỏi ô ở cỡ price-md, nên xuống price-sm.
 * Chỉ tính từ dài nhất: "1.234.567 điểm" tự xuống dòng ở khoảng trắng nên giữ price-md.
 */
export type StatValueVariant = 'price-md' | 'price-sm';

const LONG_WORD = 10;

export function statValueVariant(value: string): StatValueVariant {
  const longest = value.split(/\s+/).reduce((max, word) => Math.max(max, word.length), 0);
  return longest >= LONG_WORD ? 'price-sm' : 'price-md';
}
