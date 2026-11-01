'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BestSellersBasis, BestSellersPage } from '@tubutree/app-core/api/browse';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import type { FlashSaleActiveItem } from '@tubutree/app-core/api/flash-sale';
import { comboView, type ComboView } from '@tubutree/app-core/commerce/bundle-view';
import type { HomeKindState } from '@tubutree/app-core/home-layout';
import { composeHomeShelves } from '@tubutree/app-core/merch/home-shelves';
import { homeCombosQuery } from '@tubutree/app-core/queries/bundle';
import { flashActiveQuery } from '@tubutree/app-core/queries/flash-sale';
import { homeBestSellerQuery } from '@tubutree/app-core/queries/home';
import { serverNow } from '@tubutree/app-core/server-clock';
import { coreHttp } from '@/lib/core-http';
import { loadActiveFlashSales } from '@/lib/use-flash-sales';
import { useHydrated } from '@/lib/use-hydrated';
import { PURCHASED_RAIL_LIMIT } from '@/components/reorder/purchased-rail';
import { usePurchasedItems } from '@/components/reorder/use-purchased-items';
import { useBlockQuery, type BlockQuery } from './use-block-query';

const STALE = 60_000;

export interface HomeShelves {
  /** Suất Giờ vàng đã chống trùng (≤8; rỗng khi dưới 3 nên khối ẩn). */
  flash: FlashSaleActiveItem[];
  /** Combo toàn sàn đang chạy (2–4; rỗng khi dưới 2 nên khối ẩn). Khoá chống trùng là id bộ, không phải slug: combo không chiếm món của kệ nào. */
  combos: ComboView[];
  /** Bán chạy nhất đã bỏ món trùng các kệ trên (≤10; rỗng khi dưới 3). */
  bestSellers: ProductCard[];
  /** Hạng thật của từng món ở `bestSellers` (cùng chỉ số): vị trí trong danh sách xếp theo lượt bán 30 ngày, tính trước khi bỏ món trùng kệ trên. */
  bestSellerRanks: number[];
  /** Thước đo của bảng xếp hạng: `total` khi API cũ chưa có `best_seller_30d` và kệ lùi về tổng lượt bán (phụ đề không được ghi "30 ngày"). */
  bestSellerBasis: BestSellersBasis;
  /** Slug các món Giờ vàng đang giữ: Mua lại bỏ chúng đi. */
  flashSlugs: ReadonlySet<string>;
  /** Slug mọi món đang hiện ở kệ hàng: lưới Gợi ý hôm nay bỏ chúng. */
  seen: ReadonlySet<string>;
  flashQuery: BlockQuery<FlashSaleActiveItem[]>;
  bestSellerQuery: BlockQuery<BestSellersPage>;
  /** Khối Giờ vàng gọi khi đồng hồ về 0: suất hết giờ rời kệ và thôi chiếm món, món đó trở lại các kệ dưới. */
  onFlashEnd: () => void;
}

export interface HomeShelvesInitial {
  /** Suất Giờ vàng server dựng sẵn trong HTML đầu. */
  flash?: FlashSaleActiveItem[];
  bestSellers?: BestSellersPage;
}

/**
 * Đầu vào chung của các kệ hàng Trang chủ qua `SHELVES` (Giờ vàng > Mua lại > combos > Bán chạy nhất), bản web của `use-home-shelves.ts` ở Mini App:
 * đọc đúng các query mà khối dùng (cùng khoá, không thêm request) rồi chống trùng theo slug sản phẩm. Kệ chỉ dành khách cũ (Mua lại) không chiếm món
 * của khách mới; loại khách chưa rõ thì chưa tính Mua lại vì khối đó chưa hiện. Combo xếp theo id bộ nên không chiếm món (cùng sản phẩm vẫn hiện ở Bán chạy nhất); chỉ tải ở trình duyệt (lúc đó đi chung request gộp `/home`).
 * Dữ liệu dựng sẵn (ISR) có ngay ở lần vẽ đầu nên kệ có trong HTML server; Giờ vàng vẫn hỏi lại ngay vì giá và số suất còn là của lúc dựng trang.
 * Suất đã quá `endAt` không vào chống trùng (khối Giờ vàng cũng không vẽ chúng; nếu để lại, chúng chiếm món và tính vào mức tối thiểu của kệ mà kệ thì
 * ẩn, nên món đó không hiện ở đâu cả). Trước hydrate mọi suất coi là còn giờ, đúng như HTML máy chủ và khối Giờ vàng, để hai bên hydrate cùng một kết quả.
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

  // Lỗi thì không có kệ, không báo lỗi: combo là phần thêm, không phải nội dung chính của Trang chủ.
  const combosQuery = useQuery({ ...homeCombosQuery(coreHttp), staleTime: STALE, retry: 0 });

  const hydrated = useHydrated();
  // `expiredTick` tăng khi suất sớm nhất đếm về 0 để tính lại theo giờ máy chủ, không phải chờ lần tải tiếp theo của danh sách suất.
  const [expiredTick, setExpiredTick] = useState(0);
  const onFlashEnd = useCallback(() => setExpiredTick((n) => n + 1), []);

  const flashData = flashQuery.data;
  const purchasedData = purchased.data?.items;
  const bestData = bestSellerQuery.data?.data;
  const bestSellerBasis: BestSellersBasis = bestSellerQuery.data?.basis ?? 'days30';
  const combosData = combosQuery.data;
  // Chỉ phụ thuộc dữ liệu (không phải đối tượng query, đổi mỗi lần vẽ) để `seen` giữ nguyên danh tính khi dữ liệu chưa đổi.
  const shelves = useMemo(() => {
    const now = serverNow();
    const composed = composeHomeShelves({
      flash: (flashData ?? []).filter((item) => !hydrated || Date.parse(item.endAt) > now).map((item) => ({ id: item.productSlug, item })),
      purchased: kind === 'returning' ? (purchasedData ?? []).map((item) => ({ id: item.slug, item })) : [],
      combos: (combosData ?? []).flatMap((b) => comboView(b, now) ?? []).map((view) => ({ id: view.id, item: view })),
      // Hạng đi cùng món qua bước chống trùng: kệ chỉ vẽ món còn lại nhưng thẻ phải ghi hạng thật, không phải số thứ tự trong kệ đã cắt.
      bestSellers: (bestData ?? []).map((item, i) => ({ id: item.slug, item: { product: item, rank: i + 1 } })),
    });
    return {
      flash: composed.flash,
      combos: composed.combos,
      bestSellers: composed.bestSellers.map((x) => x.product),
      bestSellerRanks: composed.bestSellers.map((x) => x.rank),
      flashSlugs: new Set(composed.flash.map((it) => it.productSlug)) as ReadonlySet<string>,
      seen: composed.seen,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `expiredTick` chỉ để tính lại `serverNow()`.
  }, [kind, flashData, purchasedData, bestData, combosData, hydrated, expiredTick]);
  return { ...shelves, bestSellerBasis, flashQuery, bestSellerQuery, onFlashEnd };
}
