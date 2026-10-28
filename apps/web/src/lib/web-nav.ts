import { Gift, Home, LayoutGrid, Sprout, User, type LucideIcon } from 'lucide-react';
import { NAV_TAB_SPECS, type NavTabId, type NavTabSpec } from '@tubutree/app-core/home-layout';
import { isWebRouteReady } from '@/lib/route-map';

/**
 * 5 mục gốc của web, cùng nhãn, thứ tự và huy hiệu với `apps/miniapp/src/components/nav-config.ts` (cả hai đọc `NAV_TAB_SPECS`
 * ở app-core); ở đây chỉ gắn biểu tượng và route web (route-map.json). Phương án A: "Ưu đãi" thay "Đơn hàng", đơn nằm ở hàng
 * trạng thái đầu trang Cá nhân. Thanh đáy điện thoại và thanh đầu máy tính cùng đọc từ đây.
 */
export interface WebNavTab extends NavTabSpec {
  path: string;
  Icon: LucideIcon;
}

const WEB_VISUALS: Record<NavTabId, { path: string; Icon: LucideIcon }> = {
  home: { path: '/', Icon: Home },
  browse: { path: '/san-pham', Icon: LayoutGrid },
  garden: { path: '/vuon-xanh', Icon: Sprout },
  offers: { path: '/uu-dai', Icon: Gift },
  profile: { path: '/tai-khoan', Icon: User },
};

export const WEB_NAV_TABS: readonly WebNavTab[] = NAV_TAB_SPECS.map((t) => ({ ...t, ...WEB_VISUALS[t.id] }));

export const WEB_ROOT_PATHS: readonly string[] = WEB_NAV_TABS.map((t) => t.path);

export const isWebRootPath = (pathname: string | null | undefined): boolean => !!pathname && WEB_ROOT_PATHS.includes(pathname);

/** Mục có route web đã xong; route còn `pending` trong route-map thì ẩn để khách không bấm vào trang chưa có. */
export const readyNavTabs = (): WebNavTab[] => WEB_NAV_TABS.filter((t) => isWebRouteReady(t.path));

/**
 * Chức năng không nằm trên thanh đáy điện thoại nhưng khách máy tính cần thấy ngay ở thanh đầu và chân trang (trước đây bị giấu).
 * Cũng lọc theo route-map: route web chưa xong thì ẩn.
 */
export const WEB_PROGRAM_LINKS: readonly { path: string; label: string }[] = [
  { path: '/doi-rac', label: 'Đổi rác lấy quà' },
  { path: '/kho-qua', label: 'Kho quà' },
  { path: '/mua-chung', label: 'Mua chung' },
  { path: '/cong-dong', label: 'Cộng đồng' },
];

export interface ProgramLinkOptions {
  /** Chương trình Đổi rác đang bật, hoặc khách còn yêu cầu đang mở khi đã tạm dừng. Chưa biết (cấu hình chưa tải) thì false. */
  wasteVisible: boolean;
}

export const readyProgramLinks = ({ wasteVisible }: ProgramLinkOptions) =>
  WEB_PROGRAM_LINKS.filter((l) => isWebRouteReady(l.path) && (l.path !== '/doi-rac' || wasteVisible));

/** Hàng điều hướng của thanh đầu máy tính: không lặp "Trang chủ" (logo) và "Cá nhân" (nút tài khoản). */
export const readyDesktopNav = (opts: ProgramLinkOptions): { path: string; label: string }[] => [
  ...readyNavTabs().filter((t) => t.id !== 'home' && t.id !== 'profile'),
  ...readyProgramLinks(opts),
];
