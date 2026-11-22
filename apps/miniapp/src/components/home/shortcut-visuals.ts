import { Gift, HeartHandshake, MessagesSquare, Package, Recycle, RefreshCw, ScanLine, ShoppingBasket, Sprout, Ticket, Users, Zap, type LucideIcon } from 'lucide-react';
import { offersTabHref } from '@tubutree/app-core/commerce/offers-hub';
import { liveRoute } from '@tubutree/app-core/merch/route-fallback';
import type { HomePillarId, HomeShortcutId } from '@tubutree/app-core/home-layout';

export const SHORTCUT_ICONS: Record<HomeShortcutId, LucideIcon> = {
  flash: Zap,
  orders: Package,
  rewards: Gift,
  recycle: Recycle,
  groupBuy: Users,
  coupons: Ticket,
  gifts: ShoppingBasket,
  claim: ScanLine,
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
 * Đích điều hướng của lối tắt; `null` = mở sheet thay vì sang trang (Kiếm tiền). Giờ vàng và Mã giảm giá đi qua `liveRoute` cùng nguồn với "Xem tất cả"
 * của khối tương ứng (Mã giảm giá: tab Săn mã của Ưu đãi, kho mã mở sẵn).
 */
export const SHORTCUT_ROUTES: Record<HomeShortcutId, string | null> = {
  flash: liveRoute('/flash-sale', 'mini'),
  orders: '/orders',
  rewards: offersTabHref('/offers', 'rewards'),
  recycle: '/recycle',
  groupBuy: '/group-buy',
  coupons: liveRoute('/vouchers', 'mini'),
  gifts: liveRoute('/gift-combos', 'mini'),
  claim: '/points/scan',
  earn: null,
  community: '/feed',
};
