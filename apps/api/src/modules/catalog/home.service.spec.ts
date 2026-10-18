import { HOME_FEATURED_LIMIT, HOME_SECTION_LIMIT, HomeService } from './home.service';

const page = (ids: string[]) => ({ data: ids.map((id) => ({ id })), meta: { page: 1, limit: 6, total: ids.length } });

function setup() {
  const catalog = {
    list: jest.fn().mockImplementation(async (q: { sort?: string; limit: number }) => page([`${q.sort ?? 'featured'}-${q.limit}`])),
    categories: jest.fn().mockResolvedValue([{ id: 'c1' }]),
    brands: jest.fn().mockResolvedValue([{ brand: 'B', count: 1 }]),
    getForYou: jest.fn().mockResolvedValue([{ id: 'fy' }]),
  };
  const flashSale = {
    listActive: jest.fn().mockResolvedValue([{ itemId: 'f1' }]),
    listUpcoming: jest.fn().mockResolvedValue([{ itemId: 'u1', reminded: true }]),
  };
  const orders = {
    activeCount: jest.fn().mockResolvedValue({ count: 2 }),
    list: jest.fn().mockResolvedValue(page(['o1'])),
  };
  const purchased = { list: jest.fn().mockResolvedValue({ items: [], nextCursor: null }) };
  const subs = { list: jest.fn().mockResolvedValue([]) };
  const notifications = { listForUser: jest.fn().mockResolvedValue([{ id: 'n1' }]) };
  // Mặc định cấu hình là bảng rỗng: mọi khoá rơi về mặc định trong mã của buildPublicConfig.
  const config = { get: jest.fn(async (_key: string, fallback?: unknown) => fallback) };
  const loyalty = { getNewCustomerOffer: jest.fn().mockResolvedValue({ isNewCustomer: true, welcomeVoucher: null }) };
  const svc = new HomeService(
    catalog as never, flashSale as never, orders as never, purchased as never, subs as never, notifications as never, config as never, loyalty as never,
  );
  return { svc, catalog, flashSale, orders, purchased, subs, notifications, config, loyalty };
}

describe('HomeService.getPublic', () => {
  it('gộp đủ 7 khối (kèm cấu hình công khai), dùng đúng tham số lẻ của Home', async () => {
    const { svc, catalog } = setup();
    const r = await svc.getPublic(1000);
    expect(Object.keys(r).sort()).toEqual(['bestSellers', 'brands', 'categories', 'featured', 'flashActive', 'newest', 'publicConfig']);
    const calls = catalog.list.mock.calls.map(([q]) => ({ sort: q.sort, limit: q.limit, page: q.page }));
    expect(calls).toEqual(
      expect.arrayContaining([
        { sort: 'best_seller', limit: HOME_SECTION_LIMIT, page: 1 },
        { sort: undefined, limit: HOME_FEATURED_LIMIT, page: 1 },
        { sort: 'newest', limit: HOME_SECTION_LIMIT, page: 1 },
      ]),
    );
  });

  it('khối lỗi độc lập: chỉ khối đó là null, các khối khác vẫn trả', async () => {
    const { svc, flashSale } = setup();
    flashSale.listActive.mockRejectedValue(new Error('db down'));
    const r = await svc.getPublic(1000);
    expect(r.flashActive).toBeNull();
    expect(r.categories).toEqual([{ id: 'c1' }]);
    expect(r.bestSellers).not.toBeNull();
  });

  it('cache chung 20s: lần gọi thứ hai không chạm DB, hết hạn thì dựng lại', async () => {
    const { svc, catalog } = setup();
    await svc.getPublic(1000);
    await svc.getPublic(1000 + 19_000);
    expect(catalog.categories).toHaveBeenCalledTimes(1);
    await svc.getPublic(1000 + 21_000);
    expect(catalog.categories).toHaveBeenCalledTimes(2);
  });

  it('bản có khối lỗi chỉ cache 3s để thử lại sớm', async () => {
    const { svc, catalog } = setup();
    catalog.brands.mockRejectedValueOnce(new Error('x'));
    expect((await svc.getPublic(1000)).brands).toBeNull();
    expect((await svc.getPublic(1000 + 4_000)).brands).toEqual([{ brand: 'B', count: 1 }]);
  });

  it('nhiều request đồng thời lúc hết cache chỉ dựng một lần', async () => {
    const { svc, catalog } = setup();
    await Promise.all([svc.getPublic(1000), svc.getPublic(1000), svc.getPublic(1000)]);
    expect(catalog.categories).toHaveBeenCalledTimes(1);
  });

  it('flash sale tươi hơn phần còn lại: sau 6s dựng lại flashActive, categories/bestSellers vẫn dùng cache 20s', async () => {
    const { svc, catalog, flashSale } = setup();
    await svc.getPublic(1000);
    flashSale.listActive.mockResolvedValue([{ itemId: 'f2' }]);
    const r = await svc.getPublic(1000 + 6_000);
    expect(flashSale.listActive).toHaveBeenCalledTimes(2);
    expect(r.flashActive).toEqual([{ itemId: 'f2' }]);
    expect(catalog.categories).toHaveBeenCalledTimes(1);
    expect(catalog.list).toHaveBeenCalledTimes(3);
  });

  it('flash trong 2s đầu vẫn dùng cache (không đổ dồn xuống DB)', async () => {
    const { svc, flashSale } = setup();
    await svc.getPublic(1000);
    await svc.getPublic(1000 + 2_000);
    expect(flashSale.listActive).toHaveBeenCalledTimes(1);
  });

  it('khối chậm quá hạn thì thành null, không giữ cả trang', async () => {
    jest.useFakeTimers();
    try {
      const { svc, catalog } = setup();
      catalog.brands.mockReturnValue(new Promise(() => undefined));
      const pending = svc.getPublic(1000);
      await jest.advanceTimersByTimeAsync(3_000);
      const r = await pending;
      expect(r.brands).toBeNull();
      expect(r.categories).toEqual([{ id: 'c1' }]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('không nhận userId: khối công khai không gọi API theo người dùng', async () => {
    const { svc, orders, flashSale, catalog } = setup();
    await svc.getPublic(1000);
    expect(orders.list).not.toHaveBeenCalled();
    expect(flashSale.listUpcoming).not.toHaveBeenCalled();
    expect(catalog.getForYou).not.toHaveBeenCalled();
  });
});

// D2-07b: khối "Quà khách mới" cần cấu hình công khai và ưu đãi của khách mà không thêm request lẻ khi mở Trang chủ (C-037).
describe('HomeService — số liệu cho khối Quà khách mới', () => {
  it('khối publicConfig đúng bằng GET /config/public (cùng hàm dựng), và lỗi thì chỉ khối đó null', async () => {
    const { svc, config } = setup();
    const r = await svc.getPublic(1000);
    expect(r.publicConfig).toMatchObject({
      freeshipThreshold: 200000,
      newCustomer: { welcomeVoucher: { amount: 30000, minOrder: 199000 }, firstOrderFreeShip: { enabled: true, minSubtotal: 199000 } },
      homeNewCustomerLayout: true,
    });
    config.get.mockRejectedValue(new Error('db down'));
    const degraded = await svc.getPublic(1000 + 30_000);
    expect(degraded.publicConfig).toBeNull();
    expect(degraded.bestSellers).not.toBeNull();
  });

  it('khối newCustomerOffer của user: gọi đúng userId, lỗi thì chỉ khối đó null', async () => {
    const { svc, loyalty } = setup();
    const r = await svc.getForUser('u1');
    expect(loyalty.getNewCustomerOffer).toHaveBeenCalledWith('u1');
    expect(r.newCustomerOffer).toEqual({ isNewCustomer: true, welcomeVoucher: null });
    loyalty.getNewCustomerOffer.mockRejectedValue(new Error('boom'));
    const failed = await svc.getForUser('u1');
    expect(failed.newCustomerOffer).toBeNull();
    expect(failed.forYou).toEqual([{ id: 'fy' }]);
  });
});

describe('HomeService.getForUser', () => {
  it('trả khối theo user, truyền đúng userId + purchasedLimit, không cache giữa hai user', async () => {
    const { svc, purchased, orders, flashSale } = setup();
    const r = await svc.getForUser('u1', 10);
    expect(purchased.list).toHaveBeenCalledWith('u1', { limit: 10 });
    expect(orders.list).toHaveBeenCalledWith('u1', { status: 'SHIPPING' }, 1, 1);
    expect(flashSale.listUpcoming).toHaveBeenCalledWith('u1');
    expect(r.activeOrderCount).toEqual({ count: 2 });
    expect(r.purchasedLimit).toBe(10);
    await svc.getForUser('u2');
    expect(orders.activeCount).toHaveBeenCalledTimes(2);
    expect(orders.activeCount).toHaveBeenLastCalledWith('u2');
  });

  it('một khối lỗi (vd subscriptions) không làm hỏng các khối khác', async () => {
    const { svc, subs } = setup();
    subs.list.mockRejectedValue(new Error('boom'));
    const r = await svc.getForUser('u1');
    expect(r.subscriptions).toBeNull();
    expect(r.notifications).toEqual([{ id: 'n1' }]);
    expect(r.forYou).toEqual([{ id: 'fy' }]);
  });
});
