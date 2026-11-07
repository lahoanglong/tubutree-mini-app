'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cartUnitsByVariation, cartUnitsReady } from '@tubutree/app-core/commerce/reorder-notice';
import { useAuthPhase } from '@/lib/auth-phase';
import { useCartKey } from '@/lib/cart-key';
import { getCart } from '@/lib/shop-client';

/**
 * Số lượng từng biến thể đang có trong giỏ, cho sheet Mua lại: giỏ gộp số lượng rồi mới so với suất Giờ vàng, nên sheet cần biết
 * phần đã có sẵn để hiện đúng giá giỏ sẽ tính. Chỉ tải khi sheet mở (`enabled`).
 * `ready` = false trong lúc giỏ đang tải lần đầu: sheet khoá nút thêm thay vì tính như giỏ rỗng. Lỗi tải hoặc không tải giỏ
 * (chưa đăng nhập) thì `ready` = true và bảng rỗng (giữ luật cũ, không giữ khách chờ).
 */
export function useCartUnits(enabled: boolean): { units: ReadonlyMap<string, number>; ready: boolean } {
  const authed = useAuthPhase() === 'authenticated';
  const queryEnabled = enabled && authed;
  const { data, status, fetchStatus } = useQuery({ queryKey: useCartKey(), queryFn: getCart, enabled: queryEnabled });
  const items = data?.items;
  const units = useMemo(() => cartUnitsByVariation(items), [items]);
  return { units, ready: cartUnitsReady({ enabled: queryEnabled, status, fetchStatus }) };
}
