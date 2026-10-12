'use client';

import { usePathname } from 'next/navigation';
import { isPortalPath } from '@/lib/site';

/** Ẩn phần tử bán hàng dành cho khách (chân trang) ở cổng quản trị/đối tác/nhãn hàng. */
export default function HideOnPortals({ children }: { children: React.ReactNode }) {
  return isPortalPath(usePathname()) ? null : <>{children}</>;
}
