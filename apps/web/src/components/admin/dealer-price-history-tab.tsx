'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { listDealerPriceHistory, nextPageParam, type DealerPriceChange } from '@/lib/admin-client';
import { formatDateTime } from '@/lib/format-date';
import { formatVnd } from '@/lib/shop-client';
import { useDebounced } from './search-picker';
import { BTN_SECONDARY, FIELD_XS } from './ui';

/** Sổ đổi giá đại lý theo bậc (mới nhất trước): giá cũ → mới, ai đổi, lúc nào. Ghi ở mỗi lần nhập bảng giá đại lý. */
export function DealerPriceHistoryTab() {
  const [typed, setTyped] = useState('');
  const sku = useDebounced(typed.trim(), 300);
  const q = useInfiniteQuery({
    queryKey: ['admin-dealer-price-history', sku],
    queryFn: ({ pageParam }) => listDealerPriceHistory(sku || undefined, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => nextPageParam(last.meta),
  });
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];
  const total = q.data?.pages[0]?.meta.total;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-stone-900">Lịch sử giá đại lý</h2>
        {total !== undefined && <span className="text-xs text-stone-500">{total} lần đổi giá</span>}
      </div>
      <input
        type="search"
        aria-label="Tìm theo SKU"
        placeholder="Tìm theo SKU"
        maxLength={64}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        className={`${FIELD_XS} w-full sm:w-72`}
      />
      {q.isLoading && <p className="text-sm text-stone-500">Đang tải…</p>}
      {q.isError && <p className="text-sm text-danger-fg">Không tải được lịch sử giá.</p>}
      {q.isSuccess && rows.length === 0 && (
        <p className="text-sm text-stone-500">{sku ? `Không có lần đổi giá nào cho SKU "${sku}".` : 'Chưa có lần đổi giá đại lý nào.'}</p>
      )}
      <ul className="space-y-2">
        {rows.map((h) => <PriceRow key={h.id} item={h} />)}
      </ul>
      {q.hasNextPage && (
        <div className="text-center">
          <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className={BTN_SECONDARY}>
            {q.isFetchingNextPage ? 'Đang tải…' : 'Tải thêm'}
          </button>
        </div>
      )}
    </div>
  );
}

function PriceRow({ item: h }: { item: DealerPriceChange }) {
  const name = [h.productName, h.variationName].filter(Boolean).join(' · ');
  const up = h.oldPrice !== null && h.newPrice > h.oldPrice;
  return (
    <li data-price-history className="rounded-card border border-stone-200 bg-stone-0 p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 break-all font-mono text-xs font-medium text-stone-900">{h.sku}</span>
        <span className="shrink-0 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-700">Bậc {h.tierName ?? h.tierId}</span>
      </div>
      {name && <div className="mt-0.5 break-words text-xs text-stone-600">{name}</div>}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        {h.oldPrice === null ? (
          <span className="text-xs text-stone-500">Chưa có giá riêng</span>
        ) : (
          <span className="text-stone-500 line-through decoration-stone-400">{formatVnd(h.oldPrice)}</span>
        )}
        <span aria-hidden="true" className="text-stone-400">→</span>
        <span className={`font-semibold ${up ? 'text-warning-fg' : 'text-forest-700'}`}>{formatVnd(h.newPrice)}</span>
      </div>
      <div className="mt-1 text-xs text-stone-500">
        {h.changedByName ?? 'Không rõ tên người đổi'} · {formatDateTime(h.createdAt)}
      </div>
    </li>
  );
}
