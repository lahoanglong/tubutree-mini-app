import type { ProductDetail } from '../services/shop-api';

/**
 * Hàng chỉ bán giá lẻ, không đặt định kỳ và không mua chung: gian hàng tự giao hoặc đang tạm nghỉ/ngừng bán (D4, R3-MERCHANT-3),
 * hay hàng của gian hàng đối tác kể cả khi Tubu giao hộ (Q8 S2). Trang sản phẩm và màn đặt hàng thành công dùng chung một luật để
 * không mời khách đặt định kỳ món mà máy chủ sẽ từ chối (PARTNER_GOODS_NOT_ELIGIBLE).
 */
export function isRetailOnly(p: Pick<ProductDetail, 'fulfiller' | 'partnerOwned'>): boolean {
  return p.fulfiller?.kind === 'MERCHANT' || p.fulfiller?.kind === 'UNAVAILABLE' || p.partnerOwned === true;
}
