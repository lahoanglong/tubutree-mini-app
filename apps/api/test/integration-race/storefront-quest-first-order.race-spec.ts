import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { StorefrontQuestService } from '../../src/modules/storefront/storefront-quest.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/** Nhiệm vụ "Đơn hàng đầu tiên": chỉ đơn khách tự đặt đã giao; thưởng cấp đúng một lần. */
describe('StorefrontQuestService first_order (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let svc: StorefrontQuestService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [SystemConfigService, RewardPointsService, StorefrontQuestService],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    svc = moduleRef.get(StorefrontQuestService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function setup() {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const slug = `it-q-${randCode(8).toLowerCase()}`;
    await prisma.storefront.create({ data: { type: 'CTV', slug, ownerUserId: ctv.id, title: 'Shop IT', isPublished: true } });
    const sale = async (
      status: 'DELIVERED' | 'CONFIRMED' | 'CANCELLED' | 'RETURNED' | 'PENDING_PAYMENT',
      opts: { placedForCustomer?: boolean; commissionStatus?: 'PENDING' | 'REJECTED' } = {},
    ) => {
      const order = await createOrder(prisma, {
        userId: opts.placedForCustomer ? ctv.id : buyer.id,
        status,
        total: 500_000,
        referrerUserId: ctv.id,
        storefrontSlug: slug,
        placedForCustomer: opts.placedForCustomer ?? false,
        ...(opts.placedForCustomer ? { endCustomerKey: '0911111111' } : {}),
      });
      await prisma.commission.create({
        data: {
          affiliateUserId: ctv.id,
          orderId: order.id,
          orderTotal: order.total,
          commissionableTotal: order.total,
          rate: 10,
          amount: 50_000,
          status: opts.commissionStatus ?? 'PENDING',
        },
      });
      return order;
    };
    const firstOrder = async () => (await svc.listQuests(ctv.id)).quests.find((q) => q.code === 'first_order')!;
    return { ctv, sale, firstOrder };
  }

  it('đơn khách tự đặt đã giao: đạt', async () => {
    const { sale, firstOrder } = await setup();
    await sale('DELIVERED');
    expect((await firstOrder()).done).toBe(true);
  });

  it('đơn CTV đặt hộ đã giao: không đạt', async () => {
    const { ctv, sale, firstOrder } = await setup();
    await sale('DELIVERED', { placedForCustomer: true });
    expect((await firstOrder()).done).toBe(false);
    await expect(svc.claimQuest(ctv.id, 'first_order')).rejects.toThrow(/chưa hoàn thành/);
  });

  it('đơn chưa giao, huỷ, trả, hoa hồng huỷ: không đạt', async () => {
    const { sale, firstOrder } = await setup();
    await sale('PENDING_PAYMENT');
    await sale('CONFIRMED');
    await sale('CANCELLED');
    await sale('RETURNED');
    await sale('DELIVERED', { commissionStatus: 'REJECTED' });
    expect((await firstOrder()).done).toBe(false);
  });

  it('đơn hộ đã giao cộng đơn khách tự đặt chưa giao: vẫn không đạt; giao đơn khách thì đạt', async () => {
    const { sale, firstOrder } = await setup();
    await sale('DELIVERED', { placedForCustomer: true });
    const own = await sale('CONFIRMED');
    expect((await firstOrder()).done).toBe(false);
    await prisma.order.update({ where: { id: own.id }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    expect((await firstOrder()).done).toBe(true);
  });

  it('hai đơn giao cùng lúc, nhận thưởng đồng thời: Điểm Xanh cấp đúng một lần', async () => {
    const { ctv, sale } = await setup();
    await sale('DELIVERED');
    await sale('DELIVERED');
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => svc.claimQuest(ctv.id, 'first_order')));
    expect(summarize(results).rejected).toHaveLength(0);
    const granted = results.filter((r) => r.status === 'fulfilled' && !r.value.alreadyClaimed);
    expect(granted).toHaveLength(1);
    const rows = await prisma.pointsTransaction.findMany({ where: { userId: ctv.id, reason: 'STOREFRONT_QUEST:first_order' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].delta).toBe(5_000);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ctv.id }, select: { pointsBalance: true } });
    expect(u.pointsBalance).toBe(5_000);
  });

  it('thưởng đã cấp theo luật cũ được giữ: đơn hộ không thu hồi, vẫn hiện đã nhận', async () => {
    const { ctv, sale, firstOrder } = await setup();
    await sale('DELIVERED');
    await svc.claimQuest(ctv.id, 'first_order');
    await prisma.order.updateMany({ where: { referrerUserId: ctv.id }, data: { placedForCustomer: true } });
    const q = await firstOrder();
    expect(q.claimed).toBe(true);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: ctv.id }, select: { pointsBalance: true } });
    expect(u.pointsBalance).toBe(5_000);
  });
});
