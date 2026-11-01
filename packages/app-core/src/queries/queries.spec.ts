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
  ['ordersHomeStrip', (h) => orders.ordersHomeStripQuery(h), ['orders', 'home-strip'], '/orders'],
  ['ordersHomeTodo', (h) => orders.ordersHomeTodoQuery(h), ['orders', 'home-todo'], '/orders/home-todo'],
  ['activeOrderCount', (h) => orders.activeOrderCountQuery(h), ['orders', 'active-count'], '/orders/active-count'],
  ['purchasedItems', (h) => orders.purchasedItemsQuery(h, 10), ['purchased-items', 10], '/me/purchased-items'],
  ['myReturns', (h) => orders.myReturnsQuery(h), ['my-returns'], '/orders/me/returns'],
  ['myRefunds', (h) => orders.myRefundsQuery(h, 'o1'), ['my-refunds', 'o1'], '/orders/me/refunds'],
  ['refundBank', (h) => orders.refundBankQuery(h), ['refund-bank'], '/orders/me/refund-bank'],
  ['returnEstimate', (h) => orders.returnEstimateQuery(h, 'T1', [], 'DEFECTIVE'), ['return-estimate', 'T1', [], 'DEFECTIVE'], '/orders/T1/return-estimate'],
  ['flashActive', (h) => flash.flashActiveQuery(h), ['flash-sales', 'active'], '/flash-sales/active'],
  ['flashUpcoming', (h) => flash.flashUpcomingQuery(h), ['flash-sales', 'upcoming'], '/flash-sales/upcoming'],
  ['flashSlots', (h) => flash.flashSlotsQuery(h), ['flash-sales', 'slots'], '/flash-sales/slots'],
  ['flashSlotItems', (h) => flash.flashSlotItemsQuery(h, 's1'), ['flash-sales', 'slots', 's1', 'items'], '/flash-sales/slots/s1/items'],
  ['publicConfig', (h) => config.publicConfigQuery(h), ['public-config'], '/config/public'],
  ['groupBuyList', (h) => groupbuy.groupBuyListQuery(h), ['group-buy', 'list', 'guest'], '/group-buy'],
  ['groupBuyOne', (h) => groupbuy.groupBuyOneQuery(h, 'g1'), ['group-buy', 'one', 'g1', 'guest'], '/group-buy/g1'],
  ['publicBrand', (h) => brand.publicBrandQuery(h, 'tubu'), ['public-brand', 'tubu'], '/brand/public/tubu'],
  ['brandFollow', (h) => brand.brandFollowQuery(h, 'tubu'), ['brand-follow', 'tubu'], '/brand/tubu/follow-state'],
  ['brandShareToEarn', (h) => brand.brandShareToEarnQuery(h, 'tubu'), ['brand-ste', 'tubu'], '/brand/tubu/share-to-earn'],
  ['subscriptions', (h) => subs.subscriptionsQuery(h), ['subscriptions'], '/me/subscriptions'],
  ['geoProvinces', (h) => geo.provincesQuery(h), ['geo-provinces'], '/geo/provinces'],
  ['wishlist', (h) => wishlist.wishlistQuery(h), ['wishlist'], '/me/wishlist'],
  ['wishlistIds', (h) => wishlist.wishlistIdsQuery(h), ['wishlist-ids'], '/me/wishlist/ids'],
  ['geoCommunes', (h) => geo.communesQuery(h, 'p'), ['geo-communes', 'p'], '/geo/communes'],
  ['me', (h) => account.meQuery(h), ['me'], '/me'],
  ['notifications', (h) => account.notificationsQuery(h), ['notifications'], '/me/notifications'],
  ['unreadNotifications', (h) => account.unreadNotificationCountQuery(h), ['notifications', 'unread'], '/me/notifications/unread-count'],
  ['faqs', (h) => config.faqsQuery(h), ['faqs'], '/faqs'],
  ['supportContact', (h) => config.supportContactQuery(h), ['support-contact'], '/config/public'],
  ['loyalty', (h) => loyalty.loyaltyQuery(h), ['loyalty'], '/me/loyalty'],
  ['coupons', (h) => loyalty.couponsQuery(h), ['coupons'], '/me/coupons'],
  ['pointsTxn', (h) => loyalty.pointsTxnQuery(h), ['points-txn'], '/me/points/transactions'],
  ['checkIn', (h) => loyalty.checkInQuery(h), ['loyalty-checkin'], '/me/daily-check-in'],
  ['memberCard', (h) => loyalty.memberCardQuery(h), ['loyalty-member-card'], '/me/loyalty/member-card'],
  ['referral', (h) => loyalty.referralQuery(h), ['referral'], '/me/referral'],
  ['newCustomerOffer', (h) => loyalty.newCustomerOfferQuery(h, 'u1'), ['new-customer-offer', 'u1'], '/me/new-customer-offer'],
  ['rewards', (h) => loyalty.rewardsQuery(h), ['loyalty-rewards'], '/me/loyalty/rewards'],
  ['myRedemptions', (h) => loyalty.myRedemptionsQuery(h), ['loyalty-rewards', 'mine'], '/me/loyalty/rewards/mine'],
  ['wallet', (h) => wallet.walletQuery(h), ['wallet'], '/me/wallet'],
  ['externalClaims', (h) => externalPoints.externalClaimsQuery(h, 2, 10), ['external-claims', 2], '/me/external-points/claims'],
  ['cashbackMerchants', (h) => cashback.cashbackMerchantsQuery(h), ['cashback-merchants'], '/cashback/merchants'],
  ['cashbackTxn', (h) => cashback.cashbackTxnQuery(h), ['cashback-txn'], '/cashback/transactions'],
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

describe('queries — phiên bản thể lệ', () => {
  it('API cũ không trả version: queryFn trả null, không trả undefined (react-query không cho)', async () => {
    const { http } = fakeHttp(() => ({ text: 'Thể lệ' }));
    expect(await waste.wasteRulesVersionQuery(http).queryFn()).toBeNull();
  });
  it('trả đúng số phiên bản khi API có', async () => {
    const { http } = fakeHttp(() => ({ text: 'Thể lệ', version: '2026-10-17.1' }));
    expect(await waste.wasteRulesVersionQuery(http).queryFn()).toBe('2026-10-17.1');
  });
});

describe('queries — danh sách thông báo (infinite)', () => {
  const row = (i: number) => ({ id: `n${i}`, templateCode: 'X', payload: {}, status: 'SENT' as const, sentAt: `2026-10-28T03:00:0${i}.000Z` });

  it('khoá con của ["notifications"] (invalidate cũ vẫn đúng) và khác khoá mảng phẳng; trang đầu không con trỏ', async () => {
    const { http, calls } = fakeHttp();
    const q = account.notificationsInfiniteQuery(http);
    expect(q.queryKey).toEqual(['notifications', 'list']);
    expect(q.queryKey[0]).toBe(account.notificationsQuery(http).queryKey[0]);
    await q.queryFn({ pageParam: undefined });
    await q.queryFn({ pageParam: { before: '2026-10-28T03:00:00.000Z', beforeId: 'n9' } });
    expect(calls.map((c) => c.opts)).toEqual([
      { query: { limit: 20 } },
      { query: { before: '2026-10-28T03:00:00.000Z', beforeId: 'n9', limit: 20 } },
    ]);
  });

  it('trang đủ 20 tin: con trỏ là sentAt + id của tin cuối; trang ít hơn hoặc rỗng: hết tin', () => {
    const full = Array.from({ length: 20 }, (_, i) => row(i % 10));
    expect(account.nextNotificationCursor(full)).toEqual({ before: full[19]!.sentAt, beforeId: full[19]!.id });
    expect(account.nextNotificationCursor(full.slice(0, 19))).toBeUndefined();
    expect(account.nextNotificationCursor([])).toBeUndefined();
    expect(account.nextNotificationCursor(full.slice(0, 5), 5)).toEqual({ before: full[4]!.sentAt, beforeId: full[4]!.id });
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

describe('queries — danh sách đơn và trang Duyệt (infinite)', () => {
  it('ordersListQuery: khoá theo tab, queryFn nhận pageParam', async () => {
    const { http, calls } = fakeHttp();
    const q = orders.ordersListQuery(http, 'shipping', { status: 'SHIPPING' });
    expect(q.queryKey).toEqual(['orders', 'list', 'shipping']);
    await q.queryFn({ pageParam: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe('/orders');
    expect(calls[0]!.opts).toEqual({ query: { status: 'SHIPPING', page: 3, limit: 20 } });
  });

  it('ordersListQuery: không bộ lọc chỉ gửi page và limit', async () => {
    const { http, calls } = fakeHttp();
    await orders.ordersListQuery(http, 'all', {}, 10).queryFn({ pageParam: 2 });
    expect(calls[0]!.opts).toEqual({ query: { page: 2, limit: 10 } });
  });

  it('browseQuery: khoá theo urlKey, queryFn dựng truy vấn từ pageParam', async () => {
    const { http, calls } = fakeHttp(() => ({ data: [], meta: {} }));
    const q = catalog.browseQuery(http, 'k1', (page) => ({ page, limit: 20 }));
    expect(q.queryKey).toEqual(['products', 'browse', 'k1']);
    await q.queryFn({ pageParam: 4 });
    expect(calls[0]!.path).toBe('/products');
    expect(calls[0]!.opts).toEqual({ query: expect.objectContaining({ page: 4, limit: 20 }) });
  });

  it('wasteByOrderQuery: khoá con của waste, gọi by-order', async () => {
    const { http, calls } = fakeHttp();
    const q = waste.wasteByOrderQuery(http, 'o1');
    expect(q.queryKey).toEqual(['waste', 'by-order', 'o1']);
    await q.queryFn();
    expect(calls[0]!.path).toBe('/waste/requests/by-order/o1');
  });
});

describe('makeFlashRefetchInterval (B-132)', () => {
  const NOW = Date.parse('2026-10-27T10:00:00Z');
  const poll = flash.makeFlashRefetchInterval(() => NOW);
  const at = (ms: number) => ({ endAt: new Date(NOW + ms).toISOString() });

  it('không có suất hoặc chưa có dữ liệu: không thêm request', () => {
    expect(poll({ state: { data: [] } })).toBe(false);
    expect(poll({ state: { data: undefined } })).toBe(false);
  });

  it('mốc kết thúc còn xa hơn một phút: nhịp 60 giây', () => {
    expect(poll({ state: { data: [at(3_600_000)] } })).toBe(60_000);
  });

  it('mốc kết thúc gần nhất trong vòng một phút: tải lại đúng lúc đó (từ 5 giây trở lên), lấy suất sớm nhất', () => {
    expect(poll({ state: { data: [at(3_600_000), at(12_500)] } })).toBe(12_500);
  });

  it('đã quá mốc hoặc sát mốc: tối thiểu 5 giây (phản hồi được cache tới 10 giây), không dồn request', () => {
    expect(poll({ state: { data: [at(-5_000)] } })).toBe(5_000);
    expect(poll({ state: { data: [at(300)] } })).toBe(5_000);
    expect(poll({ state: { data: [at(5_000)] } })).toBe(5_000);
    expect(poll({ state: { data: [at(7_000)] } })).toBe(7_000);
  });

  it('suất không có endAt hợp lệ: nhịp 60 giây', () => {
    expect(poll({ state: { data: [{}, { endAt: 'abc' }] } })).toBe(60_000);
  });
});

describe('groupBuyOneQuery gắn với người xem (E-44)', () => {
  it('khách và người đã đăng nhập không dùng chung bản chi tiết nhóm (joined/couponCode theo người xem)', async () => {
    const { groupBuyOneQuery } = await import('./groupbuy');
    const http = {} as never;
    expect(groupBuyOneQuery(http, 'g1', 'guest').queryKey).not.toEqual(groupBuyOneQuery(http, 'g1', 'u1').queryKey);
    expect(groupBuyOneQuery(http, 'g1', 'u1').queryKey).toEqual(['group-buy', 'one', 'g1', 'u1']);
  });
});

describe('groupBuyListQuery gắn với người xem (R-25)', () => {
  it('khách và thành viên có khoá khác nhau, nên đăng nhập xong không dùng lại danh sách của khách', async () => {
    const { groupBuyListQuery } = await import('./groupbuy');
    const http = {} as never;
    expect(groupBuyListQuery(http, 'guest').queryKey).not.toEqual(groupBuyListQuery(http, 'u1').queryKey);
    expect(groupBuyListQuery(http, 'u1').queryKey).toEqual(['group-buy', 'list', 'u1']);
  });
});
