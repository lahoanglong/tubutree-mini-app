import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, ShoppingCart, Star, X } from 'lucide-react';
import { lightboxCounter, lightboxStep, swipeDirection, type ReviewMediaItem } from '@tubutree/app-core/commerce/review-media';
import { fillCopy } from '@tubutree/app-core/shop-copy';

export interface ReviewMediaLightboxProps {
  open: boolean;
  onClose: () => void;
  items: readonly ReviewMediaItem[];
  index: number;
  onIndexChange: (index: number) => void;
  author: string;
  rating: number;
  verifiedPurchase?: boolean;
  comment?: string | null;
  /** Ghép địa chỉ gốc của máy chủ ảnh vào đường dẫn tương đối API trả về. */
  resolveSrc?: (src: string) => string;
  /** Có thì chân lightbox hiện nút "Thêm vào giỏ": đóng lightbox rồi chạy luồng thêm giỏ của trang sản phẩm. */
  onAdd?: () => void;
}

let scrollLocks = 0;
let savedOverflow = '';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

/** Phần tử Tab tới được trong `panel`, theo thứ tự DOM; bỏ phần bị `hidden`/`inert` và phần có `tabindex` âm. */
function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[hidden],[inert]') && !(Number(el.getAttribute('tabindex') ?? 0) < 0),
  );
}

/**
 * Xem ảnh/video đánh giá toàn màn hình (web có bản cùng tên): nền đen 90% làm mờ phía sau, mở 220ms theo đường cong drawer
 * (`.review-lightbox`, giảm chuyển động thì hiện ngay). Chuyển tệp bằng nút Trước/Sau (44×44), vuốt ngang, phím ←/→/Home/End; nút × hoặc Esc đóng.
 * Tab/Shift+Tab quay vòng trong hộp; hộp modal khác mở sau (cuối DOM) giữ bàn phím.
 * Nút back của Zalo đóng lightbox thay vì thoát trang: mở thì đẩy một mục lịch sử, `popstate` thì đóng (như lớp phủ chi tiết thông báo).
 * Chân hiện người mua, số sao, nhãn "Đã mua hàng", nhận xét. Không dựng khi đóng. Số đo nằm ở các lớp `.review-lightbox__*` (css/tokens.css).
 */
export function ReviewMediaLightbox({ open, onClose, items, index, onIndexChange, author, rating, verifiedPurchase, comment, resolveSrc, onAdd }: ReviewMediaLightboxProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const at = items.length > 0 ? Math.min(Math.max(index, 0), items.length - 1) : 0;
  const live = useRef({ onClose, onIndexChange, count: items.length, index: at });
  live.current = { onClose, onIndexChange, count: items.length, index: at };

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    if (scrollLocks++ === 0) savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    window.history.pushState({ reviewLightbox: true }, '');
    const onPop = () => live.current.onClose();
    const onKey = (e: KeyboardEvent) => {
      const panel = panelRef.current;
      if (!panel) return;
      // Hộp modal khác mở sau (portal cuối DOM) giữ bàn phím.
      const modals = document.querySelectorAll('[aria-modal="true"]');
      if (modals[modals.length - 1] !== panel) return;
      // Phím mũi tên/Home/End của thanh tua video thuộc về trình phát, không chuyển tệp.
      const browse = live.current.count > 1 && !(e.target instanceof HTMLVideoElement);
      if (e.key === 'Escape' && !e.isComposing) {
        e.stopPropagation();
        live.current.onClose();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && browse) {
        e.preventDefault();
        live.current.onIndexChange(lightboxStep(live.current.index, live.current.count, e.key === 'ArrowRight' ? 1 : -1));
      } else if ((e.key === 'Home' || e.key === 'End') && browse) {
        e.preventDefault();
        const target = e.key === 'Home' ? 0 : live.current.count - 1;
        if (target !== live.current.index) live.current.onIndexChange(target);
      } else if (e.key === 'Tab') {
        const list = focusableIn(panel);
        if (list.length === 0) {
          e.preventDefault();
          return;
        }
        const wrapTo = e.shiftKey ? list[list.length - 1]! : list[0]!;
        const active = document.activeElement;
        if (!active || !panel.contains(active)) {
          e.preventDefault();
          wrapTo.focus();
          return;
        }
        // Nút của trình phát nằm trong shadow DOM nên focus vẫn ở chính <video>: để trình duyệt tự đi qua từng nút.
        if (active instanceof HTMLVideoElement) return;
        // Quay vòng khi không còn phần tử nào phía trước/sau chỗ đang focus (không chỉ so với nút đầu/cuối): chính khung (tabIndex -1,
        // sau khi bấm vùng trống) hay ô nhận xét có thanh cuộn (Chromium cho focus) đều nằm ngoài danh sách mà vẫn phải quay vòng đúng.
        const side = e.shiftKey ? Node.DOCUMENT_POSITION_PRECEDING : Node.DOCUMENT_POSITION_FOLLOWING;
        if (!list.some((el) => (active.compareDocumentPosition(el) & side) !== 0)) {
          e.preventDefault();
          wrapTo.focus();
        }
      }
    };
    window.addEventListener('popstate', onPop);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey);
      if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
      // Đóng bằng nút ×/Esc thì mục lịch sử đã đẩy vẫn còn trên cùng: bỏ nó đi để nút back kế tiếp thoát trang như bình thường.
      if (window.history.state?.reviewLightbox) window.history.back();
      opener?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined' || items.length === 0) return null;
  const count = items.length;
  const current = items[at]!;
  const src = resolveSrc ? resolveSrc(current.src) : current.src;
  const step = (dir: 1 | -1) => onIndexChange(lightboxStep(at, count, dir));
  const onDown = (e: ReactPointerEvent) => {
    // Kéo thanh tua của video không được tính là vuốt chuyển tệp.
    swipeStart.current = e.target instanceof HTMLVideoElement ? null : { x: e.clientX, y: e.clientY };
  };
  const onUp = (e: ReactPointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || count < 2) return;
    const dir = swipeDirection(e.clientX - start.x, e.clientY - start.y);
    if (dir !== 0) step(dir);
  };

  return createPortal(
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label={fillCopy('review.mediaDialog')} tabIndex={-1} data-testid="review-lightbox" className="review-lightbox">
      {/* Nút đóng bên TRÁI như màn chi tiết thông báo: capsule ⋯/✕ của Zalo luôn nằm góc phải trên. */}
      <div className="review-lightbox__bar">
        <button ref={closeRef} type="button" aria-label="Đóng" className="review-lightbox__btn tubu-press" onClick={onClose}>
          <X size={20} aria-hidden="true" />
        </button>
        <span aria-live="polite" className="review-lightbox__counter" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {lightboxCounter(at, count)}
        </span>
      </div>

      <div
        className="review-lightbox__stage"
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (swipeStart.current = null)}
        style={{ touchAction: 'pan-y pinch-zoom' }}
      >
        {current.kind === 'video' ? (
          <video key={src} src={src} controls playsInline preload="metadata" className="review-lightbox__media" />
        ) : (
          <img key={src} src={src} alt={`Ảnh đánh giá của ${author}`} draggable={false} className="review-lightbox__media" />
        )}
        {count > 1 && (
          <>
            <button type="button" aria-label={fillCopy('review.mediaPrev')} className="review-lightbox__btn review-lightbox__nav review-lightbox__nav--prev tubu-press" onClick={() => step(-1)}>
              <ChevronLeft size={20} aria-hidden="true" />
            </button>
            <button type="button" aria-label={fillCopy('review.mediaNext')} className="review-lightbox__btn review-lightbox__nav review-lightbox__nav--next tubu-press" onClick={() => step(1)}>
              <ChevronRight size={20} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div className="review-lightbox__foot">
        <div className="review-lightbox__meta">
          <span className="review-lightbox__author">{author}</span>
          <span role="img" aria-label={`${rating} sao`} className="review-lightbox__stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} size={14} aria-hidden="true" fill={n <= rating ? 'currentColor' : 'none'} style={{ opacity: n <= rating ? 1 : 0.4 }} />
            ))}
          </span>
          {verifiedPurchase && (
            <span className="review-lightbox__chip">
              <Check size={12} aria-hidden="true" />
              {fillCopy('review.mediaVerified')}
            </span>
          )}
        </div>
        {comment && <p className="review-lightbox__comment">{comment}</p>}
        {onAdd && (
          <button type="button" className="review-lightbox__add tubu-press" onClick={onAdd}>
            <ShoppingCart size={16} aria-hidden="true" />
            {fillCopy('review.mediaAdd')}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
