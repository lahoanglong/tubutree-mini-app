import { useQuery } from '@tanstack/react-query';
import { makeFlashRefetchInterval } from '@tubutree/app-core/queries/flash-sale';
import { fetchActiveFlashSales } from '../services/shop-api';
import { serverNow } from '../utils/server-clock';

/**
 * Chủ duy nhất của nhịp tải lại danh sách Giờ vàng đang chạy (queryKey dùng chung với thẻ, dải Giờ vàng, trang chi tiết): gắn một lần
 * ở gốc app. Mọi nơi khác chỉ đọc cache cùng key, không tự đặt refetchInterval, để số request không nhân theo số thẻ/trang đang mở.
 */
export function useFlashSalesPoller(): void {
  useQuery({
    queryKey: ['flash-sales', 'active'],
    queryFn: fetchActiveFlashSales,
    staleTime: 30_000,
    refetchInterval: makeFlashRefetchInterval(serverNow),
  });
}
