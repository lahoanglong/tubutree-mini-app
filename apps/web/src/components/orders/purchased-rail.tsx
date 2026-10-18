'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { purchasedItemsQuery } from '@tubutree/app-core/queries/orders';
import type { PurchasedItem } from '@tubutree/app-core/api/orders';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { coreHttp } from '@/lib/core-http';
import { useAuthPhase } from '@/lib/auth-phase';
import { formatVnd } from '@/lib/format-vnd';
import { ui } from '@/lib/guest-ui';
import { ReorderSheet } from './reorder-sheet';
import { itemReorderTarget, type ReorderSource, type ReorderTarget } from './reorder';
import type { ReorderNotice } from './use-reorder';

/** Cùng số với Mini App để cùng khoá cache ['purchased-items', 10]. */
export const PURCHASED_RAIL_LIMIT = 10;

const TILE_WIDTH = 148;

/**
 * Kệ "Mua lại": sản phẩm khách đã nhận hàng, mới mua trước. Khách mới / chưa đăng nhập / API cũ (404) / lỗi ở lần tải đầu → không
 * render gì (không có khung lỗi trên đầu trang). Làm mới lỗi nhưng còn dữ liệu cũ → vẫn hiện kệ cũ kèm một dòng báo nhẹ và
 * "Thử lại", không để kệ biến mất im lặng. Mua lại = 2 chạm rồi tự sang giỏ.
 */
export function PurchasedRail({ source, onNotice }: { source: ReorderSource; onNotice?: (n: ReorderNotice) => void }) {
  const authed = useAuthPhase() === 'authenticated';
  // retry:false — API cũ trả 404 thì ẩn kệ ngay.
  const q = useQuery({ ...purchasedItemsQuery(coreHttp, PURCHASED_RAIL_LIMIT), enabled: authed, staleTime: 60_000, retry: false });
  const [target, setTarget] = useState<ReorderTarget | null>(null);

  if (q.isLoading) {
    return (
      <div data-testid="purchased-rail-loading" aria-hidden="true" className="mt-4 pb-3">
        <Skeleton width={96} height={24} />
        <div className="mt-2 flex gap-2.5 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width={TILE_WIDTH} height={240} rounded="rounded-card" style={{ flex: '0 0 auto' }} />
          ))}
        </div>
      </div>
    );
  }
  const items = q.data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <section aria-label="Mua lại" className="mt-4 pb-3">
      <h2 className={ui.sectionTitle}>Mua lại</h2>
      {q.isError && (
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="min-w-0 text-sm text-stone-600">Có chút trục trặc, thử lại nhé</p>
          <button type="button" aria-label="Thử lại Mua lại" onClick={() => void q.refetch()} disabled={q.isFetching} className={ui.btnSecondary}>
            Thử lại
          </button>
        </div>
      )}
      <ul className="-mx-4 mt-2 flex gap-2.5 overflow-x-auto px-4 pb-1">
        {items.map((p) => (
          <RailTile key={p.variationId} item={p} onRebuy={() => setTarget(itemReorderTarget(p))} />
        ))}
      </ul>
      <ReorderSheet target={target} source={source} navigateToCart onNotice={onNotice} onClose={() => setTarget(null)} />
    </section>
  );
}

function RailTile({ item: p, onRebuy }: { item: PurchasedItem; onRebuy: () => void }) {
  const name = p.variationName ? `${p.productName} · ${p.variationName}` : p.productName;
  return (
    <li className={`flex flex-none flex-col gap-2 p-2 ${ui.card}`} style={{ width: TILE_WIDTH }}>
      <Link href={`/san-pham/${encodeURIComponent(p.slug)}`} className="flex flex-col gap-1.5">
        <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-control bg-stone-100">
          {p.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <Package className="h-6 w-6 text-stone-500" aria-hidden="true" />
          )}
        </div>
        <span className="line-clamp-2 min-h-[2.5rem] text-sm text-stone-900">{name}</span>
      </Link>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-semibold text-forest-700">{formatVnd(p.salePrice ?? p.price)}</span>
        {p.salePrice != null && <s className="text-xs text-stone-500">{formatVnd(p.price)}</s>}
      </div>
      {p.timesBought > 1 && (
        <div>
          <Badge tone="brand" size="sm">{`Đã mua ${p.timesBought} lần`}</Badge>
        </div>
      )}
      {p.inStock === false ? (
        <span className="text-xs text-danger-fg">Tạm hết hàng</span>
      ) : null}
      <button type="button" onClick={onRebuy} className={`${ui.btnSecondary} w-full`}>
        Mua lại
      </button>
    </li>
  );
}
