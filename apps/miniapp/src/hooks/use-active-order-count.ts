import { useQuery } from '@tanstack/react-query';
import { fetchActiveOrderCount } from '../services/shop-api';
import { useAuthStore } from '../store/auth';

/** Khoá nằm dưới tiền tố ['orders'] → mọi invalidateQueries({ queryKey: ['orders'] }) sẵn có
 * (đặt đơn, huỷ đơn) làm mới luôn badge. */
export const ACTIVE_ORDER_COUNT_KEY = ['orders', 'active-count'] as const;

/** Số đơn đang xử lý cho badge tab. `enabled` = đang ở trang gốc (tab bar hiện). API cũ 404 → 0. */
export function useActiveOrderCount(enabled: boolean): number {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  const q = useQuery({
    queryKey: ACTIVE_ORDER_COUNT_KEY,
    queryFn: fetchActiveOrderCount,
    enabled: enabled && authed,
    staleTime: 30_000,
    retry: false,
  });
  return q.data ?? 0;
}
