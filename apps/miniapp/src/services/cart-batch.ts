import { addCartItemsBatch } from '@tubutree/app-core/api/cart';
import type { CartSummary } from './shop-api';
import { cartStorefrontSlug } from './cart-key';
import { coreHttp } from './core-http';

/**
 * "Thêm cả combo": một lệnh, máy chủ thêm tất cả hoặc không thêm món nào (một món hết hàng thì cả lô bị từ chối, giỏ không đổi).
 * Nguồn `ctv_sheet` là nguồn thêm giỏ từ trang gian hàng; gian hàng đang ghi công đi kèm để giỏ trừ đúng combo.
 */
export const addAllToCart = (items: { variationId: string; quantity: number }[]): Promise<CartSummary> =>
  addCartItemsBatch(coreHttp, items, 'ctv_sheet', cartStorefrontSlug()) as Promise<CartSummary>;
