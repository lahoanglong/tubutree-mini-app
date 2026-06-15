import { useNavigate, useLocation } from 'zmp-ui';
import { ChevronLeft } from 'lucide-react';

/**
 * Nút back NỔI cho trang con. Vì đã ẩn actionBar gốc Zalo (immersive, content tràn
 * viền lên), trang con không còn nút back native → component này thay thế.
 * Đặt top-LEFT để tránh capsule (⋯ ✕) của Zalo luôn nằm top-right.
 * Ẩn ở các tab gốc (đã có BottomNav).
 */
const ROOTS = ['/', '/browse', '/game', '/wallet', '/profile'];

export default function BackButton() {
  const navigate = useNavigate();
  const location = useLocation();
  if (ROOTS.includes(location.pathname)) return null;

  return (
    <button
      type="button"
      aria-label="Quay lại"
      className="tubu-press"
      onClick={() => navigate(-1)}
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
