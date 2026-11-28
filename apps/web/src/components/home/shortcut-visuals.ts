import { Gift, HeartHandshake, MessagesSquare, Recycle, RefreshCw, ShoppingBasket, Sprout, Ticket, Users, Zap, type LucideIcon } from 'lucide-react';
import { liveRoute } from '@tubutree/app-core/merch/route-fallback';
import type { HomePillarId, HomeShortcutId } from '@tubutree/app-core/home-layout';

export const SHORTCUT_ICONS: Record<HomeShortcutId, LucideIcon> = {
  coupons: Ticket,
  gifts: ShoppingBasket,
  earn: HeartHandshake,
  community: MessagesSquare,
};

export const PILLAR_ICONS: Record<HomePillarId, LucideIcon> = {
  retail: Zap,
  recycle: Recycle,
  groupBuy: Users,
  subscription: RefreshCw,
  garden: Sprout,
  rewards: Gift,
};

/**
 * Đích điều hướng của lối tắt phụ; `null` = mở sheet thay vì sang trang (Kiếm tiền). Đích là route web trong route-map; route chưa làm xong (pending)
 * thì lối tắt ẩn. Mã giảm giá và Bộ quà tặng đi qua `liveRoute` cùng nguồn với "Xem tất cả" của khối tương ứng (Mã giảm giá: tab Săn mã của Ưu đãi, kho mã mở sẵn).
 */
export const SHORTCUT_ROUTES: Record<HomeShortcutId, string | null> = {
  coupons: liveRoute('/vouchers', 'web'),
  gifts: liveRoute('/gift-combos', 'web'),
  earn: null,
  community: '/cong-dong',
};
