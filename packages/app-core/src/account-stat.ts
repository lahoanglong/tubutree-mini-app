/**
 * Cỡ chữ của số trong ô thống kê trang Cá nhân (Điểm Xanh, Ví Tubu, Mã giảm giá). Ba ô chia đều bề ngang nên ở 320px mỗi ô rộng 93px,
 * trừ đệm còn 85px chữ. Inter 600 số tabular rộng chừng 0,58em mỗi ký tự (đo trong trình duyệt, E2E account-stat-320), nên chọn cỡ
 * theo độ dài CẢ chuỗi: "1.000 điểm" ở 16px dài ~90px và gãy "điểm" xuống dòng; "10.000.000đ" ở 14px dài ~89px và tràn khỏi ô.
 * - tới 8 ký tự ("999.999đ", "999 điểm"): price-md 16px
 * - 9–10 ký tự ("1.000 điểm", "9.999.999đ"): price-sm 14px (~81px)
 * - từ 11 ký tự ("99.999 điểm", "100.000.000đ"): label 12px (tới 12 ký tự ~83px, vẫn cách mép ô quá phần đệm)
 */
export type StatValueVariant = 'price-md' | 'price-sm' | 'label';

const MD_MAX = 8;
const SM_MAX = 10;

export function statValueVariant(value: string): StatValueVariant {
  const length = Array.from(value.trim()).length;
  if (length <= MD_MAX) return 'price-md';
  return length <= SM_MAX ? 'price-sm' : 'label';
}

/**
 * Cỡ label 12px khít chữ lại 0,02em (~3px với 12 ký tự): "100.000.000đ" và "999.999 điểm" cách mép ô hơn 6px thay vì chưa tới 5px.
 * Hai cỡ lớn hơn đã đủ chỗ nên giữ khoảng chữ gốc.
 */
export function statValueTracking(variant: StatValueVariant): string | undefined {
  return variant === 'label' ? '-0.02em' : undefined;
}

/**
 * Chiều cao dòng cố định bằng dòng price-md (22px) cho mọi cỡ: số nhỏ hơn vẫn cùng hàng với ô bên cạnh, nhãn dưới số thẳng hàng.
 * Kèm `overflow-wrap: anywhere` ở app để số quá dài (ví từ một tỷ) xuống dòng trong ô thay vì tràn ngang trang.
 */
export const STAT_VALUE_LINE_HEIGHT = 'calc(var(--type-price-md-size) * var(--type-price-md-lh))';
