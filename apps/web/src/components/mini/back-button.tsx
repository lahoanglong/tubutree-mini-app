'use client';

// Nguồn: apps/miniapp/src/components/back-button.tsx (nút quay lại tròn nổi, ẩn ở 5 trang gốc)
import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { isWebRootPath } from '@/lib/web-nav';

// PageHeader (web) dựng ở rất nhiều trang; ngoài App Router (spec render trần) hai hook dưới ném: khi đó coi là trang con và lùi bằng History API.
// Ném luôn ở cùng một chỗ trong mọi lần render nên thứ tự hook không đổi.
function useOptionalRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}
function useOptionalPathname() {
  try {
    return usePathname();
  } catch {
    return null;
  }
}

export interface BackButtonProps {
  /** Trang đích khi lịch sử trình duyệt rỗng (mở thẳng link chia sẻ), như nhánh về trang chủ/gian hàng của Mini App. */
  fallbackHref?: string;
  /** Lớp thêm cho nút; PageHeader/BackLink của web dùng `md:hidden` để nút nổi chỉ có ở điện thoại. */
  className?: string;
}

/** Nút lùi NỔI cho trang con: top-left, tròn 44px. Gắn `with-back-btn` lên <body> khi hiện để CSS đệm đỉnh `.page`. */
export default function BackButton({ fallbackHref = '/', className }: BackButtonProps) {
  const router = useOptionalRouter();
  const pathname = useOptionalPathname();
  const show = !isWebRootPath(pathname);

  // history.length tính cả các mục trước khi khách vào site (quảng cáo, Zalo) nên không dùng được; đếm số lần đổi đường dẫn trong app.
  // BackButton nằm ở layout nên sống suốt phiên; mở thẳng một trang thì đếm bằng 0 và nút về fallbackHref.
  const lastPath = useRef(pathname);
  const inAppSteps = useRef(0);
  if (lastPath.current !== pathname) {
    lastPath.current = pathname;
    inAppSteps.current += 1;
  }

  useEffect(() => {
    document.body.classList.toggle('with-back-btn', show);
    return () => document.body.classList.remove('with-back-btn');
  }, [show]);

  if (!show) return null;

  return (
    <button
      type="button"
      aria-label="Quay lại"
      className={className ? `tubu-press ${className}` : 'tubu-press'}
      onClick={() => {
        // Mở thẳng trang con (share-link/thông báo/quảng cáo) → back() sẽ rời khỏi site thay vì về fallbackHref.
        if (inAppSteps.current > 0) router ? router.back() : window.history.back();
        else router ? router.push(fallbackHref) : window.location.assign(fallbackHref);
      }}
      style={{
        position: 'fixed',
        top: 'calc(var(--safe-top) + 8px)',
        left: 12,
        zIndex: 200,
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
