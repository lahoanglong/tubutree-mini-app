import { Home, LayoutGrid, Package, Sprout, User, type LucideIcon } from 'lucide-react';

/**
 * Nguồn DUY NHẤT cho tab bar + danh sách trang gốc (spec §3.5). Trước đây ROOTS chép tay ở
 * back-button.tsx và bottom-nav.tsx — đổi một chỗ quên chỗ kia là nút back hiện trên trang gốc.
 * Tab "Đơn hàng" thay "Ví & HH" (4a.1): Ví chuyển vào Cá nhân.
 */
export interface NavTab {
  path: string;
  label: string;
  Icon: LucideIcon;
  center?: boolean;
  badge?: 'active-orders';
}

export const NAV_TABS: readonly NavTab[] = [
  { path: '/', label: 'Trang chủ', Icon: Home },
  { path: '/browse', label: 'Danh mục', Icon: LayoutGrid },
  { path: '/game', label: 'Vườn Xanh', Icon: Sprout, center: true },
  { path: '/orders', label: 'Đơn hàng', Icon: Package, badge: 'active-orders' },
  { path: '/profile', label: 'Cá nhân', Icon: User },
];

export const ROOT_PATHS: readonly string[] = NAV_TABS.map((t) => t.path);

export function isRootPath(pathname: string): boolean {
  return ROOT_PATHS.includes(pathname);
}
