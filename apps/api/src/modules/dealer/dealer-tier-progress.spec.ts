import { DealerService } from './dealer.service';
import { nextTierOf, tierDiscountPct, vnMonthBounds, type TierRow } from './dealer-tier-progress';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SystemConfigService } from '../system-config/system-config.service';

const TIERS: TierRow[] = [
  { id: 'DEALER_1', name: 'Đại lý Cấp 1', minOrderVolume: 10_000_000, discountRules: { default: 0.2 } },
  { id: 'DEALER_2', name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountRules: { default: 0.3 } },
  { id: 'DEALER_3', name: 'Đại lý Cấp 3', minOrderVolume: 80_000_000, discountRules: { default: 0.38 } },
  { id: 'DEALER_VIP', name: 'Đại lý VIP', minOrderVolume: 200_000_000, discountRules: { default: 0.45 } },
];

describe('vnMonthBounds', () => {
  it('lấy tháng theo giờ VN: 17:30 UTC ngày 30/11 đã là 00:30 ngày 01/12 ở VN', () => {
    const m = vnMonthBounds(new Date('2026-11-30T17:30:00Z'));
    expect(m.label).toBe('12/2026');
    expect(m.start.toISOString()).toBe('2026-11-30T17:00:00.000Z');
    expect(m.end.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('mốc đầu tháng là 00:00 giờ VN (17:00 UTC hôm trước)', () => {
    const m = vnMonthBounds(new Date('2026-11-24T04:00:00Z'));
    expect(m.label).toBe('11/2026');
    expect(m.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(m.end.toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });
});

describe('tierDiscountPct', () => {
  it('đọc discountRules.default, thiếu thì 20% như dealerContext, kẹp theo trần', () => {
    expect(tierDiscountPct({ default: 0.3 }, 0.45)).toBe(30);
    expect(tierDiscountPct({}, 0.45)).toBe(20);
    expect(tierDiscountPct(null, 0.45)).toBe(20);
    expect(tierDiscountPct({ default: 0.6 }, 0.45)).toBe(45);
    expect(tierDiscountPct({ default: 'abc' }, 0.45)).toBe(20);
  });
});

describe('nextTierOf', () => {
  it('bậc kế = mốc nhỏ nhất lớn hơn mốc hiện tại', () => {
    expect(nextTierOf(TIERS, TIERS[0]!, 0.45)).toMatchObject({ id: 'DEALER_2', minOrderVolume: 30_000_000, discountPct: 30 });
    expect(nextTierOf(TIERS, TIERS[2]!, 0.45)).toMatchObject({ id: 'DEALER_VIP', discountPct: 45 });
  });

  it('bậc cao nhất, hoặc chưa được gán bậc → không có bậc kế', () => {
    expect(nextTierOf(TIERS, TIERS[3]!, 0.45)).toBeNull();
    expect(nextTierOf(TIERS, null, 0.45)).toBeNull();
  });

  it('bỏ bậc mốc cao hơn mà chiết khấu không cao hơn (sau khi kẹp trần)', () => {
    // Trần 30%: Cấp 3 và VIP đều chỉ còn 30%, không giảm thêm so với Cấp 2.
    expect(nextTierOf(TIERS, TIERS[1]!, 0.3)).toBeNull();
    const odd: TierRow[] = [...TIERS, { id: 'DEALER_2B', name: 'Cấp 2B', minOrderVolume: 50_000_000, discountRules: { default: 0.3 } }];
    expect(nextTierOf(odd, TIERS[1]!, 0.45)?.id).toBe('DEALER_3');
  });

  it('bỏ chính bậc hiện tại kể cả khi danh sách có bậc trùng mốc', () => {
    const dup: TierRow[] = [TIERS[0]!, { ...TIERS[0]!, id: 'DEALER_1B' }, TIERS[1]!];
    expect(nextTierOf(dup, TIERS[0]!, 0.45)?.id).toBe('DEALER_2');
  });
});

describe('DealerService.tierProgress', () => {
  const config = (values: Record<string, unknown> = {}) =>
    ({ get: async <T>(key: string, fb?: T): Promise<T> => (key in values ? values[key] : fb) as T }) as unknown as SystemConfigService;

  function prisma(tier: TierRow | null, orders: unknown[]) {
    const findMany = jest.fn().mockResolvedValue(orders);
    const tierFindMany = jest.fn().mockResolvedValue(TIERS);
    return {
      prisma: {
        user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'd1', role: 'DEALER', metadata: tier ? { dealerTierId: tier.id } : null }) },
        dealerTier: { findUnique: jest.fn().mockResolvedValue(tier), findMany: tierFindMany },
        order: { findMany },
        dealerCreditLedger: { findMany: jest.fn().mockResolvedValue([]) },
      } as unknown as PrismaService,
      findMany,
      tierFindMany,
    };
  }

  it('doanh số tháng VN đã chốt (tiền hàng, bỏ phí giao) so với mốc bậc kế; đơn chưa chốt vào pendingVolume', async () => {
    const { prisma: p, findMany } = prisma(TIERS[0]!, [
      { id: 'o1', total: 12_030_000, shippingFee: 30_000, status: 'DELIVERED', paymentStatus: 'PAID', createdAt: new Date(), paidAt: new Date() },
      { id: 'o2', total: 5_000_000, shippingFee: 0, status: 'CONFIRMED', paymentStatus: 'UNPAID', createdAt: new Date(), paidAt: null },
    ]);
    const r = await new DealerService(p, config()).tierProgress('d1', new Date('2026-11-24T04:00:00Z'));
    expect(r).toMatchObject({
      month: '11/2026',
      volume: 12_000_000,
      pendingVolume: 5_000_000,
      currentTier: { id: 'DEALER_1', discountPct: 20 },
      nextTier: { id: 'DEALER_2', name: 'Đại lý Cấp 2', minOrderVolume: 30_000_000, discountPct: 30, toGo: 18_000_000 },
    });
    const where = findMany.mock.calls[0]![0].where;
    expect(where.type).toBe('DEALER');
    expect(where.createdAt).toEqual({ gte: new Date('2026-10-31T17:00:00Z'), lt: new Date('2026-11-30T17:00:00Z') });
  });

  it('đã vượt mốc → toGo 0 (vẫn là bậc kế, chờ Tubu Tree xét)', async () => {
    const { prisma: p } = prisma(TIERS[0]!, [
      { id: 'o1', total: 31_000_000, shippingFee: 0, status: 'DELIVERED', paymentStatus: 'PAID', createdAt: new Date(), paidAt: new Date() },
    ]);
    const r = await new DealerService(p, config()).tierProgress('d1', new Date('2026-11-24T04:00:00Z'));
    expect(r.nextTier).toMatchObject({ id: 'DEALER_2', toGo: 0 });
  });

  it('chưa được gán bậc → không đọc bảng bậc, không có bậc kế', async () => {
    const { prisma: p, tierFindMany } = prisma(null, []);
    const r = await new DealerService(p, config()).tierProgress('d1', new Date('2026-11-24T04:00:00Z'));
    expect(r.currentTier).toBeNull();
    expect(r.nextTier).toBeNull();
    expect(tierFindMany).not.toHaveBeenCalled();
  });

  it('trần chiết khấu đọc từ cấu hình: trần 30% thì Cấp 2 không còn bậc kế giảm thêm', async () => {
    const { prisma: p } = prisma(TIERS[1]!, []);
    const r = await new DealerService(p, config({ 'dealer.max_discount_pct': 0.3 })).tierProgress('d1', new Date('2026-11-24T04:00:00Z'));
    expect(r.currentTier).toMatchObject({ id: 'DEALER_2', discountPct: 30 });
    expect(r.nextTier).toBeNull();
  });

  it('không phải đại lý → Forbidden', async () => {
    const p = {
      user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'u1', role: 'CUSTOMER', metadata: null }) },
    } as unknown as PrismaService;
    await expect(new DealerService(p, config()).tierProgress('u1')).rejects.toThrow('Tài khoản chưa được duyệt làm đại lý.');
  });
});
