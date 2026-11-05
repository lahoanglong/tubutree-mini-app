/**
 * Mã sku biến thể mặc định của hàng đối tác: MCH-<mã thời gian base36 viết hoa>-<6 ký tự cuối của hậu tố viết hoa>. Hậu tố phải khác nhau giữa các
 * sản phẩm đăng cùng mili giây (số ngẫu nhiên khi đăng, hoặc id sản phẩm khi liên kết bổ sung) vì sku là unique.
 */
export function merchantSku(suffix: string, now: number = Date.now()): string {
  return `MCH-${now.toString(36).toUpperCase()}-${suffix.slice(-6).toUpperCase()}`;
}
