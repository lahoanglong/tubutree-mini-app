import { useEffect } from 'react';
import { useNavigate, useLocation } from 'zmp-ui';
import { ChevronLeft } from 'lucide-react';

/**
 * Nút back NỔI cho trang con. Vì đã ẩn actionBar gốc Zalo (immersive, content tràn
 * viền lên), trang con không còn nút back native → component này thay thế.
 * Đặt top-LEFT để tránh capsule (⋯ ✕) của Zalo luôn nằm top-right.
 * Ẩn ở các tab gốc (đã có BottomNav).
 *
 * Khi hiện, gắn class `with-back-btn` lên <body> để CSS đệm thêm đỉnh cho .page
 * (nội dung không bị nút back đè) — trừ trang hero full-bleed (.page-bleed).
 */
const ROOTS = ['/', '/browse', '/game', '/wallet', '/profile'];

export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  const show = !ROOTS.includes(location.pathname);

  useEffect(() => {
    document.body.classList.toggle('with-back-btn', show);
    return () => document.body.classList.remove('with-back-btn');
  }, [show]);

  if (!show) return null;

  return (
    <button
      type="button"
      aria-label="Quay lại"
      className="tubu-press"
      onClick={() => {
        // Mở thẳng trang con (share-link/thông báo) → history rỗng, navigate(-1) kẹt.
        const idx = (window.history.state?.idx as number | undefined) ?? 0;
        if (idx > 0) navigate(-1);
        else navigate('/');
      }}
      style={{
        position: 'fixed',
        top: 'calc(var(--safe-top) + 8px)',
        left: 12,
        zIndex: 200,
        width: 38,
        height: 38,
        borderRadius: '50%',
        border: 'none',
        background: 'rgba(255,255,255,0.92)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        cursor: 'pointer',
      }}
    >
      <ChevronLeft size={24} color="var(--neutral-800, #2b2b2b)" strokeWidth={2.2} />
    </button>
  );
}
