import 'reflect-metadata';
import { AffiliateService } from './affiliate.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';
import type { PricingService } from '../pricing/pricing.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;
// Ship mặc định 0 cho test (override bằng mockResolvedValue trong test lên-đơn-hộ).
const pricing = { calcShippingFee: jest.fn().mockResolvedValue(0) } as unknown as PricingService;

function prismaWith(order: unknown, variations: unknown[], createSpy = jest.fn()) {
  return {
    order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
    variation: { findMany: jest.fn().mockResolvedValue(variations) },
    commission: { create: createSpy },
  } as unknown as PrismaService;
}

describe('AffiliateService.createCommissionForOrder', () => {
  it('bỏ qua khi tự giới thiệu ORGANIC (referrer === buyer, placedForCustomer=false)', async () => {
    const create = jest.fn();
    const prisma = prismaWith({ id: 'o1', userId: 'u1', referrerUserId: 'u1', placedForCustomer: false, items: [] }, [], create);
    await new AffiliateService(prisma, config, pricing).createCommissionForOrder('o1');
    expect(create).not.toHaveBeenCalled();
  });

  it('CTV lên đơn hộ (referrer === buyer NHƯNG placedForCustomer=true) → VẪN tạo hoa hồng', async () => {
    const create = jest.fn().mockResolvedValue({});
    const order = {
      id: 'o1',
      userId: 'ctv', // CTV vừa là người đặt (userId) vừa là người hưởng (referrerUserId)
      referrerUserId: 'ctv',
      placedForCustomer: true,
      total: 200000,
      items: [{ variationId: 'v1', total: 200000 }],
    };
    const prisma = prismaWith(order, [{ id: 'v1', affiliateRate: 10 }], create);
    await new AffiliateService(prisma, config, pricing).createCommissionForOrder('o1');
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.amount).toBe(20000); // 10% * 200k
    expect(data.affiliateUserId).toBe('ctv');
    expect(data.status).toBe('PENDING');
  });

  it('tính hoa hồng theo rate từng SKU (floor mỗi dòng) — referrer ≠ buyer không đổi', async () => {
    const create = jest.fn().mockResolvedValue({});
    const order = {
      id: 'o1',
      userId: 'buyer',
      referrerUserId: 'ctv',
      total: 300000,
      items: [
        { variationId: 'v1', total: 200000 },
        { variationId: 'v2', total: 100000 },
      ],
    };
    const prisma = prismaWith(order, [
      { id: 'v1', affiliateRate: 10 }, // 10% * 200k = 20000
      { id: 'v2', affiliateRate: 5 }, // 5% * 100k = 5000
    ], create);
    await new AffiliateService(prisma, config, pricing).createCommissionForOrder('o1');
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data.amount).toBe(25000);
    expect(data.affiliateUserId).toBe('ctv');
    expect(data.status).toBe('PENDING');
  });

  it('không tạo commission khi tổng rate = 0', async () => {
    const create = jest.fn();
    const order = { id: 'o1', userId: 'b', referrerUserId: 'ctv', total: 100000, items: [{ variationId: 'v1', total: 100000 }] };
    const prisma = prismaWith(order, [{ id: 'v1', affiliateRate: 0 }], create);
    await new AffiliateService(prisma, config, pricing).createCommissionForOrder('o1');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AffiliateService.reverseCommissionsForOrder (guard đối xứng cho lên-đơn-hộ)', () => {
  function makePrisma(order: unknown) {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      commission: { updateMany },
    } as unknown as PrismaService;
    return { prisma, updateMany };
  }

  it('đơn thường (referrer ≠ buyer) → VẪN đảo hoa hồng (không đổi)', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'buyer', referrerUserId: 'ctv', placedForCustomer: false });
    await new AffiliateService(prisma, config, pricing).reverseCommissionsForOrder('o1');
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orderId: 'o1', status: { in: ['PENDING', 'LOCKED'] } } }),
    );
  });

  it('CTV lên đơn hộ (referrer === buyer, placedForCustomer=true) → đảo hoa hồng', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true });
    await new AffiliateService(prisma, config, pricing).reverseCommissionsForOrder('o1');
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('tự giới thiệu ORGANIC (referrer === buyer, placedForCustomer=false) → KHÔNG đảo (không có hoa hồng)', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: 'u1', placedForCustomer: false });
    await new AffiliateService(prisma, config, pricing).reverseCommissionsForOrder('o1');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('không có người giới thiệu → KHÔNG đảo', async () => {
    const { prisma, updateMany } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: null, placedForCustomer: false });
    await new AffiliateService(prisma, config, pricing).reverseCommissionsForOrder('o1');
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('AffiliateService.placeOrderForCustomer (CTV lên đơn hộ — MONEY-CRITICAL)', () => {
  const CUSTOMER = {
    recipient: 'Khách A',
    phone: '0900000000',
    province: 'Hà Nội',
    district: '',
    ward: 'Phường 1',
    street: 'Số 1',
    provinceCode: '84_VN01',
    districtCode: '',
    wardCode: '84_VN0101',
  };

  function build(
    opts: {
      variations?: Array<{ id: string; isActive?: boolean; salePrice?: number | null; retailPrice?: number; name?: string; product?: { name: string } }>;
      stockCount?: number;
      variationUpdateMany?: jest.Mock;
      role?: string;
      storefront?: { slug: string } | null;
      shippingFee?: number;
    } = {},
  ) {
    const variations =
      opts.variations ?? [{ id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'Mặc định', product: { name: 'Trà thảo mộc' } }];
    const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
    const variationUpdateMany = opts.variationUpdateMany ?? jest.fn().mockResolvedValue({ count: opts.stockCount ?? 1 });
    const commissionCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'ctv', role: opts.role ?? 'AFFILIATE' }) },
      variation: { findMany: jest.fn().mockResolvedValue(variations), updateMany: variationUpdateMany },
      storefront: { findFirst: jest.fn().mockResolvedValue(opts.storefront === undefined ? { slug: 'ctv-shop' } : opts.storefront) },
      order: {
        create: orderCreate,
        findUnique: jest.fn().mockResolvedValue(null), // generateOrderCode: code chưa tồn tại
        findUniqueOrThrow: jest
          .fn()
          // 1) createCommissionForOrder đọc order + items; 2) trả đơn cuối cùng
          .mockResolvedValue({ id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true, total: 100000, items: [], code: 'TUBU1' }),
      },
      commission: { create: commissionCreate },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
    const pricingLocal = { calcShippingFee: jest.fn().mockResolvedValue(opts.shippingFee ?? 0) } as unknown as PricingService;
    const svc = new AffiliateService(prisma, config, pricingLocal);
    return { svc, prisma, orderCreate, variationUpdateMany, commissionCreate, pricingLocal };
  }

  const DTO = (over: Record<string, unknown> = {}) => ({
    items: [{ variationId: 'v1', quantity: 2 }],
    customer: CUSTOMER,
    paymentMethod: 'COD' as const,
    ...over,
  });

  it('COD → đơn CONFIRMED, userId==referrerUserId==ctv, placedForCustomer=true', async () => {
    const { svc, orderCreate } = build({ shippingFee: 19000 });
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.status).toBe('CONFIRMED');
    expect(data.userId).toBe('ctv');
    expect(data.referrerUserId).toBe('ctv');
    expect(data.placedForCustomer).toBe(true);
    expect(data.paymentStatus).toBe('UNPAID');
    // goods = 100000 * 2 = 200000; ship 19000 → total 219000
    expect(data.subtotal).toBe(200000);
    expect(data.shippingFee).toBe(19000);
    expect(data.total).toBe(219000);
    expect(data.discount).toBe(0);
    expect(data.items.create[0]).toMatchObject({ variationId: 'v1', unitPrice: 100000, quantity: 2, total: 200000 });
  });

  it('BANK_TRANSFER → đơn PENDING_PAYMENT', async () => {
    const { svc, orderCreate } = build();
    await svc.placeOrderForCustomer('ctv', DTO({ paymentMethod: 'BANK_TRANSFER' }) as never);
    expect(orderCreate.mock.calls[0][0].data.status).toBe('PENDING_PAYMENT');
  });

  it('dùng salePrice khi có (ưu tiên salePrice ?? retailPrice)', async () => {
    const { svc, orderCreate } = build({
      variations: [{ id: 'v1', isActive: true, salePrice: 80000, retailPrice: 100000, name: 'X', product: { name: 'P' } }],
    });
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    const data = orderCreate.mock.calls[0][0].data;
    expect(data.items.create[0].unitPrice).toBe(80000);
    expect(data.subtotal).toBe(160000);
  });

  it('trừ stock ATOMIC từng line (where gte) trước khi tạo đơn', async () => {
    const { svc, variationUpdateMany, orderCreate } = build();
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    expect(variationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'v1', stock: { gte: 2 } }, data: { stock: { decrement: 2 } } }),
    );
    expect(orderCreate).toHaveBeenCalled();
  });

  it('stock không đủ (count=0) → BadRequest, KHÔNG tạo đơn (rollback)', async () => {
    const { svc, orderCreate } = build({ stockCount: 0 });
    await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toThrow('không đủ tồn kho');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('tạo hoa hồng cho CTV sau khi đặt đơn (createCommissionForOrder)', async () => {
    const { svc, commissionCreate, prisma } = build();
    // order fetch trong createCommissionForOrder: đơn CTV placedForCustomer + 1 item có rate.
    (prisma.order.findUniqueOrThrow as jest.Mock)
      .mockResolvedValueOnce({ id: 'o1', userId: 'ctv', referrerUserId: 'ctv', placedForCustomer: true, total: 200000, items: [{ variationId: 'v1', total: 200000 }] })
      .mockResolvedValueOnce({ id: 'o1', code: 'TUBU1', total: 200000, items: [] });
    (prisma.variation.findMany as jest.Mock).mockResolvedValueOnce([
      { id: 'v1', isActive: true, salePrice: null, retailPrice: 100000, name: 'X', product: { name: 'P' } },
    ]).mockResolvedValueOnce([{ id: 'v1', affiliateRate: 10 }]);
    await svc.placeOrderForCustomer('ctv', DTO() as never);
    expect(commissionCreate).toHaveBeenCalledTimes(1);
    expect(commissionCreate.mock.calls[0][0].data.affiliateUserId).toBe('ctv');
  });

  it('không có item → BadRequest', async () => {
    const { svc } = build();
    await expect(svc.placeOrderForCustomer('ctv', DTO({ items: [] }) as never)).rejects.toThrow();
  });

  it('variation ngừng bán (isActive=false) → BadRequest', async () => {
    const { svc } = build({
      variations: [{ id: 'v1', isActive: false, salePrice: null, retailPrice: 100000, name: 'X', product: { name: 'P' } }],
    });
    await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toThrow();
  });

  it('người dùng không phải CTV/ADMIN → BadRequest (chống tự-giao-dịch)', async () => {
    const { svc, orderCreate } = build({ role: 'CUSTOMER' });
    await expect(svc.placeOrderForCustomer('ctv', DTO() as never)).rejects.toThrow();
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('gắn storefrontSlug của CTV để attribution; null nếu chưa có gian hàng', async () => {
    const withStore = build({ storefront: { slug: 'ctv-shop' } });
    await withStore.svc.placeOrderForCustomer('ctv', DTO() as never);
    expect(withStore.orderCreate.mock.calls[0][0].data.storefrontSlug).toBe('ctv-shop');

    const noStore = build({ storefront: null });
    await noStore.svc.placeOrderForCustomer('ctv', DTO() as never);
    expect(noStore.orderCreate.mock.calls[0][0].data.storefrontSlug).toBeNull();
  });
});

describe('AffiliateService.monthlyTier (Build Spec §6.8.2)', () => {
  // monthlyTier là private + thuần — gọi qua cast để kiểm tra ranh giới bậc.
  const tier = (revenue: number) =>
    (new AffiliateService({} as unknown as PrismaService, config, pricing) as unknown as {
      monthlyTier(r: number): {
        name: string;
        bonusPct: number;
        nextName: string | null;
        nextThreshold: number | null;
        toNext: number;
      };
    }).monthlyTier(revenue);

  it('doanh số 0 → Tân binh, bonus 0%, next là Đồng tại 3tr', () => {
    const t = tier(0);
    expect(t.name).toBe('Tân binh');
    expect(t.bonusPct).toBe(0);
    expect(t.nextName).toBe('Đồng');
    expect(t.nextThreshold).toBe(3_000_000);
    expect(t.toNext).toBe(3_000_000);
  });

  it('đúng tại ngưỡng (inclusive): 3tr → Đồng, 10tr → Bạc, 80tr → Kim Cương', () => {
    expect(tier(3_000_000).name).toBe('Đồng');
    expect(tier(10_000_000).name).toBe('Bạc');
    expect(tier(30_000_000).name).toBe('Vàng');
    expect(tier(80_000_000).name).toBe('Kim Cương');
  });

  it('ngay dưới ngưỡng vẫn ở bậc thấp hơn', () => {
    expect(tier(2_999_999).name).toBe('Tân binh');
    expect(tier(9_999_999).name).toBe('Đồng');
  });

  it('toNext = phần còn thiếu để lên bậc kế', () => {
    const t = tier(5_000_000); // Đồng, cần lên Bạc (10tr)
    expect(t.name).toBe('Đồng');
    expect(t.bonusPct).toBe(1);
    expect(t.toNext).toBe(5_000_000);
  });

  it('bậc cao nhất (Kim Cương) không còn next', () => {
    const t = tier(120_000_000);
    expect(t.name).toBe('Kim Cương');
    expect(t.bonusPct).toBe(6);
    expect(t.nextName).toBeNull();
    expect(t.nextThreshold).toBeNull();
    expect(t.toNext).toBe(0);
  });
});

describe('AffiliateService.requestPayout (money safety)', () => {
  function makePrisma(opts: { available?: number; rows?: { id: string; amount: number }[]; markCount?: number }) {
    const rows = opts.rows ?? [{ id: 'c1', amount: 100_000 }];
    const userUpdate = jest.fn().mockResolvedValue({});
    const payoutCreate = jest.fn().mockResolvedValue({ id: 'payout-1' });
    const updateMany = jest.fn().mockResolvedValue({ count: opts.markCount ?? rows.length });
    const prisma = {
      commission: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.available ?? 100_000 } }),
        findMany: jest.fn().mockResolvedValue(rows),
        updateMany,
      },
      user: { update: userUpdate },
      payout: { create: payoutCreate },
    } as unknown as PrismaService;
    (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prisma));
    return { prisma, userUpdate, payoutCreate, updateMany };
  }

  it('số dư khả dụng = 0 → BadRequest', async () => {
    const { prisma } = makePrisma({ available: 0 });
    await expect(new AffiliateService(prisma, config, pricing).requestPayout('u1', 0, 'WALLET_BALANCE')).rejects.toThrow(
      'khả dụng',
    );
  });

  it('amount vượt khả dụng → BadRequest', async () => {
    const { prisma } = makePrisma({ available: 100_000 });
    await expect(
      new AffiliateService(prisma, config, pricing).requestPayout('u1', 200_000, 'WALLET_BALANCE'),
    ).rejects.toThrow('không đủ');
  });

  it('WALLET_BALANCE → credit ×1.5 theo TỔNG THỰC (không mất tiền) + mark PAID', async () => {
    const { prisma, userUpdate, payoutCreate } = makePrisma({
      available: 100_000,
      rows: [
        { id: 'c1', amount: 60_000 },
        { id: 'c2', amount: 40_000 },
      ],
    });
    const r = await new AffiliateService(prisma, config, pricing).requestPayout('u1', 50_000, 'WALLET_BALANCE');
    // dù request 50k, credit theo tổng thực 100k ×1.5 = 150k (không mất 50k còn lại)
    expect(r.credited).toBe(150_000);
    expect(userUpdate.mock.calls[0][0].data.walletBalance).toEqual({ increment: 150_000 });
    expect(payoutCreate.mock.calls[0][0].data.status).toBe('PAID');
  });

  it('WALLET_BALANCE double-spend: updateMany count=0 → BadRequest, KHÔNG credit ví', async () => {
    const { prisma, userUpdate } = makePrisma({ available: 100_000, markCount: 0 });
    await expect(
      new AffiliateService(prisma, config, pricing).requestPayout('u1', 100_000, 'WALLET_BALANCE'),
    ).rejects.toThrow('đã được xử lý');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('BANK dưới mức tối thiểu → BadRequest', async () => {
    const { prisma } = makePrisma({ available: 100_000 });
    await expect(new AffiliateService(prisma, config, pricing).requestPayout('u1', 10_000, 'BANK', {})).rejects.toThrow(
      'tối thiểu',
    );
  });

  it('BANK hợp lệ → payout.amount = TỔNG THỰC + mark PAID + gán batch', async () => {
    const { prisma, payoutCreate, updateMany } = makePrisma({
      available: 100_000,
      rows: [{ id: 'c1', amount: 100_000 }],
    });
    const r = await new AffiliateService(prisma, config, pricing).requestPayout('u1', 80_000, 'BANK', { bank: 'VCB' });
    expect(r.status).toBe('REQUESTED');
    expect(payoutCreate.mock.calls[0][0].data.amount).toBe(100_000); // tổng thực, không phải 80k
    expect(updateMany.mock.calls[0][0].data.payoutBatchId).toBe('payout-1');
    expect(updateMany.mock.calls[0][0].data.status).toBe('PAID');
  });
});

describe('AffiliateService.grantReferralReward (refer-reward 1 lần, cộng dồn hoa hồng)', () => {
  function makePrisma(order: unknown, existingCoupon: unknown = null) {
    const couponCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
      coupon: { findUnique: jest.fn().mockResolvedValue(existingCoupon), create: couponCreate },
    } as unknown as PrismaService;
    return { prisma, couponCreate };
  }

  it('đơn ≥200k có người giới thiệu → thưởng voucher 50k cho CẢ hai (§6.14.5)', async () => {
    const { prisma, couponCreate } = makePrisma({ id: 'o1', userId: 'referee', referrerUserId: 'referrer', total: 250000 });
    await new AffiliateService(prisma, config, pricing).grantReferralReward('o1');
    expect(couponCreate).toHaveBeenCalledTimes(2);
    const data = couponCreate.mock.calls.map((c) => c[0].data);
    const codes = data.map((d) => d.code);
    expect(codes).toContain('REFER-REFERRER-REFEREE'); // người mời (cặp)
    expect(codes).toContain('REFERRED-REFEREE'); // người được mời (welcome)
    expect(data.every((d) => d.value === 50000)).toBe(true); // cả hai 50k
    expect(data.every((d) => d.minOrder === 200000)).toBe(true); // áp đơn ≥200k
    expect(data.map((d) => d.scopeMeta.userId)).toEqual(expect.arrayContaining(['referrer', 'referee']));
  });

  it('đơn < 200k → KHÔNG thưởng (chưa đạt ngưỡng §6.14.5)', async () => {
    const { prisma, couponCreate } = makePrisma({ id: 'o1', userId: 'referee', referrerUserId: 'referrer', total: 150000 });
    await new AffiliateService(prisma, config, pricing).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('tự giới thiệu (referrer === buyer) → không thưởng', async () => {
    const { prisma, couponCreate } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: 'u1', total: 250000 });
    await new AffiliateService(prisma, config, pricing).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('không có người giới thiệu → không thưởng', async () => {
    const { prisma, couponCreate } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: null, total: 250000 });
    await new AffiliateService(prisma, config, pricing).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('voucher đã tồn tại (đã thưởng cặp này) → không cấp lại (idempotent)', async () => {
    const { prisma, couponCreate } = makePrisma(
      { id: 'o1', userId: 'referee', referrerUserId: 'referrer', total: 250000 },
      { id: 'existing' },
    );
    await new AffiliateService(prisma, config, pricing).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });
});

describe('AffiliateService analytics', () => {
  it('storefrontAnalytics gom theo gian hàng của tôi', async () => {
    const orderAggregate = jest.fn().mockResolvedValue({ _count: { _all: 3 }, _sum: { total: 900000 } });
    const commissionAggregate = jest.fn().mockResolvedValue({ _sum: { amount: 72000 } });
    const prisma = {
      storefront: { findMany: jest.fn().mockResolvedValue([{ slug: 'linh', title: 'Cửa hàng Linh' }]) },
      order: { aggregate: orderAggregate },
      commission: { aggregate: commissionAggregate },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing);
    const r = await svc.storefrontAnalytics('u1');
    expect(r.storefronts[0]).toMatchObject({ slug: 'linh', orders: 3, revenue: 900000, commission: 72000 });
    // Hardening: WHERE phải scope đúng theo slug + referrer (chống đếm chéo người dùng).
    expect(orderAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ storefrontSlug: 'linh', referrerUserId: 'u1' }) }),
    );
    expect(commissionAggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ affiliateUserId: 'u1', order: { storefrontSlug: 'linh' } }),
      }),
    );
  });

  it('productCommissionBreakdown nhóm theo sản phẩm', async () => {
    const prisma = {
      commission: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', orderId: 'o1', order: { id: 'o1', items: [
          { productName: 'Dầu gội', variationId: 'v1', total: 100000 },
          { productName: 'Xà phòng', variationId: 'v2', total: 50000 },
        ] } },
      ]) },
      variation: { findMany: jest.fn().mockResolvedValue([
        { id: 'v1', affiliateRate: '10' }, { id: 'v2', affiliateRate: '8' },
      ]) },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing);
    const r = await svc.productCommissionBreakdown('u1');
    const dau = r.find((x) => x.productName === 'Dầu gội');
    expect(dau?.commission).toBe(10000); // floor(100000*10/100)
    expect(dau?.orders).toBe(1);
    expect(r.find((x) => x.productName === 'Xà phòng')?.commission).toBe(4000);
  });

  it('productCommissionBreakdown: 1 đơn có 2 item CÙNG sản phẩm → orders=1, hoa hồng cộng dồn', async () => {
    const prisma = {
      commission: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', orderId: 'o1', order: { id: 'o1', items: [
          { productName: 'Dầu gội', variationId: 'v1', total: 100000 },
          { productName: 'Dầu gội', variationId: 'v1', total: 60000 },
        ] } },
      ]) },
      variation: { findMany: jest.fn().mockResolvedValue([
        { id: 'v1', affiliateRate: '10' },
      ]) },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config, pricing);
    const r = await svc.productCommissionBreakdown('u1');
    const dau = r.find((x) => x.productName === 'Dầu gội');
    expect(dau?.orders).toBe(1); // 2 item cùng đơn → 1 đơn
    expect(dau?.commission).toBe(16000); // floor(100000*10/100) + floor(60000*10/100)
  });
});

describe('AffiliateService.recordTouch / getActiveTouch (attribution 3 ngày)', () => {
  const NOW = new Date('2026-06-27T00:00:00Z');
  function makePrisma(over: any = {}) {
    return {
      user: { findUnique: jest.fn() },
      referralTouch: { upsert: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
      ...over,
    } as unknown as PrismaService;
  }

  it('recordTouch: resolve referralCode → upsert với expiresAt = now + 3 ngày', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'ctv1' });
    await new AffiliateService(prisma, config, pricing).recordTouch('buyer1', { referralCode: 'LINH', storefrontSlug: 'LINH', kind: 'ctv' }, NOW);
    const call = (prisma as any).referralTouch.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: 'buyer1' });
    expect(call.create.referrerUserId).toBe('ctv1');
    expect(call.create.expiresAt.getTime()).toBe(NOW.getTime() + 3 * 86400000);
  });

  it('recordTouch: bỏ qua nếu không có referralCode', async () => {
    const prisma = makePrisma();
    const r = await new AffiliateService(prisma, config, pricing).recordTouch('buyer1', {}, NOW);
    expect(r.ok).toBe(false);
    expect((prisma as any).referralTouch.upsert).not.toHaveBeenCalled();
  });

  it('recordTouch: bỏ qua tự giới thiệu (code trỏ chính mình)', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue({ id: 'buyer1' });
    const r = await new AffiliateService(prisma, config, pricing).recordTouch('buyer1', { referralCode: 'SELF' }, NOW);
    expect(r.ok).toBe(false);
    expect((prisma as any).referralTouch.upsert).not.toHaveBeenCalled();
  });

  it('recordTouch: bỏ qua code không tồn tại', async () => {
    const prisma = makePrisma();
    (prisma as any).user.findUnique.mockResolvedValue(null);
    const r = await new AffiliateService(prisma, config, pricing).recordTouch('buyer1', { referralCode: 'NOPE' }, NOW);
    expect(r.ok).toBe(false);
  });

  it('getActiveTouch: trả touch khi còn hạn', async () => {
    const prisma = makePrisma();
    (prisma as any).referralTouch.findUnique.mockResolvedValue({ referrerUserId: 'ctv1', storefrontSlug: 'LINH', kind: 'ctv', expiresAt: new Date(NOW.getTime() + 1000) });
    const t = await new AffiliateService(prisma, config, pricing).getActiveTouch('buyer1', NOW);
    expect(t).toEqual({ referrerUserId: 'ctv1', storefrontSlug: 'LINH', kind: 'ctv' });
  });

  it('getActiveTouch: null khi hết hạn', async () => {
    const prisma = makePrisma();
    (prisma as any).referralTouch.findUnique.mockResolvedValue({ referrerUserId: 'ctv1', storefrontSlug: null, kind: 'ctv', expiresAt: new Date(NOW.getTime() - 1000) });
    const t = await new AffiliateService(prisma, config, pricing).getActiveTouch('buyer1', NOW);
    expect(t).toBeNull();
  });
});
