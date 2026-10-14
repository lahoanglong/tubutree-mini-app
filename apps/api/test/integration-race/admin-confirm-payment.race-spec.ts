import { PrismaService } from '../../src/prisma/prisma.service';
import { AdminService } from '../../src/modules/admin/admin.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { recordLatePaymentRefund } from '../../src/modules/orders/refund-queue';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/**
 * Nút "Đã nhận tiền" (POST /admin/orders/:id/confirm-payment → OrderStatusService.markPaid) trên
 * Postgres THẬT: hai admin cùng bấm cho một đơn chuyển khoản → đơn lật PAID đúng 1 lần, đúng 1 dòng
 * lịch sử, đúng 1 event order_paid, khách được báo đúng 1 lần (C-024). Chỉ stub thông báo / điểm /
 * hoa hồng / flash-sale / coupon — không liên quan việc lật thanh toán.
 */
describe('Admin confirm-payment race (real Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;
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
    orderStatus = new OrderStatusService(
      prisma,
      loyalty,
      affiliate,
      notifications,
      reversal,
      undefined,
      new AnalyticsEventsService(prisma),
    );
    admin = new AdminService(
      prisma,
      {} as never,
      loyalty,
      affiliate,
      notifications,
      reversal,
      orderStatus,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(() => notify.mockClear());

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
    return { user, order };
  }

  async function effects(orderId: string, code: string) {
    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId } });
    const paidEvents = await prisma.analyticsEvent.findMany({
      where: { eventName: 'order_paid', props: { path: ['orderId'], equals: orderId } },
    });
    const notified = notify.mock.calls.filter((c) => (c[2] as { order_code?: string })?.order_code === code);
    return { after, history, paidEvents, notified };
  }

  it('(a) hai admin cùng qua bước đọc "chưa trả" rồi cùng lật → chỉ 1 lần PAID, hệ quả 1 lần, bên kia nhận alreadyPaid', async () => {
    const { order } = await bankTransferOrder();
    const [a1, a2] = await Promise.all([createUser(prisma, { role: 'ADMIN' }), createUser(prisma, { role: 'ADMIN' })]);

    // Rào tất định ở bước đọc của markPaid (findFirst không `select` — bước tra đơn của AdminService có
    // `select`): không admin nào được lật trước khi CẢ HAI đã đọc thấy UNPAID → chứng minh guard atomic
    // trong DB chặn bên thua, không phải nhờ hai request tình cờ chạy nối tiếp.
    const original = prisma.order.findFirst.bind(prisma.order);
    let gated = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const spy = jest.spyOn(prisma.order, 'findFirst').mockImplementation((async (args: Parameters<typeof original>[0]) => {
      const res = await original(args);
      if (!args?.select && gated < 2) {
        gated += 1;
        if (gated === 2) release();
        await gate;
      }
      return res;
    }) as never);
    let results;
    try {
      results = await Promise.allSettled([
        admin.confirmOrderPayment(a1.id, order.id, { bankRef: 'FT-A1' }),
        admin.confirmOrderPayment(a2.id, order.code, { bankRef: 'FT-A2' }),
      ]);
    } finally {
      spy.mockRestore();
    }

    const s = summarize(results);
    expect(s.errors).toEqual([]);
    const flags = s.fulfilled.map((r) => r.value.alreadyPaid).sort();
    expect(flags).toEqual([false, true]);

    const { after, history, paidEvents, notified } = await effects(order.id, order.code);
    expect(after.status).toBe('CONFIRMED');
    expect(after.paymentStatus).toBe('PAID');
    expect(after.paidAt).toBeInstanceOf(Date);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromStatus: 'PENDING_PAYMENT', toStatus: 'CONFIRMED', actorType: 'ADMIN' });
    expect([a1.id, a2.id]).toContain(history[0].actorId);
    expect(paidEvents).toHaveLength(1);
    expect(notified).toHaveLength(1);
  });

  it('(b) 6 đơn, mỗi đơn 4 admin bấm đồng thời → mỗi đơn đúng 1 lần PAID / 1 dòng lịch sử / 1 order_paid / 1 thông báo', async () => {
    const admins = await Promise.all(Array.from({ length: 4 }, () => createUser(prisma, { role: 'ADMIN' })));
    const fixtures = await Promise.all(Array.from({ length: 6 }, (_, i) => bankTransferOrder(300_000 + i * 1_000)));

    const results = await Promise.allSettled(
      fixtures.flatMap(({ order }) => admins.map((a) => admin.confirmOrderPayment(a.id, order.id))),
    );
    const s = summarize(results);
    expect(s.errors).toEqual([]);

    for (const { order } of fixtures) {
      const { after, history, paidEvents, notified } = await effects(order.id, order.code);
      expect(after.paymentStatus).toBe('PAID');
      expect(after.status).toBe('CONFIRMED');
      expect(history).toHaveLength(1);
      expect(paidEvents).toHaveLength(1);
      expect(notified).toHaveLength(1);
    }
    expect(s.fulfilled.filter((r) => r.value.alreadyPaid === false)).toHaveLength(fixtures.length);
  });

  it('(c) bấm lại sau khi đã PAID → 200 alreadyPaid, không thêm lịch sử', async () => {
    const { order } = await bankTransferOrder();
    const a = await createUser(prisma, { role: 'ADMIN' });
    await admin.confirmOrderPayment(a.id, order.id);
    const again = await admin.confirmOrderPayment(a.id, order.id);
    expect(again.alreadyPaid).toBe(true);
    const { history, paidEvents } = await effects(order.id, order.code);
    expect(history).toHaveLength(1);
    expect(paidEvents).toHaveLength(1);
  });

  it('(d) đơn chuyển khoản chưa trả → admin chuyển DELIVERED bị chặn; sau "Đã nhận tiền" thì giao được', async () => {
    const { order } = await bankTransferOrder();
    await prisma.order.update({ where: { id: order.id }, data: { pancakeOrderId: `pk-${order.code}` } });
    const a = await createUser(prisma, { role: 'ADMIN' });
    await expect(admin.updateOrderStatus({ id: a.id, role: 'ADMIN' }, order.id, 'DELIVERED')).rejects.toThrow('Đã nhận tiền');
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING_PAYMENT');

    await admin.confirmOrderPayment(a.id, order.id);
    const delivered = await admin.updateOrderStatus({ id: a.id, role: 'ADMIN' }, order.id, 'DELIVERED');
    expect(delivered.status).toBe('DELIVERED');
  });

  it('tiền về muộn cho đơn đã huỷ: 2 admin cùng bấm "Đã nhận tiền" với cùng mã GD → đúng 1 khoản hoàn LATE_PAYMENT, đơn vẫn CANCELLED/UNPAID (D2, R2-ADMINOPS-3)', async () => {
    const { order } = await bankTransferOrder(300_000);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    const results = await Promise.allSettled([
      admin.confirmOrderPayment('admin-a', order.code, { bankRef: 'FT2627001' }),
      admin.confirmOrderPayment('admin-b', order.code, { bankRef: 'FT2627001' }),
    ]);
    expect(summarize(results).rejected).toHaveLength(0);
    const refunds = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ kind: 'LATE_PAYMENT', amount: 300_000, status: 'PENDING', method: 'MANUAL_TRANSFER' });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
  });
  describe('tiền về muộn: mỗi lần chuyển chỉ thành MỘT khoản hoàn, dù ghi từ webhook Pancake hay admin (R2-ADMINOPS-3)', () => {
    const lateRefunds = (orderId: string) => prisma.orderCustomerRefund.findMany({ where: { orderId, kind: 'LATE_PAYMENT' } });
    const ctx = () => ({ prisma, notifications: { notify }, logger: { warn: jest.fn(), log: jest.fn() } });
    async function cancelledUnpaid(total = 300_000) {
      const { order } = await bankTransferOrder(total);
      return prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    }

    it('webhook Pancake đã ghi khoản tiền về muộn → admin đối soát bấm "Ghi nhận tiền về muộn" không tạo khoản thứ hai, nút tắt', async () => {
      const order = await cancelledUnpaid();
      expect(await recordLatePaymentRefund(ctx(), order, { amount: 300_000, source: 'PANCAKE', refKey: 'p77:300000' })).toBe(true);

      const res = await admin.confirmOrderPayment('admin-a', order.code, { bankRef: 'FT2627009' });

      expect(res).toMatchObject({ ok: true, latePayment: true });
      expect(res.message).toContain('đã được ghi trước đó');
      expect(await lateRefunds(order.id)).toHaveLength(1);
      const listed = await admin.listOrders(1, 20, undefined, order.code);
      expect(listed.data.find((o) => o.id === order.id)).toMatchObject({ canRecordLatePayment: false });
    });

    it('admin bấm lại với mã GD khác / viết khác / bỏ trống → vẫn đúng 1 khoản hoàn', async () => {
      const order = await cancelledUnpaid();
      const before = await admin.listOrders(1, 20, undefined, order.code);
      expect(before.data.find((o) => o.id === order.id)).toMatchObject({ canRecordLatePayment: true });

      await admin.confirmOrderPayment('admin-a', order.code, { bankRef: 'FT1' });
      await admin.confirmOrderPayment('admin-b', order.code, { bankRef: 'ft1 ' });
      await admin.confirmOrderPayment('admin-b', order.code, { bankRef: 'FT2' });
      await admin.confirmOrderPayment('admin-c', order.code);

      const rows = await lateRefunds(order.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ amount: 300_000, adminNote: expect.stringContaining('FT1') });
    });

    it('2 admin (mã GD khác nhau) + webhook Pancake cùng lúc → đúng 1 khoản hoàn', async () => {
      const orders = await Promise.all(Array.from({ length: 5 }, () => cancelledUnpaid(250_000)));
      const results = await Promise.allSettled(
        orders.flatMap((order, i) => [
          admin.confirmOrderPayment('admin-a', order.code, { bankRef: `FTA${i}` }),
          admin.confirmOrderPayment('admin-b', order.code, { bankRef: `FTB${i}` }),
          recordLatePaymentRefund(ctx(), order, { amount: 250_000, source: 'PANCAKE', refKey: `p${i}:250000` }),
        ]),
      );
      expect(summarize(results).rejected).toHaveLength(0);
      for (const order of orders) expect(await lateRefunds(order.id)).toHaveLength(1);
    });

    it('admin ghi tay trước, webhook Pancake báo cùng khoản tiền sau → không tạo khoản thứ hai, báo admin kiểm tra', async () => {
      const order = await cancelledUnpaid();
      await admin.confirmOrderPayment('admin-a', order.code, { bankRef: 'FT3' });
      notify.mockClear();

      expect(await recordLatePaymentRefund(ctx(), order, { amount: 300_000, source: 'PANCAKE', refKey: 'p88:300000' })).toBe(false);

      expect(await recordLatePaymentRefund(ctx(), order, { amount: 300_000, source: 'PANCAKE', refKey: 'p88:300000' })).toBe(false);

      expect(await lateRefunds(order.id)).toHaveLength(1);
      expect(notify.mock.calls.filter(([, code]) => code === 'REFUND_LATE_PAYMENT')).toHaveLength(0);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.pancakeAttention).toContain('admin đã ghi tay khoản tiền về muộn');
      const adminAlerts = notify.mock.calls.filter(([, code]) => code === 'OPS_REFUND_ALERT');
      expect(adminAlerts.length).toBeGreaterThan(0);
      const perAdmin = new Map<string, number>();
      for (const [uid] of adminAlerts) perAdmin.set(uid as string, (perAdmin.get(uid as string) ?? 0) + 1);
      expect(Math.max(...perAdmin.values())).toBe(1);
    });
  });
});
