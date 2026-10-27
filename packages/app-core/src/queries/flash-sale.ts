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
export const FLASH_REFETCH_MIN_MS = 5_000;

type FlashPollQuery = { state: { data?: readonly { endAt?: string }[] } };

/**
 * `refetchInterval` cho danh sách Giờ vàng đang chạy: không có suất thì không thêm request nào; có suất thì tải lại tối đa mỗi 60 giây
 * và sớm hơn, vào đúng mốc kết thúc gần nhất theo giờ `now` (tối thiểu 5 giây: phản hồi được cache tới 10 giây nên nhịp dày hơn chỉ lấy lại suất vừa hết), để thẻ bỏ giá Giờ vàng ngay khi đợt hết thay vì
 * chờ nhịp kế. Chỉ MỘT nơi trong mỗi app gắn hàm này (xem useFlashSalesPoller của Mini App); nơi khác chỉ đọc cache.
 */
export const makeFlashRefetchInterval =
  (now: () => number) =>
  (query: FlashPollQuery): number | false => {
    const items = query.state.data ?? [];
    if (items.length === 0) return false;
    const ends = items.map((i) => Date.parse(i.endAt ?? '')).filter((t) => Number.isFinite(t));
    if (ends.length === 0) return FLASH_REFETCH_MS;
    const untilNext = Math.min(...ends) - now();
    return Math.min(FLASH_REFETCH_MS, Math.max(FLASH_REFETCH_MIN_MS, untilNext));
  };
