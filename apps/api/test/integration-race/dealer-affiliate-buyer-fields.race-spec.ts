import { randomInt } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PricingService } from '../../src/modules/pricing/pricing.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { RewardPointsService } from '../../src/modules/wallet/reward-points.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { BUYER_HIDDEN_ORDER_FIELDS } from '../../src/modules/orders/buyer-order-fields';
import { createDealer, createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * Đơn trả cho người đặt (khách, đại lý, CTV lên đơn hộ) trên Postgres THẬT: cột tìm kiếm người nhận do trigger điền, mốc hệ thống
 * thôi tự huỷ và ghi chú vận hành Pancake không bao giờ nằm trong response (R7 review #2).
 */
describe('Đơn trả cho người đặt không kèm cột nội bộ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let affiliate: AffiliateService;
  let dealer: DealerService;
  let orders: OrdersService;
  const ATTENTION = 'Đơn CHƯA thanh toán — hệ thống thôi tự huỷ vì đã bàn giao vận chuyển. Gọi khách thu tiền.';

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        AnalyticsEventsService,
        AffiliateService,
        DealerService,
        { provide: RewardPointsService, useValue: {} },
        { provide: PricingService, useValue: { calcShippingFee: jest.fn().mockResolvedValue(0) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { resolveEffective: jest.fn().mockResolvedValue(new Map()), consumeQuota: jest.fn() } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    affiliate = moduleRef.get(AffiliateService);
    dealer = moduleRef.get(DealerService);
    const none = {} as never;
    orders = new OrdersService(prisma, none, none, none, none, none, none);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  const phone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

  async function variation() {
    const tag = randCode(8);
    return prisma.variation.create({
      data: {
        pancakeId: `itbf-v-${tag}`,
        sku: `ITBF-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        affiliateRate: 10,
        stock: 50,
        product: {
          create: { pancakeId: `itbf-p-${tag}`, brand: 'IT', slug: `itbf-${tag.toLowerCase()}`, name: `SP IT ${tag}`, description: 'IT', basePrice: 100_000 },
        },
      },
    });
  }

  /** Đơn đã bàn giao vận chuyển mà chưa thanh toán: hệ thống thôi tự huỷ và để lại ghi chú cho vận hành. */
  async function markBlocked(orderId: string) {
    await prisma.order.update({
      where: { id: orderId },
      data: { autoCancelBlockedAt: new Date(), pancakeAttention: ATTENTION, pancakeAttentionAt: new Date() },
    });
    const row = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(row.recipientSearch).not.toBe('');
    expect(row.pancakeAttention).toBe(ATTENTION);
  }

  function expectNoInternalFields(res: object) {
    const keys = Object.keys(res);
    for (const k of BUYER_HIDDEN_ORDER_FIELDS) expect(keys).not.toContain(k);
    expect(keys).not.toContain('recipientSearch');
    expect(keys).not.toContain('autoCancelBlockedAt');
    expect(keys).not.toContain('pancakeAttention');
    expect(JSON.stringify(res)).not.toContain('thôi tự huỷ');
  }

  it('đại lý: đơn vừa đặt, đặt lại cùng Idempotency-Key và GET /dealer/orders', async () => {
    const tag = randCode(6);
    const tier = await prisma.dealerTier.create({ data: { id: `tier_${tag}`, name: `Bậc ${tag}`, minOrderVolume: 0, discountRules: { default: 0.2 } } });
    const d = await createDealer(prisma, { metadata: { dealerTierId: tier.id } });
    const v = await variation();
    const key = `itbf-${randCode(10)}`;
    const dto = { items: [{ variationId: v.id, quantity: 2 }], paymentMethod: 'PREPAID' } as never;

    const created = await dealer.placeOrder(d.id, dto, key);
    expect(created).toMatchObject({ type: 'DEALER', total: 160_000 });
    expectNoInternalFields(created);

    await markBlocked(created.id);
    const replayed = await dealer.placeOrder(d.id, dto, key);
    expect(replayed.id).toBe(created.id);
    expectNoInternalFields(replayed);

    const listed = (await dealer.listOrders(d.id)).find((o) => o.id === created.id)!;
    expect(listed.items).toHaveLength(1);
    expectNoInternalFields(listed);
  });

  it('CTV lên đơn hộ: đơn vừa đặt và đặt lại cùng Idempotency-Key', async () => {
    const ctv = await createUser(prisma, { role: 'AFFILIATE', phone: phone() });
    const v = await variation();
    const key = `itbf-${randCode(10)}`;
    const dto = {
      items: [{ variationId: v.id, quantity: 1 }],
      paymentMethod: 'COD',
      customer: { recipient: 'Nguyễn Thị Khách', phone: phone(), province: 'Hà Nội', ward: 'Phường IT', street: '1 Đường IT', provinceCode: '84_VN01', wardCode: '00001' },
    } as never;

    const created = await affiliate.placeOrderForCustomer(ctv.id, dto, key);
    expect(created).toMatchObject({ placedForCustomer: true, total: 100_000 });
    expectNoInternalFields(created);

    await markBlocked(created.id);
    const replayed = await affiliate.placeOrderForCustomer(ctv.id, dto, key);
    expect(replayed.id).toBe(created.id);
    expectNoInternalFields(replayed);
  });

  it('khách: danh sách và chi tiết đơn', async () => {
    const u = await createUser(prisma, { phone: phone() });
    const order = await createOrder(prisma, {
      userId: u.id,
      shippingAddress: { recipient: 'Trần Văn Nhận', phone: phone(), province: 'Hà Nội', ward: 'Phường IT', street: '1 Đường IT' },
    });
    await markBlocked(order.id);
    const page = await orders.list(u.id, {}, 1, 20);
    expectNoInternalFields(page.data.find((o) => o.id === order.id)!);
    expectNoInternalFields(await orders.detailView(u.id, order.code));
  });
});
