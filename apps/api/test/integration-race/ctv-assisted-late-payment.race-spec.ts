import { randomInt } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { CustomerRefundsService } from '../../src/modules/orders/customer-refunds.service';
import { ADMIN_LATE_PAYMENT_REF, recordLatePaymentRefund, recordOverpaymentRefund } from '../../src/modules/orders/refund-queue';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import type { GomdonAlertService } from '../../src/modules/integrations/gomdon/gomdon-alert.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import type { CartService } from '../../src/modules/cart/cart.service';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/**
 * MONEY-1 (review cuối PR #5): đơn CTV "lên đơn hộ" ghi userId = CTV, nên khoản tiền về muộn / trả dư / chuyển thiếu rồi
 * huỷ của khách cuối từng được ghi cho CTV — CTV thấy ở GET /orders/me/refunds và tự chọn nhận về Ví Tubu của mình.
 * Chạy PancakeProcessor + OrdersService + OrderStatusService + CustomerRefundsService THẬT trên Postgres: khoản hoàn phải
 * là của KHÁCH CUỐI (userId null, SĐT + tên người nhận), vào hàng đợi admin chuyển khoản tay; CTV không thấy, không chọn
 * được nơi nhận, không bị báo "chọn Ví hay ngân hàng".
 */
describe('Tiền khách cuối của đơn CTV lên hộ: về muộn / dư / thiếu rồi huỷ (real Postgres)', () => {
  let prisma: PrismaService;
  let processor: PancakeProcessor;
  let orders: OrdersService;
  let orderStatus: OrderStatusService;
  let refunds: CustomerRefundsService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const ctx = () => ({ prisma, notifications: { notify }, logger: { warn: jest.fn(), log: jest.fn() } });

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const loyalty = {
      creditOrderPoints: jest.fn().mockResolvedValue(undefined),
      reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
      refundRedeemedPoints: jest.fn().mockResolvedValue(undefined),
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
    const config = new SystemConfigService(prisma);
    const analytics = new AnalyticsEventsService(prisma);
    const alerts = { alert: jest.fn().mockResolvedValue(undefined) } as unknown as GomdonAlertService;
    orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, undefined, analytics);
    orders = new OrdersService(prisma, loyalty, {} as CartService, notifications, config, affiliate, reversal, undefined, orderStatus);
    refunds = new CustomerRefundsService(prisma, notifications);
    processor = new PancakeProcessor(prisma, notifications, orderStatus, alerts);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(() => notify.mockClear());

  const randomPhone = () => `09${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
  const walletOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).walletBalance;

  /** Đơn đúng hình dạng affiliate.placeOrderForCustomer tạo: userId = referrerUserId = CTV, khách cuối chỉ là endCustomerKey + snapshot. */
  async function assistedOrder(opts: {
    status: 'PENDING_PAYMENT' | 'CONFIRMED';
    paymentStatus: 'UNPAID' | 'PAID';
    total?: number;
    customerPhone?: string;
  }) {
    const total = opts.total ?? 300_000;
    const ctv = await createUser(prisma, { role: 'AFFILIATE', walletBalance: 0, phone: randomPhone() });
    const customerPhone = opts.customerPhone ?? randomPhone();
    const order = await createOrder(prisma, {
      userId: ctv.id,
      referrerUserId: ctv.id,
      placedForCustomer: true,
      source: 'ctv_assisted',
      endCustomerKey: customerPhone,
      status: opts.status,
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: opts.paymentStatus,
      total,
      subtotal: total,
      shippingAddress: {
        recipient: 'Khach That',
        phone: customerPhone,
        street: '1 Duong IT',
        ward: 'Phuong IT',
        district: '',
        province: 'Ha Noi',
        provinceCode: '84_VN01',
        districtCode: '',
        wardCode: '00001',
      },
    });
    return { ctv, order, customerPhone };
  }

  async function deliver(code: string, payload: Record<string, unknown>) {
    const ev = await prisma.pancakeWebhookEvent.create({
      data: { eventType: 'orders', rawPayload: { extension: { external_order_id: code }, ...payload } as object, status: 'PENDING' },
    });
    await processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);
  }

  /** Khoản hoàn của khách cuối: không chủ tài khoản, có SĐT + tên người nhận, chờ admin chuyển khoản tay. */
  function expectEndCustomerRow(row: unknown, expected: { kind: string; amount: number; status: string; phone: string }) {
    expect(row).toMatchObject({
      kind: expected.kind,
      amount: expected.amount,
      status: expected.status,
      method: 'MANUAL_TRANSFER',
      userId: null,
      customerUserId: null,
      phone: expected.phone,
      recipientName: 'Khach That',
    });
  }

  /** CTV không thấy khoản nào và không chọn được nơi nhận cho khoản đó (404), Ví CTV giữ nguyên. */
  async function expectCtvLockedOut(ctvId: string, orderId: string, refundId: string) {
    expect(await refunds.listMine(ctvId)).toEqual([]);
    expect(await refunds.listMine(ctvId, orderId)).toEqual([]);
    await expect(refunds.chooseDestination(ctvId, refundId, { refundMethod: 'WALLET' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      refunds.chooseDestination(ctvId, refundId, { refundMethod: 'BANK', bankName: 'MB', accountNumber: '123456789', accountName: 'CTV' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(await walletOf(ctvId)).toBe(0);
    expect(await prisma.walletTransaction.count({ where: { userId: ctvId, type: 'ORDER_REFUND' } })).toBe(0);
  }

  const toCtv = (ctvId: string) => notify.mock.calls.filter(([id]) => id === ctvId).map(([, code]) => code as string);

  /**
   * Tin OPS_REFUND_ALERT của đơn này gửi tới các admin (notifyAdmins chỉ lấy tối đa 20 admin chưa khoá, DB dùng chung nhiều spec
   * nên không biết trước admin nào được báo): phải có người được báo, ai cũng nói đây là khoản của khách cuối, không ai bị báo hai lần.
   */
  function expectAdminsToldEndCustomer(orderCode: string) {
    const alerts = notify.mock.calls.filter(([, code, data]) => code === 'OPS_REFUND_ALERT' && (data as { order_code: string }).order_code === orderCode);
    expect(alerts.length).toBeGreaterThan(0);
    expect(new Set(alerts.map(([id]) => id as string)).size).toBe(alerts.length);
    for (const [, , data] of alerts) expect((data as { message: string }).message).toContain('khách cuối');
  }

  it('CTV huỷ đơn chưa trả, khách cuối chuyển khoản muộn (Pancake) → khoản LATE_PAYMENT của khách cuối; CTV không thấy/không chọn được; admin thấy và xử lý', async () => {
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const customerAccount = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0, phone: randomPhone() });
    const { ctv, order, customerPhone } = await assistedOrder({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', total: 300_000 });
    await orders.cancel(ctv.id, order.code);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });

    await deliver(order.code, { id: `pc-${order.code}`, status: 6, bank_payment: 300_000 });

    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expectEndCustomerRow(rows[0], { kind: 'LATE_PAYMENT', amount: 300_000, status: 'PENDING', phone: customerPhone });
    expect(toCtv(ctv.id)).not.toContain('REFUND_LATE_PAYMENT');
    expectAdminsToldEndCustomer(order.code);
    expect(await walletOf(customerAccount.id)).toBe(0);
    await expectCtvLockedOut(ctv.id, order.id, rows[0]!.id);

    const queue = await refunds.list('OPEN', 1, 100);
    expect(queue.data.map((r) => r.id)).toContain(rows[0]!.id);

    // Admin xác nhận đã chuyển khoản theo SĐT khách cuối: không cần "Bắt đầu chuyển khoản", không cần tài khoản gõ sẵn.
    const claimed = await refunds.claim(adminUser.id, rows[0]!.id);
    expect(claimed.status).toBe('PROCESSING');
    const done = await refunds.markPaid(adminUser.id, rows[0]!.id, { bankRef: 'FT-LATE-1' });
    expect(done).toMatchObject({ status: 'COMPLETED', bankRef: 'FT-LATE-1', userId: null });
    expect(toCtv(ctv.id)).not.toContain('REFUND_BANK_COMPLETED');
  });

  it('webhook Pancake báo tiền muộn 3 lần đồng thời → đúng 1 khoản của khách cuối, admin được báo 1 lần', async () => {
    const { ctv, order, customerPhone } = await assistedOrder({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', total: 210_000 });
    await orders.cancel(ctv.id, order.code);

    const s = summarize(await Promise.allSettled([1, 2, 3].map(() => deliver(order.code, { id: `pc-${order.code}`, status: 6, bank_payment: 210_000 }))));
    expect(s.errors).toEqual([]);

    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expectEndCustomerRow(rows[0], { kind: 'LATE_PAYMENT', amount: 210_000, status: 'PENDING', phone: customerPhone });
    expectAdminsToldEndCustomer(order.code);
    expect(toCtv(ctv.id)).not.toContain('REFUND_LATE_PAYMENT');
  });

  it('admin ghi tay tiền về muộn cho đơn CTV đã huỷ → khoản của khách cuối, không phải của CTV', async () => {
    const { ctv, order, customerPhone } = await assistedOrder({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', total: 180_000 });
    await orders.cancel(ctv.id, order.code);
    const closed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    notify.mockClear();

    expect(
      await recordLatePaymentRefund(ctx(), closed, { amount: 180_000, source: 'ADMIN', refKey: ADMIN_LATE_PAYMENT_REF, note: 'Admin ghi nhận tiền về muộn' }),
    ).toBe(true);

    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expectEndCustomerRow(rows[0], { kind: 'LATE_PAYMENT', amount: 180_000, status: 'PENDING', phone: customerPhone });
    expect(toCtv(ctv.id)).toEqual([]);
    await expectCtvLockedOut(ctv.id, order.id, rows[0]!.id);
  });

  it('khách cuối chuyển thiếu rồi CTV huỷ → khoản hoàn số đã nhận là của khách cuối; tin huỷ gửi CTV không hứa CTV chọn Ví/ngân hàng', async () => {
    const { ctv, order, customerPhone } = await assistedOrder({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', total: 300_000 });
    await deliver(order.code, { id: `pc-${order.code}`, bank_payment: 120_000 });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ pancakePaidReported: 120_000, status: 'PENDING_PAYMENT' });
    notify.mockClear();

    await orders.cancel(ctv.id, order.code);

    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expectEndCustomerRow(rows[0], { kind: 'LATE_PAYMENT', amount: 120_000, status: 'PENDING', phone: customerPhone });
    const cancelled = notify.mock.calls.find(([id, code]) => id === ctv.id && code === 'ORDER_CANCELLED');
    expect(cancelled).toBeDefined();
    const note = (cancelled![2] as { refund_note: string }).refund_note;
    expect(note).toContain('120.000đ');
    expect(note).toContain('người nhận hàng');
    expect(note).not.toMatch(/Ví Tubu|chọn nhận/);
    expect(toCtv(ctv.id)).not.toContain('REFUND_LATE_PAYMENT');
    expectAdminsToldEndCustomer(order.code);
    await expectCtvLockedOut(ctv.id, order.id, rows[0]!.id);
  });

  it('khách cuối chuyển thiếu rồi admin huỷ (setStatus) → cùng kết quả: khoản của khách cuối, tin huỷ không nói "chọn nhận"', async () => {
    const { ctv, order, customerPhone } = await assistedOrder({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', total: 250_000 });
    await deliver(order.code, { id: `pc-${order.code}`, bank_payment: 90_000 });
    notify.mockClear();

    await orderStatus.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN' });

    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expectEndCustomerRow(rows[0], { kind: 'LATE_PAYMENT', amount: 90_000, status: 'PENDING', phone: customerPhone });
    const cancelled = notify.mock.calls.find(([id, code]) => id === ctv.id && code === 'ORDER_CANCELLED');
    const note = (cancelled![2] as { refund_note: string }).refund_note;
    expect(note).toContain('người nhận hàng');
    expect(note).not.toMatch(/Ví Tubu|chọn nhận/);
    expect(toCtv(ctv.id)).not.toContain('REFUND_LATE_PAYMENT');
    await expectCtvLockedOut(ctv.id, order.id, rows[0]!.id);
  });

  it('Pancake báo đã nhận vượt tổng đơn đã PAID → khoản OVERPAYMENT UNVERIFIED của khách cuối; admin xác nhận xong CTV vẫn không thấy/không chọn được và không được báo', async () => {
    const adminUser = await createUser(prisma, { role: 'ADMIN' });
    const { ctv, order, customerPhone } = await assistedOrder({ status: 'CONFIRMED', paymentStatus: 'PAID', total: 200_000 });

    await deliver(order.code, { id: `pc-${order.code}`, bank_payment: 350_000 });

    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expectEndCustomerRow(rows[0], { kind: 'OVERPAYMENT', amount: 150_000, status: 'UNVERIFIED', phone: customerPhone });
    expectAdminsToldEndCustomer(order.code);
    await expectCtvLockedOut(ctv.id, order.id, rows[0]!.id);

    // Xác nhận một phần: khoản còn lại ghi DISMISSED, cũng không mang tên CTV.
    const verified = await refunds.verifyOverpayment(adminUser.id, rows[0]!.id, { amount: 100_000 });
    expect(verified).toMatchObject({ status: 'PENDING', amount: 100_000, userId: null, phone: customerPhone });
    const all = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.userId === null && r.phone === customerPhone)).toBe(true);
    expect(toCtv(ctv.id)).toEqual([]);
    await expectCtvLockedOut(ctv.id, order.id, rows[0]!.id);

    const done = await refunds.markPaid(adminUser.id, rows[0]!.id, { bankRef: 'FT-OVER-1' });
    expect(done).toMatchObject({ status: 'COMPLETED', bankRef: 'FT-OVER-1' });
  });

  it('ZaloPay trả dư (recordOverpaymentRefund) cho đơn CTV lên hộ → khoản PENDING của khách cuối, CTV không được báo REFUND_OVERPAYMENT', async () => {
    const { ctv, order, customerPhone } = await assistedOrder({ status: 'CONFIRMED', paymentStatus: 'PAID', total: 200_000 });
    const paid = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });

    expect(await recordOverpaymentRefund(ctx(), paid, { amount: 200_000, source: 'ZALOPAY', refKey: `zp-${order.code}` })).toBe(true);

    const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(rows).toHaveLength(1);
    expectEndCustomerRow(rows[0], { kind: 'OVERPAYMENT', amount: 200_000, status: 'PENDING', phone: customerPhone });
    expect(toCtv(ctv.id)).toEqual([]);
    await expectCtvLockedOut(ctv.id, order.id, rows[0]!.id);
  });

  it('đơn thường (không phải đơn hộ): tiền về muộn vẫn là khoản của người đặt — báo khách, khách chọn Ví được', async () => {
    const buyer = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, { userId: buyer.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNPAID', total: 150_000 });

    expect(await recordLatePaymentRefund(ctx(), order, { amount: 150_000, source: 'PANCAKE', refKey: 'reg-1' })).toBe(true);

    const row = await prisma.orderCustomerRefund.findFirstOrThrow({ where: { orderId: order.id } });
    expect(row).toMatchObject({ userId: buyer.id, kind: 'LATE_PAYMENT', method: 'MANUAL_TRANSFER', status: 'PENDING', phone: null });
    expect(notify).toHaveBeenCalledWith(buyer.id, 'REFUND_LATE_PAYMENT', expect.objectContaining({ order_code: order.code }));
    expect(await refunds.listMine(buyer.id)).toEqual([expect.objectContaining({ id: row.id, canChooseDestination: true })]);
    await refunds.chooseDestination(buyer.id, row.id, { refundMethod: 'WALLET' });
    expect(await walletOf(buyer.id)).toBe(150_000);
  });
});
