import { useEffect, useState } from 'react';
import { serverNow } from '../utils/server-clock';

/** setTimeout lớn hơn 2^31-1 ms chạy ngay; Giờ vàng không dài cỡ đó nhưng hạn lạ không được làm vòng lặp. */
const MAX_DELAY = 2_147_483_647;

/**
 * Vẽ lại thẻ đúng mốc `endAt` của suất Giờ vàng đang áp, để thẻ bỏ giá Giờ vàng khi khách còn đang xem thay vì chờ lần tải lại danh sách
 * (poll 60 giây). Không hạn, hạn đã qua hoặc không đọc được thì không hẹn gì. Tính theo giờ máy chủ như `cardPricing`.
 */
export function useFlashExpiry(endAt: string | undefined): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!endAt) return;
    const wait = Date.parse(endAt) - serverNow();
    if (!Number.isFinite(wait) || wait <= 0) return;
    // +50ms: đúng mốc thì `end > now` còn sai, vẽ lại phải rơi vào SAU mốc.
    const id = setTimeout(() => setTick((n) => n + 1), Math.min(wait + 50, MAX_DELAY));
    return () => clearTimeout(id);
  }, [endAt]);
}

/**
 * Như `useFlashExpiry` cho cả danh sách suất (trang Yêu thích đếm "Đang giảm" theo Giờ vàng): vẽ lại đúng mốc kết thúc SỚM NHẤT còn ở phía trước. Danh sách
 * từ truy vấn có thể còn suất đã quá hạn, nên bỏ qua chúng; suất đó hết thì vẽ lại tính mốc kế.
 */
export function useFlashListExpiry(list: readonly { endAt?: string }[]): void {
  const now = serverNow();
  let soonest: string | undefined;
  let soonestMs = Infinity;
  for (const f of list) {
    const ms = f.endAt ? Date.parse(f.endAt) : NaN;
    if (Number.isFinite(ms) && ms > now && ms < soonestMs) {
      soonestMs = ms;
      soonest = f.endAt;
    }
  }
  useFlashExpiry(soonest);
}
