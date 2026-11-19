'use client';

import { usePathname } from 'next/navigation';
import { HUB } from './browse-hub-route';
import { GUEST_PREBUILT_ORIGINS } from './guest-prebuilt';
import { BROWSE_PATH } from './search-state';

/** Bản Trang chủ dựng sẵn cho khách có cookie phiên (app/khoi-phuc/[hint]) hiện ở URL "/" nhưng server dựng theo đường dẫn của trang. */
const PREBUILT_HOME = /^\/khoi-phuc\/[^/]+$/;

/**
 * Đường dẫn dùng cho vỏ trang (thanh đáy, nút quay lại, tiêu đề): bản dựng sẵn của Trang chủ tính là "/", bản tĩnh của hub Danh mục
 * (app/hub-san-pham) tính là "/san-pham", bản dựng sẵn cho khách của Giỏ hàng và Vườn Xanh (`/gio-hang/khach`, `/vuon-xanh/khach`, xem
 * lib/guest-prebuilt.ts) tính là đường dẫn thật, để HTML server khớp lần hydrate và URL ghi lại vẫn là đường dẫn thật.
 */
export function shellPath<T extends string | null>(pathname: T): T | string {
  if (pathname === null) return pathname;
  if (PREBUILT_HOME.test(pathname)) return '/';
  if (pathname === HUB) return BROWSE_PATH;
  return GUEST_PREBUILT_ORIGINS[pathname] ?? pathname;
}

export function useShellPathname(): string {
  return shellPath(usePathname());
}
