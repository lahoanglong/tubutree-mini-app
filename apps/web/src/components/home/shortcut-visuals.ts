import { Gift, HeartHandshake, MessagesSquare, Package, Recycle, ScanLine, Ticket, Users, Zap, type LucideIcon } from 'lucide-react';
import { liveRoute } from '@tubutree/app-core/merch/route-fallback';
import type { HomeShortcutId } from '@tubutree/app-core/home-layout';

export const SHORTCUT_ICONS: Record<HomeShortcutId, LucideIcon> = {
  flash: Zap,
  orders: Package,
  rewards: Gift,
  recycle: Recycle,
  groupBuy: Users,
  coupons: Ticket,
  claim: ScanLine,
  earn: HeartHandshake,
  community: MessagesSquare,
};

/**
 * Đích điều hướng của lối tắt; `null` = mở sheet thay vì sang trang (Kiếm tiền). Đích là route web trong route-map; route chưa làm xong (pending)
 * thì lối tắt ẩn. Giờ vàng đi qua `liveRoute` vì trang `/gio-vang` thuộc gói sau.
 */
export const SHORTCUT_ROUTES: Record<HomeShortcutId, string | null> = {
  flash: liveRoute('/flash-sale', 'web'),
  orders: '/tai-khoan/don-hang',
  rewards: '/kho-qua',
  recycle: '/doi-rac',
  groupBuy: '/mua-chung',
  coupons: '/uu-dai?section=coupons',
  claim: '/points/scan',
  earn: null,
  community: '/cong-dong',
};
