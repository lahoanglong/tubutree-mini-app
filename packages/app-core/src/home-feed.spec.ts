import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHomeFeed, isHomePurchasedRequest, takeHomeRequest, type HomeFeed } from './home-feed';

const fetchPublic = vi.fn();
const fetchMe = vi.fn();
let who: string | null = 'a';
let feed: HomeFeed;

beforeEach(() => {
  vi.clearAllMocks();
  who = 'a';
  feed = createHomeFeed({ fetchPublic, fetchMe, identity: () => who });
});

describe('createHomeFeed', () => {
  it('chưa arm: không gọi request gộp', async () => {
    expect(await feed.takePublic('categories')).toBeNull();
    expect(await feed.takeMe('forYou')).toBeNull();
    expect(fetchPublic).not.toHaveBeenCalled();
    expect(fetchMe).not.toHaveBeenCalled();
  });

  it('nhiều khối dùng MỘT request; mỗi khối chỉ lấy được một lần', async () => {
    fetchPublic.mockResolvedValue({ categories: [{ id: 'c' }], brands: [] });
    feed.arm();
    expect(await feed.takePublic('categories')).toEqual([{ id: 'c' }]);
    expect(await feed.takePublic('brands')).toEqual([]);
    expect(await feed.takePublic('categories')).toBeNull();
    expect(fetchPublic).toHaveBeenCalledTimes(1);
    expect(fetchMe).not.toHaveBeenCalled();
  });

  it('request gộp lỗi hoặc không phải object: mọi khối null, không ném', async () => {
    fetchPublic.mockRejectedValue(new Error('404'));
    fetchMe.mockResolvedValue('x');
    feed.arm();
    expect(await feed.takePublic('flashActive')).toBeNull();
    expect(await feed.takeMe('forYou')).toBeNull();
  });

  it('reset: lần lấy kế tiếp tải lại khối gộp', async () => {
    fetchPublic.mockResolvedValue({ categories: [{ id: 'c' }] });
    feed.arm();
    await feed.takePublic('categories');
    feed.reset();
    expect(await feed.takePublic('categories')).toEqual([{ id: 'c' }]);
    expect(fetchPublic).toHaveBeenCalledTimes(2);
  });

  it('đổi phiên khi còn mở: khối cá nhân của người trước không trao cho người sau', async () => {
    fetchMe.mockResolvedValue({ forYou: [{ id: 'p' }], flashUpcoming: [] });
    feed.arm();
    expect(await feed.takeMe('flashUpcoming')).toEqual([]);
    who = 'b';
    expect(await feed.takeMe('forYou')).toBeNull();
  });

  it('đổi tài khoản khi /home/me còn đang chạy: khối cá nhân của người trước không lọt sang người sau', async () => {
    let resolveMe!: (v: unknown) => void;
    fetchMe.mockReturnValue(new Promise((r) => { resolveMe = r; }));
    feed.arm();
    const taken = feed.takeMe('forYou');
    who = 'b';
    resolveMe({ forYou: [{ id: 'p' }] });
    expect(await taken).toBeNull();
  });
});

describe('takeHomeRequest (web)', () => {
  beforeEach(() => {
    fetchPublic.mockResolvedValue({ publicConfig: { freeshipThreshold: 1 }, flashActive: [{ id: 'f' }], campaigns: [{ id: 'c' }] });
    fetchMe.mockResolvedValue({
      flashUpcoming: [{ id: 'u' }],
      forYou: [{ id: 'p' }],
      activeOrderCount: { count: 2 },
      purchasedItems: { items: [], nextCursor: null },
      shippingOrders: { data: [], total: 0 },
      newCustomerOffer: { eligible: true },
      wasteOpenRequestCount: 3,
    });
    feed.arm();
  });

  it('đúng từng request lẻ của Trang chủ, trả đúng dạng phản hồi của endpoint lẻ', async () => {
    expect(await takeHomeRequest(feed, '/config/public', undefined)).toEqual({ freeshipThreshold: 1 });
    expect(await takeHomeRequest(feed, '/flash-sales/active', undefined)).toEqual([{ id: 'f' }]);
    expect(await takeHomeRequest(feed, '/flash-sales/upcoming', undefined)).toEqual([{ id: 'u' }]);
    expect(await takeHomeRequest(feed, '/products/for-you', undefined)).toEqual([{ id: 'p' }]);
    expect(await takeHomeRequest(feed, '/orders/active-count', undefined)).toEqual({ count: 2 });
    expect(await takeHomeRequest(feed, '/me/purchased-items', { limit: 10 })).toEqual({ items: [], nextCursor: null });
    expect(await takeHomeRequest(feed, '/orders', { status: 'SHIPPING', page: 1, limit: 1 })).toEqual({ data: [], total: 0 });
    expect(await takeHomeRequest(feed, '/me/new-customer-offer', undefined)).toEqual({ eligible: true });
    expect(await takeHomeRequest(feed, '/waste/me/open-count', undefined)).toEqual({ count: 3 });
    expect(fetchPublic).toHaveBeenCalledTimes(1);
    expect(fetchMe).toHaveBeenCalledTimes(1);
  });

  it('banner chiến dịch: chỉ request HOME_TOP không kèm tham số khác lấy từ khối gộp', async () => {
    expect(await takeHomeRequest(feed, '/campaigns', { placement: 'HOME_TOP' })).toEqual([{ id: 'c' }]);
    expect(fetchMe).not.toHaveBeenCalled();
  });

  it('banner OFFERS_TOP hoặc có lọc đối tượng không phải khối của Trang chủ (null, đi request lẻ)', () => {
    expect(takeHomeRequest(feed, '/campaigns', { placement: 'OFFERS_TOP' })).toBeNull();
    expect(takeHomeRequest(feed, '/campaigns', { placement: 'HOME_TOP', audience: 'NEW' })).toBeNull();
    expect(takeHomeRequest(feed, '/campaigns', undefined)).toBeNull();
    expect(fetchPublic).not.toHaveBeenCalled();
  });

  it('gợi ý cá nhân kèm seed ngày VN vẫn lấy từ khối gộp (lần đầu), không đẩy thêm request lẻ', async () => {
    expect(await takeHomeRequest(feed, '/products/for-you', { seed: '20261101' })).toEqual([{ id: 'p' }]);
    expect(fetchMe).toHaveBeenCalledTimes(1);
    expect(takeHomeRequest(feed, '/products/for-you', { seed: '20261101', page: 2 })).toBeNull();
  });

  it('tham số lệch thì không phải request của Trang chủ (null, không gọi gộp)', () => {
    expect(takeHomeRequest(feed, '/me/purchased-items', { limit: 20 })).toBeNull();
    expect(takeHomeRequest(feed, '/me/purchased-items', { limit: 10, cursor: 'x' })).toBeNull();
    expect(takeHomeRequest(feed, '/orders', { status: 'PENDING_PAYMENT', page: 1, limit: 1 })).toBeNull();
    expect(takeHomeRequest(feed, '/orders', { group: 'processing', page: 1, limit: 1 })).toBeNull();
    expect(takeHomeRequest(feed, '/orders', { status: 'SHIPPING', page: 2, limit: 1 })).toBeNull();
    expect(takeHomeRequest(feed, '/config/public', { x: 1 })).toBeNull();
    expect(takeHomeRequest(feed, '/cart', undefined)).toBeNull();
    expect(fetchPublic).not.toHaveBeenCalled();
    expect(fetchMe).not.toHaveBeenCalled();
  });

  it('API cũ không có số yêu cầu đổi rác: null để đi request lẻ', async () => {
    fetchMe.mockResolvedValue({ forYou: [] });
    feed.reset();
    expect(await takeHomeRequest(feed, '/waste/me/open-count', undefined)).toBeNull();
  });
});

describe('isHomePurchasedRequest', () => {
  it('chỉ trang đầu với limit khớp', () => {
    expect(isHomePurchasedRequest({ limit: 10 })).toBe(true);
    expect(isHomePurchasedRequest({ limit: 10, variationId: 'v' })).toBe(false);
    expect(isHomePurchasedRequest({ limit: 5 })).toBe(false);
  });
});
