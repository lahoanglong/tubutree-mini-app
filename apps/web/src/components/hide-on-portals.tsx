'use client';


import { isPortalPath } from '@/lib/site';
import { useShellPathname } from '@/lib/shell-pathname';

/** Ẩn phần tử bán hàng dành cho khách (thanh đầu có giỏ hàng, chân trang) ở cổng quản trị/đối tác. */
export default function HideOnPortals({ children }: { children: React.ReactNode }) {
  return isPortalPath(useShellPathname()) ? null : <>{children}</>;
}
