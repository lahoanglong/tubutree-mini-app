import { Test, type TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { QUEUE_GOMDON_EVENTS, QUEUE_GOMDON_PUSH } from '../../src/jobs/queues';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { GomdonOrderService } from '../../src/modules/integrations/gomdon/gomdon-order.service';
import { GomdonWebhookService } from '../../src/modules/integrations/gomdon/gomdon-webhook.service';
import { GomdonClient } from '../../src/modules/integrations/gomdon/gomdon.client';
import { GOMDON_ALERT_KIND, GOMDON_ALERT_TEMPLATE, GomdonAlertService } from '../../src/modules/integrations/gomdon/gomdon-alert.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

const mockQueue = () => ({ getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue({}) });
const PANCAKE_CANCEL_AFTER_HANDOVER = 'Pancake báo HUỶ nhưng đơn đã bàn giao vận chuyển (bưu tá Gomdon/BestExpress đã lấy hàng) — KHÔNG tự huỷ/hoàn tiền.';

/**
 * R3-CANCEL-3 trên Postgres THẬT: Gomdon 3 (bưu tá lấy hàng) → Pancake 6 ("Cần xử lý": huỷ sau bàn giao) → Gomdon 8 (đã
 * hoàn hàng về kho) → CSKH huỷ. Lỗi cũ: job huỷ Gomdon coi 8 là "bưu tá đã lấy hàng" → TOO_LATE + báo "chặn giao" sai;
 * báo động "Đã hoàn hàng" và việc Pancake cũ còn mở dù đơn đã xử lý xong. Stub: GomdonClient, hàng đợi, Pancake, thông báo.
 */
describe('Đơn thu gom huỷ sau khi Gomdon báo "Đã hoàn hàng" (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let status: OrderStatusService;
  let gomdonOrder: GomdonOrderService;
  let webhook: GomdonWebhookService;
  let alerts: GomdonAlertService;
  const client = { cancelOrder: jest.fn().mockResolvedValue({ ok: true }), isConfigured: jest.fn().mockResolvedValue(true) };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        GomdonAlertService,
        GomdonOrderService,
        GomdonWebhookService,
        { provide: GomdonClient, useValue: client },
        { provide: getQueueToken(QUEUE_GOMDON_PUSH), useValue: mockQueue() },
        { provide: getQueueToken(QUEUE_GOMDON_EVENTS), useValue: mockQueue() },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
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
    gomdonOrder = moduleRef.get(GomdonOrderService);
    webhook = moduleRef.get(GomdonWebhookService);
    alerts = moduleRef.get(GomdonAlertService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  async function pickedUpRecyclingOrder(gomdonStatus = '3') {
    const user = await createUser(prisma, { walletBalance: 0 });
    const gid = String(Math.floor(Math.random() * 9e8) + 1e8);
    return createOrder(prisma, {
      userId: user.id,
      status: 'SHIPPING',
      paymentMethod: 'COD',
      paymentStatus: 'UNPAID',
      total: 120_000,
      subtotal: 120_000,
      hasRecyclingPickup: true,
      gomdonOrderId: gid,
      gomdonPartnerCode: `BEX${gid}`,
      shippingCode: `BEX${gid}`,
      shippingPartner: 'BestExpress',
      gomdonStatus,
      pancakeOrderId: `pk-${randCode(8)}`,
      pancakeAttention: PANCAKE_CANCEL_AFTER_HANDOVER,
      pancakeAttentionAt: new Date(),
    });
  }

  const openAlerts = (orderId: string) => prisma.gomdonAlert.findMany({ where: { orderId, resolvedAt: null } });

  it('(a) Gomdon 8 → báo động "xử lý đơn với khách"; CSKH huỷ → đóng báo động + gỡ việc Pancake; job huỷ Gomdon NOT_NEEDED, không báo "chặn giao"', async () => {
    const order = await pickedUpRecyclingOrder();
    await webhook.receive({ order_id: order.gomdonOrderId, status: 8, created_time: Math.floor(Date.now() / 1000) });
    const event = await prisma.gomdonWebhookEvent.findFirstOrThrow({ where: { gomdonOrderId: order.gomdonOrderId }, orderBy: { receivedAt: 'desc' } });
    await webhook.processEvent(event.id);
    expect((await openAlerts(order.id)).map((a) => a.kind)).toEqual([GOMDON_ALERT_KIND.GOODS_RETURNED]);

    await status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN', note: 'Hàng đã hoàn về kho' });
    await gomdonOrder.cancelOnGomdon(order.id, false);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', gomdonCancelStatus: 'NOT_NEEDED', pancakeAttention: null });
    expect(await openAlerts(order.id)).toEqual([]);
    const all = await prisma.gomdonAlert.findMany({ where: { orderId: order.id } });
    expect(all.some((a) => a.message.includes('chặn giao'))).toBe(false);
    expect(client.cancelOrder).not.toHaveBeenCalled();
  });

  it('(b) 10 đơn: báo động "Đã hoàn hàng" ghi SONG SONG với CSKH huỷ → không đơn đã huỷ nào còn báo động đó mở', async () => {
    const orders = await Promise.all(Array.from({ length: 10 }, () => pickedUpRecyclingOrder('8')));
    const results = await Promise.allSettled(
      orders.flatMap((o) => [
        alerts.alert(o.code, 'Gomdon báo "Đã hoàn hàng". Hàng đã hoàn về kho — xử lý đơn với khách (KHÔNG tự hoàn tiền).', GOMDON_ALERT_TEMPLATE, GOMDON_ALERT_KIND.GOODS_RETURNED),
        status.setStatus(o.id, 'CANCELLED', { actorType: 'ADMIN' }),
      ]),
    );
    expect(summarize(results).errors).toEqual([]);
    for (const o of orders) {
      expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('CANCELLED');
      expect(await openAlerts(o.id)).toEqual([]);
    }
  });
});
