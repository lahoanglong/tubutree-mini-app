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

/**
 * Nhân viên Pancake ghi nhận chuyển khoản VÀ đổi trạng thái trong cùng một lần lưu → một webhook mang
 * cả status lẫn bank_payment. Chạy PancakeProcessor + OrderStatusService THẬT trên Postgres (không mock
 * setStatus) để khoá thứ tự đối soát-trước-trạng-thái-sau của cổng chặn giao đơn trả trước chưa PAID (C-024).
 */
describe('Pancake webhook: thanh toán + trạng thái cùng một sự kiện (real Postgres)', () => {
  let prisma: PrismaService;
  let processor: PancakeProcessor;
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
    const orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, undefined, analytics);
    processor = new PancakeProcessor(prisma, notifications, orderStatus, undefined, undefined, analytics);
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

  it('status=3 + bank_payment=total → SHIPPING + PAID, không có dấu "đẩy tay"; sự kiện lặp lại không đổi gì', async () => {
    const order = await bankTransferOrder();
    const payload = { id: `pc-${order.code}`, extension: { external_order_id: order.code }, status: 3, bank_payment: order.total };

    const ev = await deliver(payload);
    expect(ev.status).toBe('PROCESSED');
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe('PAID');
    expect(after.status).toBe('SHIPPING');
    expect(after.note ?? '').not.toContain(MARKER);
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    expect(history.map((h) => h.toStatus)).toEqual(['SHIPPING']);

    await deliver(payload);
    const again = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(again).toMatchObject({ status: 'SHIPPING', paymentStatus: 'PAID', note: after.note });
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(1);
    const paidEvents = await prisma.analyticsEvent.count({
      where: { eventName: 'order_paid', props: { path: ['orderId'], equals: order.id } },
    });
    expect(paidEvents).toBe(1);
  });

  it('status=2 + bank_payment=total → PACKED + PAID (không kẹt ở CONFIRMED)', async () => {
    const order = await bankTransferOrder();
    await deliver({ extension: { external_order_id: order.code }, status: 2, bank_payment: order.total });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'PACKED', paymentStatus: 'PAID' });
    expect(after.note ?? '').not.toContain(MARKER);
  });

  it('status=3 không có tiền → vẫn bị chặn ở PENDING_PAYMENT + UNPAID, có dấu "đẩy tay", event không FAILED', async () => {
    const order = await bankTransferOrder();
    const ev = await deliver({ extension: { external_order_id: order.code }, status: 3 });
    expect(ev.status).toBe('PROCESSED');
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID' });
    expect(after.note).toContain(`vận chuyển đã báo SHIPPING — ${MARKER}`);
  });

  it('status=6 (huỷ) + bank_payment=total → CANCELLED, KHÔNG tự lật PAID (giữ đường hoàn tiền thủ công)', async () => {
    const order = await bankTransferOrder();
    await deliver({ extension: { external_order_id: order.code }, status: 6, bank_payment: order.total });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
  });
});
