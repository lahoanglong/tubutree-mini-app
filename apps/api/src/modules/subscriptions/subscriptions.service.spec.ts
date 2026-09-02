import { SubscriptionsService } from './subscriptions.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { NotificationsService } from '../notifications/notifications.service';

const config = {} as unknown as SystemConfigService;
const pricing = {} as unknown as PricingService;
const loyalty = {} as unknown as LoyaltyService;
const notifications = {} as unknown as NotificationsService;

function makeService(opts: { variation?: unknown; address?: unknown; create?: jest.Mock } = {}) {
  const create = opts.create ?? jest.fn().mockImplementation((args) => Promise.resolve({ id: 's1', ...args.data }));
  const prisma = {
    variation: { findUnique: jest.fn().mockResolvedValue(opts.variation ?? { id: 'v1', isActive: true }) },
    address: { findUnique: jest.fn().mockResolvedValue(opts.address ?? { id: 'a1', userId: 'u1' }) },
    subscription: { create },
  } as unknown as PrismaService;
  return { svc: new SubscriptionsService(prisma, config, pricing, loyalty, notifications), create };
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
});

describe('SubscriptionsService.processDue (claim chống double-order)', () => {
  type Tier = { minActive: number; pct: number };
  function makeProcess(
    claimCount: number,
    opts: { activeCount?: number; tiers?: Tier[]; stockCount?: number } = {},
  ) {
    const due = [{ id: 's1', userId: 'u1', variationId: 'v1', quantity: 1, addressId: 'a1', intervalWeeks: 4 }];
    const updateMany = jest.fn().mockResolvedValue({ count: claimCount });
    const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
    const stockUpdateMany = opts.stockCount != null
      ? jest.fn().mockResolvedValue({ count: opts.stockCount })
      : jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue(due),
        updateMany,
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(opts.activeCount ?? 1),
      },
      variation: {
        findUnique: jest.fn().mockResolvedValue({ id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'V', product: { name: 'P' } }),
        updateMany: stockUpdateMany,
      },
      address: { findUnique: jest.fn().mockResolvedValue({ id: 'a1', userId: 'u1', recipient: 'R', phone: '09', province: 'p', district: 'd', ward: 'w', street: 's', provinceCode: '1', districtCode: '2', wardCode: '3' }) },
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
    return { svc: new SubscriptionsService(prisma, cfg, pr, ly, nt), updateMany, orderCreate, stockUpdateMany, notify };
  }

  it('claim thành công (count=1) → tạo đơn định kỳ', async () => {
    const { svc, updateMany, orderCreate } = makeProcess(1);
    await svc.processDue();
    // claim advance nextRunAt với điều kiện status ACTIVE + đến hạn
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ id: 's1', status: 'ACTIVE' });
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it('instance khác đã claim (count=0) → KHÔNG tạo đơn trùng', async () => {
    const { svc, orderCreate } = makeProcess(0);
    await svc.processDue();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('trừ stock ATOMIC (gte) trước khi tạo đơn — chống oversell đơn định kỳ', async () => {
    const { svc, stockUpdateMany, orderCreate } = makeProcess(1);
    await svc.processDue();
    expect(stockUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 'v1', stock: { gte: 1 } },
      data: { stock: { decrement: 1 } },
    });
    // Order chỉ tạo SAU khi trừ stock thành công.
    expect(orderCreate).toHaveBeenCalledTimes(1);
  });

  it('hết stock (updateMany count=0) → KHÔNG tạo đơn, chu kỳ bị bỏ qua (không double-charge)', async () => {
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
    return new SubscriptionsService(prisma, cfg, pricing, loyalty, notifications);
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
    const svc = new SubscriptionsService(prisma, config, pricing, loyalty, notifications);
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
    const svc = new SubscriptionsService(prisma, cfg, pricing, loyalty, notifications);
    const result = await svc.list('u1');
    expect(result[0]?.effectiveDiscountPct).toBe(0.14);
  });
});
