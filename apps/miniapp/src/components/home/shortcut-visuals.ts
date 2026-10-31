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

/** Đích điều hướng của lối tắt; `null` = mở sheet thay vì sang trang (Kiếm tiền). Giờ vàng đi qua `liveRoute` cùng nguồn với "Xem tất cả" của khối Giờ vàng. */
export const SHORTCUT_ROUTES: Record<HomeShortcutId, string | null> = {
  flash: liveRoute('/flash-sale', 'mini'),
  orders: '/orders',
  rewards: '/rewards',
  recycle: '/recycle',
  groupBuy: '/group-buy',
  coupons: '/offers?section=coupons',
  claim: '/points/scan',
  earn: null,
  community: '/feed',
};
