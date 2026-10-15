import { Test, type TestingModule } from '@nestjs/testing';
import type { OrderStatus, PaymentStatus } from '@prisma/client';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/** AffiliateService.storefrontAnalytics: doanh thu gian hàng chỉ gồm đơn bán thật, trừ tiền đã hoàn trả một phần. */
describe('AffiliateService.storefrontAnalytics revenue (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        RewardPointsService,
        AnalyticsEventsService,
        AffiliateService,
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function setup() {
    const ctv = await createUser(prisma, { role: 'AFFILIATE' });
    const buyer = await createUser(prisma);
    const slug = `it-sa-${randCode(8).toLowerCase()}`;
    await prisma.storefront.create({ data: { type: 'CTV', slug, ownerUserId: ctv.id, title: 'Shop IT', isPublished: true } });
    const mk = (status: OrderStatus, paymentStatus: PaymentStatus, total: number) =>
      createOrder(prisma, { userId: buyer.id, status, paymentStatus, total, referrerUserId: ctv.id, storefrontSlug: slug });
    const ret = (orderId: string, refundAmount: number | null, shippingRefund = 0, extra: { status?: 'APPROVED' | 'REQUESTED'; fullReturn?: boolean } = {}) =>
      prisma.returnRequest.create({
        data: { orderId, userId: buyer.id, reason: 'IT', status: extra.status ?? 'APPROVED', refundAmount, shippingRefund, fullReturn: extra.fullReturn ?? false },
      });
    const read = async () => (await affiliate.storefrontAnalytics(ctv.id)).storefronts.find((s) => s.slug === slug)!;
    return { mk, ret, read, ctv, buyer, slug };
  }

  it('đơn không trả: như cũ', async () => {
    const { mk, read } = await setup();
    await mk('DELIVERED', 'PAID', 300_000);
    await mk('CONFIRMED', 'UNPAID', 200_000);
    expect(await read()).toMatchObject({ orders: 2, revenue: 500_000 });
  });

  it('đơn CANCELLED / RETURNED / chờ thanh toán / đã hoàn tiền không vào doanh thu', async () => {
    const { mk, read } = await setup();
    await mk('DELIVERED', 'PAID', 300_000);
    await mk('CANCELLED', 'UNPAID', 111_000);
    await mk('RETURNED', 'PAID', 222_000);
    await mk('PENDING_PAYMENT', 'UNPAID', 333_000);
    await mk('DELIVERED', 'REFUNDED', 444_000);
    expect(await read()).toMatchObject({ revenue: 300_000 });
  });

  it('trừ tiền hàng + phí ship đã hoàn của các lần trả một phần đã duyệt; yêu cầu chưa duyệt / fullReturn bỏ qua', async () => {
    const { mk, ret, read } = await setup();
    const o = await mk('DELIVERED', 'PAID', 300_000);
    await ret(o.id, 100_000);
    await ret(o.id, 50_000, 10_000);
    await ret(o.id, 70_000, 0, { status: 'REQUESTED' });
    await ret(o.id, 90_000, 0, { fullReturn: true });
    expect((await read()).revenue).toBe(300_000 - 100_000 - 60_000);
  });

  it('hoàn vượt tổng thì kẹp về 0, không âm', async () => {
    const { mk, ret, read } = await setup();
    const o = await mk('DELIVERED', 'PAID', 100_000);
    await ret(o.id, 100_000, 5_000);
    expect((await read()).revenue).toBe(0);
  });

  it('CTV hàng chục nghìn đơn (>32.766 tham số bind nếu gửi IN id): tính trong DB, số đúng, không đọc đơn về Node', async () => {
    const { mk, ret, read, ctv, buyer, slug } = await setup();
    const N = 33_000;
    await prisma.$executeRaw`
      INSERT INTO "orders" ("id", "code", "userId", "type", "status", "subtotal", "total", "paymentMethod", "paymentStatus",
                            "shippingAddress", "referrerUserId", "storefrontSlug", "updatedAt")
      SELECT ${`itbulk-${randCode(6)}-`} || g, ${`ITB${randCode(6)}-`} || g, ${buyer.id}, 'RETAIL', 'DELIVERED', 1000, 1000, 'COD', 'PAID',
             '{}'::jsonb, ${ctv.id}, ${slug}, now()
      FROM generate_series(1, ${N}) AS g`;
    const sample = await prisma.order.findFirstOrThrow({ where: { referrerUserId: ctv.id, storefrontSlug: slug } });
    await ret(sample.id, 400, 100);
    await ret(sample.id, 200);
    await mk('CANCELLED', 'UNPAID', 999_999);
    const findMany = jest.spyOn(prisma.order, 'findMany');
    try {
      const r = await read();
      expect(r).toMatchObject({ orders: N + 1, revenue: N * 1000 - 700 });
      expect(findMany).not.toHaveBeenCalled();
    } finally {
      findMany.mockRestore();
    }
  });
});
