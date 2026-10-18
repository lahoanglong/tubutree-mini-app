import { Home, LayoutGrid, Package, Sprout, User, type LucideIcon } from 'lucide-react';
import { isWebRouteReady } from '@/lib/route-map';

/**
 * 5 mục gốc của web, cùng nhãn, icon và thứ tự với `apps/miniapp/src/components/nav-config.ts`
 * (đường dẫn là route web tương ứng trong route-map.json). Thanh đáy điện thoại và thanh đầu máy tính cùng đọc từ đây.
 */
export interface WebNavTab {
  path: string;
  label: string;
  Icon: LucideIcon;
  center?: boolean;
  badge?: 'active-orders';
}

export const WEB_NAV_TABS: readonly WebNavTab[] = [
  { path: '/', label: 'Trang chủ', Icon: Home },
  { path: '/san-pham', label: 'Danh mục', Icon: LayoutGrid },
  { path: '/vuon-xanh', label: 'Vườn Xanh', Icon: Sprout, center: true },
  { path: '/tai-khoan/don-hang', label: 'Đơn hàng', Icon: Package, badge: 'active-orders' },
  { path: '/tai-khoan', label: 'Cá nhân', Icon: User },
];

export const WEB_ROOT_PATHS: readonly string[] = WEB_NAV_TABS.map((t) => t.path);

export const isWebRootPath = (pathname: string | null | undefined): boolean => !!pathname && WEB_ROOT_PATHS.includes(pathname);

/** Mục có route web đã xong; route còn `pending` trong route-map thì ẩn để khách không bấm vào trang chưa có. */
export const readyNavTabs = (): WebNavTab[] => WEB_NAV_TABS.filter((t) => isWebRouteReady(t.path));
