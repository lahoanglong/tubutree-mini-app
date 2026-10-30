import type { HomeMeDTO, HomePublicDTO } from '../../../../packages/app-core/src/api/home';
import type { MockApi } from './mock-api';

/**
 * Dữ liệu `GET /home` + `GET /home/me` đúng dạng API thật cho spec "Trang chủ dùng request gộp". Mock-api mặc định để hai đường này 404 (Trang chủ lùi về
 * request lẻ); chỉ spec này bật chúng, nên spec khác không đổi.
 */
const card = (n: number, name: string) => ({
  id: `hm-${n}`, slug: `hm-sp-${n}`, brand: 'Tubu', name, thumbnail: null, basePrice: 100_000 + n, salePrice: null, isFeatured: false, inStock: true,
});
const pageOf = (data: unknown[], limit: number) => ({ data, meta: { page: 1, limit, total: data.length } });

export const MERGED_FOR_YOU = 'Gợi ý từ request gộp';
export const MERGED_PURCHASED = 'Mua lại từ request gộp';

export const HOME_PUBLIC: HomePublicDTO = {
  bestSellers: pageOf([card(1, 'Bán chạy từ request gộp')], 6),
  featured: pageOf([card(2, 'Nổi bật từ request gộp')], 12),
  newest: pageOf([card(3, 'Mới từ request gộp')], 6),
  flashActive: [],
  categories: [
    { id: 'hm-cat', parentId: null, name: 'Danh mục gộp', slug: 'danh-muc-gop', image: null, sortOrder: 1, productCount: 3 },
  ],
  brands: [{ brand: 'Tubu', count: 3 }],
  publicConfig: { freeshipThreshold: 350_000, subscribeDiscountPct: 0.12 } as HomePublicDTO['publicConfig'],
};

export const HOME_ME: HomeMeDTO = {
  forYou: [card(9, MERGED_FOR_YOU)],
  flashUpcoming: [],
  purchasedItems: {
    items: [{
      variationId: 'hm-v1', productId: 'hm-p1', slug: 'hm-mua-lai', productName: MERGED_PURCHASED, variationName: 'Chanh', brand: 'Tubu',
      thumbnail: null, price: 65_000, salePrice: null, stock: 8, inStock: true, timesBought: 2, retailOnly: false, lastPurchasedAt: '2026-09-10T00:00:00.000Z',
    }],
    nextCursor: null,
  },
  activeOrderCount: { count: 0 },
  shippingOrders: pageOf([], 1) as HomeMeDTO['shippingOrders'],
  subscriptions: [],
  notifications: [],
  newCustomerOffer: { isNewCustomer: false, welcomeVoucher: null } as HomeMeDTO['newCustomerOffer'],
  wasteOpenRequestCount: 0,
  purchasedLimit: 10,
};

/** Các endpoint lẻ mà request gộp đã thay: Trang chủ mở bằng request gộp thì không được gọi chúng. */
export const MERGED_LONE_ENDPOINTS = [
  '/products/for-you',
  '/me/purchased-items',
  '/flash-sales/upcoming',
  '/me/new-customer-offer',
] as const;

export function mockMergedHome(api: MockApi): void {
  api.get('/home', HOME_PUBLIC);
  api.get('/home/me', HOME_ME);
}

export function lonePersonalCalls(api: MockApi): string[] {
  return MERGED_LONE_ENDPOINTS.flatMap((p) => api.callsTo('GET', p).map((c) => `GET ${p}`));
}
