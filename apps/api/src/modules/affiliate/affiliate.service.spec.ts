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
