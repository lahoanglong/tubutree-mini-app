import type { Job } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, warmPool } from './helpers';

const MARKER = 'đẩy tay sau khi nhận tiền';
const order6 = () => Math.random().toString(36).slice(2, 8);

/**
 * Nhân viên Pancake ghi nhận chuyển khoản VÀ đổi trạng thái trong cùng một lần lưu → một webhook mang
 * cả status lẫn bank_payment. Chạy PancakeProcessor + OrderStatusService THẬT trên Postgres (không mock
 * setStatus) để khoá thứ tự đối soát-trước-trạng-thái-sau của cổng chặn giao đơn trả trước chưa PAID (C-024).
 */
describe('Pancake webhook: thanh toán + trạng thái cùng một sự kiện (real Postgres)', () => {
  let prisma: PrismaService;
  let processor: PancakeProcessor;
  let orderStatus: OrderStatusService;
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const loyalty = {
      creditOrderPoints: jest.fn().mockResolvedValue(undefined),
      reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
    } as unknown as LoyaltyService;
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
    const analytics = new AnalyticsEventsService(prisma);
    orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, undefined, analytics);
    processor = new PancakeProcessor(prisma, notifications, orderStatus);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function bankTransferOrder(total = 450_000) {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    return createOrder(prisma, {
      userId: user.id,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total,
      subtotal: total,
    });
  }

  async function deliver(payload: Record<string, unknown>) {
    const ev = await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'orders', rawPayload: payload as object, status: 'PENDING' },
    });
    await processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);
    return prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
  }

  // Mã Pancake POS (api-docs.pancake.vn): 2 Đã gửi hàng, 3 Đã nhận, 8 Đang đóng hàng, 5 Đã hoàn, 6 Đã hủy.
  it('status=2 (Đã gửi hàng) + bank_payment=total → SHIPPING + PAID, lịch sử ghi bước nhận tiền; sự kiện lặp lại không đổi gì', async () => {
    const order = await bankTransferOrder();
    const payload = { id: `pc-${order.code}`, extension: { external_order_id: order.code }, status: 2, bank_payment: order.total };

    const ev = await deliver(payload);
    expect(ev.status).toBe('PROCESSED');
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe('PAID');
    expect(after.status).toBe('SHIPPING');
    expect(after.note ?? '').not.toContain(MARKER);
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => [h.fromStatus, h.toStatus, h.actorType])).toEqual([
      ['PENDING_PAYMENT', 'CONFIRMED', 'PANCAKE'],
      ['CONFIRMED', 'SHIPPING', 'PANCAKE'],
    ]);
    expect(history[0]!.note).toContain('Đã nhận tiền');

    await deliver(payload);
    const again = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(again).toMatchObject({ status: 'SHIPPING', paymentStatus: 'PAID', note: after.note });
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(2);
    const paidEvents = await prisma.analyticsEvent.count({
      where: { eventName: 'order_paid', props: { path: ['orderId'], equals: order.id } },
    });
    expect(paidEvents).toBe(1);
  });

  it('status=3 (Đã nhận) + bank_payment=total → DELIVERED + PAID (đơn trả trước thường dừng ở 3)', async () => {
    const order = await bankTransferOrder();
    await deliver({ extension: { external_order_id: order.code }, status: 3, bank_payment: order.total });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });
    expect(after.deliveredAt).not.toBeNull();
  });

  it('status=8 (Đang đóng hàng) + bank_payment=total → PACKED + PAID (không kẹt ở CONFIRMED)', async () => {
    const order = await bankTransferOrder();
    await deliver({ extension: { external_order_id: order.code }, status: 8, bank_payment: order.total });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'PACKED', paymentStatus: 'PAID' });
    expect(after.note ?? '').not.toContain(MARKER);
  });

  it('status=2 không có tiền → vẫn bị chặn ở PENDING_PAYMENT + UNPAID, có dấu "đẩy tay", vào hàng đợi Pancake, event không FAILED', async () => {
    const order = await bankTransferOrder();
    const ev = await deliver({ extension: { external_order_id: order.code }, status: 2 });
    expect(ev.status).toBe('PROCESSED');
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' });
    expect(after.note ?? '').not.toContain(MARKER);
    expect(after.pancakeAttention).toContain('chưa ghi nhận thanh toán');
    expect(after.pancakeAttentionAt).not.toBeNull();
  });

  it('webhook vận chuyển (Gomdon/hệ thống) bị chặn vì chưa trả tiền → dấu "đẩy tay" vào hàng đợi admin, KHÔNG vào ghi chú khách (R2-PANCAKE-5)', async () => {
    const order = await bankTransferOrder();
    await prisma.order.update({ where: { id: order.id }, data: { note: 'Gọi trước khi giao' } });
    for (let i = 0; i < 2; i++) {
      await expect(orderStatus.setStatus(order.id, 'SHIPPING', { actorType: 'SYSTEM' })).rejects.toThrow();
    }
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.note).toBe('Gọi trước khi giao');
    expect(after.pancakeAttention).toBe(`[Chờ thanh toán: vận chuyển đã báo SHIPPING — ${MARKER}]`);
    expect(after.pancakeAttentionAt).not.toBeNull();
  });

  it('status=6 (huỷ) + bank_payment=total → CANCELLED, KHÔNG tự lật PAID; tạo đúng 1 yêu cầu hoàn tiền về muộn (D2)', async () => {
    const order = await bankTransferOrder();
    await deliver({ extension: { external_order_id: order.code }, status: 6, bank_payment: order.total });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
    const late = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(late).toEqual([expect.objectContaining({ kind: 'LATE_PAYMENT', amount: order.total, status: 'PENDING', userId: order.userId })]);
  });

  it('status=5 (Đã hoàn) khi đơn COD đang giao → CANCELLED (không kẹt "Đang giao"), lịch sử actor PANCAKE', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, { userId: user.id, status: 'SHIPPING' });
    const ev = await deliver({ extension: { external_order_id: order.code }, status: 5 });
    expect(ev.status).toBe('PROCESSED');
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CANCELLED');
    const h = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId: order.id } });
    expect(h).toMatchObject({ fromStatus: 'SHIPPING', toStatus: 'CANCELLED', actorType: 'PANCAKE' });
  });

  it('đơn Pancake KHÁC mang mã của đơn đã gắn đơn Pancake → đơn thật không bị huỷ; vào hàng đợi', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const linked = `pk-${order6()}`;
    const order = await createOrder(prisma, { userId: user.id, status: 'CONFIRMED', pancakeOrderId: linked });
    const ev = await deliver({ id: `dup-${linked}`, extension: { external_order_id: order.code }, status: 6 });
    expect(ev.status).toBe('PROCESSED');
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('CONFIRMED');
    expect(after.pancakeAttention).toContain(`#dup-${linked}`);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(0);
  });

  it('webhook tới trước khi lưu pancakeOrderId (không kèm mã đơn) → UNMATCHED; xử lý lại sau khi có id thì ghi được mã vận đơn', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, { userId: user.id, status: 'CONFIRMED' });
    const pid = `pk-${order6()}`;
    const ev = await deliver({ id: pid, status: 1, partner: { partner_name: 'GHN', extend_code: 'GHN123' } });
    expect(ev).toMatchObject({ status: 'UNMATCHED', processedAt: null });

    await prisma.order.update({ where: { id: order.id }, data: { pancakeOrderId: pid } });
    await processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);
    expect((await prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } })).status).toBe('PROCESSED');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).shippingCode).toBe('GHN123');
  });
});
