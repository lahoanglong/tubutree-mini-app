import { createHmac } from 'node:crypto';
import type { Job } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { CustomerRefundsService } from '../../src/modules/orders/customer-refunds.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { ZalopayService } from '../../src/modules/integrations/payment/zalopay.service';
import { ZalopayReconcileCron } from '../../src/modules/integrations/payment/zalopay-reconcile.cron';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import type { GomdonAlertService } from '../../src/modules/integrations/gomdon/gomdon-alert.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import type { CartService } from '../../src/modules/cart/cart.service';
import { createOrder, createUser, randCode, summarize, warmPool } from './helpers';

const ZALOPAY_KEY2 = 'r5-key2';
const zalopayConfig = () => {
  const map: Record<string, string> = { ZALOPAY_APP_ID: '2553', ZALOPAY_KEY1: 'r5-key1', ZALOPAY_KEY2, ZALOPAY_ENDPOINT: 'http://127.0.0.1:9' };
  return { get: (k: string) => map[k] ?? '' };
};
const zalopayCallback = (appTransId: string, amount: number) => {
  const raw = JSON.stringify({ app_trans_id: appTransId, amount });
  return { raw, mac: createHmac('sha256', ZALOPAY_KEY2).update(raw).digest('hex') };
};

/**
 * UAT vòng 3 — gói r5-money trên Postgres THẬT:
 * - R3-MONEY-1: khách trả hai lần (hai lệnh ZaloPay cùng thành công, chuyển khoản dư) cho đơn đã nhận tiền → đúng một khoản
 *   hoàn OVERPAYMENT cho mỗi lần trả thêm, kể cả callback gửi lại/đồng thời và cron đối soát.
 * - R3-MONEY-4: khoản đang chuyển khoản chỉ người nhận (hoặc người tiếp quản có ghi lịch sử) trả về hàng chờ / xác nhận.
 * - R3-MONEY-5: đơn chuyển thiếu bị huỷ → hoàn ngay số đã nhận, gỡ cảnh báo; trả đủ → gỡ cảnh báo.
 * - R2-LIFECYCLE-5: hoàn thẳng vào Ví để lại dòng vết khách thấy ở chi tiết đơn.
 */
describe('R5 tiền: trả hai lần, khoá người chuyển khoản, chuyển thiếu (real Postgres)', () => {
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let orders: OrdersService;
  let refunds: CustomerRefundsService;
  let zalopay: ZalopayService;
  let processor: PancakeProcessor;
  const notify = jest.fn().mockResolvedValue(undefined);
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) } as unknown as GomdonAlertService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    const loyalty = {
      creditOrderPoints: jest.fn().mockResolvedValue(undefined),
      reverseOrderPoints: jest.fn().mockResolvedValue(0),
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
    orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, undefined, analytics);
    orders = new OrdersService(prisma, loyalty, {} as CartService, notifications, config, affiliate, reversal, undefined, orderStatus);
    refunds = new CustomerRefundsService(prisma, notifications);
    zalopay = new ZalopayService(prisma, notifications, zalopayConfig() as never, undefined, analytics);
    processor = new PancakeProcessor(prisma, notifications, orderStatus, alerts);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(() => notify.mockClear());

  const walletOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).walletBalance;
  const sent = (code: string) => notify.mock.calls.filter(([, c]) => c === code);

  async function zalopayOrder(total: number, attempts: number) {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'ZALOPAY',
      paymentStatus: 'UNPAID',
      subtotal: total,
      total,
      createdAt: new Date(Date.now() - 30 * 60_000),
    });
    const ids: string[] = [];
    for (let i = 0; i < attempts; i++) {
      const appTransId = `261014_${order.code}_${randCode(6).toLowerCase()}`;
      await prisma.paymentAttempt.create({
        data: { orderId: order.id, provider: 'ZALOPAY', appTransId, amount: total, createdAt: new Date(Date.now() - (20 - i) * 60_000) },
      });
      ids.push(appTransId);
    }
    return { user, order, attempts: ids };
  }

  describe('R3-MONEY-1 — ZaloPay: hai lệnh của cùng đơn đều thành công', () => {
    it('callback hai lệnh, mỗi lệnh gửi 2 lần, cùng lúc (6 vòng) → đơn PAID một lần, đúng một khoản OVERPAYMENT cho lệnh không lật PAID', async () => {
      for (let round = 0; round < 6; round++) {
        notify.mockClear();
        const { order, attempts } = await zalopayOrder(44_000, 2);
        const calls = [attempts[0]!, attempts[1]!, attempts[0]!, attempts[1]!].map((id) => {
          const { raw, mac } = zalopayCallback(id, 44_000);
          return zalopay.handleCallback(raw, mac, 1);
        });
        const s = summarize(await Promise.allSettled(round % 2 ? calls.reverse() : calls));
        expect(s.errors).toEqual([]);

        const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
        const winners = await prisma.paymentAttempt.findMany({ where: { orderId: order.id, succeededAt: { not: null } } });
        expect(winners).toHaveLength(1);
        const loser = attempts.find((a) => a !== winners[0]!.appTransId)!;
        const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
        expect(rows).toEqual([
          expect.objectContaining({ kind: 'OVERPAYMENT', refKey: `ZALOPAY:${loser}`, amount: 44_000, method: 'MANUAL_TRANSFER', status: 'PENDING' }),
        ]);
        expect(sent('ORDER_CONFIRMED')).toHaveLength(1);
        expect(sent('REFUND_OVERPAYMENT')).toHaveLength(1);
      }
    });

    it('callback thất lạc cả hai: cron đối soát hỏi ZaloPay thấy cả hai lệnh đã trả → PAID + một khoản OVERPAYMENT; chạy lại cron không tạo thêm', async () => {
      const { order } = await zalopayOrder(85_000, 2);
      const cron = new ZalopayReconcileCron(prisma, zalopay);
      const query = jest.spyOn(zalopay, 'queryOrderStatus').mockImplementation(async (id: string) =>
        id.includes(order.code) ? { return_code: 1, amount: 85_000 } : { return_code: 3 },
      );
      try {
        await cron.reconcile();
        await cron.reconcile(new Date(Date.now() + 10 * 60_000));
      } finally {
        query.mockRestore();
      }
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.paymentStatus).toBe('PAID');
      const rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
      expect(rows).toEqual([expect.objectContaining({ kind: 'OVERPAYMENT', amount: 85_000 })]);
      expect(await prisma.paymentAttempt.count({ where: { orderId: order.id, resolvedAt: null } })).toBe(0);
    });

    it('khách huỷ đơn đã trả (hoàn Ví) rồi lệnh thứ hai mới về → khoản OVERPAYMENT riêng, Ví chỉ nhận một lần', async () => {
      const { user, order, attempts } = await zalopayOrder(60_000, 2);
      const first = zalopayCallback(attempts[0]!, 60_000);
      await zalopay.handleCallback(first.raw, first.mac, 1);
      await orders.cancel(user.id, order.code, { refundMethod: 'WALLET' });
      expect(await walletOf(user.id)).toBe(60_000);

      const second = zalopayCallback(attempts[1]!, 60_000);
      await Promise.all([zalopay.handleCallback(second.raw, second.mac, 1), zalopay.handleCallback(second.raw, second.mac, 1)]);
      const late = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id, kind: 'OVERPAYMENT' } });
      expect(late).toEqual([expect.objectContaining({ refKey: `ZALOPAY:${attempts[1]}`, amount: 60_000, status: 'PENDING' })]);
      // Lệnh đầu gửi lại sau khi huỷ: là lệnh đã ghi nhận → không tạo gì.
      await zalopay.handleCallback(first.raw, first.mac, 1);
      expect(await prisma.orderCustomerRefund.count({ where: { orderId: order.id, kind: { in: ['OVERPAYMENT', 'LATE_PAYMENT'] } } })).toBe(1);
      expect(await walletOf(user.id)).toBe(60_000);
    });

    it('đơn cũ nhiều lệnh, không biết lệnh nào đã lật PAID → không tự tạo khoản hoàn, đưa vào "Cần xử lý"', async () => {
      const { order, attempts } = await zalopayOrder(70_000, 2);
      await prisma.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED', paymentStatus: 'PAID', paidAt: new Date() } });
      const cb = zalopayCallback(attempts[1]!, 70_000);
      await zalopay.handleCallback(cb.raw, cb.mac, 1);
      expect(await prisma.orderCustomerRefund.count({ where: { orderId: order.id } })).toBe(0);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.pancakeAttention).toContain('không xác định được lệnh nào');
    });
  });

  async function pancakeBankOrder(total: number, over: Record<string, unknown> = {}) {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const pancakeOrderId = `r5-${randCode(8)}`;
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      subtotal: total,
      total,
      pancakeOrderId,
      pancakePushStatus: 'SYNCED',
      ...over,
    });
    const deliver = async (payload: Record<string, unknown>) => {
      const ev = await prisma.pancakeWebhookEvent.create({
        data: { eventType: 'orders', rawPayload: { id: pancakeOrderId, extension: { external_order_id: order.code }, ...payload }, status: 'PENDING' },
      });
      await processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);
    };
    return { user, order, deliver };
  }

  describe('R3-MONEY-1 — chuyển khoản dư (Pancake báo vượt tổng đơn): chờ admin đối soát, khách không rút được', () => {
    const paidBank = (total: number) =>
      pancakeBankOrder(total, { status: 'CONFIRMED', paymentStatus: 'PAID', paidAt: new Date(), pancakePaymentSynced: true });

    it('đơn đã PAID, 2 webhook "đã nhận 2T" cùng lúc rồi "3T" → hai khoản OVERPAYMENT chờ đối soát, khách không thấy, không chọn Ví được, không được báo', async () => {
      const { user, order, deliver } = await paidBank(114_000);
      await createUser(prisma, { role: 'ADMIN' });
      const s = summarize(await Promise.allSettled([deliver({ bank_payment: 228_000 }), deliver({ bank_payment: 228_000 })]));
      expect(s.errors).toEqual([]);
      let rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
      expect(rows).toEqual([
        expect.objectContaining({ kind: 'OVERPAYMENT', amount: 114_000, refKey: 'PANCAKE:paid:228000', status: 'UNVERIFIED' }),
      ]);
      await deliver({ bank_payment: 342_000 });
      rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
      expect(rows.map((r) => [r.amount, r.status])).toEqual([
        [114_000, 'UNVERIFIED'],
        [114_000, 'UNVERIFIED'],
      ]);

      expect(await refunds.listMine(user.id, order.id)).toEqual([]);
      for (const r of rows) {
        await expect(refunds.chooseDestination(user.id, r.id, { refundMethod: 'WALLET' })).rejects.toThrow('Không tìm thấy khoản hoàn tiền');
      }
      expect(await walletOf(user.id)).toBe(0);
      expect(await prisma.walletTransaction.count({ where: { userId: user.id } })).toBe(0);
      expect(sent('REFUND_OVERPAYMENT')).toHaveLength(0);
      expect(notify.mock.calls.filter(([uid]) => uid === user.id)).toEqual([]);
      const alerts = sent('OPS_REFUND_ALERT').map(([, , d]) => d as Record<string, string>);
      expect(alerts.length).toBeGreaterThan(0);
      for (const d of alerts) expect(d).toMatchObject({ order_code: order.code, message: expect.stringContaining('Khách CHƯA được báo') });
    });

    it('Pancake báo prepaid = số Tubu tự ghi (transfer_money) cùng bank_payment nhân viên ghi → KHÔNG tạo gì (kể cả khoản chờ đối soát)', async () => {
      const { user, order, deliver } = await paidBank(114_000);
      await deliver({ prepaid: 114_000, bank_payment: 114_000 });
      await deliver({ prepaid: 114_000, bank_payment: 114_000, is_paid: true });
      expect(await prisma.orderCustomerRefund.count({ where: { orderId: order.id } })).toBe(0);
      expect(await refunds.listMine(user.id, order.id)).toEqual([]);
      expect(notify).not.toHaveBeenCalled();
    });

    it('admin xác nhận (đối chiếu sao kê) → khách mới thấy khoản, được báo, chọn Ví được đúng một lần', async () => {
      const { user, order, deliver } = await paidBank(90_000);
      const admin = await createUser(prisma, { role: 'ADMIN', fullName: 'Admin Đối Soát' });
      await deliver({ bank_payment: 180_000 });
      const [row] = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
      notify.mockClear();

      await refunds.verifyOverpayment(admin.id, row!.id, { note: 'Sao kê có 2 lần chuyển 90.000đ' });
      expect(sent('REFUND_OVERPAYMENT')).toEqual([[user.id, 'REFUND_OVERPAYMENT', { order_code: order.code, amount: '90.000đ' }]]);
      expect(await refunds.listMine(user.id, order.id)).toEqual([
        expect.objectContaining({ kind: 'OVERPAYMENT', amount: 90_000, status: 'PENDING', canChooseDestination: true }),
      ]);
      expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, actorId: admin.id, note: { contains: 'Xác nhận tiền trả dư' } } })).toBe(1);

      const picks = await Promise.allSettled([
        refunds.chooseDestination(user.id, row!.id, { refundMethod: 'WALLET' }),
        refunds.chooseDestination(user.id, row!.id, { refundMethod: 'WALLET' }),
      ]);
      expect(picks.filter((p) => p.status === 'fulfilled')).toHaveLength(1);
      expect(await walletOf(user.id)).toBe(90_000);
    });

    it('RACE (8 vòng): hai admin cùng lúc — một "Xác nhận tiền dư", một "Không phải tiền dư" → đúng một bên thắng; bỏ qua thì khách không bao giờ nhận được', async () => {
      const outcomes: string[] = [];
      for (let round = 0; round < 8; round++) {
        notify.mockClear();
        const { user, order, deliver } = await paidBank(50_000);
        const [a, b] = [await createUser(prisma, { role: 'ADMIN' }), await createUser(prisma, { role: 'ADMIN' })];
        await deliver({ bank_payment: 100_000 });
        const [row] = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
        const verify = () => refunds.verifyOverpayment(a.id, row!.id, {});
        const dismiss = () => refunds.dismissOverpayment(b.id, row!.id, { reason: 'Không thấy trên sao kê' });
        const [verified, dismissed] =
          round % 2 ? await Promise.allSettled([verify(), dismiss()]) : (await Promise.allSettled([dismiss(), verify()])).reverse();
        expect([verified!.status, dismissed!.status].sort()).toEqual(['fulfilled', 'rejected']);
        const final = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row!.id } });
        if (verified!.status === 'fulfilled') {
          outcomes.push('verified');
          expect(final.status).toBe('PENDING');
          expect(sent('REFUND_OVERPAYMENT')).toHaveLength(1);
          await refunds.chooseDestination(user.id, row!.id, { refundMethod: 'WALLET' });
          expect(await walletOf(user.id)).toBe(50_000);
        } else {
          outcomes.push('dismissed');
          expect(final).toMatchObject({ status: 'DISMISSED', completedBy: b.id });
          expect(sent('REFUND_OVERPAYMENT')).toHaveLength(0);
          await expect(refunds.chooseDestination(user.id, row!.id, { refundMethod: 'WALLET' })).rejects.toThrow();
          await expect(refunds.claim(a.id, row!.id, { bankName: 'ACB', accountNumber: '123456789', accountName: 'A' })).rejects.toThrow();
          expect(await walletOf(user.id)).toBe(0);
        }
        expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, actorType: 'ADMIN' } })).toBe(1);
      }
      console.log('[verify x dismiss] %j', outcomes);
    });

    it('sao kê chỉ có một phần → khoản đúng số thực nhận; Pancake báo lại cùng số không đẻ khoản mới, báo thêm chỉ phần tăng', async () => {
      const { user, order, deliver } = await paidBank(100_000);
      const admin = await createUser(prisma, { role: 'ADMIN' });
      await deliver({ bank_payment: 200_000 });
      const [row] = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
      await refunds.verifyOverpayment(admin.id, row!.id, { amount: 30_000 });
      await deliver({ bank_payment: 200_000 });
      let rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id }, orderBy: { amount: 'asc' } });
      expect(rows.map((r) => [r.amount, r.status])).toEqual([
        [30_000, 'PENDING'],
        [70_000, 'DISMISSED'],
      ]);
      await deliver({ bank_payment: 250_000 });
      rows = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id, status: 'UNVERIFIED' } });
      expect(rows.map((r) => r.amount)).toEqual([50_000]);
      expect((await refunds.listMine(user.id, order.id)).map((r) => r.amount)).toEqual([30_000]);
    });
  });

  describe('R3-MONEY-5 — khách chuyển thiếu', () => {
    it('chuyển thiếu rồi khách huỷ → hoàn ngay số đã nhận (một tin huỷ nói luôn), gỡ cảnh báo; Pancake báo lại cùng số không tạo thêm, báo thêm thì chỉ phần tăng', async () => {
      const { user, order, deliver } = await pancakeBankOrder(114_000);
      await deliver({ bank_payment: 50_000 });
      let row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row.pancakeAttention).toMatch(/^Khách chuyển thiếu/);
      expect(row.pancakePaidReported).toBe(50_000);

      notify.mockClear();
      await orders.cancel(user.id, order.code);
      row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row.status).toBe('CANCELLED');
      expect(row.pancakeAttention).toBeNull();
      let late = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id, kind: 'LATE_PAYMENT' } });
      expect(late).toEqual([expect.objectContaining({ amount: 50_000, refKey: 'PANCAKE:paid:50000', status: 'PENDING' })]);
      const cancelled = sent('ORDER_CANCELLED');
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]![2].refund_note).toContain('Tubu đã nhận 50.000đ chuyển khoản của đơn này');
      expect(sent('REFUND_LATE_PAYMENT')).toHaveLength(0);

      await deliver({ status: 6, bank_payment: 50_000 });
      await deliver({ status: 6, bank_payment: 80_000 });
      late = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id, kind: 'LATE_PAYMENT' }, orderBy: { createdAt: 'asc' } });
      expect(late.map((r) => r.amount)).toEqual([50_000, 30_000]);
    });

    it('chuyển thiếu, đơn tự huỷ vì quá hạn (tin riêng không có chỗ nói tiền) → khoản hoàn tự báo khách bằng tin tiền về muộn', async () => {
      const { order, deliver } = await pancakeBankOrder(114_000);
      await deliver({ bank_payment: 40_000 });
      notify.mockClear();
      await orderStatus.setStatus(order.id, 'CANCELLED', {
        actorType: 'SYSTEM',
        note: 'Tự huỷ: quá 24 giờ chưa thanh toán',
        onlyIfUnpaid: true,
        expectedStatus: 'PENDING_PAYMENT',
        notifyEvent: 'ORDER_PAYMENT_EXPIRED',
      });
      expect(await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } })).toEqual([
        expect.objectContaining({ kind: 'LATE_PAYMENT', amount: 40_000 }),
      ]);
      expect(sent('REFUND_LATE_PAYMENT')).toHaveLength(1);
    });

    it('chuyển thiếu rồi chuyển đủ → PAID, cảnh báo "Khách chuyển thiếu" tự gỡ', async () => {
      const { order, deliver } = await pancakeBankOrder(114_000);
      await deliver({ bank_payment: 50_000 });
      await deliver({ bank_payment: 114_000 });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row).toMatchObject({ paymentStatus: 'PAID', pancakeAttention: null });
    });
  });

  describe('R3-MONEY-4 — chỉ người đang chuyển khoản được trả về hàng chờ / xác nhận', () => {
    async function claimedRefund() {
      const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const adminA = await createUser(prisma, { role: 'ADMIN', fullName: 'Admin A' });
      const adminB = await createUser(prisma, { role: 'ADMIN', fullName: 'Admin B' });
      const order = await createOrder(prisma, { userId: user.id, status: 'CANCELLED', paymentMethod: 'BANK_TRANSFER', total: 44_000 });
      const row = await prisma.orderCustomerRefund.create({
        data: {
          orderId: order.id,
          orderCode: order.code,
          kind: 'LATE_PAYMENT',
          refKey: `r5-${randCode(6)}`,
          userId: user.id,
          amount: 44_000,
          method: 'MANUAL_TRANSFER',
          status: 'PENDING',
          reason: 'CANCELLED',
          bankName: 'Techcombank',
          bankAccountNo: '190312345678',
          bankAccountName: 'NGUYEN VAN A',
        },
      });
      await refunds.claim(adminA.id, row.id);
      return { user, adminA, adminB, order, row };
    }

    it('admin B không trả về hàng chờ / không xác nhận được khoản admin A đang chuyển; khách không rút về Ví được', async () => {
      const { user, adminA, adminB, row } = await claimedRefund();
      await expect(refunds.release(adminB.id, row.id)).rejects.toThrow('Khoản này đang do Admin A chuyển khoản');
      await expect(refunds.markPaid(adminB.id, row.id, { bankRef: 'FT-B' })).rejects.toThrow('Khoản này đang do Admin A chuyển khoản');
      await expect(refunds.chooseDestination(user.id, row.id, { refundMethod: 'WALLET' })).rejects.toThrow('Tubu đang chuyển khoản');
      const done = await refunds.markPaid(adminA.id, row.id, { bankRef: 'FT-A' });
      expect(done).toMatchObject({ status: 'COMPLETED', completedBy: adminA.id, claimedBy: adminA.id });
      expect(await walletOf(user.id)).toBe(0);
    });

    it('RACE (8 vòng): A bấm "Đã chuyển khoản" cùng lúc B tiếp quản trả về hàng chờ rồi khách chọn Ví → tiền đi đúng MỘT đường', async () => {
      const outcomes: string[] = [];
      for (let round = 0; round < 8; round++) {
        const { user, adminA, adminB, order, row } = await claimedRefund();
        const [paid, released] = await Promise.allSettled([
          refunds.markPaid(adminA.id, row.id, { bankRef: `FT-A-${round}` }),
          refunds
            .release(adminB.id, row.id, { takeOver: true, takeOverReason: 'A báo chưa chuyển được' })
            .then(() => refunds.chooseDestination(user.id, row.id, { refundMethod: 'WALLET' })),
        ]);
        const final = await prisma.orderCustomerRefund.findUniqueOrThrow({ where: { id: row.id } });
        const wallet = await walletOf(user.id);
        const takeOvers = await prisma.orderStatusHistory.count({ where: { orderId: order.id, note: { contains: 'tiếp quản' } } });
        if (paid.status === 'fulfilled') {
          outcomes.push('bank');
          expect(released.status).toBe('rejected');
          expect(final).toMatchObject({ method: 'MANUAL_TRANSFER', status: 'COMPLETED', completedBy: adminA.id });
          expect(wallet).toBe(0);
          expect(takeOvers).toBe(0);
        } else {
          outcomes.push('wallet');
          expect(released.status).toBe('fulfilled');
          expect(final).toMatchObject({ method: 'WALLET', status: 'COMPLETED' });
          expect(wallet).toBe(44_000);
          expect(takeOvers).toBe(1);
        }
      }
      console.log('[markPaid x takeOver] %j', outcomes);
    });
  });

  describe('R2-LIFECYCLE-5 — hoàn thẳng vào Ví để lại dòng vết cho chi tiết đơn', () => {
    it('admin huỷ đơn chuyển khoản đã trả → khách thấy "đã hoàn X vào Ví" ở danh sách khoản hoàn của đơn; tin huỷ nói lý do', async () => {
      const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const order = await createOrder(prisma, {
        userId: user.id,
        status: 'CONFIRMED',
        paymentMethod: 'BANK_TRANSFER',
        paymentStatus: 'PAID',
        total: 95_000,
      });
      await orderStatus.setStatus(order.id, 'CANCELLED', {
        actorType: 'ADMIN',
        note: 'Admin: Hết hàng nhà cung cấp',
        customerReason: 'Hết hàng nhà cung cấp',
      });
      expect(await walletOf(user.id)).toBe(95_000);
      const mine = await refunds.listMine(user.id, order.id);
      expect(mine).toEqual([expect.objectContaining({ kind: 'CANCEL', method: 'WALLET', status: 'COMPLETED', amount: 95_000, canChooseDestination: false })]);
      expect(sent('ORDER_CANCELLED')[0]![2]).toEqual({
        order_code: order.code,
        refund_note: ' Lý do: Hết hàng nhà cung cấp. Đã hoàn 95.000đ vào Ví Tubu.',
      });
    });
  });
});
