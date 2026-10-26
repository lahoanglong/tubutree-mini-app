import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'zmp-ui';
import { ChevronLeft } from 'lucide-react';
import { nextBackHidden } from '@tubutree/app-core/back-button-scroll';
import { useStorefrontContext } from '../store/storefront-context';
import { isRootPath } from './nav-config';

/** Ẩn nút khi trang cuộn xuống (đỡ đè nội dung), hiện lại khi cuộn lên. Nghe ở pha bắt để thấy cả vùng cuộn riêng trong trang. */
function useHideOnScrollDown(active: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!active) return;
    const last = new WeakMap<object, number>();
    const onScroll = (e: Event) => {
      const t = e.target;
      const el = t instanceof Element ? t : document.scrollingElement;
      if (!el) return;
      const top = el.scrollTop;
      const delta = top - (last.get(el) ?? top);
      last.set(el, top);
      if (delta === 0) return;
      setHidden((h) => nextBackHidden(h, top, delta));
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [active]);
  return hidden;
}

/**
 * Nút back NỔI cho trang con. Vì đã ẩn actionBar gốc Zalo (immersive, content tràn
 * viền lên), trang con không còn nút back native → component này thay thế.
 * Đặt top-LEFT để tránh capsule (⋯ ✕) của Zalo luôn nằm top-right.
 * Ẩn ở các tab gốc (nav-config.ts — đã có BottomNav).
 *
 * Khi hiện, gắn class `with-back-btn` lên <body> để CSS đệm thêm đỉnh cho .page
 * (nội dung không bị nút back đè) — trừ trang hero full-bleed (.page-bleed).
 */
export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const sfSlug = useStorefrontContext((s) => s.slug);
  const sfKind = useStorefrontContext((s) => s.kind);
  const rawFrom = (location.state as { from?: string } | null)?.from;
  const fromPath = typeof rawFrom === 'string' && rawFrom !== location.pathname ? rawFrom : undefined;
  const show = !isRootPath(location.pathname) || Boolean(fromPath);

  useEffect(() => {
    document.body.classList.toggle('with-back-btn', show);
    return () => document.body.classList.remove('with-back-btn');
  }, [show]);

  const hidden = useHideOnScrollDown(show);

  if (!show) return null;

  return (
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
          else navigate(sfSlug ? (sfKind === 'brand' ? `/brand/${sfSlug}` : `/s/${sfSlug}`) : '/');
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
        opacity: hidden ? 0 : 1,
        transform: hidden ? 'translateY(-8px)' : 'none',
        pointerEvents: hidden ? 'none' : 'auto',
        transition: 'opacity 160ms ease, transform 160ms ease',
      }}
      tabIndex={hidden ? -1 : undefined}
    >
      <ChevronLeft size={24} color="var(--color-text-primary)" strokeWidth={2.2} />
    </button>
  );
}
