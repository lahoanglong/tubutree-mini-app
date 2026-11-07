'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cartUnitsByVariation } from '@tubutree/app-core/commerce/reorder-notice';
import { useAuthPhase } from '@/lib/auth-phase';
import { useCartKey } from '@/lib/cart-key';
import { getCart } from '@/lib/shop-client';

/**
 * Số lượng từng biến thể đang có trong giỏ, cho sheet Mua lại: giỏ gộp số lượng rồi mới so với suất Giờ vàng, nên sheet cần biết
 * phần đã có sẵn để hiện đúng giá giỏ sẽ tính. Chỉ tải khi sheet mở (`enabled`); chưa tải xong hoặc lỗi thì bảng rỗng (giữ luật cũ).
 */
export function useCartUnits(enabled: boolean): ReadonlyMap<string, number> {
  const authed = useAuthPhase() === 'authenticated';
  const items = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: enabled && authed }).data?.items;
  return useMemo(() => cartUnitsByVariation(items), [items]);
}
