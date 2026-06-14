import { DealerService } from './dealer.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

function makeConfig(values: Record<string, unknown> = {}): SystemConfigService {
  return {
    get: async <T>(key: string, fb?: T): Promise<T> => (key in values ? values[key] : fb) as T,
  } as unknown as SystemConfigService;
}

function prismaForPricelist(user: unknown, tier: unknown, variations: unknown[]) {
  return {
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user) },
    dealerTier: { findUnique: jest.fn().mockResolvedValue(tier) },
    variation: { findMany: jest.fn().mockResolvedValue(variations) },
  } as unknown as PrismaService;
}

const variation = (id: string, retail: number) => ({
  id,
  sku: `SKU-${id}`,
  name: '500ml',
  retailPrice: retail,
  stock: 10,
  product: { name: `SP ${id}`, brand: 'Pơ Lang' },
});

describe('DealerService.pricelist', () => {
  it('áp chiết khấu theo tier (default 25%)', async () => {
    const prisma = prismaForPricelist(
      { id: 'd1', role: 'DEALER', metadata: { dealerTierId: 't1' } },
      { id: 't1', discountRules: { default: 0.25 } },
      [variation('v1', 200000)],
    );
    const rows = await new DealerService(prisma, makeConfig()).pricelist('d1');
    expect(rows[0]!.dealerPrice).toBe(150000); // 200k * (1-0.25)
    expect(rows[0]!.discountPct).toBe(25);
  });

  it('kẹp chiết khấu theo trần max_discount_pct', async () => {
    const prisma = prismaForPricelist(
      { id: 'd1', role: 'DEALER', metadata: { dealerTierId: 't1' } },
      { id: 't1', discountRules: { default: 0.9 } }, // 90% nhưng trần 45%
      [variation('v1', 200000)],
    );
    const rows = await new DealerService(prisma, makeConfig({ 'dealer.max_discount_pct': 0.45 })).pricelist('d1');
    expect(rows[0]!.dealerPrice).toBe(110000); // 200k * (1-0.45)
    expect(rows[0]!.discountPct).toBe(45);
  });

  it('chặn user không phải DEALER', async () => {
    const prisma = prismaForPricelist({ id: 'u1', role: 'CUSTOMER', metadata: null }, null, []);
    await expect(new DealerService(prisma, makeConfig()).pricelist('u1')).rejects.toThrow();
  });
});

describe('DealerService.quarterlyReport (thưởng doanh số quý)', () => {
  function prismaForReport(revenue: number) {
    return {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', metadata: null }) },
      dealerTier: { findUnique: jest.fn().mockResolvedValue(null) },
      order: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: revenue }, _count: 3 }) },
    } as unknown as PrismaService;
  }

  it('110tr → đạt bậc 100tr = 3%', async () => {
    const r = await new DealerService(prismaForReport(110_000_000), makeConfig()).quarterlyReport('d1');
    expect(r.bonusPct).toBe(3);
    expect(r.bonusAmount).toBe(3_300_000);
    expect(r.nextTier?.pct).toBe(4); // bậc kế là 200tr→4%
  });

  it('30tr → chưa đạt bậc nào = 0%, nextTier 50tr→2%', async () => {
    const r = await new DealerService(prismaForReport(30_000_000), makeConfig()).quarterlyReport('d1');
    expect(r.bonusPct).toBe(0);
    expect(r.bonusAmount).toBe(0);
    expect(r.nextTier?.min).toBe(50_000_000);
  });

  it('250tr → bậc cao nhất 200tr = 4%, không còn nextTier', async () => {
    const r = await new DealerService(prismaForReport(250_000_000), makeConfig()).quarterlyReport('d1');
    expect(r.bonusPct).toBe(4);
    expect(r.nextTier).toBeNull();
  });
});
