'use client';


import { isPortalPath, isPreviewPath } from '@/lib/site';
import { useShellPathname } from '@/lib/shell-pathname';

/**
 * Ẩn phần tử bán hàng dành cho khách (thanh đầu có giỏ hàng, chân trang) ở cổng quản trị/đối tác, và ở trang xem trước MSS: trang đó nằm
 * trong iframe của MSS, link của thanh đầu/chân trang dẫn sang trang Tubu không nhúng được (X-Frame-Options DENY) nên chỉ ra khung trắng.
 */
export default function HideOnPortals({ children }: { children: React.ReactNode }) {
  const pathname = useShellPathname();
  return isPortalPath(pathname) || isPreviewPath(pathname) ? null : <>{children}</>;
}
