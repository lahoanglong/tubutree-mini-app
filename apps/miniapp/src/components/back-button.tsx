import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'zmp-ui';
import { ChevronLeft } from 'lucide-react';
import { useStorefrontContext } from '../store/storefront-context';
import { isRootPath } from './nav-config';

/**
 * Nút back NỔI cho trang con. Vì đã ẩn actionBar gốc Zalo (immersive, content tràn
 * viền lên), trang con không còn nút back native → component này thay thế.
 * Đặt top-LEFT để tránh capsule (⋯ ✕) của Zalo luôn nằm top-right.
 * Ẩn ở các tab gốc (nav-config.ts — đã có BottomNav).
 *
 * Khi hiện, gắn class `with-back-btn` lên <body> để CSS đệm thêm đỉnh cho .page
 * (nội dung không bị nút back đè) — trừ trang hero full-bleed (.page-bleed).
 */
/** Thanh đặc phía sau nút lùi: cao 56px + vùng an toàn, cùng bề cao với PageHeader (đệm 48px) nên nội dung cuộn lên không chui dưới nút. */
function BAR_STYLE(solid: boolean, zIndex: number): React.CSSProperties {
  return {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: 'calc(var(--safe-top) + 56px)',
    zIndex,
    background: 'var(--color-bg-surface)',
    borderBottom: '1px solid var(--color-border-subtle)',
    opacity: solid ? 1 : 0,
    pointerEvents: solid ? 'auto' : 'none',
    transition: 'opacity 150ms',
  };
}

export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const sfSlug = useStorefrontContext((s) => s.slug);
  const sfKind = useStorefrontContext((s) => s.kind);
  const rawFrom = (location.state as { from?: string } | null)?.from;
  const fromPath =
    typeof rawFrom === 'string' && rawFrom !== location.pathname ? rawFrom : undefined;
  const show = !isRootPath(location.pathname) || Boolean(fromPath);

  useEffect(() => {
    document.body.classList.toggle('with-back-btn', show);
    return () => document.body.classList.remove('with-back-btn');
  }, [show]);

  // Nút lùi nổi đè lên nội dung khi cuộn; cuộn xuống thì nền thanh đặc lên (ở đỉnh vẫn trong suốt để ảnh hero tràn mép).
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!show) return;
    setScrolled(false);
    // Cuộn xảy ra ở .zaui-page chứ không ở window; sự kiện scroll không nổi bọt nên bắt ở pha capture trên document.
    const onScroll = (e: Event) => {
      const t = e.target;
      const top = t instanceof Element ? t.scrollTop : window.scrollY;
      setScrolled(top > 8);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => document.removeEventListener('scroll', onScroll, { capture: true });
  }, [show, location.pathname]);

  if (!show) return null;

  return (
    <>
      <div
        aria-hidden="true"
        data-back-bar=""
        data-scrolled={scrolled ? 'true' : 'false'}
        style={BAR_STYLE(scrolled, 199)}
      />
      <button
        type="button"
        aria-label="Quay lại"
        className="tubu-press"
        onClick={() => {
          if (fromPath) {
            navigate(fromPath);
          } else {
            // Mở thẳng trang con (share-link/thông báo) → history rỗng, navigate(-1) kẹt.
            const idx = (window.history.state?.idx as number | undefined) ?? 0;
            if (idx > 0) navigate(-1);
            else
              navigate(sfSlug ? (sfKind === 'brand' ? `/brand/${sfSlug}` : `/s/${sfSlug}`) : '/');
          }
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
    </>
  );
}
