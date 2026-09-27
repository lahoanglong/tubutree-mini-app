import { SubscriptionsService } from './subscriptions.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { PancakeOrderService } from '../integrations/pancake/pancake-order.service';
import type { AnalyticsEventsService } from '../analytics/analytics-events.service';

/** Stub tối thiểu cho các test không quan tâm việc đẩy Pancake. */
const pancakeStub = () => ({ enqueuePush: jest.fn().mockResolvedValue(undefined) }) as unknown as PancakeOrderService;
import type { NotificationsService } from '../notifications/notifications.service';

const config = {} as unknown as SystemConfigService;
const pricing = {} as unknown as PricingService;
const loyalty = {} as unknown as LoyaltyService;
const notifications = {} as unknown as NotificationsService;

/** Mock mới cho mỗi test — record/recordBestEffort là jest.fn() để assert riêng từng test. */
function makeAnalytics() {
  return {
    record: jest.fn().mockResolvedValue(undefined),
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
  } as unknown as AnalyticsEventsService;
}

function makeService(opts: { variation?: unknown; address?: unknown; create?: jest.Mock } = {}) {
  const create = opts.create ?? jest.fn().mockImplementation((args) => Promise.resolve({ id: 's1', ...args.data }));
  const prisma = {
    variation: { findUnique: jest.fn().mockResolvedValue(opts.variation ?? { id: 'v1', isActive: true }) },
    address: { findUnique: jest.fn().mockResolvedValue(opts.address ?? { id: 'a1', userId: 'u1' }) },
    subscription: { create },
    // create() giờ chạy trong $transaction (subscription.create + event atomic) — mock chạy
    // callback với chính prisma mock (đủ subscription.create cho test).
    $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
  } as unknown as PrismaService;
  const analytics = makeAnalytics();
  return {
    svc: new SubscriptionsService(
      prisma,
      config,
      pricing,
      loyalty,
      notifications,
      { enqueuePush: jest.fn() } as unknown as PancakeOrderService,
      analytics,
    ),
    create,
    analytics,
  };
}

const dto = (over = {}) => ({ variationId: 'v1', quantity: 2, intervalWeeks: 4, addressId: 'a1', ...over });

describe('SubscriptionsService.create', () => {
  it('từ chối chu kỳ không hợp lệ (5 tuần)', async () => {
    const { svc } = makeService();
    await expect(svc.create('u1', dto({ intervalWeeks: 5 }))).rejects.toThrow('4/6/8/10');
  });

  it('từ chối sản phẩm ngừng bán', async () => {
    const { svc } = makeService({ variation: { id: 'v1', isActive: false } });
    await expect(svc.create('u1', dto())).rejects.toThrow('không khả dụng');
  });

  it('từ chối địa chỉ của người khác', async () => {
    const { svc } = makeService({ address: { id: 'a1', userId: 'other' } });
    await expect(svc.create('u1', dto())).rejects.toThrow('Địa chỉ không hợp lệ');
  });

  it('tạo lịch ACTIVE với nextRunAt ≈ +intervalWeeks', async () => {
    const { svc, create } = makeService();
    await svc.create('u1', dto({ intervalWeeks: 6 }));
    const data = create.mock.calls[0][0].data;
    const days = (new Date(data.nextRunAt).getTime() - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(6 * 7 - 1);
    expect(days).toBeLessThan(6 * 7 + 1);
    expect(data.quantity).toBe(2);
    expect(data.intervalWeeks).toBe(6);
  });

  it('phát subscription_changed action=created trong cùng transaction', async () => {
    const { svc, analytics } = makeService();
    await svc.create('u1', dto({ intervalWeeks: 6 }));
    expect(analytics.record).toHaveBeenCalledTimes(1);
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'miniapp',
        props: expect.objectContaining({
          subscriptionId: 's1',
          action: 'created',
          variationId: 'v1',
          intervalWeeks: 6,
        }),
      }),
    );
  });
});

describe('SubscriptionsService.processDue (claim chống double-order)', () => {
  type Tier = { minActive: number; pct: number };
  function makeProcess(
    claimCount: number,
    opts: {
      activeCount?: number;
      tiers?: Tier[];
      stockCount?: number;
      variationInactive?: boolean;
      addressInvalid?: boolean;
    } = {},
  ) {
    const due = [{ id: 's1', userId: 'u1', variationId: 'v1', quantity: 1, addressId: 'a1', intervalWeeks: 4 }];
    const updateMany = jest.fn().mockResolvedValue({ count: claimCount });
    const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
    const subUpdate = jest.fn().mockResolvedValue({});
    // Giữ chỗ tồn kho đi bằng SQL thô (catalog/variation-stock.ts) — trả SỐ DÒNG bị sửa.
    const stockExecuteRaw = jest.fn().mockResolvedValue(opts.stockCount ?? 1);
    const prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue(due),
        updateMany,
        update: subUpdate,
        count: jest.fn().mockResolvedValue(opts.activeCount ?? 1),
      },
      variation: {
        findUnique: jest.fn().mockResolvedValue(
          opts.variationInactive
            ? { id: 'v1', isActive: false, salePrice: null, retailPrice: 100000, name: 'V', product: { name: 'P' } }
            : { id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'V', product: { name: 'P' } },
        ),
      },
      $executeRaw: stockExecuteRaw,
      address: {
        findUnique: jest.fn().mockResolvedValue(
          opts.addressInvalid
            ? null
            : { id: 'a1', userId: 'u1', recipient: 'R', phone: '09', province: 'p', district: 'd', ward: 'w', street: 's', provinceCode: '1', districtCode: '2', wardCode: '3' },
        ),
      },
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', tierId: null }) },
      order: { create: orderCreate, findUnique: jest.fn().mockResolvedValue(null) },
      // Tạo đơn định kỳ giờ chạy trong $transaction (trừ stock atomic + order.create) — mock
      // chạy callback với chính prisma mock (đủ variation.updateMany + order.create cho test).
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        k === 'subscribe.discount_tiers' && opts.tiers ? (opts.tiers as unknown as T) : (fb as T),
    } as unknown as SystemConfigService;
    const pr = {
      calcShippingFee: jest.fn().mockResolvedValue(0),
      calcPointsEarned: jest.fn().mockResolvedValue(0),
    } as unknown as PricingService;
    const ly = { getTierMultiplier: jest.fn().mockResolvedValue(1) } as unknown as LoyaltyService;
    const notify = jest.fn().mockResolvedValue(undefined);
    const nt = { notify } as unknown as NotificationsService;
    const enqueuePush = jest.fn().mockResolvedValue(undefined);
    const pancake = { enqueuePush } as unknown as PancakeOrderService;
    const analytics = makeAnalytics();
    return {
      svc: new SubscriptionsService(prisma, cfg, pr, ly, nt, pancake, analytics),
      updateMany,
      orderCreate,
      stockExecuteRaw,
      notify,
      enqueuePush,
      analytics,
      subUpdate,
    };
  }

  it('claim thành công (count=1) → tạo đơn định kỳ', async () => {
    const { svc, updateMany, orderCreate } = makeProcess(1);
    await svc.processDue();
    // claim advance nextRunAt với điều kiện status ACTIVE + đến hạn
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ id: 's1', status: 'ACTIVE' });
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it('tạo đơn thành công → phát order_placed + subscription_changed action=order_created (cùng tx)', async () => {
    const { svc, orderCreate, analytics } = makeProcess(1);
    await svc.processDue();
    expect(orderCreate).toHaveBeenCalledTimes(1);
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'order_placed',
        userId: 'u1',
        platform: 'system',
        props: expect.objectContaining({ orderId: 'o1', orderSource: 'subscription', subscriptionId: 's1' }),
      }),
    );
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'system',
        props: expect.objectContaining({ subscriptionId: 's1', action: 'order_created', orderId: 'o1' }),
      }),
    );
    // order.create() nhận đủ source/platform/subscriptionId để gắn đơn về đúng subscription.
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.source).toBe('subscription');
    expect(data.platform).toBe('system');
    expect(data.subscriptionId).toBe('s1');
  });

  it('instance khác đã claim (count=0) → KHÔNG tạo đơn trùng', async () => {
    const { svc, orderCreate } = makeProcess(0);
    await svc.processDue();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('trừ stock ATOMIC (gte) trước khi tạo đơn — chống oversell đơn định kỳ', async () => {
    const { svc, stockExecuteRaw, orderCreate } = makeProcess(1);
    await svc.processDue();
    // Tham số câu UPDATE giữ chỗ: (số lượng, số lượng, variationId, số lượng) — điều kiện
    // `stock >= số lượng` nằm TRONG câu lệnh nên không có khe hở đọc-rồi-ghi.
    expect(stockExecuteRaw.mock.calls[0]!.slice(1)).toEqual([1, 1, 'v1', 1]);
    // Order chỉ tạo SAU khi trừ stock thành công.
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it('hết stock (0 dòng bị sửa) → KHÔNG tạo đơn, chu kỳ bị bỏ qua (không double-charge)', async () => {
    const { svc, orderCreate } = makeProcess(1, { stockCount: 0 });
    // claim đã advance nextRunAt nên lỗi ở createOrderFor chỉ bị log, không throw ra ngoài.
    await expect(svc.processDue()).resolves.toBeUndefined();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('hết stock → báo user (KHÔNG pause lịch, khác nhánh isActive=false/địa chỉ hỏng)', async () => {
    const { svc, notify } = makeProcess(1, { stockCount: 0 });
    await svc.processDue();
    expect(notify).toHaveBeenCalledWith('u1', 'SUBSCRIPTION_ORDER_FAILED', expect.any(Object));
  });

  it('hết stock → phát subscription_changed action=order_failed reason=out_of_stock (best-effort, ngoài tx đã rollback)', async () => {
    const { svc, analytics } = makeProcess(1, { stockCount: 0 });
    await svc.processDue();
    expect(analytics.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'system',
        props: expect.objectContaining({ subscriptionId: 's1', action: 'order_failed', reason: 'out_of_stock' }),
      }),
    );
  });

  it('SP ngừng bán → tạm dừng lịch + phát subscription_changed action=order_failed reason=inactive_product', async () => {
    const { svc, analytics, subUpdate, orderCreate } = makeProcess(1, { variationInactive: true });
    await svc.processDue();
    expect(orderCreate).not.toHaveBeenCalled();
    expect(subUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'PAUSED' } });
    expect(analytics.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'system',
        props: expect.objectContaining({ subscriptionId: 's1', action: 'order_failed', reason: 'inactive_product' }),
      }),
    );
  });

  it('địa chỉ không hợp lệ → tạm dừng lịch + phát subscription_changed action=order_failed reason=invalid_address', async () => {
    const { svc, analytics, subUpdate, orderCreate } = makeProcess(1, { addressInvalid: true });
    await svc.processDue();
    expect(orderCreate).not.toHaveBeenCalled();
    expect(subUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'PAUSED' } });
    expect(analytics.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'system',
        props: expect.objectContaining({ subscriptionId: 's1', action: 'order_failed', reason: 'invalid_address' }),
      }),
    );
  });

  it('user chỉ có 1 subscription ACTIVE → giảm bậc cơ bản 12%', async () => {
    const { svc, orderCreate } = makeProcess(1, {
      activeCount: 1,
      tiers: [{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.14 }, { minActive: 5, pct: 0.15 }],
    });
    await svc.processDue();
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.discount).toBe(Math.floor(100000 * 0.12));
    expect(data.total).toBe(data.subtotal - data.discount + data.shippingFee);
  });

  it('user có 5 subscription ACTIVE → giảm bậc cao nhất 15% cho đơn định kỳ', async () => {
    const { svc, orderCreate } = makeProcess(1, {
      activeCount: 5,
      tiers: [{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.14 }, { minActive: 5, pct: 0.15 }],
    });
    await svc.processDue();
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.discount).toBe(Math.floor(100000 * 0.15));
    expect(data.total).toBe(data.subtotal - data.discount + data.shippingFee);
  });

  // P1-4 (docs/2026-09-08-review-progress.md): đơn Subscribe & Save do cron tạo KHÔNG được đẩy
  // sang Pancake ở bất kỳ đường nào — kho vật lý không bao giờ thấy đơn, không webhook nào khớp
  // được, đơn kẹt CONFIRMED vĩnh viễn dù đã trừ kho và đã báo khách "đơn định kỳ đang tới".
  describe('SubscriptionsService — đẩy đơn định kỳ sang Pancake', () => {
    it('tạo đơn thành công → enqueuePush(orderId)', async () => {
      const { svc, enqueuePush, orderCreate } = makeProcess(1);
      await svc.processDue();
      expect(orderCreate).toHaveBeenCalled();
      expect(enqueuePush).toHaveBeenCalledWith(expect.any(String));
    });

    it('enqueuePush lỗi → KHÔNG làm hỏng chu kỳ cron (non-fatal, cron reconcile quét lại)', async () => {
      const { svc, enqueuePush } = makeProcess(1);
      enqueuePush.mockRejectedValue(new Error('redis down'));
      // processDue() trả void — điều cần khẳng định là KHÔNG ném lỗi ra ngoài cron.
      await expect(svc.processDue()).resolves.toBeUndefined();
    });
  });

});

describe('SubscriptionsService.effectiveDiscountPct', () => {
  const tiers = [{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.14 }, { minActive: 5, pct: 0.15 }];

  function makeSvc(activeCount: number) {
    const prisma = {
      subscription: { count: jest.fn().mockResolvedValue(activeCount) },
    } as unknown as PrismaService;
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        k === 'subscribe.discount_tiers' ? (tiers as unknown as T) : (fb as T),
    } as unknown as SystemConfigService;
    return new SubscriptionsService(
      prisma,
      cfg,
      pricing,
      loyalty,
      notifications,
      { enqueuePush: jest.fn() } as unknown as PancakeOrderService,
      makeAnalytics(),
    );
  }

  it.each([
    [1, 0.12],
    [2, 0.12],
    [3, 0.14],
    [4, 0.14],
    [5, 0.15],
    [10, 0.15],
  ])('activeCount=%i → pct=%f (bậc cao nhất đạt được)', async (activeCount, expected) => {
    const svc = makeSvc(activeCount);
    await expect(svc.effectiveDiscountPct('u1')).resolves.toBe(expected);
  });

  it('activeCount=0 (không có subscription ACTIVE nào) → 0%', async () => {
    const svc = makeSvc(0);
    await expect(svc.effectiveDiscountPct('u1')).resolves.toBe(0);
  });
});

describe('SubscriptionsService.skipCycle', () => {
  function makeSkip(sub: unknown, updateImpl?: jest.Mock) {
    const update = updateImpl ?? jest.fn().mockImplementation((args) => Promise.resolve({ id: 's1', ...args.data }));
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue(sub),
        update,
      },
    } as unknown as PrismaService;
    const svc = new SubscriptionsService(prisma, config, pricing, loyalty, notifications, pancakeStub(), makeAnalytics());
    return { svc, update };
  }

  it('sub ACTIVE → dời nextRunAt thêm 1 chu kỳ, giữ nguyên status', async () => {
    const nextRunAt = new Date('2026-07-10T00:00:00.000Z');
    const { svc, update } = makeSkip({ id: 's1', userId: 'u1', status: 'ACTIVE', intervalWeeks: 4, nextRunAt });
    await svc.skipCycle('u1', 's1');
    const data = update.mock.calls[0][0].data;
    expect((data.nextRunAt as Date).getTime()).toBe(nextRunAt.getTime() + 4 * 7 * 864e5);
    expect(data.status).toBeUndefined();
  });

  it('không tìm thấy lịch → NotFound', async () => {
    const { svc } = makeSkip(null);
    await expect(svc.skipCycle('u1', 's1')).rejects.toThrow('Không tìm thấy lịch đặt định kỳ.');
  });

  it('không phải chủ sở hữu → NotFound', async () => {
    const { svc } = makeSkip({ id: 's1', userId: 'other', status: 'ACTIVE', intervalWeeks: 4, nextRunAt: new Date() });
    await expect(svc.skipCycle('u1', 's1')).rejects.toThrow('Không tìm thấy lịch đặt định kỳ.');
  });

  it.each(['PAUSED', 'CANCELLED'])('lịch đang %s (không ACTIVE) → BadRequest', async (status) => {
    const { svc } = makeSkip({ id: 's1', userId: 'u1', status, intervalWeeks: 4, nextRunAt: new Date() });
    await expect(svc.skipCycle('u1', 's1')).rejects.toThrow('Chỉ bỏ qua kỳ khi lịch đang chạy.');
  });
});

describe('SubscriptionsService.setStatus', () => {
  function makeSetStatus(sub: unknown) {
    const update = jest.fn().mockImplementation((args) => Promise.resolve({ id: 's1', ...args.data }));
    const prisma = {
      subscription: {
        findUnique: jest.fn().mockResolvedValue(sub),
        update,
      },
      // setStatus() giờ chạy trong $transaction (subscription.update + event atomic) — mock
      // chạy callback với chính prisma mock (đủ subscription.update cho test).
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    } as unknown as PrismaService;
    const analytics = makeAnalytics();
    const svc = new SubscriptionsService(prisma, config, pricing, loyalty, notifications, pancakeStub(), analytics);
    return { svc, update, analytics };
  }

  it('không tìm thấy lịch → NotFound', async () => {
    const { svc } = makeSetStatus(null);
    await expect(svc.setStatus('u1', 's1', 'PAUSED')).rejects.toThrow('Không tìm thấy lịch đặt định kỳ.');
  });

  it('không phải chủ sở hữu → NotFound', async () => {
    const { svc } = makeSetStatus({ id: 's1', userId: 'other', status: 'ACTIVE', intervalWeeks: 4, nextRunAt: new Date() });
    await expect(svc.setStatus('u1', 's1', 'PAUSED')).rejects.toThrow('Không tìm thấy lịch đặt định kỳ.');
  });

  it('PAUSED → cập nhật status + phát subscription_changed action=paused (cùng transaction)', async () => {
    const { svc, update, analytics } = makeSetStatus({ id: 's1', userId: 'u1', status: 'ACTIVE', intervalWeeks: 4, nextRunAt: new Date(Date.now() + 999_999_999) });
    await svc.setStatus('u1', 's1', 'PAUSED');
    expect(update.mock.calls[0][0].where).toEqual({ id: 's1' });
    expect(update.mock.calls[0][0].data.status).toBe('PAUSED');
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventName: 'subscription_changed',
        userId: 'u1',
        platform: 'miniapp',
        props: expect.objectContaining({ subscriptionId: 's1', action: 'paused' }),
      }),
    );
  });

  it('CANCELLED → phát subscription_changed action=cancelled', async () => {
    const { svc, analytics } = makeSetStatus({ id: 's1', userId: 'u1', status: 'ACTIVE', intervalWeeks: 4, nextRunAt: new Date(Date.now() + 999_999_999) });
    await svc.setStatus('u1', 's1', 'CANCELLED');
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        props: expect.objectContaining({ subscriptionId: 's1', action: 'cancelled' }),
      }),
    );
  });

  it('ACTIVE (bật lại từ PAUSED, đã quá hạn) → dời nextRunAt + phát subscription_changed action=resumed', async () => {
    const pastRunAt = new Date(Date.now() - 999_999_999);
    const { svc, update, analytics } = makeSetStatus({ id: 's1', userId: 'u1', status: 'PAUSED', intervalWeeks: 4, nextRunAt: pastRunAt });
    await svc.setStatus('u1', 's1', 'ACTIVE');
    const data = update.mock.calls[0][0].data;
    expect(data.status).toBe('ACTIVE');
    expect((data.nextRunAt as Date).getTime()).toBeGreaterThan(pastRunAt.getTime());
    expect(analytics.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        props: expect.objectContaining({ subscriptionId: 's1', action: 'resumed' }),
      }),
    );
  });
});

describe('SubscriptionsService.list', () => {
  it('trả về effectiveDiscountPct theo số subscription ACTIVE của user', async () => {
    const tiers = [{ minActive: 1, pct: 0.12 }, { minActive: 3, pct: 0.14 }, { minActive: 5, pct: 0.15 }];
    const prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          { id: 's1', variationId: 'v1', quantity: 1, intervalWeeks: 4, status: 'ACTIVE', nextRunAt: new Date() },
        ]),
        count: jest.fn().mockResolvedValue(3),
      },
      variation: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'v1', name: 'V', salePrice: null, retailPrice: 100000, product: { name: 'P', thumbnail: null, slug: 'p' } },
        ]),
      },
    } as unknown as PrismaService;
    const cfg = {
      get: async <T>(k: string, fb?: T): Promise<T> =>
        k === 'subscribe.discount_tiers' ? (tiers as unknown as T) : (fb as T),
    } as unknown as SystemConfigService;
    const svc = new SubscriptionsService(prisma, cfg, pricing, loyalty, notifications, pancakeStub(), makeAnalytics());
    const result = await svc.list('u1');
    expect(result[0]?.effectiveDiscountPct).toBe(0.14);
  });
});
