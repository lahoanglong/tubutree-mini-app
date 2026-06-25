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

describe('DealerService.payoutQuarterlyBonuses (cron trả thưởng quý)', () => {
  const TIERS = [
    { min: 50_000_000, pct: 2 },
    { min: 100_000_000, pct: 3 },
    { min: 200_000_000, pct: 4 },
  ];
  // 2026-04-15 → quý vừa kết thúc = Q1/2026 (theo giờ VN).
  const NOW = new Date('2026-04-15T00:00:00Z');

  function prismaForPayout(over: Record<string, unknown> = {}) {
    const base: Record<string, unknown> = {
      user: { findMany: jest.fn().mockResolvedValue([]) },
      order: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: 0 }, _count: 0 }) },
      dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
    };
    return { ...base, ...over } as unknown as PrismaService;
  }

  it('đại lý đạt mốc → cộng thưởng (delta âm = giảm công nợ) + thông báo', async () => {
    const prisma = prismaForPayout({
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'd1' }]) },
      order: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: 120_000_000 }, _count: 5 }) },
    });
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const r = await new DealerService(prisma, makeConfig({ 'dealer.quarterly_bonus_tiers': TIERS }), notifications as never).payoutQuarterlyBonuses(NOW);
    expect(r).toEqual({ paid: 1, quarter: 'Q1/2026' });
    const led = (prisma.dealerCreditLedger.create as jest.Mock).mock.calls[0][0].data;
    expect(led).toMatchObject({ userId: 'd1', delta: -3_600_000, refType: 'QUARTER_BONUS', refId: 'Q1/2026' }); // 120tr × 3%
    expect(notifications.notify).toHaveBeenCalledWith('d1', 'DEALER_BONUS_PAID', expect.objectContaining({ quarter: 'Q1/2026' }));
  });

  it('doanh số dưới mốc thấp nhất → KHÔNG cộng thưởng', async () => {
    const prisma = prismaForPayout({
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'd1' }]) },
      order: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: 10_000_000 }, _count: 1 }) },
    });
    const r = await new DealerService(prisma, makeConfig({ 'dealer.quarterly_bonus_tiers': TIERS })).payoutQuarterlyBonuses(NOW);
    expect(r.paid).toBe(0);
    expect(prisma.dealerCreditLedger.create).not.toHaveBeenCalled();
  });

  it('đã trả thưởng quý này rồi → idempotent skip', async () => {
    const prisma = prismaForPayout({
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'd1' }]) },
      order: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: 120_000_000 }, _count: 5 }) },
      dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }), create: jest.fn().mockResolvedValue({}) },
    });
    const r = await new DealerService(prisma, makeConfig({ 'dealer.quarterly_bonus_tiers': TIERS })).payoutQuarterlyBonuses(NOW);
    expect(r.paid).toBe(0);
    expect(prisma.dealerCreditLedger.create).not.toHaveBeenCalled();
    const where = (prisma.dealerCreditLedger.findFirst as jest.Mock).mock.calls[0][0].where;
    expect(where).toMatchObject({ userId: 'd1', refType: 'QUARTER_BONUS', refId: 'Q1/2026' });
  });
});
