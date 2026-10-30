'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { PAGE_WIDE } from '@/lib/page-frame';
import { ProductDetailSkeleton } from './route-skeleton';

const PDP_PATH = /^\/san-pham\/[^/]+\/?$/;
// Chỉ là lưới an toàn khi điều hướng hỏng hẳn: mạng chậm thì giữ khung tới khi đường dẫn đổi.
const MAX_WAIT_MS = 20000;
const ANNOUNCE_EVENT = 'tubu:pdp-nav';

/** Báo cho khung chờ biết sắp mở trang sản phẩm bằng `router.push` (không có thẻ a để bắt lúc bấm). */
export function announcePdpNavigation(href: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ANNOUNCE_EVENT, { detail: href }));
}

function pdpPathOf(href: string): string | null {
  try {
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || !PDP_PATH.test(url.pathname) || url.pathname === window.location.pathname) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

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
      const path = pdpPathOf(a.href);
      if (path) setTarget(path);
    };
    const onAnnounce = (e: Event) => {
      const path = pdpPathOf(String((e as CustomEvent).detail));
      if (path) setTarget(path);
    };
    document.addEventListener('click', onClick);
    window.addEventListener(ANNOUNCE_EVENT, onAnnounce);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
    };
  }, []);

  useEffect(() => setTarget(null), [pathname]);

  useEffect(() => {
    if (target === null) return;
    const t = setTimeout(() => setTarget(null), MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, [target]);

  if (target === null || target === pathname) return null;
  return (
    <div data-testid="pdp-nav-skeleton" className="fixed inset-x-0 bottom-0 top-[var(--header-h)] z-50 overflow-hidden bg-[var(--color-bg-canvas)]">
      <main data-page-bleed className={`${PAGE_WIDE} py-6 max-md:px-0 max-md:py-0`}>
        <ProductDetailSkeleton />
      </main>
    </div>
  );
}
