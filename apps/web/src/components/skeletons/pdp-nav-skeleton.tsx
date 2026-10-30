'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { PAGE_WIDE } from '@/lib/page-frame';
import { ProductDetailSkeleton } from './route-skeleton';

const PDP_PATH = /^\/san-pham\/[^/]+\/?$/;
const MAX_WAIT_MS = 8000;

/**
 * Khung chờ trang chi tiết sản phẩm ngay lúc bấm vào đường dẫn sản phẩm. Làm bằng `loading.tsx` thì trang không tồn tại trả 200
 * thay vì 404 (Next gửi mã trạng thái cùng khung chờ), nên khung chờ nằm phía trình duyệt: mã trạng thái của máy chủ không đổi.
 */
export function PdpNavSkeleton() {
  const pathname = usePathname();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const el = e.target instanceof Element ? e.target : null;
      const a = el?.closest('a');
      if (!a || el?.closest('button') || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || !PDP_PATH.test(url.pathname) || url.pathname === window.location.pathname) return;
      setTarget(url.pathname);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => setTarget(null), [pathname]);

  useEffect(() => {
    if (target === null) return;
    const t = setTimeout(() => setTarget(null), MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, [target]);

  if (target === null || target === pathname) return null;
  return (
    <div data-testid="pdp-nav-skeleton" className="fixed inset-0 z-30 overflow-hidden bg-[var(--color-bg-canvas)] pt-[var(--header-h)]">
      <main data-page-bleed className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0`}>
        <ProductDetailSkeleton />
      </main>
    </div>
  );
}
