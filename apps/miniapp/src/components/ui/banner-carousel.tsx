import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import { useNavigate } from 'zmp-ui';
import { bannerInterval, bannerNextIndex, bannerShouldAutoplay } from '@tubutree/app-core/commerce/banner-autoplay';
import { fillCopy } from '@tubutree/app-core/shop-copy';

export interface BannerSlide {
  id: string;
  image: string;
  /** Tên đọc của cả slide (slide là một liên kết), nên là câu chữ trên ảnh. */
  alt: string;
  /** Route của nền tảng đang chạy. */
  href: string;
}

export interface BannerCarouselProps {
  slides: BannerSlide[];
  /** Dưới 5000 thì vẫn lấy 5000 (WCAG 2.2.2); chỉ để kéo dài. */
  intervalMs?: number;
}

const SETTLE_MS = 700;
const NOT_INERT = {};
// React 18 chỉ đẩy `inert` xuống DOM khi là chuỗi; web (React 19) nhận boolean.
const INERT = { inert: '' } as Record<string, string>;

const DOT_BTN: CSSProperties = {
  width: 44,
  height: 44,
  padding: 0,
  border: 0,
  background: 'transparent',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'auto',
  cursor: 'pointer',
};

function SlideImage({ slide, eager }: { slide: BannerSlide; eager: boolean }) {
  const [failed, setFailed] = useState(false);
  const frame: CSSProperties = { display: 'block', width: '100%', aspectRatio: 'var(--banner-ratio)', borderRadius: 'var(--radius-media)', objectFit: 'cover' };
  if (failed) {
    return (
      <span
        style={{
          ...frame,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          boxSizing: 'border-box',
          background: 'var(--color-bg-subtle)',
          color: 'var(--color-text-primary)',
          fontSize: 'var(--type-body-sm-size)',
          fontWeight: 700,
          textAlign: 'center',
        }}
      >
        {slide.alt}
      </span>
    );
  }
  return (
    <img
      src={slide.image}
      alt={slide.alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
      style={frame}
    />
  );
}

/**
 * Dải banner chương trình (Q6, a11y B1): tự chuyển nhưng chỉ khi chắc chắn được phép (không giảm chuyển động, tab đang hiện,
 * không có focus/ngón tay/chuột trong banner, khách chưa bấm Dừng), mỗi slide ≥ 5 giây. Nút Dừng đứng đầu thứ tự DOM để bàn phím
 * gặp trước các slide. Slide không hiện là `inert` nên Tab không rơi vào liên kết nằm ngoài khung nhìn. Cuộn ngang tự vuốt
 * (scroll-snap), không có thư viện carousel.
 */
export function BannerCarousel({ slides, intervalMs }: BannerCarouselProps) {
  const navigate = useNavigate();
  const count = slides.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const settleUntil = useRef(0);
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touching, setTouching] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);

  useEffect(() => {
    const sync = () => setHidden(document.visibilityState === 'hidden');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const sync = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  const current = Math.min(index, Math.max(0, count - 1));
  const autoplay = bannerShouldAutoplay({ slideCount: count, userPaused, reducedMotion, hidden, held: focused || touching || hovering });
  const interval = bannerInterval(intervalMs);

  const goTo = useCallback(
    (i: number) => {
      setIndex(i);
      const el = trackRef.current;
      if (!el) return;
      settleUntil.current = Date.now() + SETTLE_MS;
      const left = i * el.clientWidth;
      if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: reducedMotion === false ? 'smooth' : 'auto' });
      else el.scrollLeft = left;
    },
    [reducedMotion],
  );

  useEffect(() => {
    if (!autoplay) return;
    const t = setTimeout(() => goTo(bannerNextIndex(current, count)), interval);
    return () => clearTimeout(t);
  }, [autoplay, current, count, interval, goTo]);

  if (count === 0) return null;

  const onScroll = () => {
    const el = trackRef.current;
    if (!el || !el.clientWidth || Date.now() < settleUntil.current) return;
    setIndex(Math.min(count - 1, Math.max(0, Math.round(el.scrollLeft / el.clientWidth))));
  };

  const open = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    navigate(href);
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label={fillCopy('campaign.carouselLabel')}
      style={{ position: 'relative' }}
      onFocusCapture={(e) => {
        if (!(e.target as HTMLElement).closest('[data-banner-pause]')) setFocused(true);
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onTouchStart={() => setTouching(true)}
      onTouchEnd={() => setTouching(false)}
      onTouchCancel={() => setTouching(false)}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      {count > 1 && (
        <button
          type="button"
          data-banner-pause=""
          className="tubu-press tubu-hit-44-square"
          aria-pressed={userPaused}
          aria-label={fillCopy('campaign.pause')}
          onClick={() => setUserPaused((p) => !p)}
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 2,
            width: 32,
            height: 32,
            padding: 0,
            border: 0,
            borderRadius: '50%',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-countdown-bg)',
            color: 'var(--color-countdown-fg)',
            cursor: 'pointer',
          }}
        >
          {userPaused ? <Play size={14} strokeWidth={2} fill="currentColor" aria-hidden="true" /> : <Pause size={14} strokeWidth={2} fill="currentColor" aria-hidden="true" />}
        </button>
      )}
      <div
        ref={trackRef}
        className="scroll-x"
        aria-live={autoplay ? 'off' : 'polite'}
        onScroll={onScroll}
        style={{ display: 'flex', scrollSnapType: 'x mandatory', borderRadius: 'var(--radius-media)' }}
      >
        {slides.map((s, i) => (
          <div
            key={s.id}
            role="group"
            aria-roledescription="slide"
            aria-label={fillCopy('campaign.slideLabel', { title: s.alt, i: i + 1, n: count })}
            {...(i === current ? NOT_INERT : INERT)}
            style={{ flex: '0 0 100%', minWidth: 0, scrollSnapAlign: 'start' }}
          >
            <a href={s.href} onClick={(e) => open(e, s.href)} className="tubu-press" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
              <SlideImage slide={s} eager={i === 0} />
            </a>
          </div>
        ))}
      </div>
      {count > 1 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: -10, display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 2 }}>
          {slides.map((s, i) => (
            <button key={s.id} type="button" aria-label={fillCopy('campaign.dot', { i: i + 1 })} aria-current={i === current ? 'true' : undefined} onClick={() => goTo(i)} style={DOT_BTN}>
              <span
                aria-hidden="true"
                style={{
                  display: 'block',
                  width: i === current ? 16 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === current ? 'var(--color-countdown-fg)' : 'var(--color-media-dot-idle)',
                  boxShadow: '0 0 0 1px var(--color-countdown-bg)',
                  transition: 'width var(--dur-release) var(--ease-out), background-color var(--dur-release) var(--ease-out)',
                }}
              />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
