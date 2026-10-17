'use client';

import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Leaf } from 'lucide-react';

const FRAME = 'relative aspect-square overflow-hidden rounded-sheet border border-stone-200 bg-forest-50 shadow-card';
const ARROW =
  'absolute top-1/2 z-10 flex h-11 w-11 min-h-11 -translate-y-1/2 items-center justify-center rounded-full bg-stone-0/90 text-stone-900 shadow-card transition hover:bg-stone-0 disabled:hidden';

/**
 * Thư viện ảnh sản phẩm: vuốt ngang trên điện thoại (cuộn bám mép), mũi tên và dải ảnh nhỏ cho chuột/bàn phím.
 * Ảnh dùng object-contain để nhãn thành phần không bị cắt. Chưa dùng next/image vì ảnh đến từ host tuỳ ý
 * (Pancake/Cloudinary/…) — bật optimizer cho mọi host là biến nó thành proxy ảnh mở; cần chốt danh sách host trước.
 */
export default function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [active, setActive] = useState(0);
  const [broken, setBroken] = useState<ReadonlySet<number>>(new Set());
  const trackRef = useRef<HTMLDivElement>(null);
  const count = images.length;

  if (count === 0) {
    return (
      <div className={`${FRAME} flex items-center justify-center text-forest-600`}>
        <Leaf className="h-20 w-20 stroke-[1.5]" aria-hidden="true" />
      </div>
    );
  }

  const go = (to: number) => {
    const next = Math.min(Math.max(to, 0), count - 1);
    setActive(next);
    const el = trackRef.current;
    if (el && typeof el.scrollTo === 'function') {
      const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ left: next * el.clientWidth, behavior: reduce ? 'auto' : 'smooth' });
    }
  };
  const onScroll = () => {
    const el = trackRef.current;
    if (el && el.clientWidth > 0) setActive(Math.min(count - 1, Math.round(el.scrollLeft / el.clientWidth)));
  };
  const markBroken = (i: number) => setBroken((s) => new Set(s).add(i));

  return (
    <div className="min-w-0">
      <div className={FRAME} role="group" aria-roledescription="carousel" aria-label={`Ảnh sản phẩm ${name}`}>
        <div
          ref={trackRef}
          onScroll={onScroll}
          tabIndex={count > 1 ? 0 : undefined}
          aria-label={count > 1 ? 'Vuốt hoặc dùng phím mũi tên để xem thêm ảnh' : undefined}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') go(active + 1);
            else if (e.key === 'ArrowLeft') go(active - 1);
            else return;
            e.preventDefault();
          }}
          className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {images.map((src, i) => (
            <div
              key={src}
              role="group"
              aria-roledescription="slide"
              aria-label={`Ảnh ${i + 1} trên ${count}`}
              className="flex h-full w-full flex-none snap-center items-center justify-center"
            >
              {broken.has(i) ? (
                <Leaf className="h-20 w-20 stroke-[1.5] text-forest-600" aria-hidden="true" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={count > 1 ? `${name} — ảnh ${i + 1}` : name}
                  className="h-full w-full object-contain"
                  width={800}
                  height={800}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  fetchPriority={i === 0 ? 'high' : undefined}
                  decoding="async"
                  onError={() => markBroken(i)}
                />
              )}
            </div>
          ))}
        </div>
        {count > 1 && (
          <>
            <button type="button" onClick={() => go(active - 1)} disabled={active === 0} aria-label="Ảnh trước" className={`${ARROW} left-2`}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => go(active + 1)} disabled={active === count - 1} aria-label="Ảnh sau" className={`${ARROW} right-2`}>
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
            <p
              aria-live="polite"
              className="absolute bottom-2 right-2 rounded-full bg-stone-900/70 px-2.5 py-0.5 text-xs font-medium text-stone-0"
            >
              {active + 1}/{count}
            </p>
          </>
        )}
      </div>

      {count > 1 && (
        <ul className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Chọn ảnh">
          {images.map((src, i) => (
            <li key={src} className="flex-none">
              <button
                type="button"
                onClick={() => go(i)}
                aria-label={`Xem ảnh ${i + 1}`}
                aria-pressed={i === active}
                className={`flex h-14 min-h-11 w-14 min-w-11 items-center justify-center overflow-hidden rounded-control border-2 bg-stone-0 ${
                  i === active ? 'border-forest-600' : 'border-stone-200'
                }`}
              >
                {broken.has(i) ? (
                  <Leaf className="h-6 w-6 text-forest-600" aria-hidden="true" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" className="h-full w-full object-cover" width={56} height={56} loading="lazy" decoding="async" onError={() => markBroken(i)} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
