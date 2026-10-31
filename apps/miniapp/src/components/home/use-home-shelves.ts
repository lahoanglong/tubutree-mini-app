import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { HOME_BEST_SELLER_LIMIT, type HomeKindState } from '@tubutree/app-core/home-layout';
import { composeHomeShelves } from '@tubutree/app-core/merch/home-shelves';
import { PURCHASED_RAIL_LIMIT } from '../reorder/purchased-rail';
import { usePurchasedItems } from '../../hooks/use-purchased-items';
import { fetchActiveFlashSales, fetchProducts, type FlashSaleActiveItem, type PageResponse, type ProductCard } from '../../services/shop-api';
import { useBlockQuery, type BlockQuery } from './use-block-query';

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

/**
 * Đầu vào chung của các kệ hàng Trang chủ qua `SHELVES` (Giờ vàng > Mua lại > combos > Bán chạy nhất): đọc đúng các query mà khối dùng (cùng khoá,
 * không thêm request) rồi chống trùng theo slug sản phẩm. Kệ chỉ dành khách cũ (Mua lại) không chiếm món của khách mới; loại khách chưa rõ thì chưa tính Mua lại
 * vì khối đó chưa hiện. Combo chờ P15 nên chưa có món.
 */
export function useHomeShelves(kind: HomeKindState): HomeShelves {
  const flashQuery = useBlockQuery(useQuery({ queryKey: ['flash-sales', 'active'], queryFn: fetchActiveFlashSales, staleTime: 30_000 }));
  const purchased = usePurchasedItems(PURCHASED_RAIL_LIMIT);
  const bestSellerQuery = useBlockQuery(
    useQuery({ queryKey: ['products', 'home-best-seller'], queryFn: () => fetchProducts({ limit: HOME_BEST_SELLER_LIMIT, sort: 'best_seller_30d' }) }),
  );

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
