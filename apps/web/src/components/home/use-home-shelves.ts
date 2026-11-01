'use client';

import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BestSellersBasis, BestSellersPage } from '@tubutree/app-core/api/browse';
import type { ProductCard } from '@tubutree/app-core/api/catalog';
import type { FlashSaleActiveItem } from '@tubutree/app-core/api/flash-sale';
import type { BundleDTO } from '@tubutree/app-core/api/bundle';
import { comboView, type ComboView } from '@tubutree/app-core/commerce/bundle-view';
import type { HomeKindState } from '@tubutree/app-core/home-layout';
import { comboShelfEntry, composeHomeShelves, flashExcludedVariations, flashShelfEntry, purchasedShelfEntry } from '@tubutree/app-core/merch/home-shelves';
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
  /** Combo toàn sàn đang chạy (2–4; rỗng khi dưới 2 nên khối ẩn). Combo là đơn vị nguyên: chiếm slug các món của nó cho Bán chạy nhất và Gợi ý hôm nay, nhưng không bị Giờ vàng/Mua lại loại (Mua lại về sau cùng `/home/me`, loại theo nó thì kệ hiện rồi biến mất). */
  combos: ComboView[];
  /** Bán chạy nhất đã bỏ món trùng các kệ trên (≤10; rỗng khi dưới 3). */
  bestSellers: ProductCard[];
  /** Hạng thật của từng món ở `bestSellers` (cùng chỉ số): vị trí trong danh sách xếp theo lượt bán 30 ngày, tính trước khi bỏ món trùng kệ trên. */
  bestSellerRanks: number[];
  /** Thước đo của bảng xếp hạng: `total` khi API cũ chưa có `best_seller_30d` và kệ lùi về tổng lượt bán (phụ đề không được ghi "30 ngày"). */
  bestSellerBasis: BestSellersBasis;
  /** Mọi phân loại còn hạn đang Giờ vàng của các sản phẩm mà kệ Giờ vàng đang vẽ (kể cả phân loại thứ hai của sản phẩm mà kệ chỉ vẽ một thẻ); sản phẩm bị cắt khỏi kệ (quá `maxItems`) và kệ ẩn không góp phân loại nào. Mua lại bỏ đúng những phân loại này, không bỏ phân loại khác của cùng sản phẩm. */
  flashVariationIds: ReadonlySet<string>;
  /** Slug mọi món đang hiện ở kệ hàng (kể cả món trong combo): lưới Gợi ý hôm nay bỏ chúng. */
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
  /** Combo server dựng sẵn trong HTML đầu (rỗng: đã hỏi và không có; vắng: máy chủ hụt, client tự tải). */
  combos?: BundleDTO[];
  /** Lúc máy chủ lấy `combos` (ms): ISR có thể phát HTML cũ hơn hạn dữ liệu, nên combo đã tắt không được coi là tươi thêm 60 giây sau hydrate. */
  combosAt?: number;
}

/**
 * Đầu vào chung của các kệ hàng Trang chủ qua `SHELVES` (Giờ vàng > Mua lại > combos > Bán chạy nhất), bản web của `use-home-shelves.ts` ở Mini App:
 * đọc đúng các query mà khối dùng (cùng khoá, không thêm request) rồi chống trùng theo slug sản phẩm, riêng Mua lại so với Giờ vàng theo phân loại (khách mua Can 5L vẫn thấy nó khi Can 1L đang Giờ vàng). Kệ chỉ dành khách cũ (Mua lại) không chiếm món
 * của khách mới; loại khách chưa rõ thì chưa tính Mua lại vì khối đó chưa hiện. Combo chiếm slug các món của nó (`comboShelfEntry`): Bán chạy nhất và Gợi ý hôm nay bỏ chúng.
 * Dữ liệu dựng sẵn (ISR) có ngay ở lần vẽ đầu nên kệ có trong HTML server, cả combo, nên Bán chạy nhất đã bỏ món trùng combo ngay trong HTML và không có khoảng
 * "chờ combo" để giữ khung như Mini App; chỉ khi máy chủ hụt combo mới tải ở trình duyệt (đi chung request gộp `/home`) và Bán chạy nhất có thể mất món lúc đó. Giờ vàng vẫn hỏi lại ngay vì giá và số suất còn là của lúc dựng trang.
 * Suất đã quá `endAt` không vào chống trùng (khối Giờ vàng cũng không vẽ chúng; nếu để lại, chúng chiếm món và tính vào mức tối thiểu của kệ mà kệ thì
 * ẩn, nên món đó không hiện ở đâu cả). Trước hydrate mọi suất và mọi combo coi là còn giờ, đúng như HTML máy chủ và khối Giờ vàng, để hai bên hydrate cùng một kết quả.
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
  const combosQuery = useQuery({ ...homeCombosQuery(coreHttp), staleTime: STALE, retry: 0, ...(initial.combos ? { initialData: initial.combos, initialDataUpdatedAt: initial.combosAt } : {}) });

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
    // Danh sách gốc còn hạn, trước khi chống trùng theo slug: mỗi sản phẩm chỉ một thẻ ở kệ Giờ vàng nhưng MỌI phân loại của nó đang giảm giá.
    const liveFlash = (flashData ?? []).filter((item) => !hydrated || Date.parse(item.endAt) > now);
    const composed = composeHomeShelves({
      flash: liveFlash.map(flashShelfEntry),
      purchased: kind === 'returning' ? (purchasedData ?? []).map(purchasedShelfEntry) : [],
      // Trước hydrate không kiểm hạn combo (`liveAt` -∞): HTML dựng sẵn đã lọc theo giờ máy chủ lúc dựng, nên hydrate vẽ đúng các combo đó rồi mới kiểm hạn thật.
      combos: (combosData ?? []).flatMap((b) => comboView(b, now, hydrated ? now : Number.NEGATIVE_INFINITY) ?? []).map(comboShelfEntry),
      // Hạng đi cùng món qua bước chống trùng: kệ chỉ vẽ món còn lại nhưng thẻ phải ghi hạng thật, không phải số thứ tự trong kệ đã cắt.
      bestSellers: (bestData ?? []).map((item, i) => ({ id: item.slug, item: { product: item, rank: i + 1 } })),
    });
    return {
      flash: composed.flash,
      combos: composed.combos,
      bestSellers: composed.bestSellers.map((x) => x.product),
      bestSellerRanks: composed.bestSellers.map((x) => x.rank),
      flashVariationIds: flashExcludedVariations(liveFlash, composed.flash),
      seen: composed.seen,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `expiredTick` chỉ để tính lại `serverNow()`.
  }, [kind, flashData, purchasedData, bestData, combosData, hydrated, expiredTick]);
  return { ...shelves, bestSellerBasis, flashQuery, bestSellerQuery, onFlashEnd };
}
