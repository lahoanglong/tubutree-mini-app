import type { HttpClient } from '../http';
import { fetchHomeCombos, fetchProductBundles } from '../api/bundle';

/** Khớp `maxItems` của kệ `home.combos`. */
export const HOME_COMBOS_LIMIT = 4;

export const bundleKeys = {
  product: (slug: string) => ['bundles', 'product', slug] as const,
  homeCombos: ['bundles', 'home-combos'] as const,
};

export const productBundlesQuery = (http: HttpClient, slug: string) => ({
  queryKey: bundleKeys.product(slug),
  queryFn: () => fetchProductBundles(http, slug),
});

export const homeCombosQuery = (http: HttpClient) => ({
  queryKey: bundleKeys.homeCombos,
  queryFn: () => fetchHomeCombos(http, HOME_COMBOS_LIMIT),
});
