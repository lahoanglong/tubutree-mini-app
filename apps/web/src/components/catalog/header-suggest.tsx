'use client';

import type { ReactNode } from 'react';
import { History, Search, TrendingUp } from 'lucide-react';
import type { SuggestOption } from '@tubutree/app-core/browse/combobox';
import type { ProductSuggestion } from '@tubutree/app-core/api/catalog';
import { hideBrokenImage } from '@tubutree/app-core/image-fallback';
import { fillCopy } from '@tubutree/app-core/shop-copy';
import { browseText } from '@/lib/browse-text';
import type { CategoryEntry } from '@/lib/browse-categories';
import { cardPricing } from '@/lib/flash-price';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { useActiveFlashSales } from '@/lib/use-flash-sales';

export const HEADER_LISTBOX_ID = 'site-search-listbox';
export const headerOptionId = (i: number) => `${HEADER_LISTBOX_ID}-${i}`;

export type HeaderOption = SuggestOption<CategoryEntry, ProductSuggestion>;

const GROUP_TITLE: Record<Exclude<HeaderOption['kind'], 'search' | 'product'>, string> = {
  recent: browseText.suggest.recent,
  popular: fillCopy('search.popular'),
  category: browseText.suggest.categories,
};

/**
 * Hộp gợi ý dưới ô tìm của thanh đầu web (combobox: tiêu điểm ở lại ô nhập, dòng đang chọn báo qua `aria-activedescendant`). Định vị
 * tuyệt đối dưới form nên mở/đóng không đẩy gì trên trang. Chỉ dựng khi có dòng để hiện, nên giá Giờ vàng chỉ tải lúc khách mở hộp.
 * Bấm chuột trong hộp không lấy mất tiêu điểm của ô (`mousedown` bị chặn).
 */
export function HeaderSuggestPanel({
  options,
  active,
  stale,
  productsTitle,
  error,
  onRetry,
  onPick,
  onHover,
}: {
  options: HeaderOption[];
  active: number;
  /** Đang tải từ khoá mới: kết quả cũ còn hiện, làm mờ. */
  stale: boolean;
  /** Tiêu đề nhóm sản phẩm (đổi thành "Đang hiện kết quả cho …" khi API đã sửa từ khoá). */
  productsTitle: string;
  error: boolean;
  onRetry: () => void;
  onPick: (i: number) => void;
  onHover: (i: number) => void;
}) {
  const flash = useActiveFlashSales();
  const groups: { kind: HeaderOption['kind']; items: { o: HeaderOption; i: number }[] }[] = [];
  options.forEach((o, i) => {
    const last = groups.at(-1);
    if (last && last.kind === o.kind) last.items.push({ o, i });
    else groups.push({ kind: o.kind, items: [{ o, i }] });
  });

  const row = ({ o, i }: { o: HeaderOption; i: number }) => {
    let icon: ReactNode;
    let label: ReactNode;
    let sub: string | null = null;
    if (o.kind === 'product') {
      icon = (
        <span aria-hidden="true" className="block h-10 w-10 flex-none overflow-hidden rounded-control bg-[var(--color-bg-media)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {o.product.thumbnail && <img src={o.product.thumbnail} alt="" loading="lazy" className="block h-full w-full object-cover" onError={hideBrokenImage} />}
        </span>
      );
      label = o.product.name;
      sub = formatVnd(cardPricing(o.product, flash).price);
    } else if (o.kind === 'category') {
      icon = <o.entry.icon className="h-4 w-4 flex-none text-[color:var(--color-text-brand)]" aria-hidden="true" />;
      label = o.entry.label;
    } else {
      const Ico = o.kind === 'search' ? Search : o.kind === 'recent' ? History : TrendingUp;
      icon = <Ico className="h-4 w-4 flex-none text-[color:var(--color-text-tertiary)]" aria-hidden="true" />;
      label = o.kind === 'search' ? browseText.suggest.searchFor(o.term) : o.term;
    }
    return (
      <div
        key={headerOptionId(i)}
        id={headerOptionId(i)}
        role="option"
        aria-selected={i === active}
        onClick={() => onPick(i)}
        onMouseMove={() => i !== active && onHover(i)}
        className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 text-left ${i === active ? 'bg-[var(--color-bg-subtle)]' : ''}`}
      >
        {icon}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[color:var(--color-text-primary)]">{label}</span>
          {sub && <span className="block text-xs tabular-nums text-[color:var(--color-text-secondary)]">{sub}</span>}
        </span>
      </div>
    );
  };

  return (
    <div
      data-testid="site-search-panel"
      onMouseDown={(e) => e.preventDefault()}
      className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-card border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-2 shadow-card"
    >
      <div role="listbox" id={HEADER_LISTBOX_ID} aria-label={browseText.suggest.title}>
        {groups.map((g) =>
          g.kind === 'search' ? (
            g.items.map(row)
          ) : (
            <div
              key={`${g.kind}-${g.items[0]!.i}`}
              role="group"
              aria-label={g.kind === 'product' ? productsTitle : GROUP_TITLE[g.kind]}
              className={g.kind === 'product' && stale ? 'opacity-60 transition-opacity' : 'transition-opacity'}
            >
              <div aria-hidden="true" className="px-2 pb-1 pt-2 text-xs font-semibold text-[color:var(--color-text-secondary)]">
                {g.kind === 'product' ? productsTitle : GROUP_TITLE[g.kind]}
              </div>
              {g.items.map(row)}
            </div>
          ),
        )}
      </div>
      {error && (
        <div role="status" className="flex items-center justify-between gap-3 px-2 pt-2">
          <span className="min-w-0 text-sm text-[color:var(--color-text-secondary)]">{browseText.suggest.failed}</span>
          <button type="button" onClick={onRetry} className={`${ui.btnText} flex-none text-[color:var(--color-text-brand)]`}>
            {browseText.retry}
          </button>
        </div>
      )}
    </div>
  );
}
