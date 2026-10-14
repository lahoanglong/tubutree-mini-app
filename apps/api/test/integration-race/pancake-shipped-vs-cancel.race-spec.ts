import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

/**
 * R3-CANCEL-5 trên Postgres THẬT: admin huỷ đơn (hoàn Ví) đúng lúc webhook Pancake "Đã gửi hàng" kèm vận đơn GHN về.
 * Lỗi cũ: webhook thua race thì setStatus trả đơn hiện tại không lỗi → processor coi là xong, KHÔNG gắn "Cần xử lý"
 * (7/8 lần), rồi vẫn ghi mã vận đơn GHN lên đơn đã huỷ + hoàn tiền. Stub: thông báo, hoa hồng, báo động admin.
 */
describe('Pancake "Đã gửi hàng" song song admin huỷ (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let status: OrderStatusService;
  let proc: { onOrderEvent(d: Record<string, unknown>): Promise<void> };
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        {
          provide: AffiliateService,
          useValue: {
            reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
            grantReferralReward: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    status = moduleRef.get(OrderStatusService);
    proc = new PancakeProcessor(prisma, moduleRef.get(NotificationsService), status, alerts as never) as unknown as typeof proc;
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  it('16 đơn: không đơn nào vừa "Đã huỷ + hoàn tiền" vừa mang mã vận đơn; đơn huỷ nào cũng vào "Cần xử lý Pancake"', async () => {
    const N = 16;
    const fixtures = await Promise.all(
      Array.from({ length: N }, async () => {
        const user = await createUser(prisma, { walletBalance: 1_000_000 });
        const order = await createOrder(prisma, {
          userId: user.id,
          status: 'PACKED',
          paymentMethod: 'WALLET',
          paymentStatus: 'PAID',
          total: 114_000,
          subtotal: 114_000,
          pancakeOrderId: `pk-${randCode(8)}`,
        });
        return { user, order };
      }),
    );
    const results = await Promise.allSettled(
      fixtures.flatMap(({ order }, i) => [
        status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' }),
        proc.onOrderEvent({ id: order.pancakeOrderId, status: 2, partner: { partner_name: 'GHN', extend_code: `GHNRC${i}`, partner_status: 'picked' } }),
      ]),
    );
    for (const e of summarize(results).errors) expect(e).toMatch(/CancelAfterHandoverError|đã bàn giao vận chuyển/);

    let cancelled = 0;
    for (const { user, order } of fixtures) {
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const wallet = (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).walletBalance;
      if (after.status === 'CANCELLED') {
        cancelled += 1;
        expect(after.shippingCode).toBeNull();
        expect(after.paymentStatus).toBe('REFUNDED');
        expect(wallet).toBe(1_000_000 + order.total);
        expect(after.pancakeAttention).toMatch(/GHNRC\d+|Đang giao/);
      } else {
        expect(after.status).toBe('SHIPPING');
        expect(after.shippingCode).toMatch(/^GHNRC/);
        expect(after.paymentStatus).toBe('PAID');
        expect(wallet).toBe(1_000_000);
      }
    }
    expect(cancelled).toBeGreaterThan(0);
  });

  it('tất định: webhook đọc đơn (PACKED) rồi admin huỷ + hoàn Ví chen vào → webhook thua race vẫn gắn "Cần xử lý", không ghi vận đơn', async () => {
    const user = await createUser(prisma, { walletBalance: 1_000_000 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PACKED',
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      total: 114_000,
      subtotal: 114_000,
      pancakeOrderId: `pk-${randCode(8)}`,
    });
    const original = prisma.order.findFirst.bind(prisma.order);
    // Lần đọc thứ 2 là setStatus(SHIPPING) của webhook (lần 1 là khớp đơn theo id Pancake).
    let reads = 0;
    const spy = jest.spyOn(prisma.order, 'findFirst').mockImplementation((async (args: Parameters<typeof original>[0]) => {
      const snap = await original(args);
      reads += 1;
      if (reads === 2) {
        spy.mockRestore();
        await status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' });
      }
      return snap;
    }) as never);
    try {
      await proc.onOrderEvent({ id: order.pancakeOrderId, status: 2, partner: { partner_name: 'GHN', extend_code: 'GHNRCn', partner_status: 'picked' } });
    } finally {
      spy.mockRestore();
    }
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUNDED', shippingCode: null, shippingPartner: null });
    expect(after.pancakeAttention).toContain('GHN GHNRCn');
    expect(alerts.alert).toHaveBeenCalledWith(order.code, expect.stringContaining('GHNRCn'), expect.anything());
  });
});
