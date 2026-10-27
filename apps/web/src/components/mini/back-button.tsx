'use client';

// Nguồn: apps/miniapp/src/components/back-button.tsx (nút quay lại tròn nổi, ẩn ở 5 trang gốc)
import { useEffect, useState } from 'react';
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

  // Nút lùi nổi đè lên nội dung khi cuộn; cuộn xuống thì nền thanh đặc lên (ở đỉnh vẫn trong suốt để ảnh hero tràn mép).
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!show) return;
    setScrolled(window.scrollY > 8);
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [show, pathname]);

  if (!show) return null;

  return (
    <>
      <div
        aria-hidden="true"
        data-back-bar=""
        data-scrolled={scrolled ? 'true' : 'false'}
        className={className}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 'calc(var(--safe-top) + 56px)',
          zIndex: 39,
          background: 'var(--color-bg-surface)',
          borderBottom: '1px solid var(--color-border-subtle)',
          opacity: scrolled ? 1 : 0,
          pointerEvents: scrolled ? 'auto' : 'none',
          transition: 'opacity 150ms',
        }}
      />
      <button
        type="button"
        aria-label="Quay lại"
        className={className ? `tubu-press ${className}` : 'tubu-press'}
        onClick={() => {
          // Có mục lịch sử trước đó trong web thì lùi một bước. Không thì back() sẽ rời site (link chia sẻ, tab mới) nên đi tới trang cha bằng replace: mục mới giữ độ sâu 0 để bấm tiếp còn leo lên, không dội về trang con.
          if (historyDepth() > 0) {
            if (router) router.back();
            else window.history.back();
            return;
          }
          const declared = document
            .querySelector('[data-back-href]')
            ?.getAttribute('data-back-href');
          let target = fallbackHref ?? declared ?? parentOf(pathname);
          if (target === pathname) target = '/';
          if (router) router.replace(target);
          else window.location.replace(target);
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
    </>
  );
}
