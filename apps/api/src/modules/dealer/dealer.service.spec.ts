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
