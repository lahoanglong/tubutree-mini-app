import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { createOrder, createUser, deleteItData, randCode, warmPool } from './helpers';

/**
 * Chi tiêu 12 tháng xét hạng chỉ tính đơn khách tự mua lẻ cho mình, trên Postgres THẬT: đơn nhập sỉ của đại lý (DEALER) và đơn
 * CTV lên hộ khách (placedForCustomer) nằm cùng userId nhưng không được cộng vào hạng hay tiến độ "còn X đ".
 */
describe('Chi tiêu xét hạng chỉ tính đơn lẻ tự mua (real Postgres)', () => {
  let prisma: PrismaService;
  const userIds: string[] = [];
  const tierIds: string[] = [];
  let tiers: Awaited<ReturnType<PrismaService['membershipTier']['findMany']>>;
  let loyalty: LoyaltyService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    loyalty = new LoyaltyService(prisma, new SystemConfigService(prisma));
    const prefix = `ITQ1_${randCode(6)}`;
    const mk = (suffix: string, sortOrder: number, minSpending: number | null) =>
      prisma.membershipTier.create({
        data: { id: `${prefix}_${suffix}`, name: suffix, sortOrder, minPoints: minSpending ?? 0, minSpending, discountPct: 0, pointMultiplier: 1, perks: {} },
      });
    tiers = [await mk('mam', 70, null), await mk('loc', 71, 5_000_000), await mk('co', 72, 20_000_000)];
    tierIds.push(...tiers.map((t) => t.id));
  });

  afterAll(async () => {
    await deleteItData(prisma, { userIds });
    await prisma.membershipTier.deleteMany({ where: { id: { in: tierIds } } });
    await prisma?.$disconnect();
  });

  async function customerWith(orders: { type?: 'RETAIL' | 'DEALER'; placedForCustomer?: boolean; total: number }[], role: 'CUSTOMER' | 'DEALER' | 'AFFILIATE' = 'CUSTOMER') {
    const user = await createUser(prisma, { role, tierId: tiers[0]!.id });
    userIds.push(user.id);
    for (const o of orders) {
      await createOrder(prisma, { userId: user.id, status: 'DELIVERED', deliveredAt: new Date(), type: o.type ?? 'RETAIL', placedForCustomer: o.placedForCustomer ?? false, total: o.total, ...(o.type === 'DEALER' ? { subtotal: o.total } : {}) });
    }
    return user;
  }
  const tierOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).tierId;

  it('đại lý nhập sỉ 50 triệu: không lên hạng, tiền mua 12 tháng = 0', async () => {
    const dealer = await customerWith([{ type: 'DEALER', total: 50_000_000 }], 'DEALER');
    await loyalty.recalcTier(dealer.id, tiers);
    expect(await tierOf(dealer.id)).toBe(tiers[0]!.id);
    const ov = await loyalty.getOverview(dealer.id);
    expect(ov.spent12m).toBe(0);
  });

  it('CTV lên hộ khách 6 triệu: không lên hạng bằng tiền của khách', async () => {
    const ctv = await customerWith([{ placedForCustomer: true, total: 6_000_000 }], 'AFFILIATE');
    await loyalty.recalcTier(ctv.id, tiers);
    expect(await tierOf(ctv.id)).toBe(tiers[0]!.id);
    expect((await loyalty.getOverview(ctv.id)).spent12m).toBe(0);
  });

  it('ba loại đơn: chỉ đơn lẻ tự mua (có cả phí giao trong total) được cộng, đủ mốc thì lên hạng', async () => {
    const mixed = await customerWith([
      { total: 5_100_000 },
      { type: 'DEALER', total: 50_000_000 },
      { placedForCustomer: true, total: 30_000_000 },
    ]);
    await loyalty.recalcTier(mixed.id, tiers);
    expect(await tierOf(mixed.id)).toBe(tiers[1]!.id);
    expect((await loyalty.getOverview(mixed.id)).spent12m).toBe(5_100_000);
  });
});
