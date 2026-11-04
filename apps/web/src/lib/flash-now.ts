import { createContext, useContext, useSyncExternalStore } from 'react';
import { serverNow } from '@tubutree/app-core/server-clock';
import type { FlashItem } from '@/lib/flash-price';

/** Danh sách Giờ vàng do server gieo cho trang ISR cùng giờ lúc server dựng HTML (xem `FlashSalesSeed` ở use-flash-sales.ts). */
export const ServerSeed = createContext<{ items: readonly FlashItem[]; now: number } | null>(null);

const subscribeNever = () => () => undefined;

// Lần `/flash-sales/active` đầu tiên của trình duyệt đã xong: độ lệch đồng hồ máy chủ đã đo (nếu API trả `serverNow`), từ đây `serverNow()` mới đáng tin.
let clockSynced = false;
const syncListeners = new Set<() => void>();
export function markFlashClockSynced(): void {
  if (clockSynced) return;
  clockSynced = true;
  syncListeners.forEach((l) => l());
}
/** Chỉ cho test. */
export function resetFlashClockSynced(): void {
  clockSynced = false;
}
const subscribeSynced = (cb: () => void) => {
  syncListeners.add(cb);
  return () => syncListeners.delete(cb);
};

// Mốc đồng hồ đơn điệu lúc nạp mã (gần lúc hydrate): `performance.now()` không phụ thuộc đồng hồ treo tường của điện thoại.
const loadedAt = typeof performance !== 'undefined' ? performance.now() : 0;

/**
 * "Bây giờ" để lọc đợt Giờ vàng đang chạy; mọi chỗ đọc danh sách gieo (thanh Giờ vàng, giá, thẻ sản phẩm) phải dùng cùng mốc này. Trang không gieo luôn dùng `serverNow()`.
 * Dưới trang có gieo sẵn:
 * - Lần dựng hydrate dùng giờ server lúc dựng HTML: đợt hết giữa lúc dựng và lúc tải vẫn hiện như HTML, không lệch hydrate.
 * - Sau mount, TRƯỚC khi lần `/flash-sales/active` đầu tiên xong: giờ dựng HTML cộng thời gian trôi qua theo đồng hồ đơn điệu (`performance.now()`). Lúc này `serverNow()` chưa
 *   biết độ lệch nên bằng đồng hồ điện thoại; máy chạy NHANH sẽ giấu một đợt còn chạy rồi hiện lại khi đồng bộ (giá nhảy hai lần), máy chạy CHẬM thì còn thấy giá của đợt đã hết
 *   thêm một vòng mạng. Đồng hồ đơn điệu tránh cả hai; chỗ sai (HTML cũ tới 60 giây nên đợt hết trong khoảng đó còn hiện) chỉ là hiển thị và được lần hỏi đầu sửa ngay,
 *   còn giỏ và đơn do máy chủ tính giá từ DB.
 * - Sau khi đã đồng bộ: `serverNow()`.
 */
export function useFlashNow(): number {
  const seed = useContext(ServerSeed);
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const synced = useSyncExternalStore(subscribeSynced, () => clockSynced, () => false);
  if (!seed) return serverNow();
  if (!mounted) return seed.now;
  return synced ? serverNow() : seed.now + (performance.now() - loadedAt);
}
