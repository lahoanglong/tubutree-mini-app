'use client';

import { useEffect, useId, useRef, type PointerEvent as ReactPointerEvent } from 'react';
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

const ICON_BTN =
  'tubu-press inline-flex h-11 w-11 flex-none items-center justify-center rounded-full bg-[var(--color-bg-lightbox-control)] text-[var(--color-text-inverse)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-text-inverse)]';

let scrollLocks = 0;
let savedOverflow = '';

// Riêng cho lightbox (không dùng `focusableIn` chung của sheet): thêm `video[controls]` để bàn phím tới được trình phát, khớp bản Mini.
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

/** Phần tử Tab tới được trong `panel`, theo thứ tự DOM; bỏ phần bị `hidden`/`inert` và phần có `tabindex` âm. */
function focusableIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest('[hidden],[inert]') && !(Number(el.getAttribute('tabindex') ?? 0) < 0),
  );
}

/**
 * Xem ảnh/video đánh giá toàn màn hình (Mini App có bản cùng tên): nền đen 90% làm mờ phía sau, mở 220ms theo đường cong drawer
 * (`.review-lightbox`, giảm chuyển động thì hiện ngay). Chuyển tệp bằng nút Trước/Sau (44×44), phím ←/→/Home/End, vuốt ngang; Esc hoặc × để đóng.
 * Chân hiện người mua, số sao, nhãn "Đã mua hàng", nhận xét. Không dựng khi đóng; đóng thì trả focus về nút đã mở.
 */
export function ReviewMediaLightbox({ open, onClose, items, index, onIndexChange, author, rating, verifiedPurchase, comment, resolveSrc, onAdd }: ReviewMediaLightboxProps) {
  const uid = useId();
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
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (--scrollLocks === 0) document.body.style.overflow = savedOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === 'undefined' || items.length === 0) return null;
  const count = items.length;
  const current = items[at]!;
  const src = resolveSrc ? resolveSrc(current.src) : current.src;
  const step = (dir: 1 | -1) => onIndexChange(lightboxStep(at, count, dir));
  const counter = lightboxCounter(at, count);
  const onDown = (e: ReactPointerEvent) => {
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
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={fillCopy('review.mediaDialog')}
      tabIndex={-1}
      data-testid="review-lightbox"
      className="review-lightbox fixed inset-0 z-[80] flex flex-col text-[var(--color-text-inverse)] outline-none"
    >
      <div className="flex flex-none items-center justify-between gap-2 px-3 pb-2" style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top, 0px))' }}>
        <span id={`${uid}-count`} aria-live="polite" className="min-w-0 text-sm font-semibold tabular-nums">
          {counter}
        </span>
        <button ref={closeRef} type="button" aria-label="Đóng" onClick={onClose} className={ICON_BTN}>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center px-14"
        style={{ touchAction: 'pan-y pinch-zoom' }}
        onPointerDown={onDown}
        onPointerUp={onUp}
        onPointerCancel={() => (swipeStart.current = null)}
      >
        {current.kind === 'video' ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption -- video do khách tự quay, không có phụ đề
          <video key={src} src={src} controls playsInline preload="metadata" className="max-h-full max-w-full rounded-control bg-[var(--color-bg-inverse)]" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={src} src={src} alt={`Ảnh đánh giá của ${author}`} draggable={false} className="max-h-full max-w-full select-none rounded-control object-contain" />
        )}
        {count > 1 && (
          <>
            <button type="button" aria-label={fillCopy('review.mediaPrev')} onClick={() => step(-1)} className={`${ICON_BTN} absolute left-2 top-1/2 -translate-y-1/2`}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" aria-label={fillCopy('review.mediaNext')} onClick={() => step(1)} className={`${ICON_BTN} absolute right-2 top-1/2 -translate-y-1/2`}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div className="flex-none px-4 pt-3" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom, 0px))' }}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{author}</span>
          <span role="img" aria-label={`${rating} sao`} className="inline-flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} aria-hidden="true" className={`h-3.5 w-3.5 ${n <= rating ? 'fill-current text-[var(--color-text-inverse)]' : 'text-[var(--color-text-inverse)] opacity-40'}`} />
            ))}
          </span>
          {verifiedPurchase && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--color-bg-lightbox-chip)] px-2 py-0.5 text-xs font-medium">
              <Check className="h-3 w-3" aria-hidden="true" />
              {fillCopy('review.mediaVerified')}
            </span>
          )}
        </div>
        {comment && <p className="mt-2 max-h-[28vh] overflow-y-auto whitespace-pre-line break-words text-sm opacity-90">{comment}</p>}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            className="tubu-press mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-[var(--color-action-primary-bg)] px-4 text-sm font-semibold text-[var(--color-action-primary-fg)]"
          >
            <ShoppingCart className="h-4 w-4" aria-hidden="true" />
            {fillCopy('review.mediaAdd')}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
