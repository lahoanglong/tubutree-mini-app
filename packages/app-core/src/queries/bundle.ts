import type { HttpClient } from '../http';
import { HOME_COMBOS_LIMIT, fetchGiftLanding, fetchHomeCombos, fetchProductBundles } from '../api/bundle';

export const bundleKeys = {
  product: (slug: string) => ['bundles', 'product', slug] as const,
  homeCombos: ['bundles', 'home-combos'] as const,
  giftLanding: ['bundles', 'gift-landing'] as const,
};

export const productBundlesQuery = (http: HttpClient, slug: string) => ({
  queryKey: bundleKeys.product(slug),
  queryFn: () => fetchProductBundles(http, slug),
});

export const homeCombosQuery = (http: HttpClient) => ({
  queryKey: bundleKeys.homeCombos,
  queryFn: () => fetchHomeCombos(http, HOME_COMBOS_LIMIT),
});

/** Trang Bộ quà tặng: tiền tố `bundles` để "Thêm cả combo" lỗi tồn kho làm mới đúng danh sách này (`BUNDLE_STOCK_KEYS` của Mini App). */
export const giftLandingQuery = (http: HttpClient) => ({
  queryKey: bundleKeys.giftLanding,
  queryFn: () => fetchGiftLanding(http),
  staleTime: 60_000,
});
