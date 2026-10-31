'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PageResponse, ProductCard } from '@tubutree/app-core/api/catalog';
import type { FlashSaleActiveItem } from '@tubutree/app-core/api/flash-sale';
import type { HomeKindState } from '@tubutree/app-core/home-layout';
import { composeHomeShelves } from '@tubutree/app-core/merch/home-shelves';
import { flashActiveQuery } from '@tubutree/app-core/queries/flash-sale';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { coreHttp } from '@/lib/core-http';
import { loadActiveFlashSales } from '@/lib/use-flash-sales';
import { PURCHASED_RAIL_LIMIT } from '@/components/reorder/purchased-rail';
import { usePurchasedItems } from '@/components/reorder/use-purchased-items';
import { useBlockQuery, type BlockQuery } from './use-block-query';

const STALE = 60_000;

export interface HomeShelves {
  /** Suất Giờ vàng đã chống trùng (≤8; rỗng khi dưới 3 nên khối ẩn). */
  flash: FlashSaleActiveItem[];
  /** Bán chạy nhất đã bỏ món trùng các kệ trên (≤10; rỗng khi dưới 3). */
  bestSellers: ProductCard[];
  /** Slug các món Giờ vàng đang giữ: Mua lại bỏ chúng đi. */
  flashSlugs: ReadonlySet<string>;
  /** Slug mọi món đang hiện ở kệ hàng: lưới Gợi ý hôm nay bỏ chúng. */
  seen: ReadonlySet<string>;
  flashQuery: BlockQuery<FlashSaleActiveItem[]>;
  bestSellerQuery: BlockQuery<PageResponse<ProductCard>>;
}

export interface HomeShelvesInitial {
  /** Suất Giờ vàng server dựng sẵn trong HTML đầu. */
  flash?: FlashSaleActiveItem[];
  bestSellers?: PageResponse<ProductCard>;
}

/**
 * Đầu vào chung của các kệ hàng Trang chủ qua `SHELVES` (Giờ vàng > Mua lại > combos > Bán chạy nhất), bản web của `use-home-shelves.ts` ở Mini App:
 * đọc đúng các query mà khối dùng (cùng khoá, không thêm request) rồi chống trùng theo slug sản phẩm. Kệ chỉ dành khách cũ (Mua lại) không chiếm món
 * của khách mới; loại khách chưa rõ thì chưa tính Mua lại vì khối đó chưa hiện. Combo chờ P15 nên chưa có món.
 * Dữ liệu dựng sẵn (ISR) có ngay ở lần vẽ đầu nên kệ có trong HTML server; Giờ vàng vẫn hỏi lại ngay vì giá và số suất còn là của lúc dựng trang.
 */
export function useHomeShelves(kind: HomeKindState, initial: HomeShelvesInitial = {}): HomeShelves {
  const flashQuery = useBlockQuery(
    useQuery({
      queryKey: flashActiveQuery(coreHttp).queryKey,
      queryFn: loadActiveFlashSales,
      staleTime: 30_000,
      refetchInterval: 60_000,
      ...(initial.flash ? { initialData: initial.flash, initialDataUpdatedAt: 0 } : {}),
    }),
  );
  const purchased = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const bestSellerQuery = useBlockQuery(useQuery({ ...homeBestSellerQuery(coreHttp), ...(initial.bestSellers ? { initialData: initial.bestSellers, staleTime: STALE } : {}) }));

  const flashData = flashQuery.data;
  const purchasedData = purchased.data?.items;
  const bestData = bestSellerQuery.data?.data;
  // Chỉ phụ thuộc dữ liệu (không phải đối tượng query, đổi mỗi lần vẽ) để `seen` giữ nguyên danh tính khi dữ liệu chưa đổi.
  const shelves = useMemo(() => {
    const composed = composeHomeShelves({
      flash: (flashData ?? []).map((item) => ({ id: item.productSlug, item })),
      purchased: kind === 'returning' ? (purchasedData ?? []).map((item) => ({ id: item.slug, item })) : [],
      combos: [],
      bestSellers: (bestData ?? []).map((item) => ({ id: item.slug, item })),
    });
    return {
      flash: composed.flash,
      bestSellers: composed.bestSellers,
      flashSlugs: new Set(composed.flash.map((it) => it.productSlug)) as ReadonlySet<string>,
      seen: composed.seen,
    };
  }, [kind, flashData, purchasedData, bestData]);
  return { ...shelves, flashQuery, bestSellerQuery };
}
