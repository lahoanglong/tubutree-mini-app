import { DEFAULT_VARIATION_LABEL, variationLabel } from '@/lib/variation-label';

/**
 * " (nhãn)" đặt sau tên sản phẩm trên màn Thương nhân, rỗng khi không có nhãn để hiện (tên phân loại trống hoặc chỉ là "[object Object]" thì không để lại "()" treo).
 * `hideDefault`: bỏ luôn "Mặc định", dùng ở danh sách hàng cần gửi vì sản phẩm một phân loại không có gì để phân biệt.
 */
export function variationParen(name: string | null | undefined, hideDefault = false): string {
  const label = variationLabel(name);
  if (!label || (hideDefault && label === DEFAULT_VARIATION_LABEL)) return '';
  return ` (${label})`;
}
