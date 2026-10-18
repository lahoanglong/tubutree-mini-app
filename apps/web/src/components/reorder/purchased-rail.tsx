'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PurchasedItem } from '@tubutree/app-core/api/orders';
import { formatVnd } from '@/lib/format-vnd';
import { homeText, reorderText } from '@/lib/home-text';
import { ui } from '@/lib/guest-ui';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { homeErrorMessage } from '@/components/home/home-block-error';
import { useBlockQuery } from '@/components/home/use-block-query';
import { ReorderSheet } from './reorder-sheet';
import { itemReorderTarget, type ReorderTarget } from './reorder-types';
import { usePurchasedItems } from './use-purchased-items';

/** Dùng CHUNG query key ['purchased-items', 10] với Trang chủ khi quyết định thứ tự khối. */
export const PURCHASED_RAIL_LIMIT = 10;

function RebuyTile({ item, onRebuy }: { item: PurchasedItem; onRebuy: () => void }) {
  const name = item.variationName ? `${item.productName} · ${item.variationName}` : item.productName;
  const onSale = item.salePrice != null && item.salePrice < item.price;
  return (
    <li className="flex w-36 flex-none flex-col overflow-hidden rounded-card border border-stone-200 bg-stone-0 shadow-card sm:w-44">
      <Link href={`/san-pham/${encodeURIComponent(item.slug)}`} className="block">
        <div className="aspect-square w-full bg-stone-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {item.thumbnail && <img src={item.thumbnail} alt={name} width={176} height={176} loading="lazy" className="h-full w-full object-cover" />}
        </div>
        <div className="p-2">
          {item.brand && <p className="truncate text-xs text-stone-600">{item.brand}</p>}
          <p className="line-clamp-2 min-h-[2.5rem] text-xs text-stone-900">{name}</p>
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-sm font-bold text-stone-900">{formatVnd(onSale ? item.salePrice! : item.price)}</span>
            {onSale && <span className="text-xs text-stone-500 line-through">{formatVnd(item.price)}</span>}
          </div>
          <div className="mt-1 min-h-[1.25rem]">
            {item.timesBought > 1 && (
              <Badge tone="brand" size="sm">
                {reorderText.timesBought(item.timesBought)}
              </Badge>
            )}
          </div>
        </div>
      </Link>
      <div className="mt-auto p-2 pt-0">
        {item.inStock !== false && item.stock > 0 ? (
          <button type="button" onClick={onRebuy} className={`${ui.btnSecondary} w-full`}>
            {reorderText.cardCta}
          </button>
        ) : (
          <p className="flex min-h-11 items-center justify-center text-xs text-stone-600">{reorderText.unavailable}</p>
        )}
      </div>
    </li>
  );
}

/**
 * Kệ "Mua lại": SP khách đã nhận hàng, mới mua trước. Khách mới / chưa đăng nhập / API cũ (404) / lỗi ở lần tải đầu → không render
 * gì (Trang chủ tự dựng khối lỗi "Thử lại" cho lỗi thật). Làm mới lỗi nhưng còn dữ liệu cũ → vẫn hiện kệ cũ kèm một dòng báo nhẹ + "Thử lại",
 * không để kệ biến mất im lặng. Mua lại = 2 chạm rồi tự sang giỏ.
 *
 * `target` là state (chỉ đổi khi chạm nút) nên danh tính ổn định — ReorderSheet khởi tạo lại lựa chọn theo danh tính `target`.
 */
export function PurchasedRail() {
  const q = useBlockQuery(usePurchasedItems(PURCHASED_RAIL_LIMIT));
  const [target, setTarget] = useState<ReorderTarget | null>(null);

  if (q.isLoading) {
    // Khớp khung kệ thật (tiêu đề + hàng thẻ) để dữ liệu về không đẩy nội dung bên dưới.
    return (
      <div data-testid="purchased-rail-loading" aria-hidden="true" className="py-2">
        <Skeleton width={96} height={28} />
        <div className="mt-2 flex gap-2.5 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={144} height={300} rounded="rounded-card" style={{ flex: 'none' }} />
          ))}
        </div>
      </div>
    );
  }
  const items = q.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section aria-label={reorderText.railTitle} className="py-2">
      <h2 className="mb-2 font-display text-lg font-semibold text-stone-900">{reorderText.railTitle}</h2>
      {q.isError && (
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-stone-700">{homeErrorMessage(q.error)}</p>
          <button
            type="button"
            disabled={q.isFetching}
            aria-busy={q.isFetching || undefined}
            aria-label={homeText.retryLabel(reorderText.railTitle)}
            onClick={() => void q.refetch()}
            className={`${ui.btnSecondary} flex-none`}
          >
            {homeText.retry}
          </button>
        </div>
      )}
      <ul className="flex gap-2.5 overflow-x-auto px-1 pb-3 pt-1">
        {items.map((p) => (
          <RebuyTile key={p.variationId} item={p} onRebuy={() => setTarget(itemReorderTarget(p))} />
        ))}
      </ul>
      <ReorderSheet target={target} navigateToCart onClose={() => setTarget(null)} />
    </section>
  );
}
