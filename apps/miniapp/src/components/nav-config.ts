import { Gift, Home, LayoutGrid, ScanLine, User, type LucideIcon } from 'lucide-react';
import { NAV_TAB_SPECS, type NavTabId, type NavTabSpec } from '@tubutree/app-core/home-layout';

/**
 * Nguồn DUY NHẤT cho tab bar + danh sách trang gốc (spec §3.5). Nhãn, thứ tự, huy hiệu lấy từ app-core (`NAV_TAB_SPECS`,
 * cùng bộ với web); ở đây chỉ gắn biểu tượng và đường dẫn Mini App.
 * Phương án A: tab "Ưu đãi" thay "Đơn hàng". Đơn hàng nằm ở hàng trạng thái đầu trang Cá nhân; /orders vẫn là trang con.
 * Tab giữa là "Quét mã" (tích điểm đơn sàn, W42); Vườn Xanh (/game) thành trang con, lối vào là thẻ chính ở Trang chủ và thẻ ở Ưu đãi.
 */
export interface NavTab extends NavTabSpec {
  path: string;
  Icon: LucideIcon;
}

const NAV_VISUALS: Record<NavTabId, { path: string; Icon: LucideIcon }> = {
  home: { path: '/', Icon: Home },
  browse: { path: '/browse', Icon: LayoutGrid },
  scan: { path: '/points/scan', Icon: ScanLine },
  offers: { path: '/offers', Icon: Gift },
  profile: { path: '/profile', Icon: User },
};

export const NAV_TABS: readonly NavTab[] = NAV_TAB_SPECS.map((t) => ({ ...t, ...NAV_VISUALS[t.id] }));

export const ROOT_PATHS: readonly string[] = NAV_TABS.map((t) => t.path);

export function isRootPath(pathname: string): boolean {
  return ROOT_PATHS.includes(pathname);
}

/**
 * Tab gốc vẫn có lối vào bằng PUSH từ trang con: dòng "Tích điểm đơn sàn" trong popup "Cách tính Điểm Xanh" ở trang sản phẩm mở `/points/scan`
 * kèm `state.from`. Khách vào kiểu đó cần nút lùi về đúng trang sản phẩm; vào bằng thanh đáy, mở nguội hay deep link thì vẫn là tab gốc, không nút.
 */
const BACKABLE_ROOT_PATHS: readonly string[] = ['/points/scan'];

/**
 * Tab gốc này có hiện nút lùi không: chỉ khi là `/points/scan`, `state.from` là trang con (không phải tab gốc, không phải chính nó) và còn lịch
 * sử để lùi (`canPop`, truyền vào để file này không phụ thuộc `lib/smart-nav`). Không lịch sử thì lùi sẽ là thay trang, dễ thành vòng lùi giữa tab.
 */
export function isBackableRoot(pathname: string, state: unknown, canPop: () => boolean): boolean {
  if (!BACKABLE_ROOT_PATHS.includes(pathname)) return false;
  const from = state && typeof state === 'object' ? (state as { from?: unknown }).from : undefined;
  if (typeof from !== 'string') return false;
  const fromPath = from.split(/[?#]/)[0] ?? '';
  if (fromPath === '' || fromPath === pathname || isRootPath(fromPath)) return false;
  return canPop();
}
