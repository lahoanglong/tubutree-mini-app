import { Gift, Home, LayoutGrid, ScanLine, User, type LucideIcon } from 'lucide-react';
import { NAV_TAB_SPECS, type NavTabId, type NavTabSpec } from '@tubutree/app-core/home-layout';
import { isWebRouteReady } from '@/lib/route-map';

/**
 * 5 mục gốc của web, cùng nhãn, thứ tự và huy hiệu với `apps/miniapp/src/components/nav-config.ts` (cả hai đọc `NAV_TAB_SPECS`
 * ở app-core); ở đây chỉ gắn biểu tượng và route web (route-map.json). Phương án A: "Ưu đãi" thay "Đơn hàng", đơn nằm ở hàng
 * trạng thái đầu trang Cá nhân. Tab giữa "Quét mã" (W42) mở `/quet-ma`; Vườn Xanh vẫn ở hàng điều hướng máy tính (`WEB_DESKTOP_NAV`).
 * Thanh đáy điện thoại và thanh đầu máy tính cùng đọc từ đây.
 */
export interface WebNavTab extends NavTabSpec {
  path: string;
  Icon: LucideIcon;
}

const WEB_VISUALS: Record<NavTabId, { path: string; Icon: LucideIcon }> = {
  home: { path: '/', Icon: Home },
  browse: { path: '/san-pham', Icon: LayoutGrid },
  scan: { path: '/quet-ma', Icon: ScanLine },
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
  { path: '/gio-vang', label: 'Giờ vàng' },
  { path: '/uu-dai?codes=all', label: 'Mã giảm giá' },
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

export interface WebDesktopNavItem {
  path: string;
  label: string;
  matchPrefixes: readonly string[];
  /** Chỉ hiện từ `lg` (1024px): ở 768px–1023px hàng 5 mục chính đã gần kín, mục thêm sẽ đẩy mục cuối ra ngoài màn. */
  wideOnly?: boolean;
}

/**
 * 5 mục điều hướng ổn định trên thanh đầu máy tính (W171): không cuộn ngang ở 768px–1440px,
 * không chờ `useWasteVisible()` chèn muộn gây nhảy bố cục sau hydrate. "Bộ quà tặng" là mục thứ 6, chỉ hiện từ `lg`
 * (dưới `lg` vẫn vào được từ chân trang và "Xem tất cả" của Combo tiết kiệm ở Trang chủ); mục có trong HTML từ khung đầu, ẩn bằng CSS.
 */
export const WEB_DESKTOP_NAV: readonly WebDesktopNavItem[] = [
  { path: '/san-pham', label: 'Sản phẩm', matchPrefixes: ['/san-pham'] },
  { path: '/bo-qua-tang', label: 'Bộ quà tặng', matchPrefixes: ['/bo-qua-tang'], wideOnly: true },
  { path: '/vuon-xanh', label: 'Vườn Xanh', matchPrefixes: ['/vuon-xanh'] },
  { path: '/doi-rac', label: 'Đổi rác & Kho quà', matchPrefixes: ['/doi-rac', '/kho-qua'] },
  { path: '/mua-chung', label: 'Mua chung & Xoay vòng', matchPrefixes: ['/mua-chung', '/uu-dai', '/gio-vang'] },
  { path: '/cau-chuyen', label: 'Hành trình nguyên liệu', matchPrefixes: ['/cau-chuyen'] },
];

export const isDesktopNavActive = (pathname: string | null | undefined, item: WebDesktopNavItem): boolean =>
  !!pathname && item.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Hàng điều hướng của thanh đầu máy tính: 5 trụ cột ổn định, không lặp "Trang chủ" (logo) và "Cá nhân" (nút tài khoản). */
export const readyDesktopNav = (_opts?: ProgramLinkOptions): WebDesktopNavItem[] =>
  WEB_DESKTOP_NAV.filter((t) => isWebRouteReady(t.path));
