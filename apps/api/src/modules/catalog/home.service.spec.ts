import { HOME_BEST_SELLER_LIMIT, HOME_COMBOS_LIMIT, HOME_FEATURED_LIMIT, HOME_SECTION_LIMIT, HomeService } from './home.service';

const page = (ids: string[]) => ({ data: ids.map((id) => ({ id })), meta: { page: 1, limit: 6, total: ids.length } });

function setup() {
  const catalog = {
    list: jest.fn().mockImplementation(async (q: { sort?: string; limit: number }) => page([`${q.sort ?? 'featured'}-${q.limit}`])),
    categories: jest.fn().mockResolvedValue([{ id: 'c1' }]),
    brands: jest.fn().mockResolvedValue([{ brand: 'B', count: 1 }]),
    getForYou: jest.fn().mockResolvedValue([{ id: 'fy' }]),
    cardsByIds: jest.fn().mockResolvedValue([]),
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
  // Một câu SQL cho mọi số đếm của khách: không có dòng đơn nào, 2 yêu cầu đổi rác đang mở.
  const factRows = (orders: Record<string, number> = {}, wasteOpen = 2) => [
    ...Object.entries(orders).map(([key, n]) => ({ kind: 'order', key, n })),
    { kind: 'waste', key: 'open', n: wasteOpen },
  ];
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue(factRows()),
    membershipTier: { findMany: jest.fn().mockResolvedValue([]) },
    wasteRequest: { count: jest.fn().mockResolvedValue(2) },
    campaign: { findMany: jest.fn().mockResolvedValue([]) },
    bundle: { findMany: jest.fn().mockResolvedValue([]) },
    variation: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const svc = new HomeService(
    catalog as never, flashSale as never, orders as never, purchased as never, subs as never, notifications as never, config as never, loyalty as never,
    prisma as never,
  );
  return { svc, catalog, flashSale, orders, purchased, subs, notifications, config, loyalty, prisma, factRows };
}

describe('HomeService.getPublic', () => {
  it('gộp đủ 9 khối (kèm cấu hình công khai, banner chiến dịch và combo), dùng đúng tham số lẻ của Home', async () => {
    const { svc, catalog } = setup();
    const r = await svc.getPublic(1000);
    expect(Object.keys(r).sort()).toEqual(['bestSellers', 'brands', 'campaigns', 'categories', 'combos', 'featured', 'flashActive', 'newest', 'publicConfig']);
    const calls = catalog.list.mock.calls.map(([q]) => ({ sort: q.sort, limit: q.limit, page: q.page }));
    expect(calls).toEqual(
      expect.arrayContaining([
        { sort: 'best_seller_30d', limit: HOME_BEST_SELLER_LIMIT, page: 1 },
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

  it('flash lấy từ cache: serverNow vẫn là giờ lúc trả phản hồi, không phải giờ lúc dựng cache', async () => {
    const { svc, flashSale } = setup();
    flashSale.listActive.mockResolvedValue([{ itemId: 'f1', serverNow: new Date(0).toISOString() }]);
    await svc.getPublic(0);
    const r = await svc.getPublic(2_000);
    expect(flashSale.listActive).toHaveBeenCalledTimes(1);
    expect((r.flashActive as { serverNow: string }[])[0]!.serverNow).toBe(new Date(2_000).toISOString());
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

describe('HomeService.getPublic — banner chiến dịch', () => {
  const liveRow = {
    id: 'c1',
    slug: 'giua-thu',
    title: 'Giữa Thu',
    image: 'https://cdn.example.com/a.jpg',
    linkType: 'CAMPAIGN_PAGE',
    linkValue: null,
    audience: 'NEW',
    startAt: new Date('2026-11-01T00:00:00Z'),
    endAt: new Date('2026-11-11T16:59:59Z'),
  };

  it('khối campaigns là banner HOME_TOP đang chạy, hỏi không kèm đối tượng để blob dùng chung cho mọi khách', async () => {
    const { svc, prisma } = setup();
    prisma.campaign.findMany.mockResolvedValue([liveRow]);
    const r = await svc.getPublic(1000);
    expect(r.campaigns).toEqual([
      { id: 'c1', slug: 'giua-thu', title: 'Giữa Thu', image: 'https://cdn.example.com/a.jpg', linkType: 'CAMPAIGN_PAGE', linkValue: null, audience: 'NEW', startAt: '2026-11-01T00:00:00.000Z', endAt: '2026-11-11T16:59:59.000Z' },
    ]);
    const where = prisma.campaign.findMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ placement: 'HOME_TOP', isActive: true });
    expect(where).not.toHaveProperty('audience');
  });

  it('không có chiến dịch: mảng rỗng (khác null = lỗi), client ẩn cả khối', async () => {
    const { svc } = setup();
    expect((await svc.getPublic(1000)).campaigns).toEqual([]);
  });

  it('truy vấn lỗi: chỉ khối campaigns null, các khối khác còn nguyên', async () => {
    const { svc, prisma } = setup();
    prisma.campaign.findMany.mockRejectedValue(new Error('db down'));
    const r = await svc.getPublic(1000);
    expect(r.campaigns).toBeNull();
    expect(r.categories).toEqual([{ id: 'c1' }]);
    expect(r.bestSellers).not.toBeNull();
  });

  describe('khối combos (combo toàn sàn)', () => {
    const comboRow = (id: string) => ({
      id,
      kind: 'BUNDLE_PCT',
      title: `Combo ${id}`,
      pct: 10,
      endAt: new Date('2099-01-01T00:00:00Z'),
      anchorProductId: null,
      anchorProduct: null,
      items: ['a', 'b'].map((n) => ({ productId: `${id}${n}`, variationId: null, addonPrice: null, maxQty: 1, product: { storefrontId: null } })),
    });
    const cardFor = (id: string) => ({ id, slug: id, brand: 'B', name: id, thumbnail: null, basePrice: 50_000, salePrice: null, repVariationId: `v-${id}`, isFeatured: false, inStock: true });

    it('là combo đang chạy đủ hàng, cùng nội dung GET /bundles/combos, lấy đúng HOME_COMBOS_LIMIT combo', async () => {
      const { svc, prisma, catalog } = setup();
      prisma.bundle.findMany.mockResolvedValue([comboRow('c1'), comboRow('c2')]);
      catalog.cardsByIds.mockImplementation(async (ids: string[]) => ids.map(cardFor));
      const r = await svc.getPublic(1000);
      expect(r.combos?.map((b) => b.id)).toEqual(['c1', 'c2']);
      expect(r.combos?.[0]?.items.map((i) => i.variationId)).toEqual(['v-c1a', 'v-c1b']);
      const where = prisma.bundle.findMany.mock.calls[0]![0].where;
      expect(where).toMatchObject({ kind: 'BUNDLE_PCT', isActive: true });
      expect(prisma.bundle.findMany.mock.calls[0]![0].take).toBe(HOME_COMBOS_LIMIT * 3);
    });

    it('không có combo: mảng rỗng (khác null = lỗi), client ẩn cả khối', async () => {
      const { svc } = setup();
      expect((await svc.getPublic(1000)).combos).toEqual([]);
    });

    it('truy vấn lỗi: chỉ khối combos null, các khối khác còn nguyên', async () => {
      const { svc, prisma } = setup();
      prisma.bundle.findMany.mockRejectedValue(new Error('db down'));
      const r = await svc.getPublic(1000);
      expect(r.combos).toBeNull();
      expect(r.campaigns).toEqual([]);
      expect(r.bestSellers).not.toBeNull();
    });
  });

  it('cache chung 20s: hai request cùng TTL chỉ một lần findMany', async () => {
    const { svc, prisma } = setup();
    await svc.getPublic(1000);
    await svc.getPublic(1000 + 15_000);
    expect(prisma.campaign.findMany).toHaveBeenCalledTimes(1);
    await svc.getPublic(1000 + 21_000);
    expect(prisma.campaign.findMany).toHaveBeenCalledTimes(2);
  });
});

// D2-07b: khối "Quà khách mới" cần cấu hình công khai và ưu đãi của khách mà không thêm request lẻ khi mở Trang chủ (C-037).
describe('HomeService — số liệu cho khối Quà khách mới', () => {
  it('khối publicConfig đúng bằng GET /config/public (cùng hàm dựng), và lỗi thì chỉ khối đó null', async () => {
    const { svc, config } = setup();
    const r = await svc.getPublic(1000);
    expect(r.publicConfig).toMatchObject({
      freeshipThreshold: 199000,
      newCustomer: { welcomeVoucher: { amount: 30000, minOrder: 199000 }, firstOrderFreeShip: { enabled: true, minSubtotal: 199000 } },
    });
    config.get.mockRejectedValue(new Error('db down'));
    const degraded = await svc.getPublic(1000 + 30_000);
    expect(degraded.publicConfig).toBeNull();
    expect(degraded.bestSellers).not.toBeNull();
  });

  it('khối newCustomerOffer của user: gọi đúng userId, lỗi thì chỉ khối đó null', async () => {
    const { svc, loyalty } = setup();
    const r = await svc.getForUser('u1');
    expect(loyalty.getNewCustomerOffer).toHaveBeenCalledWith('u1', { hasPriorOrder: false });
    expect(r.newCustomerOffer).toEqual({ isNewCustomer: true, welcomeVoucher: null });
    loyalty.getNewCustomerOffer.mockRejectedValue(new Error('boom'));
    const failed = await svc.getForUser('u1');
    expect(failed.newCustomerOffer).toBeNull();
    expect(failed.forYou).toEqual([{ id: 'fy' }]);
  });
});

describe('HomeService.getForUser — yêu cầu đổi rác đang mở', () => {
  it('đếm đúng yêu cầu của chính user bằng cùng câu SQL với số đơn, chỉ một câu cho cả hai', async () => {
    const { svc, prisma } = setup();
    const r = await svc.getForUser('u1');
    expect(r.wasteOpenRequestCount).toBe(2);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const [sql] = prisma.$queryRaw.mock.calls[0] as [{ values: unknown[] }];
    expect(sql.values).toEqual(['u1', 'u1', 'OPEN', 'IN_TRANSIT', 'RECEIVED']);
  });

  it('câu đếm lỗi: các khối rơi về đường gọi thẳng từng dịch vụ như trước, không khối nào thành null', async () => {
    const { svc, prisma, catalog, purchased, orders, loyalty } = setup();
    prisma.$queryRaw.mockRejectedValue(new Error('boom'));
    const r = await svc.getForUser('u1', 10);
    expect(r.wasteOpenRequestCount).toBe(2);
    expect(prisma.wasteRequest.count).toHaveBeenCalledWith({ where: { userId: 'u1', status: { in: ['OPEN', 'IN_TRANSIT', 'RECEIVED'] } } });
    expect(r.activeOrderCount).toEqual({ count: 2 });
    expect(orders.activeCount).toHaveBeenCalledWith('u1');
    expect(r.forYou).toEqual([{ id: 'fy' }]);
    expect(catalog.getForYou).toHaveBeenCalledWith('u1', { seed: expect.stringMatching(/^\d{8}$/) });
    expect(purchased.list).toHaveBeenCalledWith('u1', { limit: 10 });
    expect(orders.list).toHaveBeenCalledWith('u1', { status: 'SHIPPING' }, 1, 1);
    expect(r.shippingOrders).toEqual(page(['o1']));
    expect(loyalty.getNewCustomerOffer).toHaveBeenCalledWith('u1', {});
    expect(r.notifications).toEqual([{ id: 'n1' }]);
  });

  it('câu đếm treo: quá hạn riêng (ngắn) rồi rơi về đường cũ, các khối còn nguyên ngân sách thời gian của mình', async () => {
    jest.useFakeTimers();
    try {
      const { svc, prisma, catalog } = setup();
      prisma.$queryRaw.mockReturnValue(new Promise(() => undefined));
      const pending = svc.getForUser('u1');
      await jest.advanceTimersByTimeAsync(1_100);
      expect(catalog.getForYou).toHaveBeenCalledWith('u1', { seed: expect.stringMatching(/^\d{8}$/) });
      const r = await pending;
      expect(r.forYou).toEqual([{ id: 'fy' }]);
      expect(r.activeOrderCount).toEqual({ count: 2 });
      expect(r.wasteOpenRequestCount).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('hạn chung từ lúc request bắt đầu: câu đếm 0,99 s rồi khối chậm thì tổng không quá 2,5 s', async () => {
    jest.useFakeTimers();
    try {
      const { svc, prisma, catalog } = setup();
      prisma.$queryRaw.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([{ kind: 'waste', key: 'open', n: 0 }]), 990)));
      catalog.getForYou.mockReturnValue(new Promise(() => undefined));
      let done = false;
      const pending = svc.getForUser('u1').then((r) => {
        done = true;
        return r;
      });
      await jest.advanceTimersByTimeAsync(2_500);
      expect(done).toBe(true);
      expect((await pending).forYou).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('HomeService.getForUser', () => {
  it('khách chưa có đơn: không gọi kệ Mua lại, danh sách đơn đang giao; đầu ra như trước (rỗng)', async () => {
    const { svc, purchased, orders, catalog } = setup();
    const r = await svc.getForUser('u1', 10);
    expect(purchased.list).not.toHaveBeenCalled();
    expect(orders.list).not.toHaveBeenCalled();
    expect(catalog.getForYou).toHaveBeenCalledWith('u1', { hasOrders: false, seed: expect.stringMatching(/^\d{8}$/) });
    expect(r.purchasedItems).toEqual({ items: [], nextCursor: null });
    expect(r.shippingOrders).toEqual({ data: [], meta: { page: 1, limit: 1, total: 0 } });
    expect(r.activeOrderCount).toEqual({ count: 0 });
    expect(r.purchasedLimit).toBe(10);
  });

  it('khách có đơn giao, đang giao, chờ thanh toán: gọi đúng dịch vụ, đếm đơn đang xử lý đúng nhóm, bỏ qua ưu đãi khách mới', async () => {
    const { svc, purchased, orders, flashSale, loyalty, prisma, factRows } = setup();
    prisma.$queryRaw.mockResolvedValue(factRows({ DELIVERED: 3, SHIPPING: 1, PENDING_PAYMENT: 2, CANCELLED: 4, RETURNED: 1 }));
    const r = await svc.getForUser('u1', 10);
    expect(purchased.list).toHaveBeenCalledWith('u1', { limit: 10 });
    expect(orders.list).toHaveBeenCalledWith('u1', { status: 'SHIPPING' }, 1, 1);
    expect(flashSale.listUpcoming).toHaveBeenCalledWith('u1');
    expect(r.activeOrderCount).toEqual({ count: 3 });
    expect(loyalty.getNewCustomerOffer).not.toHaveBeenCalled();
    expect(r.newCustomerOffer).toEqual({ isNewCustomer: false, welcomeVoucher: null });
    await svc.getForUser('u2');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('gợi ý của khối gộp dùng seed ngày VN của mốc request, đúng seed mà request lẻ /products/for-you gửi trong ngày', async () => {
    const { svc, catalog } = setup();
    // 17:30 UTC ngày 31/10 là 00:30 ngày 1/11 giờ VN; 16:59 UTC vẫn là ngày 31/10.
    await svc.getForUser('u1', 10, Date.UTC(2026, 9, 31, 17, 30));
    expect(catalog.getForYou).toHaveBeenLastCalledWith('u1', { hasOrders: false, seed: '20261101' });
    await svc.getForUser('u1', 10, Date.UTC(2026, 9, 31, 16, 59));
    expect(catalog.getForYou).toHaveBeenLastCalledWith('u1', { hasOrders: false, seed: '20261031' });
  });

  it('chỉ có đơn đã huỷ: vẫn là khách mới (hỏi loyalty), nhưng có lịch sử đơn cho gợi ý', async () => {
    const { svc, loyalty, catalog, prisma, factRows } = setup();
    prisma.$queryRaw.mockResolvedValue(factRows({ CANCELLED: 2 }));
    const r = await svc.getForUser('u1');
    expect(loyalty.getNewCustomerOffer).toHaveBeenCalledWith('u1', { hasPriorOrder: false });
    expect(r.newCustomerOffer).toEqual({ isNewCustomer: true, welcomeVoucher: null });
    expect(catalog.getForYou).toHaveBeenCalledWith('u1', { hasOrders: true, seed: expect.stringMatching(/^\d{8}$/) });
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
