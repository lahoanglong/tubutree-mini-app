import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cartUnitsByVariation } from '@tubutree/app-core/commerce/reorder-notice';
import { getCart } from '../services/shop-api';
import { useAuthStore } from '../store/auth';
import { useCartKey } from '../services/cart-key';

/**
 * Số lượng từng biến thể đang có trong giỏ, cho sheet Mua lại: giỏ gộp số lượng rồi mới so với suất Giờ vàng, nên sheet cần biết
 * phần đã có sẵn để hiện đúng giá giỏ sẽ tính. Chỉ tải khi sheet mở (`enabled`); chưa tải xong hoặc lỗi thì bảng rỗng (giữ luật cũ).
 */
export function useCartUnits(enabled: boolean): ReadonlyMap<string, number> {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const items = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: enabled && authed }).data?.items;
  return useMemo(() => cartUnitsByVariation(items), [items]);
}
