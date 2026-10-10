import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./api', () => ({ api: { get: vi.fn(), post: vi.fn() }, getAccessToken: vi.fn(() => 'tok-a') }));

import { api, getAccessToken } from './api';
import { armHomeFeed, disarmHomeFeed, homeProductSlot, resetHomeFeed, takeMeBlock, takePublicBlock, takePurchasedItems } from './home-feed';

const get = api.get as unknown as ReturnType<typeof vi.fn>;

describe('home-feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disarmHomeFeed();
  });

  it('chưa arm (không ở Trang chủ): không gọi request gộp, trả null để service đi request lẻ', async () => {
    expect(await takePublicBlock('categories')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it('arm: nhiều khối cùng dùng MỘT request /home; mỗi khối chỉ lấy được một lần', async () => {
    get.mockResolvedValue({ data: { categories: [{ id: 'c' }], brands: [] } });
    armHomeFeed();
    expect(await takePublicBlock('categories')).toEqual([{ id: 'c' }]);
    expect(await takePublicBlock('brands')).toEqual([]);
    expect(await takePublicBlock('categories')).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/home', expect.anything());
  });

  it('request gộp lỗi → mọi khối null (không ném lỗi)', async () => {
    get.mockRejectedValue(new Error('404'));
    armHomeFeed();
    expect(await takePublicBlock('categories')).toBeNull();
    expect(await takePublicBlock('flashActive')).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('resetHomeFeed: tải lại khối gộp cho lần làm mới kế tiếp', async () => {
    get.mockResolvedValue({ data: { categories: [{ id: 'c' }] } });
    armHomeFeed();
    await takePublicBlock('categories');
    resetHomeFeed();
    expect(await takePublicBlock('categories')).toEqual([{ id: 'c' }]);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('/home/me gửi purchasedLimit; kệ Mua lại chỉ dùng khối gộp khi tham số khớp', async () => {
    get.mockResolvedValue({ data: { purchasedItems: { items: [], nextCursor: null }, activeOrderCount: { count: 2 } } });
    armHomeFeed();
    expect(await takePurchasedItems({ limit: 20 })).toBeNull();
    expect(await takePurchasedItems({ limit: 10, cursor: 'x' })).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(await takePurchasedItems({ limit: 10 })).toEqual({ items: [], nextCursor: null });
    expect(get).toHaveBeenCalledWith('/home/me', expect.objectContaining({ params: { purchasedLimit: 10 } }));
    expect(await takeMeBlock('activeOrderCount')).toEqual({ count: 2 });
  });

  it('đổi tài khoản khi Trang chủ còn mở: khối cá nhân của user cũ không trao cho user mới', async () => {
    const token = getAccessToken as unknown as ReturnType<typeof vi.fn>;
    token.mockReturnValue('tok-a');
    get.mockResolvedValue({ data: { notifications: [{ id: 'n1' }], subscriptions: [] } });
    armHomeFeed();
    expect(await takeMeBlock('subscriptions')).toEqual([]);
    token.mockReturnValue('tok-b');
    expect(await takeMeBlock('notifications')).toBeNull();
    token.mockReturnValue('tok-a');
  });

  it('homeProductSlot chỉ nhận đúng 3 bộ tham số của Home', () => {
    expect(homeProductSlot({ limit: 6, sort: 'best_seller' })).toBe('bestSellers');
    expect(homeProductSlot({ limit: 6, sort: 'newest' })).toBe('newest');
    expect(homeProductSlot({ limit: 12 })).toBe('featured');
    expect(homeProductSlot({ limit: 12, brand: 'x' })).toBeNull();
    expect(homeProductSlot({ limit: 30, sort: 'newest' })).toBeNull();
    expect(homeProductSlot({})).toBeNull();
  });
});
