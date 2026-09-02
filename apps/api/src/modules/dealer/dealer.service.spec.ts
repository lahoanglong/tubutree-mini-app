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

  // Việc 4 (audit round 2): findFirst rồi create không transaction — 2 lượt chạy cron/manual
  // chồng nhau có thể cùng qua check "chưa trả thưởng" trước khi lượt đầu commit. Unique
  // (userId,refType,refId) chặn ở DB, lượt thua ăn P2002 → phải coi như ĐÃ trả thưởng (bỏ qua,
  // KHÔNG throw để không chặn các dealer khác trong cùng lượt chạy).
  it('race double-pay (P2002 khi create) → bỏ qua dealer đó, không throw, không đếm paid/notify trùng', async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    const prisma = prismaForPayout({
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'd1' }]) },
      order: { aggregate: jest.fn().mockResolvedValue({ _sum: { total: 120_000_000 }, _count: 5 }) },
      // findFirst vẫn trả null (pre-check chưa thấy — lượt kia chưa commit lúc pre-check chạy),
      // nhưng create() đụng unique constraint do lượt kia đã thắng race.
      dealerCreditLedger: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockRejectedValue(p2002) },
    });
    const notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    const r = await new DealerService(prisma, makeConfig({ 'dealer.quarterly_bonus_tiers': TIERS }), notifications as never).payoutQuarterlyBonuses(NOW);
    expect(r).toEqual({ paid: 0, quarter: 'Q1/2026' });
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});

describe('DealerService.apply (Việc 3 — TOCTOU khi đăng ký đại lý)', () => {
  it('race 2 request apply() đồng thời (P2002 khi create) → message thân thiện, không lộ lỗi DB thô', async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' });
    const prisma = {
      dealerApplication: {
        // findFirst pre-check chưa thấy đơn PENDING (request kia chưa commit lúc check chạy),
        // nhưng create() đụng partial unique index dealer_applications_pending_user_key.
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockRejectedValue(p2002),
      },
    } as unknown as PrismaService;
    const dto = {
      businessName: 'Cty A', ownerName: 'A', phone: '0900000000', address: 'HN',
      cccdFrontUrl: 'f.jpg', cccdBackUrl: 'b.jpg',
    };
    await expect(new DealerService(prisma, makeConfig()).apply('u1', dto as never)).rejects.toThrow(
      'Bạn đã có đơn đăng ký đang chờ duyệt.',
    );
  });

  it('không có đơn PENDING, create() thành công bình thường → trả đơn mới tạo', async () => {
    const created = { id: 'app1', userId: 'u1', status: 'PENDING' };
    const prisma = {
      dealerApplication: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(created),
      },
    } as unknown as PrismaService;
    const dto = {
      businessName: 'Cty A', ownerName: 'A', phone: '0900000000', address: 'HN',
      cccdFrontUrl: 'f.jpg', cccdBackUrl: 'b.jpg',
    };
    const out = await new DealerService(prisma, makeConfig()).apply('u1', dto as never);
    expect(out).toEqual(created);
  });
});

describe('DealerService.creditPayment (an authenticated non-dealer must not be able to fabricate a paid-down debt)', () => {
  it('chặn user không phải DEALER (trước đây thiếu check, cho phép tự ghi delta âm vào ledger của mình)', async () => {
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'CUSTOMER', metadata: null }) },
      dealerCreditLedger: { create: jest.fn() },
    } as unknown as PrismaService;
    await expect(new DealerService(prisma, makeConfig()).creditPayment('u1', 50_000, 'note')).rejects.toThrow();
    expect((prisma as unknown as { dealerCreditLedger: { create: jest.Mock } }).dealerCreditLedger.create).not.toHaveBeenCalled();
  });

  it('đại lý hợp lệ → ghi delta âm bình thường', async () => {
    const ledgerCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', metadata: null }) },
      dealerTier: { findUnique: jest.fn().mockResolvedValue(null) },
      dealerCreditLedger: { create: ledgerCreate, findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    await new DealerService(prisma, makeConfig()).creditPayment('d1', 50_000, 'note');
    expect(ledgerCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: 'd1', delta: -50_000 }) }));
  });
});

describe('DealerService.placeOrder idempotency (chống double-submit đơn CREDIT)', () => {
  function prismaForOrder() {
    const orderCreate = jest.fn().mockResolvedValue({ id: 'o1' });
    const base: Record<string, unknown> = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', metadata: null }) },
      dealerTier: { findUnique: jest.fn().mockResolvedValue(null) },
      variation: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', retailPrice: 100000, dealerPrices: null, name: '500ml', product: { name: 'SP' } }]) },
      order: {
        create: orderCreate,
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'o1', items: [] }),
      },
      dealerCreditLedger: { aggregate: jest.fn().mockResolvedValue({ _sum: { delta: 0 } }), create: jest.fn().mockResolvedValue({}) },
    };
    base.$transaction = jest.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(base));
    return { prisma: base as unknown as PrismaService, orderCreate };
  }

  it('key đã tồn tại (đơn đã tạo trước đó) → trả lại đơn cũ, KHÔNG tạo đơn/ghi công nợ lần 2', async () => {
    const { prisma, orderCreate } = prismaForOrder();
    (prisma.order.findUnique as jest.Mock).mockResolvedValue({ id: 'o-existing', userId: 'd1' });
    (prisma.order.findUniqueOrThrow as jest.Mock).mockResolvedValue({ id: 'o-existing', items: [] });
    const r = await new DealerService(prisma, makeConfig()).placeOrder(
      'd1',
      { items: [{ variationId: 'v1', quantity: 1 }], paymentMethod: 'PREPAID' } as never,
      'idem-key-1',
    );
    expect((r as { id: string }).id).toBe('o-existing');
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('key mới → tạo đơn bình thường + ghi idempotencyKey', async () => {
    const { prisma, orderCreate } = prismaForOrder();
    await new DealerService(prisma, makeConfig()).placeOrder(
      'd1',
      { items: [{ variationId: 'v1', quantity: 1 }], paymentMethod: 'PREPAID' } as never,
      'idem-key-2',
    );
    expect(orderCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ idempotencyKey: 'idem-key-2' }) }));
  });
});

describe('DealerService.rewardsProgress (hiển thị điều kiện + tiến trình)', () => {
  const NOW = new Date('2026-08-15T00:00:00Z'); // Q3/2026

  it('map period: QUARTER dùng doanh số quý, YEAR dùng năm; achieved/toGo đúng', async () => {
    const aggregate = jest
      .fn()
      .mockResolvedValueOnce({ _sum: { total: 30_000_000 } }) // quý
      .mockResolvedValueOnce({ _sum: { total: 120_000_000 } }); // năm
    const prisma = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', metadata: null }) },
      dealerTier: { findUnique: jest.fn() },
      order: { aggregate },
      dealerReward: { findMany: jest.fn().mockResolvedValue([
        { id: 'r1', type: 'TOUR', title: 'Tour', description: null, threshold: 50_000_000, period: 'QUARTER', sortOrder: 0 },
        { id: 'r2', type: 'GIFT', title: 'Quà năm', description: null, threshold: 100_000_000, period: 'YEAR', sortOrder: 1 },
      ]) },
    } as unknown as PrismaService;
    const out = await new DealerService(prisma, makeConfig()).rewardsProgress('d1', NOW);
    const r1 = out.rewards.find((r) => r.id === 'r1')!;
    const r2 = out.rewards.find((r) => r.id === 'r2')!;
    expect(r1.volume).toBe(30_000_000);
    expect(r1.achieved).toBe(false);
    expect(r1.toGo).toBe(20_000_000);
    expect(r2.volume).toBe(120_000_000);
    expect(r2.achieved).toBe(true);
    expect(r2.toGo).toBe(0);
  });

  it('chặn nếu không phải đại lý', async () => {
    const prisma = { user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ role: 'CUSTOMER' }) } } as unknown as PrismaService;
    await expect(new DealerService(prisma, makeConfig()).rewardsProgress('u1', NOW)).rejects.toThrow();
  });
});
