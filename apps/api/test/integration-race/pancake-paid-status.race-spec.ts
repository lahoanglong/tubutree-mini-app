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
    const notifications = { notify, notifySafe: notify } as unknown as NotificationsService;
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
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total,
      subtotal: total,
    });
    // Đơn đã đẩy lên Pancake: id khớp với `pc-<mã>` trong payload của các ca, và tiền chỉ lật PAID cho đơn đã gắn đơn Pancake.
    return prisma.order.update({ where: { id: order.id }, data: { pancakeOrderId: `pc-${order.code}` } });
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
    await deliver({ id: `pc-${order.code}`, extension: { external_order_id: order.code }, status: 3, bank_payment: order.total });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'DELIVERED', paymentStatus: 'PAID' });
    expect(after.deliveredAt).not.toBeNull();
  });

  it('status=8 (Đang đóng hàng) + bank_payment=total → PACKED + PAID (không kẹt ở CONFIRMED)', async () => {
    const order = await bankTransferOrder();
    await deliver({ id: `pc-${order.code}`, extension: { external_order_id: order.code }, status: 8, bank_payment: order.total });
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
    await deliver({ id: `pc-${order.code}`, extension: { external_order_id: order.code }, status: 6, bank_payment: order.total });
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

  it('đơn chưa gắn Pancake khớp bằng mã, is_paid → vẫn UNPAID, đặt cờ chờ đối chiếu (ô chữ giữ nguyên lý do cũ), webhook lặp không ghi lại; ô chữ không bị đụng; markPaid không làm mất lý do khác', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, {
      userId: user.id, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 200_000, subtotal: 200_000,
      pancakeAttention: 'Chưa đẩy được đơn sang Pancake', pancakeAttentionAt: new Date(),
    });
    const payload = { id: `pc-${order.code}`, extension: { external_order_id: order.code }, bank_payment: 200_000 };
    await deliver(payload);
    await deliver({ ...payload, updated_at: '2026-11-04 10:00:00' });
    const held = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(held.paymentStatus).toBe('UNPAID');
    expect(held.pancakeOrderId).toBeNull();
    expect(held.pancakeAttention).toBe('Chưa đẩy được đơn sang Pancake');
    expect(held.paymentUnlinkedAt).not.toBeNull();
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, note: { contains: 'chờ đối chiếu sao kê' } } })).toBe(1);

    expect((await orderStatus.markPaid(order.id, { actorType: 'ADMIN', actorId: user.id })).outcome).toBe('PAID');
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.paymentStatus).toBe('PAID');
    expect(paid.pancakeAttention).toBe('Chưa đẩy được đơn sang Pancake');
  });

  it('ghi chú nhân viên sửa: đơn đã gắn id khớp → PAID; đơn chưa gắn → đặt cờ chờ đối chiếu, gỡ cờ rồi webhook sau không đặt lại', async () => {
    const notes = (code: string) => [`GẤP Order code: ${code}`, `Order code: ${code} - đổi size`, `Order code:\u00a0${code}`, `Order code: ${code}`, `ghi chú\nOrder code: ${code} | COD`];
    const attached = await bankTransferOrder(120_000);
    for (const note of notes(attached.code)) {
      await prisma.order.update({ where: { id: attached.id }, data: { paymentStatus: 'UNPAID', status: 'PENDING_PAYMENT', paidAt: null } });
      await deliver({ id: `pc-${attached.code}`, note, bank_payment: 120_000 });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: attached.id } })).paymentStatus).toBe('PAID');
    }
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, { userId: user.id, code: `TUBU${Date.now()}${Math.floor(Math.random() * 1e6)}`, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 90_000, subtotal: 90_000 });
    const payload = { id: `pc-${order.code}`, note: `GẤP Order code: ${order.code}`, bank_payment: 90_000 };
    await deliver(payload);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentUnlinkedAt).not.toBeNull();
    await prisma.order.update({ where: { id: order.id }, data: { paymentUnlinkedAt: null } });
    await deliver({ ...payload, updated_at: '2026-11-04 11:00:00' });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).toBe('UNPAID');
    expect(after.paymentUnlinkedAt).toBeNull();
  });

  it('đơn đã huỷ, chưa gắn Pancake, tiền về muộn → KHÔNG có dòng hoàn, KHÔNG báo khách; đặt cờ chờ đối chiếu, không ghi ô chữ', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 80_000, subtotal: 80_000 });
    notify.mockClear();
    await deliver({ id: `pc-${order.code}`, extension: { external_order_id: order.code }, bank_payment: 80_000 });
    expect(await prisma.orderCustomerRefund.count({ where: { orderId: order.id } })).toBe(0);
    expect(notify.mock.calls.filter((c) => c[0] === user.id)).toHaveLength(0);
    const closed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(closed.paymentUnlinkedAt).not.toBeNull();
    expect(closed.pancakeAttention).toBeNull();
  });

  it('dấu "đã ghi lý do" theo cặp (đơn, đơn Pancake): đã gỡ cờ cho #A rồi #B vẫn đặt lại được; webhook không có id trên đơn đã gắn → đặt cờ chờ đối chiếu', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const order = await createOrder(prisma, { userId: user.id, code: `TUBU${Date.now()}${Math.floor(Math.random() * 1e6)}`, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 60_000, subtotal: 60_000 });
    const note = `Order code: ${order.code}`;
    await deliver({ id: `A-${order.code}`, note, bank_payment: 60_000 });
    await prisma.order.update({ where: { id: order.id }, data: { paymentUnlinkedAt: null } });
    await deliver({ id: `A-${order.code}`, note, bank_payment: 60_000, updated_at: '2026-11-04 12:00:00' });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentUnlinkedAt).toBeNull();
    await deliver({ id: `B-${order.code}`, note, bank_payment: 60_000 });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentUnlinkedAt).not.toBeNull();

    const attached = await bankTransferOrder(55_000);
    const code = `TUBU${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    await prisma.order.update({ where: { id: attached.id }, data: { code } });
    await deliver({ note: `Order code: ${code}`, bank_payment: 55_000 });
    const held = await prisma.order.findUniqueOrThrow({ where: { id: attached.id } });
    expect(held.paymentStatus).toBe('UNPAID');
    expect(held.paymentUnlinkedAt).not.toBeNull();
  });

  it('đua webhook giữ khoản chưa gắn với nút "Đã nhận tiền": đơn cuối cùng PAID và không nằm trong hàng đợi chờ đối chiếu (20 vòng)', async () => {
    for (let i = 0; i < 20; i++) {
      const user = await createUser(prisma, { role: 'CUSTOMER' });
      const order = await createOrder(prisma, { userId: user.id, status: 'PENDING_PAYMENT', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 70_000, subtotal: 70_000 });
      await Promise.all([
        deliver({ id: `pc-${order.code}`, extension: { external_order_id: order.code }, bank_payment: 70_000 }),
        orderStatus.markPaid(order.id, { actorType: 'ADMIN', actorId: user.id }),
      ]);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.paymentStatus).toBe('PAID');
      expect(await prisma.order.count({ where: { id: order.id, paymentUnlinkedAt: { not: null }, paymentStatus: 'UNPAID' } })).toBe(0);
    }
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

  it('GOMDON-3: đơn thu gom, Pancake ghi nhận tiền + "Đã gửi hàng" kèm vận đơn GHN cùng lúc → job Gomdon chỉ xếp SAU khi đơn đã SHIPPING + có mã GHN (không đặt bưu tá thứ hai)', async () => {
    const seenAtEnqueue: { status: string; shippingCode: string | null }[] = [];
    const gomdonQueue = {
      getJob: jest.fn().mockResolvedValue(undefined),
      add: jest.fn(async (_name: string, data: { orderId: string }) => {
        const o = await prisma.order.findUniqueOrThrow({ where: { id: data.orderId }, select: { status: true, shippingCode: true } });
        seenAtEnqueue.push(o);
        return {};
      }),
    };
    const loyalty = { creditOrderPoints: jest.fn(), reverseOrderPoints: jest.fn() } as unknown as LoyaltyService;
    const affiliate = { lockCommissionsForOrder: jest.fn(), grantReferralReward: jest.fn(), reverseCommissionsForOrder: jest.fn() } as unknown as AffiliateService;
    const reversal = new OrderReversalService(
      { restore: jest.fn() } as unknown as FlashSaleService,
      { release: jest.fn() } as unknown as CouponsService,
    );
    const statusWithGomdon = new OrderStatusService(
      prisma,
      loyalty,
      affiliate,
      { notify, notifySafe: notify } as unknown as NotificationsService,
      reversal,
      gomdonQueue as never,
    );
    const proc = new PancakeProcessor(prisma, { notify, notifySafe: notify } as unknown as NotificationsService, statusWithGomdon);
    const order = await bankTransferOrder();
    await prisma.order.update({ where: { id: order.id }, data: { hasRecyclingPickup: true, gomdonStatus: 'AWAITING_PAYMENT' } });
    const ev = await prisma.pancakeWebhookEvent.create({
      data: {
        eventType: 'orders',
        rawPayload: {
          id: `pc-${order.code}`,
          extension: { external_order_id: order.code },
          status: 2,
          bank_payment: order.total,
          partner: { partner_name: 'GHN', extend_code: 'GHN777888' },
        } as object,
        status: 'PENDING',
      },
    });
    await proc.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'SHIPPING', paymentStatus: 'PAID', shippingCode: 'GHN777888' });
    expect(seenAtEnqueue).toEqual([{ status: 'SHIPPING', shippingCode: 'GHN777888' }]);
  });
});
