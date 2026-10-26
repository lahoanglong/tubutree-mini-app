'use client';

import type { ReactNode, RefObject } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useScrollHints } from '@/components/mini/use-scroll-hints';

const ARROW =
  'absolute top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200 bg-stone-0 text-stone-800 shadow-raised transition hover:bg-stone-50 md:flex';

/**
 * Nút ‹ › cho hàng ngang từ md: chuột không có vuốt ngang nên thẻ ngoài mép không với tới được. Chỉ hiện nút phía còn nội dung;
 * điện thoại không hiện (vuốt như Mini App). Đặt trong khung `relative` bao hàng cuộn.
 */
export function RailArrows({ scrollerRef, hasPrev, hasNext }: { scrollerRef: RefObject<HTMLElement | null>; hasPrev: boolean; hasNext: boolean }) {
  const go = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.8), behavior: 'smooth' });
  };
  return (
    <>
      {hasPrev && (
        <button type="button" aria-label="Xem các mục trước" onClick={() => go(-1)} className={`${ARROW} left-0 -translate-x-1/2`}>
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      {hasNext && (
        <button type="button" aria-label="Xem các mục tiếp" onClick={() => go(1)} className={`${ARROW} right-0 translate-x-1/2`}>
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    </>
  );
}

/** Danh sách `<ul>` cuộn ngang kèm nút ‹ › từ md. `className` áp lên `<ul>` (flex, gap, overflow-x-auto…). */
export function ScrollRail({ className, label, children }: { className: string; label?: string; children: ReactNode }) {
  const hints = useScrollHints<HTMLUListElement>();
  return (
    <div className="relative">
      <ul {...hints} aria-label={label} className={className}>
        {children}
      </ul>
      <RailArrows scrollerRef={hints.ref} hasPrev={hints['data-fade-start'] === 'true'} hasNext={hints['data-fade-end'] === 'true'} />
    </div>
  );
}
