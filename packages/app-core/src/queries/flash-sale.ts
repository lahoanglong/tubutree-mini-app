import type { HttpClient } from '../http';
import { fetchActiveFlashSales, fetchUpcomingFlashSales } from '../api/flash-sale';

export const flashActiveQuery = (http: HttpClient) => ({
  queryKey: ['flash-sales', 'active'] as const,
  queryFn: () => fetchActiveFlashSales(http),
});
export const flashUpcomingQuery = (http: HttpClient) => ({
  queryKey: ['flash-sales', 'upcoming'] as const,
  queryFn: () => fetchUpcomingFlashSales(http),
});

export const FLASH_REFETCH_MS = 60_000;

/**
 * `refetchInterval` cho thẻ sản phẩm dùng danh sách Giờ vàng đang chạy: chỉ tải lại khi đang có suất (để thẻ bỏ giá Giờ vàng khi
 * đợt hết), không có suất thì không thêm request nào.
 */
export const flashRefetchInterval = (query: { state: { data?: readonly unknown[] } }): number | false =>
  (query.state.data?.length ?? 0) > 0 ? FLASH_REFETCH_MS : false;
