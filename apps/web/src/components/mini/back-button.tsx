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

const DEPTH_KEY = 'tubu.nav.depth';
const readDepth = () => {
  try {
    return Math.max(0, Number(sessionStorage.getItem(DEPTH_KEY)) || 0);
  } catch {
    return 0;
  }
};
const writeDepth = (n: number) => {
  try {
    sessionStorage.setItem(DEPTH_KEY, String(n));
  } catch {
    /* không có sessionStorage: mất độ sâu sau F5, nút về fallbackHref */
  }
};

// Nhiều bản BackButton có thể cùng gắn; chỉ gỡ lớp khỏi body khi bản cuối biến mất.
let showing = 0;

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

  // history.length tính cả các mục trước khi khách vào site (quảng cáo, Zalo) nên không dùng được; đếm độ sâu trong app.
  // Đổi đường dẫn do popstate (lùi) thì giảm, còn lại tăng. Lưu sessionStorage để F5 không mất; mở thẳng một trang thì độ sâu 0 và nút về fallbackHref.
  const depth = useRef<number | null>(null);
  const popped = useRef(false);
  const lastPath = useRef(pathname);
  if (depth.current === null) depth.current = readDepth();

  useEffect(() => {
    const onPop = () => {
      popped.current = true;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    depth.current = popped.current ? Math.max(0, (depth.current ?? 0) - 1) : (depth.current ?? 0) + 1;
    popped.current = false;
    writeDepth(depth.current);
  }, [pathname]);

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
        // Mở thẳng trang con (share-link/thông báo/quảng cáo) → back() sẽ rời khỏi site thay vì về fallbackHref.
        if ((depth.current ?? 0) > 0) router ? router.back() : window.history.back();
        else router ? router.push(fallbackHref) : window.location.assign(fallbackHref);
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
