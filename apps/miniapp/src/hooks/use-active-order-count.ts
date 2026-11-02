import { useMeSummary } from './use-me-summary';

/** Số đơn đang xử lý cho badge tab, lấy từ /me/summary (cùng nguồn với số trên Cá nhân). `enabled` = đang ở trang gốc (tab bar hiện). */
export function useActiveOrderCount(enabled: boolean): number {
  return useMeSummary({ enabled, select: (s) => s.orders.active, staleTime: 30_000 }).data ?? 0;
}
