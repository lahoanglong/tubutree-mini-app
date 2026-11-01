import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BestSellersBasis, BestSellersPage } from '@tubutree/app-core/api/browse';
import { comboView, type ComboView } from '@tubutree/app-core/commerce/bundle-view';
import type { HomeKindState } from '@tubutree/app-core/home-layout';
import { COMBO_HOLD_MS, comboShelfEntry, composeHomeShelves } from '@tubutree/app-core/merch/home-shelves';
import { bundleKeys } from '@tubutree/app-core/queries/bundle';
import { PURCHASED_RAIL_LIMIT } from '../reorder/purchased-rail';
import { serverNow } from '../../utils/server-clock';
import { usePurchasedItems } from '../../hooks/use-purchased-items';
import { getHomeCombos } from '../../services/bundle-api';
import { fetchActiveFlashSales, type FlashSaleActiveItem, type ProductCard } from '../../services/shop-api';
import { homeBestSellerQuery } from './home-best-seller-query';
import { useBlockQuery, type BlockQuery } from './use-block-query';

export interface HomeShelves {
  /** Suất Giờ vàng đã chống trùng (≤8; rỗng khi dưới 3 nên khối ẩn). */
  flash: FlashSaleActiveItem[];
  /** Combo toàn sàn đang chạy (2–4; rỗng khi dưới 2 nên khối ẩn). Combo là đơn vị nguyên: chiếm slug các món của nó, và chứa món của Giờ vàng/Mua lại thì bị bỏ cả bộ. */
  combos: ComboView[];
  /** Bán chạy nhất đã bỏ món trùng các kệ trên (≤10; rỗng khi dưới 3). */
  bestSellers: ProductCard[];
  /** Hạng thật của từng món ở `bestSellers` (cùng chỉ số): vị trí trong danh sách xếp theo lượt bán 30 ngày, tính trước khi bỏ món trùng kệ trên. */
  bestSellerRanks: number[];
  /** Thước đo của bảng xếp hạng: `total` khi API cũ chưa có `best_seller_30d` và kệ lùi về tổng lượt bán (phụ đề không được ghi "30 ngày"). */
  bestSellerBasis: BestSellersBasis;
  /** Slug các món Giờ vàng đang giữ: Mua lại bỏ chúng đi. */
  flashSlugs: ReadonlySet<string>;
  /** Slug mọi món đang hiện ở kệ hàng (kể cả món trong combo): lưới Gợi ý hôm nay bỏ chúng. */
  seen: ReadonlySet<string>;
  flashQuery: BlockQuery<FlashSaleActiveItem[]>;
  /** `isLoading` còn true tới khi biết combo (tối đa `COMBO_HOLD_MS`): Bán chạy nhất giữ khung chờ thay vì vẽ món của combo rồi bỏ đi. */
  bestSellerQuery: BlockQuery<BestSellersPage>;
  /** Khối Giờ vàng gọi khi đồng hồ về 0: suất hết giờ rời kệ và thôi chiếm món, món đó trở lại các kệ dưới. */
  onFlashEnd: () => void;
}

/**
 * Đầu vào chung của các kệ hàng Trang chủ qua `SHELVES` (Giờ vàng > Mua lại > combos > Bán chạy nhất): đọc đúng các query mà khối dùng (cùng khoá,
 * không thêm request) rồi chống trùng theo slug sản phẩm. Kệ chỉ dành khách cũ (Mua lại) không chiếm món của khách mới; loại khách chưa rõ thì chưa tính Mua lại
 * vì khối đó chưa hiện. Combo xếp theo id bộ nên không chiếm món (cùng sản phẩm vẫn hiện ở Bán chạy nhất). Suất Giờ vàng đã quá `endAt` không vào chống trùng (khối Giờ vàng cũng không vẽ chúng): nếu để
 * lại, chúng chiếm món và tính vào mức tối thiểu của kệ, còn kệ thì ẩn, nên món đó không hiện ở đâu cả.
 */
export function useHomeShelves(kind: HomeKindState): HomeShelves {
  const flashQuery = useBlockQuery(useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000 }));
  const purchased = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const bestSellerQuery = useBlockQuery(useQuery(homeBestSellerQuery));

  const combosQuery = useQuery({ queryKey: bundleKeys.homeCombos, queryFn: getHomeCombos, staleTime: 60_000, retry: false });
  // Combo chậm hay treo không được giữ khung chờ Bán chạy nhất mãi: quá COMBO_HOLD_MS thì vẽ tiếp, combo về sau mới chống trùng.
  const combosLoading = combosQuery.isLoading;
  const [holdExpired, setHoldExpired] = useState(false);
  useEffect(() => {
    if (!combosLoading) return;
    const timer = setTimeout(() => setHoldExpired(true), COMBO_HOLD_MS);
    return () => clearTimeout(timer);
  }, [combosLoading]);

  // `expiredTick` tăng khi suất sớm nhất đếm về 0 để tính lại theo giờ máy chủ, không phải chờ lần tải tiếp theo của danh sách suất.
  const [expiredTick, setExpiredTick] = useState(0);
  const onFlashEnd = useCallback(() => setExpiredTick((n) => n + 1), []);

  const flashData = flashQuery.data;
  const purchasedData = purchased.data?.items;
  const bestData = bestSellerQuery.data?.data;
  const bestSellerBasis: BestSellersBasis = bestSellerQuery.data?.basis ?? 'days30';
  const combosData = combosQuery.data;
  // Chỉ phụ thuộc dữ liệu (không phải đối tượng query, đổi mỗi lần vẽ) để `seen` giữ nguyên danh tính khi dữ liệu chưa đổi; `expiredTick` chỉ để tính lại `serverNow()`.
  const shelves = useMemo(() => {
    const now = serverNow();
    const composed = composeHomeShelves({
      flash: (flashData ?? []).filter((item) => Date.parse(item.endAt) > now).map((item) => ({ id: item.productSlug, item })),
      purchased: kind === 'returning' ? (purchasedData ?? []).map((item) => ({ id: item.slug, item })) : [],
      combos: (combosData ?? []).flatMap((b) => comboView(b, now) ?? []).map(comboShelfEntry),
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
  }, [kind, flashData, purchasedData, bestData, combosData, expiredTick]);
  const holdBestSellers = combosLoading && !holdExpired;
  return { ...shelves, bestSellerBasis, flashQuery, bestSellerQuery: holdBestSellers ? { ...bestSellerQuery, isLoading: true } : bestSellerQuery, onFlashEnd };
}
