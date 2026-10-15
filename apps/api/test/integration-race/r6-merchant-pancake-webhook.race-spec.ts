import { PrismaService } from '../../src/prisma/prisma.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { pancakeDedupeKey } from '../../src/modules/integrations/pancake/pancake-webhook-dedupe';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * R4-SYNC-1 trên Postgres THẬT: đơn gian hàng đối tác tự giao (fulfiller=MERCHANT, chưa từng lên Pancake) mà Pancake gửi webhook
 * của một đơn Pancake lạ ghi "Order code: <mã đơn đối tác>" — trước đây đơn đi CONFIRMED → SHIPPING (vận đơn lạ) → DELIVERED,
 * khách được cộng điểm và báo "đã giao" dù đối tác chưa gửi hàng. Giờ: đơn giữ nguyên, sự kiện IGNORED kèm lý do, đơn vào
 * "Cần xử lý Pancake" một lần, các lần chạy lại không đụng gì. Stub: điểm, hoa hồng, thông báo, báo động admin.
 */
describe('Webhook Pancake mang mã đơn gian hàng đối tác tự giao (real Postgres)', () => {
  let prisma: PrismaService;
  let proc: PancakeProcessor;
  const loyalty = {
    creditOrderPoints: jest.fn().mockResolvedValue(undefined),
    reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
    refundRedeemedPoints: jest.fn().mockResolvedValue(undefined),
  };
  const notify = jest.fn().mockResolvedValue(undefined);
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const affiliate = {
      lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      grantReferralReward: jest.fn().mockResolvedValue(undefined),
      reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as AffiliateService;
    const notifications = { notify } as unknown as NotificationsService;
    const reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
    );
    const orderStatus = new OrderStatusService(
      prisma,
      loyalty as unknown as LoyaltyService,
      affiliate,
      notifications,
      reversal,
      undefined,
      new AnalyticsEventsService(prisma),
    );
    proc = new PancakeProcessor(prisma, notifications, orderStatus, alerts as never);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function merchantOrder() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const buyer = await createUser(prisma);
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itr6-${tag}`, title: `Shop IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    // Mã dạng TUBU<số> như đơn thật: "Order code: …" trong ghi chú Pancake chỉ đọc chữ in hoa + số.
    const code = `TUBU${Date.now()}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
    return createOrder(prisma, { userId: buyer.id, code, status: 'CONFIRMED', fulfiller: 'MERCHANT', fulfillerStorefrontId: store.id });
  }

  async function receive(body: Record<string, unknown>) {
    const eventType = 'orders';
    const event = await prisma.pancakeWebhookEvent.create({
      data: { eventType, dedupeKey: pancakeDedupeKey(eventType, body), rawPayload: body as object, status: 'RECEIVED' },
    });
    await proc.process({ data: { eventId: event.id } } as never);
    return prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
  }

  it('Đã gửi hàng kèm vận đơn rồi Đã giao → đơn đối tác giữ nguyên, không điểm/thông báo; hai sự kiện IGNORED; báo admin một lần', async () => {
    const order = await merchantOrder();
    const pancakeId = `stray-${randCode(6)}`;
    const shipped = await receive({
      type: 'orders',
      id: pancakeId,
      status: 2,
      note: `Order code: ${order.code}`,
      partner: { partner_name: 'GHN', extend_code: 'GHNSTRAY', partner_status: 'picked' },
    });
    const delivered = await receive({ type: 'orders', id: pancakeId, status: 3, note: `Order code: ${order.code}` });

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CONFIRMED', shippingCode: null, shippingPartner: null, pancakeOrderId: null });
    expect(after.pancakeAttention).toContain(`#${pancakeId}`);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(0);
    expect(loyalty.creditOrderPoints).not.toHaveBeenCalledWith(order.id);
    expect(notify).not.toHaveBeenCalledWith(order.userId, expect.anything(), expect.anything());
    for (const e of [shipped, delivered]) {
      expect(e.status).toBe('IGNORED');
      expect(e.processedAt).not.toBeNull();
      expect(e.error).toContain('gian hàng đối tác tự giao');
    }
    expect(alerts.alert.mock.calls.filter(([code]) => code === order.code)).toHaveLength(1);
  });

  it('sự kiện IGNORED được đưa lại hàng đợi (BullMQ retry / cron cứu) → không claim lại, không đếm thêm lần thử', async () => {
    const order = await merchantOrder();
    const event = await receive({ type: 'orders', id: `stray-${randCode(6)}`, status: 6, note: `Order code: ${order.code}` });
    await proc.process({ data: { eventId: event.id } } as never);
    const again = await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(again).toMatchObject({ status: 'IGNORED', attempts: event.attempts });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CONFIRMED');
  });
});
