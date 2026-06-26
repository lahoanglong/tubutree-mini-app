import 'reflect-metadata';
import { AffiliateService } from './affiliate.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const config = { get: async <T>(_k: string, fb?: T): Promise<T> => fb as T } as unknown as SystemConfigService;

function prismaWith(order: unknown, variations: unknown[], createSpy = jest.fn()) {
  return {
    order: { findUniqueOrThrow: jest.fn().mockResolvedValue(order) },
    variation: { findMany: jest.fn().mockResolvedValue(variations) },
    commission: { create: createSpy },
  } as unknown as PrismaService;
}

describe('AffiliateService.createCommissionForOrder', () => {
  it('bỏ qua khi tự giới thiệu (referrer === buyer)', async () => {
    const create = jest.fn();
    const prisma = prismaWith({ id: 'o1', userId: 'u1', referrerUserId: 'u1', items: [] }, [], create);
    await new AffiliateService(prisma, config).createCommissionForOrder('o1');
    expect(create).not.toHaveBeenCalled();
  });

  it('tính hoa hồng theo rate từng SKU (floor mỗi dòng)', async () => {
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
    await new AffiliateService(prisma, config).createCommissionForOrder('o1');
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
    await new AffiliateService(prisma, config).createCommissionForOrder('o1');
    expect(create).not.toHaveBeenCalled();
  });
});

describe('AffiliateService.monthlyTier (Build Spec §6.8.2)', () => {
  // monthlyTier là private + thuần — gọi qua cast để kiểm tra ranh giới bậc.
  const tier = (revenue: number) =>
    (new AffiliateService({} as unknown as PrismaService, config) as unknown as {
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
    await expect(new AffiliateService(prisma, config).requestPayout('u1', 0, 'WALLET_BALANCE')).rejects.toThrow(
      'khả dụng',
    );
  });

  it('amount vượt khả dụng → BadRequest', async () => {
    const { prisma } = makePrisma({ available: 100_000 });
    await expect(
      new AffiliateService(prisma, config).requestPayout('u1', 200_000, 'WALLET_BALANCE'),
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
    const r = await new AffiliateService(prisma, config).requestPayout('u1', 50_000, 'WALLET_BALANCE');
    // dù request 50k, credit theo tổng thực 100k ×1.5 = 150k (không mất 50k còn lại)
    expect(r.credited).toBe(150_000);
    expect(userUpdate.mock.calls[0][0].data.walletBalance).toEqual({ increment: 150_000 });
    expect(payoutCreate.mock.calls[0][0].data.status).toBe('PAID');
  });

  it('WALLET_BALANCE double-spend: updateMany count=0 → BadRequest, KHÔNG credit ví', async () => {
    const { prisma, userUpdate } = makePrisma({ available: 100_000, markCount: 0 });
    await expect(
      new AffiliateService(prisma, config).requestPayout('u1', 100_000, 'WALLET_BALANCE'),
    ).rejects.toThrow('đã được xử lý');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('BANK dưới mức tối thiểu → BadRequest', async () => {
    const { prisma } = makePrisma({ available: 100_000 });
    await expect(new AffiliateService(prisma, config).requestPayout('u1', 10_000, 'BANK', {})).rejects.toThrow(
      'tối thiểu',
    );
  });

  it('BANK hợp lệ → payout.amount = TỔNG THỰC + mark PAID + gán batch', async () => {
    const { prisma, payoutCreate, updateMany } = makePrisma({
      available: 100_000,
      rows: [{ id: 'c1', amount: 100_000 }],
    });
    const r = await new AffiliateService(prisma, config).requestPayout('u1', 80_000, 'BANK', { bank: 'VCB' });
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
    await new AffiliateService(prisma, config).grantReferralReward('o1');
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
    await new AffiliateService(prisma, config).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('tự giới thiệu (referrer === buyer) → không thưởng', async () => {
    const { prisma, couponCreate } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: 'u1', total: 250000 });
    await new AffiliateService(prisma, config).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('không có người giới thiệu → không thưởng', async () => {
    const { prisma, couponCreate } = makePrisma({ id: 'o1', userId: 'u1', referrerUserId: null, total: 250000 });
    await new AffiliateService(prisma, config).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });

  it('voucher đã tồn tại (đã thưởng cặp này) → không cấp lại (idempotent)', async () => {
    const { prisma, couponCreate } = makePrisma(
      { id: 'o1', userId: 'referee', referrerUserId: 'referrer', total: 250000 },
      { id: 'existing' },
    );
    await new AffiliateService(prisma, config).grantReferralReward('o1');
    expect(couponCreate).not.toHaveBeenCalled();
  });
});

describe('AffiliateService analytics', () => {
  it('storefrontAnalytics gom theo gian hàng của tôi', async () => {
    const prisma = {
      storefront: { findMany: jest.fn().mockResolvedValue([{ slug: 'linh', title: 'Cửa hàng Linh' }]) },
      order: { aggregate: jest.fn().mockResolvedValue({ _count: { _all: 3 }, _sum: { total: 900000 } }) },
      commission: { aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 72000 } }) },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config);
    const r = await svc.storefrontAnalytics('u1');
    expect(r.storefronts[0]).toMatchObject({ slug: 'linh', orders: 3, revenue: 900000, commission: 72000 });
  });

  it('productCommissionBreakdown nhóm theo sản phẩm', async () => {
    const prisma = {
      commission: { findMany: jest.fn().mockResolvedValue([
        { id: 'c1', order: { items: [
          { productName: 'Dầu gội', variationId: 'v1', total: 100000 },
          { productName: 'Xà phòng', variationId: 'v2', total: 50000 },
        ] } },
      ]) },
      variation: { findMany: jest.fn().mockResolvedValue([
        { id: 'v1', affiliateRate: '10' }, { id: 'v2', affiliateRate: '8' },
      ]) },
    } as unknown as PrismaService;
    const svc = new AffiliateService(prisma, config);
    const r = await svc.productCommissionBreakdown('u1');
    const dau = r.find((x) => x.productName === 'Dầu gội');
    expect(dau?.commission).toBe(10000); // floor(100000*10/100)
    expect(r.find((x) => x.productName === 'Xà phòng')?.commission).toBe(4000);
  });
});
