'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { pageWindow } from '@tubutree/app-core/commerce/shop-page';
import { fillCopy } from '@tubutree/app-core/shop-copy';

export interface ShopPagerProps {
  page: number;
  pages: number;
  onChange: (page: number) => void;
  label?: string;
}

const CELL = 'inline-flex h-11 min-w-11 items-center justify-center rounded-control px-2 text-sm font-semibold tabular-nums';

/** Phân trang số của tab Sản phẩm từ lg (điện thoại dùng "Xem thêm"). Số hiện tại không bấm được; mũi tên ở đầu/cuối là `aria-disabled` (vẫn Tab tới được). */
export function ShopPager({ page, pages, onChange, label }: ShopPagerProps) {
  if (!Number.isFinite(pages) || pages <= 1) return null;
  const go = (n: number) => {
    if (n >= 1 && n <= pages && n !== page) onChange(n);
  };
  const arrow = (dir: -1 | 1) => {
    const off = dir === -1 ? page <= 1 : page >= pages;
    return (
      <button
        type="button"
        aria-label={fillCopy(dir === -1 ? 'shop.pagePrev' : 'shop.pageNext')}
        aria-disabled={off || undefined}
        onClick={() => !off && go(page + dir)}
        className={`${CELL} text-stone-700 hover:bg-stone-100 ${off ? 'cursor-default opacity-40 hover:bg-transparent' : ''}`}
      >
        {dir === -1 ? <ChevronLeft className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
      </button>
    );
  };
  return (
    <nav aria-label={label ?? fillCopy('shop.pagerLabel')} className="mt-6 flex flex-wrap items-center justify-center gap-1">
      {arrow(-1)}
      {pageWindow(page, pages).map((n, i) =>
        n === '…' ? (
          <span key={`gap-${i}`} aria-hidden="true" className={`${CELL} text-stone-500`}>…</span>
        ) : n === page ? (
          <button key={n} type="button" disabled aria-current="page" aria-label={fillCopy('shop.pageN', { n })} className={`${CELL} bg-forest-700 text-stone-0`}>
            {n}
          </button>
        ) : (
          <button key={n} type="button" aria-label={fillCopy('shop.pageN', { n })} onClick={() => go(n)} className={`${CELL} text-stone-800 hover:bg-stone-100`}>
            {n}
          </button>
        ),
      )}
      {arrow(1)}
    </nav>
  );
}
