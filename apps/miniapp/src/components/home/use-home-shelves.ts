import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { BestSellersBasis, BestSellersPage } from '@tubutree/app-core/api/browse';
import { comboView, type ComboView } from '@tubutree/app-core/commerce/bundle-view';
import { quickReorderShelfItems } from '@tubutree/app-core/commerce/quick-reorder';
import { homePromoPick, type HomeKindState, type HomePromoKind } from '@tubutree/app-core/home-layout';
import { COMBO_HOLD_MS, comboShelfEntry, composeHomeShelves, flashExcludedVariations, flashShelfEntry, imageFirst, purchasedShelfEntry } from '@tubutree/app-core/merch/home-shelves';
import { bundleKeys } from '@tubutree/app-core/queries/bundle';
import { PURCHASED_RAIL_LIMIT } from '../reorder/purchased-rail';
import { serverNow } from '../../utils/server-clock';
import { usePurchasedItems } from '../../hooks/use-purchased-items';
import { getHomeCombos } from '../../services/bundle-api';
import { fetchActiveFlashSales, type FlashSaleActiveItem, type ProductCard } from '../../services/shop-api';
import { homeBestSellerQuery } from './home-best-seller-query';
import { useBlockQuery, type BlockQuery } from './use-block-query';

/** Những gì ngoài các kệ mà ô khuyến mãi cần biết để chọn Giờ vàng, banner hay combo (`homePromoPick`). Thiếu thì coi như không có banner và không nhớ lần mở trước. */
export interface HomePromoInput {
  bannerSlides: number;
  bannerPending: boolean;
  bannerRemembered: boolean;
  flashRemembered: boolean;
}
const NO_PROMO_INPUT: HomePromoInput = { bannerSlides: 0, bannerPending: false, bannerRemembered: false, flashRemembered: false };

export interface HomeShelves {
  /** MỘT ô khuyến mãi dưới kệ Bán chạy nhất: Giờ vàng > banner > combo; `null` thì ô ẩn hẳn. Combo chỉ chiếm món khi là ô được chọn. */
  promo: HomePromoKind | null;
  /** Suất Giờ vàng đã chống trùng (≤8; rỗng khi dưới 3 nên khối ẩn). */
  flash: FlashSaleActiveItem[];
  /** Combo toàn sàn đang chạy (2–4; rỗng khi dưới 2 nên khối ẩn, và rỗng khi ô khuyến mãi là Giờ vàng hay banner: combo không được vẽ thì không chiếm món). Combo là đơn vị nguyên: chiếm slug các món của nó cho Bán chạy nhất và Gợi ý hôm nay, nhưng không bị Giờ vàng/Mua lại loại (Mua lại về sau cùng `/home/me`, loại theo nó thì kệ hiện rồi biến mất). */
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
  /** `isLoading` còn true tới khi biết combo (tối đa `COMBO_HOLD_MS`): Bán chạy nhất giữ khung chờ thay vì vẽ món của combo rồi bỏ đi. */
  bestSellerQuery: BlockQuery<BestSellersPage>;
  /** Khối Giờ vàng gọi khi đồng hồ về 0: suất hết giờ rời kệ và thôi chiếm món, món đó trở lại các kệ dưới. */
  onFlashEnd: () => void;
}

/**
 * Đầu vào chung của các kệ hàng Trang chủ qua `SHELVES` (Giờ vàng > Mua lại > combos > Bán chạy nhất): đọc đúng các query mà khối dùng (cùng khoá,
 * không thêm request) rồi chống trùng theo slug sản phẩm, riêng Mua lại so với Giờ vàng theo phân loại (khách mua Can 5L vẫn thấy nó khi Can 1L đang Giờ vàng). Kệ chỉ dành khách cũ (Mua lại) không chiếm món của khách mới; loại khách chưa rõ thì chưa tính Mua lại
 * vì khối đó chưa hiện. Combo chiếm slug các món của nó (`comboShelfEntry`) nên Bán chạy nhất và Gợi ý hôm nay bỏ chúng; vì combo và Bán chạy nhất cùng đến từ request
 * gộp `/home`, Bán chạy nhất chờ combo (có hạn `COMBO_HOLD_MS`) rồi mới vẽ, để món không hiện rồi biến mất. Suất Giờ vàng đã quá `endAt` không vào chống trùng
 * (khối Giờ vàng cũng không vẽ chúng): nếu để lại, chúng chiếm món và tính vào mức tối thiểu của kệ, còn kệ thì ẩn, nên món đó không hiện ở đâu cả.
 */
export function useHomeShelves(kind: HomeKindState, promoInput: HomePromoInput = NO_PROMO_INPUT): HomeShelves {
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
  const base = useMemo(() => {
    const now = serverNow();
    // Danh sách gốc còn hạn, trước khi chống trùng theo slug: mỗi sản phẩm chỉ một thẻ ở kệ Giờ vàng nhưng MỌI phân loại của nó đang giảm giá.
    const liveFlash = (flashData ?? []).filter((item) => Date.parse(item.endAt) > now);
    return {
      liveFlash,
      entries: {
        flash: liveFlash.map(flashShelfEntry),
        purchased: kind === 'returning' ? quickReorderShelfItems(purchasedData ?? []).map(purchasedShelfEntry) : [],
        combos: (combosData ?? []).flatMap((b) => comboView(b, now) ?? []).map(comboShelfEntry),
        // Hạng đi cùng món qua bước chống trùng: kệ chỉ vẽ món còn lại nhưng thẻ phải ghi hạng thật, không phải số thứ tự trong kệ đã cắt.
        // Hạng gắn TRƯỚC khi xếp món có ảnh lên đầu (ô lá thay thế không nằm giữa màn đầu): hạng hụt thì thẻ chỉ ghi "Bán chạy" (`ranksAreSequential`).
        bestSellers: imageFirst(
          (bestData ?? []).map((item, i) => ({ product: item, rank: i + 1 })),
          (x) => Boolean(x.product.thumbnail?.trim()),
        ).map((x) => ({ id: x.product.slug, item: x })),
      },
    };
  }, [kind, flashData, purchasedData, bestData, combosData, expiredTick]);
  // Giờ vàng đứng đầu thứ tự chống trùng nên số món của nó không phụ thuộc combo: chọn ô khuyến mãi trước, rồi combo chỉ chiếm món của Bán chạy nhất khi chính nó là ô được vẽ
  // (combo bị ẩn mà vẫn lấy món thì Bán chạy nhất và Gợi ý thiếu món vô cớ).
  const withCombos = useMemo(() => composeHomeShelves(base.entries), [base]);
  const promo = homePromoPick({
    flashItems: withCombos.flash.length,
    flashPending: flashQuery.isLoading,
    flashRemembered: promoInput.flashRemembered,
    bannerSlides: promoInput.bannerSlides,
    bannerPending: promoInput.bannerPending,
    bannerRemembered: promoInput.bannerRemembered,
    combos: withCombos.combos.length,
  });
  const composed = useMemo(() => (promo === 'combos' ? withCombos : composeHomeShelves({ ...base.entries, combos: [] as typeof base.entries.combos })), [promo, withCombos, base]);
  const shelves = useMemo(
    () => ({
      flash: composed.flash,
      combos: composed.combos,
      bestSellers: composed.bestSellers.map((x) => x.product),
      bestSellerRanks: composed.bestSellers.map((x) => x.rank),
      flashVariationIds: flashExcludedVariations(base.liveFlash, composed.flash),
      seen: composed.seen,
    }),
    [composed, base],
  );
  // Combo chỉ chiếm món khi chính nó là ô khuyến mãi: Giờ vàng hay banner đã thắng thì combo về chậm cũng không đổi Bán chạy nhất, không cần giữ khung chờ.
  const holdBestSellers = combosLoading && !holdExpired && promo !== 'flash' && promo !== 'banner';
  return { ...shelves, promo, bestSellerBasis, flashQuery, bestSellerQuery: holdBestSellers ? (Object.create(bestSellerQuery, { isLoading: { value: true, enumerable: true } }) as BlockQuery<BestSellersPage>) : bestSellerQuery, onFlashEnd };
}
