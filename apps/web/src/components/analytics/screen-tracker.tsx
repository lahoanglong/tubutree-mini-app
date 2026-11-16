'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { trackScreenView } from '@/lib/analytics';

/** `screen_viewed` mỗi lần đổi trang; khu quản trị không thuộc phễu mua của khách nên bỏ. Không vẽ gì. */
export function ScreenTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname || pathname === '/admin' || pathname.startsWith('/admin/')) return;
    trackScreenView(pathname);
  }, [pathname]);
  return null;
}
