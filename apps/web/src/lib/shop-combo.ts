'use client';

import { addCartItemsBatch } from '@tubutree/app-core/api/cart';
import { cartStorefrontSlug } from './cart-key';
import { coreHttp } from './core-http';

/**
 * "Thêm cả combo": một lệnh, máy chủ thêm tất cả hoặc không thêm món nào (một món hết hàng thì cả lô bị từ chối, giỏ không đổi).
 * Gian hàng CTV đang ghi công đi kèm để giỏ trừ đúng combo.
 */
export const addAllToCart = (items: { variationId: string; quantity: number }[]) =>
  addCartItemsBatch(coreHttp, items, 'ctv_sheet', cartStorefrontSlug());
