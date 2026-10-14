import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { AdminEngagementService } from '../../src/modules/admin/admin-engagement.service';
import { createUser, randCode } from './helpers';

/**
 * Trên Postgres THẬT: màn "Lịch sử giá đại lý" (ADMINOPS-17) lọc SKU không phân biệt hoa thường và kèm tên sản phẩm/bậc/người
 * đổi; màn "Nhiệm vụ & quà đổi điểm" (ENGAGE-22) đếm lượt nhận nhiệm vụ và lượt đổi quà từ sổ điểm.
 */
describe('Admin — lịch sử giá đại lý, nhiệm vụ & quà đổi điểm (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
  let engagement: AdminEngagementService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const none = {} as never;
    admin = new AdminService(prisma, none, none, none, none, none, none, none, none, none);
    engagement = new AdminEngagementService(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('lịch sử giá: tìm SKU không phân biệt hoa thường, kèm sản phẩm, biến thể, bậc, người đổi', async () => {
    const tag = randCode(8);
    const boss = await createUser(prisma, { role: 'ADMIN', fullName: `Chủ ${tag}` });
    const tier = await prisma.dealerTier.create({ data: { id: `tier_${tag}`, name: `Bậc ${tag}`, minOrderVolume: 0, discountRules: {} } });
    const p = await prisma.product.create({
      data: { pancakeId: `it-ph-p-${tag}`, brand: 'IT', slug: `it-ph-${tag.toLowerCase()}`, name: `Nước rửa ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `it-ph-v-${tag}`, productId: p.id, sku: `PH-${tag}`, name: 'Chai 500ml', attributes: {}, retailPrice: 100_000, stock: 1 },
    });
    await prisma.dealerPriceHistory.create({
      data: { variationId: v.id, sku: v.sku, tierId: tier.id, oldPrice: null, newPrice: 90_000, changedBy: boss.id },
    });

    const res = await admin.getDealerPriceHistory({ sku: `ph-${tag.toLowerCase()}` }, 1, 20);
    expect(res.meta.total).toBe(1);
    expect(res.data[0]).toMatchObject({
      sku: `PH-${tag}`,
      productName: `Nước rửa ${tag}`,
      variationName: 'Chai 500ml',
      tierName: `Bậc ${tag}`,
      changedByName: `Chủ ${tag}`,
      oldPrice: null,
      newPrice: 90_000,
    });
  });

  it('nhiệm vụ đếm lượt đã nhận; quà đổi điểm đếm lượt đổi tổng và 30 ngày', async () => {
    const tag = randCode(8);
    const u = await createUser(prisma);
    const mission = await prisma.mission.create({
      data: { id: `it-m-${tag}`, code: `IT_${tag}`, title: 'IT', description: 'IT', rewardPoints: 10, goal: 1 },
    });
    await prisma.missionProgress.createMany({
      data: [
        { userId: u.id, missionId: mission.id, cycleKey: '0', progress: 1, goal: 1, completedAt: new Date() },
        { userId: (await createUser(prisma)).id, missionId: mission.id, cycleKey: '0', progress: 1, goal: 1, completedAt: new Date() },
      ],
    });
    const listed = (await engagement.listMissions()).find((m) => m.id === mission.id)!;
    expect(listed.claimedCount).toBe(2);

    const updated = await engagement.updateMission(mission.id, { rewardPoints: 25, title: 'Nhiệm vụ IT' });
    expect(updated).toMatchObject({ rewardPoints: 25, title: 'Nhiệm vụ IT', goal: 1 });

    const before = (await engagement.rewardCatalog()).find((r) => r.id === 'reward-freeship')!;
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await prisma.pointsTransaction.createMany({
      data: [
        { userId: u.id, delta: -20, reason: 'LOYALTY_REDEEM_VOUCHER:reward-freeship', refType: 'REWARD', refId: `c-${tag}-1` },
        { userId: u.id, delta: -20, reason: 'LOYALTY_REDEEM_VOUCHER:reward-freeship', refType: 'REWARD', refId: `c-${tag}-2`, createdAt: old },
        { userId: u.id, delta: 20, reason: 'LOYALTY_REDEEM_VOUCHER:reward-freeship', refType: 'REWARD_REFUND', refId: `c-${tag}-3` },
      ],
    });
    const after = (await engagement.rewardCatalog()).find((r) => r.id === 'reward-freeship')!;
    expect(after.redeemedCount - before.redeemedCount).toBe(2);
    expect(after.redeemed30d - before.redeemed30d).toBe(1);
  });
});
