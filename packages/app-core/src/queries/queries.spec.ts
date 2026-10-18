import { describe, expect, it } from 'vitest';
import type { HttpClient } from '../http';
import { fakeHttp } from '../api/fake-http';
import * as account from './account';
import * as brand from './brand';
import * as cart from './cart';
import * as cashback from './cashback';
import * as catalog from './catalog';
import * as checkout from './checkout';
import * as config from './config';
import * as externalPoints from './external-points';
import * as flash from './flash-sale';
import * as geo from './geo';
import * as groupbuy from './groupbuy';
import * as home from './home';
import * as loyalty from './loyalty';
import * as orders from './orders';
import * as payment from './payment';
import * as refill from './refill';
import * as reviews from './reviews';
import * as subs from './subscriptions';
import * as wallet from './wallet';
import * as waste from './waste';
import * as wishlist from './wishlist';

type Q = { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> };
type Case = [name: string, make: (h: HttpClient) => Q, key: readonly unknown[], path: string];

/** queryKey phải GIỐNG HỆT key Mini App đang dùng (cache dùng chung, invalidate theo tiền tố). */
const cases: Case[] = [
  ['product', (h) => catalog.productQuery(h, 'sp'), ['product', 'sp'], '/products/sp'],
  ['related', (h) => catalog.relatedQuery(h, 'sp'), ['related', 'sp'], '/products/sp/related'],
  ['boughtTogether', (h) => catalog.boughtTogetherQuery(h, 'sp'), ['bought-together', 'sp'], '/products/sp/bought-together'],
  ['brands', (h) => catalog.brandsQuery(h), ['brands'], '/brands'],
  ['categories', (h) => catalog.categoriesQuery(h), ['categories'], '/categories'],
  ['forYou', (h) => catalog.forYouQuery(h), ['for-you'], '/products/for-you'],
  ['suggest', (h) => catalog.suggestQuery(h, 'sữa'), ['search-suggest', 'sữa'], '/search/suggest'],
  ['recentlyViewed', (h) => catalog.recentlyViewedQuery(h, ['a', 'b']), ['recently-viewed-products', 'a,b'], '/products'],
  ['catalogCount', (h) => catalog.catalogCountQuery(h, 'q=a', { page: 1, limit: 1 }), ['products', 'count', 'q=a'], '/products'],
  ['suggestedRail', (h) => catalog.suggestedRailQuery(h), ['products', 'suggested-rail'], '/products'],
  ['homeBestSeller', (h) => home.homeBestSellerQuery(h), ['products', 'home-best-seller'], '/products'],
  ['homeFeatured', (h) => home.homeFeaturedQuery(h), ['products', 'home-featured'], '/products'],
  ['homeNewest', (h) => home.homeNewestQuery(h), ['products', 'home-newest'], '/products'],
  ['cart', (h) => cart.cartQuery(h, 'ctv'), ['cart', 'ctv'], '/cart'],
  ['cartNoSlug', (h) => cart.cartQuery(h, null), ['cart', null], '/cart'],
  ['cartSelection', (h) => cart.cartSelectionQuery(h, 'ctv', 'sig', ['a']), ['cart', 'ctv', 'selection', 'sig'], '/cart'],
  ['addresses', (h) => checkout.addressesQuery(h), ['addresses'], '/me/addresses'],
  ['quote', (h) => checkout.quoteQuery(h, 'a1', 5, 'ctv', ['i1', 'i2']), ['quote', 'a1', 5, 'ctv', 'i1,i2'], '/checkout/quote'],
  ['quoteNoItems', (h) => checkout.quoteQuery(h, 'a1', undefined, undefined, undefined), ['quote', 'a1', undefined, undefined, ''], '/checkout/quote'],
  ['couponPreviews', (h) => checkout.couponPreviewsQuery(h, 'sig', { addressId: 'a1' } as never), ['coupon-previews', 'sig'], '/checkout/coupon-previews'],
  ['order', (h) => orders.orderQuery(h, 'T1'), ['order', 'T1'], '/orders/T1'],
  ['ordersList', (h) => orders.ordersListQuery(h, 'all', {}, 1, 20), ['orders', 'list', 'all'], '/orders'],
  ['ordersHomeStrip', (h) => orders.ordersHomeStripQuery(h), ['orders', 'home-strip'], '/orders'],
  ['activeOrderCount', (h) => orders.activeOrderCountQuery(h), ['orders', 'active-count'], '/orders/active-count'],
  ['purchasedItems', (h) => orders.purchasedItemsQuery(h, 10), ['purchased-items', 10], '/me/purchased-items'],
  ['myReturns', (h) => orders.myReturnsQuery(h), ['my-returns'], '/orders/me/returns'],
  ['myRefunds', (h) => orders.myRefundsQuery(h, 'o1'), ['my-refunds', 'o1'], '/orders/me/refunds'],
  ['refundBank', (h) => orders.refundBankQuery(h), ['refund-bank'], '/orders/me/refund-bank'],
  ['returnEstimate', (h) => orders.returnEstimateQuery(h, 'T1', [], 'DEFECTIVE'), ['return-estimate', 'T1', [], 'DEFECTIVE'], '/orders/T1/return-estimate'],
  ['reviews', (h) => reviews.reviewsQuery(h, 'sp'), ['reviews', 'sp'], '/products/sp/reviews'],
  ['canReview', (h) => reviews.canReviewQuery(h, 'sp'), ['can-review', 'sp'], '/products/sp/reviews/can-review'],
  ['myReview', (h) => reviews.myReviewQuery(h, 'r1'), ['my-review', 'r1'], '/reviews/r1'],
  ['flashActive', (h) => flash.flashActiveQuery(h), ['flash-sales', 'active'], '/flash-sales/active'],
  ['flashUpcoming', (h) => flash.flashUpcomingQuery(h), ['flash-sales', 'upcoming'], '/flash-sales/upcoming'],
  ['publicConfig', (h) => config.publicConfigQuery(h), ['public-config'], '/config/public'],
  ['groupBuyList', (h) => groupbuy.groupBuyListQuery(h), ['group-buy'], '/group-buy'],
  ['groupBuyOne', (h) => groupbuy.groupBuyOneQuery(h, 'g1'), ['group-buy', 'one', 'g1'], '/group-buy/g1'],
  ['publicBrand', (h) => brand.publicBrandQuery(h, 'tubu'), ['public-brand', 'tubu'], '/brand/public/tubu'],
  ['brandFollow', (h) => brand.brandFollowQuery(h, 'tubu'), ['brand-follow', 'tubu'], '/brand/tubu/follow-state'],
  ['brandShareToEarn', (h) => brand.brandShareToEarnQuery(h, 'tubu'), ['brand-ste', 'tubu'], '/brand/tubu/share-to-earn'],
  ['subscriptions', (h) => subs.subscriptionsQuery(h), ['subscriptions'], '/me/subscriptions'],
  ['bankQr', (h) => payment.bankQrQuery(h, 'T1'), ['bank-qr', 'T1'], '/payments/bank-qr/T1'],
  ['geoProvinces', (h) => geo.provincesQuery(h), ['geo-provinces'], '/geo/provinces'],
  ['wishlist', (h) => wishlist.wishlistQuery(h), ['wishlist'], '/me/wishlist'],
  ['wishlistIds', (h) => wishlist.wishlistIdsQuery(h), ['wishlist-ids'], '/me/wishlist/ids'],
  ['geoCommunes', (h) => geo.communesQuery(h, 'p'), ['geo-communes', 'p'], '/geo/communes'],
  ['me', (h) => account.meQuery(h), ['me'], '/me'],
  ['notifications', (h) => account.notificationsQuery(h), ['notifications'], '/me/notifications'],
  ['loyalty', (h) => loyalty.loyaltyQuery(h), ['loyalty'], '/me/loyalty'],
  ['coupons', (h) => loyalty.couponsQuery(h), ['coupons'], '/me/coupons'],
  ['pointsTxn', (h) => loyalty.pointsTxnQuery(h), ['points-txn'], '/me/points/transactions'],
  ['checkIn', (h) => loyalty.checkInQuery(h), ['loyalty-checkin'], '/me/loyalty/check-in'],
  ['memberCard', (h) => loyalty.memberCardQuery(h), ['loyalty-member-card'], '/me/loyalty/member-card'],
  ['referral', (h) => loyalty.referralQuery(h), ['referral'], '/me/referral'],
  ['newCustomerOffer', (h) => loyalty.newCustomerOfferQuery(h, 'u1'), ['new-customer-offer', 'u1'], '/me/new-customer-offer'],
  ['rewards', (h) => loyalty.rewardsQuery(h), ['loyalty-rewards'], '/me/loyalty/rewards'],
  ['wallet', (h) => wallet.walletQuery(h), ['wallet'], '/me/wallet'],
  ['externalClaims', (h) => externalPoints.externalClaimsQuery(h, 2, 10), ['external-claims', 2], '/me/external-points/claims'],
  ['cashbackMerchants', (h) => cashback.cashbackMerchantsQuery(h), ['cashback-merchants'], '/cashback/merchants'],
  ['cashbackTxn', (h) => cashback.cashbackTxnQuery(h), ['cashback-txn'], '/cashback/transactions'],
  ['refill', (h) => refill.refillQuery(h), ['refill'], '/refill/me'],
  ['adminRefillPending', (h) => refill.adminRefillPendingQuery(h), ['admin-refill-pending'], '/refill/admin/pending'],
  ['wasteMe', (h) => waste.wasteMeQuery(h), ['waste', 'me'], '/waste/me'],
  ['wasteItems', (h) => waste.wasteItemsQuery(h), ['waste', 'items'], '/waste/items'],
  ['wastePoints', (h) => waste.wastePointsQuery(h, null), ['waste', 'points', null], '/waste/points'],
  ['wasteRequests', (h) => waste.wasteRequestsQuery(h), ['waste', 'requests'], '/waste/requests'],
  ['wasteRequest', (h) => waste.wasteRequestQuery(h, 'r1'), ['waste', 'request', 'r1'], '/waste/requests/r1'],
  ['wasteRules', (h) => waste.wasteRulesQuery(h), ['waste', 'rules'], '/waste/rules'],
  ['deskPoints', (h) => waste.deskPointsQuery(h), ['waste', 'desk'], '/waste/desk/points'],
  ['deskPointReport', (h) => waste.deskPointReportQuery(h, 'p1', '2026-10'), ['waste', 'desk', 'report', 'p1', '2026-10'], '/waste/desk/points/p1/report'],
];

describe('queries — queryKey giống Mini App, queryFn gọi đúng đường dẫn', () => {
  it.each(cases)('%s', async (_name, make, key, path) => {
    const { http, calls } = fakeHttp(() => ({ data: [], meta: {}, coupons: [], count: 0, bank: null }));
    const q = make(http);
    expect(q.queryKey).toEqual(key);
    expect(calls).toHaveLength(0);
    await q.queryFn();
    expect(calls[0]!.path).toBe(path);
  });
});

describe('queries — sao kê ví (infinite)', () => {
  it('khoá con của wallet, queryFn nhận pageParam', async () => {
    const { http, calls } = fakeHttp();
    const q = wallet.walletTransactionsQuery(http);
    expect(q.queryKey).toEqual(['wallet', 'transactions']);
    await q.queryFn({ pageParam: 3 });
    expect(calls).toEqual([{ method: 'get', path: '/me/wallet/transactions', opts: { query: { page: 3, limit: 20 } } }]);
  });
});
