'use client';

// Nguồn: apps/miniapp/src/components/back-button.tsx (nút quay lại tròn nổi, ẩn ở 5 trang gốc)
import { useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useOptionalPathname, useOptionalRouter } from '@/lib/optional-nav';
import { historyDepth, trackHistoryDepth } from '@/lib/nav-depth';
import { isWebRouteReady } from '@/lib/route-map';
import { isWebRootPath } from '@/lib/web-nav';

/** Trang cha hợp lý trong web: bỏ dần đoạn cuối của đường dẫn tới route đã có, không thì trang chủ. */
function parentOf(pathname: string | null): string {
  const parts = (pathname ?? '').split('/').filter(Boolean);
  while (parts.length > 1) {
    parts.pop();
    const candidate = `/${parts.join('/')}`;
    if (isWebRouteReady(candidate)) return candidate;
  }
  return '/';
}

// Nhiều bản BackButton có thể cùng gắn; chỉ gỡ lớp khỏi body khi bản cuối biến mất.
let showing = 0;

export interface BackButtonProps {
  /** Trang đích khi chưa có lịch sử trong web (mở thẳng link chia sẻ); bỏ trống thì lấy trang cha PageHeader khai báo, rồi suy từ đường dẫn. */
  fallbackHref?: string;
  /** Lớp thêm cho nút; PageHeader/BackLink của web dùng `md:hidden` để nút nổi chỉ có ở điện thoại. */
  className?: string;
}

/** Nút lùi NỔI cho trang con: top-left, tròn 44px. Gắn `with-back-btn` lên <body> khi hiện để CSS đệm đỉnh `.page`. */
export default function BackButton({ fallbackHref, className }: BackButtonProps) {
  const router = useOptionalRouter();
  const pathname = useOptionalPathname();
  const show = !isWebRootPath(pathname);

  useEffect(() => {
    trackHistoryDepth();
  }, []);

  useEffect(() => {
    if (!show) return;
    showing += 1;
    document.body.classList.add('with-back-btn');
    return () => {
      showing -= 1;
      if (showing === 0) document.body.classList.remove('with-back-btn');
    };
  }, [show]);

  if (!show) return null;

  return (
    <button
      type="button"
      aria-label="Quay lại"
      className={className ? `tubu-press ${className}` : 'tubu-press'}
      onClick={() => {
        // Có mục lịch sử trước đó trong web thì lùi một bước. Không thì back() sẽ rời site (link chia sẻ, tab mới) nên đi tới trang cha.
        if (historyDepth() > 0) {
          if (router) router.back();
          else window.history.back();
          return;
        }
        const declared = document.querySelector('[data-back-href]')?.getAttribute('data-back-href');
        let target = fallbackHref ?? declared ?? parentOf(pathname);
        if (target === pathname) target = '/';
        if (router) router.push(target);
        else window.location.assign(target);
      }}
      style={{
        position: 'fixed',
        top: 'calc(var(--safe-top) + 8px)',
        left: 12,
        zIndex: 40,
        width: 44,
        height: 44,
        borderRadius: '50%',
        border: 'none',
        background: 'var(--color-bg-surface)',
        boxShadow: 'var(--elevation-2)',
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        cursor: 'pointer',
      }}
    >
      <ChevronLeft size={24} color="var(--color-text-primary)" strokeWidth={2.2} />
    </button>
  );
}
