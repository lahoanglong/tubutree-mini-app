'use client';

import { usePathname } from 'next/navigation';

/** Bản Trang chủ dựng sẵn cho khách có cookie phiên (app/khoi-phuc/[hint]) hiện ở URL "/" nhưng server dựng theo đường dẫn của trang. */
const PREBUILT_HOME = /^\/khoi-phuc\/[^/]+$/;

/** Đường dẫn dùng cho vỏ trang (thanh đáy, nút quay lại, tiêu đề): bản dựng sẵn của Trang chủ tính là "/" để HTML server khớp lần hydrate. */
export function shellPath<T extends string | null>(pathname: T): T | '/' {
  return pathname !== null && PREBUILT_HOME.test(pathname) ? '/' : pathname;
}

export function useShellPathname(): string {
  return shellPath(usePathname());
}
