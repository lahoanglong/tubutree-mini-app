import { createContext, useContext, useSyncExternalStore } from 'react';
import { serverNow } from '@tubutree/app-core/server-clock';
import type { FlashItem } from '@/lib/flash-price';

/** Danh sách Giờ vàng do server gieo cho trang ISR cùng giờ lúc server dựng HTML (xem `FlashSalesSeed` ở use-flash-sales.ts). */
export const ServerSeed = createContext<{ items: readonly FlashItem[]; now: number } | null>(null);

const subscribeNever = () => () => undefined;

/**
 * "Bây giờ" để lọc đợt Giờ vàng đang chạy. Dưới trang có gieo sẵn, lần dựng hydrate dùng giờ server lúc dựng HTML (đợt hết giữa lúc dựng và lúc tải vẫn hiện
 * như HTML, không lệch hydrate); ngay sau đó chuyển sang giờ máy chủ đã đồng bộ, đợt đã hết thì biến mất một lần. Trang không gieo luôn dùng giờ đồng bộ.
 * Mọi chỗ đọc danh sách gieo (thanh Giờ vàng, giá, thẻ sản phẩm) phải dùng cùng mốc này.
 */
export function useFlashNow(): number {
  const seed = useContext(ServerSeed);
  const settled = useSyncExternalStore(subscribeNever, () => true, () => false);
  return seed && !settled ? seed.now : serverNow();
}
