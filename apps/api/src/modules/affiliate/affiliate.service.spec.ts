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
