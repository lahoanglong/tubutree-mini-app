import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { PENDING_PAYMENT_TTL_KEY, PendingPaymentExpiryCron } from '../../src/modules/orders/pending-payment-expiry.cron';
import { MssPaymentRescueService } from '../../src/modules/orders/mss-payment-rescue.service';
import { MSS_PAYMENT_RESCUE_CANCEL_KEY } from '../../src/modules/integrations/mss/mss-flag-keys';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, warmPool } from './helpers';

/**
 * MSS báo quá hạn chuyển khoản (webhook `order-status`, khối `payment_rescue`, hợp đồng W4-02) trên Postgres THẬT: MSS gửi lại cùng
 * tin nhiều lần cùng lúc, cron tự huỷ chạy chồng, hay tiền về chen giữa, thì đơn chỉ huỷ một lần (một dòng lịch sử, hoàn kho một lần,
 * nhả mã giảm giá một lần, khách nhận một tin), và đơn đã trả tiền không bao giờ bị huỷ.
 */
describe('MSS payment_rescue overdue vs gửi lặp / cron / tiền về (real Postgres)', () => {
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  let rescue: MssPaymentRescueService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const couponRelease = jest.fn().mockResolvedValue(undefined);
  const QTY = 2;
  const START_STOCK = 8;
  const created = { orderIds: [] as string[], userIds: [] as string[], productIds: [] as string[] };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    await setConfig(prisma, PENDING_PAYMENT_TTL_KEY, 24);
    await setConfig(prisma, MSS_PAYMENT_RESCUE_CANCEL_KEY, true);
    const loyalty = {
      creditOrderPoints: jest.fn().mockResolvedValue(undefined),
      reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
    } as unknown as LoyaltyService;
    const affiliate = {
      lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      grantReferralReward: jest.fn().mockResolvedValue(undefined),
      reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as AffiliateService;
    const reversal = new OrderReversalService({ restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService, { release: couponRelease } as unknown as CouponsService);
    orderStatus = new OrderStatusService(
      prisma,
      loyalty,
      affiliate,
      { notify, notifySafe: notify } as unknown as NotificationsService,
      reversal,
      undefined,
      new AnalyticsEventsService(prisma),
    );
    rescue = new MssPaymentRescueService(prisma, new SystemConfigService(prisma), orderStatus);
  });

  afterAll(async () => {
    if (prisma) {
      const { orderIds, userIds, productIds } = created;
      await prisma.$transaction([
        prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } }),
        prisma.order.deleteMany({ where: { id: { in: orderIds } } }),
        prisma.analyticsEvent.deleteMany({ where: { userId: { in: userIds } } }),
        prisma.user.deleteMany({ where: { id: { in: userIds } } }),
        prisma.product.deleteMany({ where: { id: { in: productIds } } }),
        prisma.systemConfig.deleteMany({ where: { key: MSS_PAYMENT_RESCUE_CANCEL_KEY } }),
      ]);
    }
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    notify.mockClear();
    couponRelease.mockClear();
  });

  // Đặt 2 ngày trước: đã qua hạn 24 giờ.
  const twoDaysAgo = () => new Date(Date.now() - 48 * 3_600_000 - Math.floor(Math.random() * 60_000));

  async function overdueOrder(over: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    created.userIds.push(user.id);
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itmpr-p-${tag}`, brand: 'IT', slug: `itmpr-${tag.toLowerCase()}`, name: `IT MPR ${tag}`, description: 'IT', basePrice: 100_000 },
    });
    created.productIds.push(product.id);
    const v = await prisma.variation.create({
      data: { pancakeId: `itmpr-v-${tag}`, productId: product.id, sku: `ITMPR-${tag}`, name: 'Mặc định', attributes: {}, retailPrice: 100_000, stock: START_STOCK, reservedStock: QTY },
    });
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total: 200_000,
      subtotal: 200_000,
      createdAt: twoDaysAgo(),
      ...over,
      items: { create: [{ variationId: v.id, productName: 'IT MPR', variationName: 'Mặc định', unitPrice: 100_000, quantity: QTY, total: 200_000 }] },
    });
    created.orderIds.push(order.id);
    return { order, variationId: v.id };
  }

  async function state(orderId: string, variationId: string) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const v = await prisma.variation.findUniqueOrThrow({ where: { id: variationId } });
    const cancels = await prisma.orderStatusHistory.findMany({ where: { orderId, toStatus: 'CANCELLED' } });
    return { order, stock: v.stock, reserved: v.reservedStock, cancels };
  }

  const expiredNotices = (code: string) =>
    notify.mock.calls.filter((c) => c[1] === 'ORDER_PAYMENT_EXPIRED' && (c[2] as { order_code?: string } | undefined)?.order_code === code);

  it('MSS gửi lặp 5 lần cùng lúc: huỷ đúng một lần với lý do chuẩn, hoàn kho một lần, một tin cho khách', async () => {
    const { order, variationId } = await overdueOrder();
    const results = await Promise.all(Array.from({ length: 5 }, () => rescue.handleOverdue(order.code)));
    expect(results.filter((r) => r.outcome === 'cancelled')).toHaveLength(1);
    expect(results.every((r) => r.outcome === 'cancelled' || r.outcome === 'already_cancelled' || (r.outcome === 'skipped' && r.reason === 'raced'))).toBe(true);

    const s = await state(order.id, variationId);
    expect(s.order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
    expect(s.cancels).toHaveLength(1);
    expect(s.cancels[0]).toMatchObject({ fromStatus: 'PENDING_PAYMENT', actorType: 'SYSTEM', note: 'Tự động hủy do quá hạn chuyển khoản 24h' });
    expect(s.stock).toBe(START_STOCK + QTY);
    expect(s.reserved).toBe(0);
    expect(couponRelease).toHaveBeenCalledTimes(1);
    expect(expiredNotices(order.code)).toHaveLength(1);

    // Gửi lại sau đó (MSS thử lại khi chưa nhận 2xx): already_cancelled, không làm gì thêm.
    notify.mockClear();
    await expect(rescue.handleOverdue(order.code)).resolves.toEqual({ outcome: 'already_cancelled' });
    expect((await state(order.id, variationId)).cancels).toHaveLength(1);
    expect(notify).not.toHaveBeenCalled();
    expect(couponRelease).toHaveBeenCalledTimes(1);
  });

  it('webhook chạy chồng cron tự huỷ: một bên thắng, đơn huỷ một lần', async () => {
    const { order, variationId } = await overdueOrder();
    const cron = new PendingPaymentExpiryCron(prisma, new SystemConfigService(prisma), orderStatus);
    await Promise.allSettled([rescue.handleOverdue(order.code), cron.expireStale(), rescue.handleOverdue(order.code)]);
    const s = await state(order.id, variationId);
    expect(s.order.status).toBe('CANCELLED');
    expect(s.cancels).toHaveLength(1);
    expect(s.stock).toBe(START_STOCK + QTY);
    expect(expiredNotices(order.code)).toHaveLength(1);
  });

  it('tiền về chạy chồng webhook: hoặc đã trả và giữ đơn, hoặc huỷ chưa trả; không bao giờ huỷ đơn đã trả', async () => {
    for (let i = 0; i < 4; i++) {
      const { order, variationId } = await overdueOrder();
      await Promise.allSettled([rescue.handleOverdue(order.code), orderStatus.markPaid(order.id, { actorType: 'SYSTEM', note: 'callback' })]);
      const s = await state(order.id, variationId);
      if (s.order.paymentStatus === 'PAID') {
        expect(s.order.status).toBe('CONFIRMED');
        expect(s.cancels).toHaveLength(0);
        expect(s.stock).toBe(START_STOCK);
      } else {
        expect(s.order.status).toBe('CANCELLED');
        expect(s.cancels).toHaveLength(1);
        expect(s.stock).toBe(START_STOCK + QTY);
      }
    }
  });

  it('không huỷ: COD, đã trả, khách chuyển một phần, chưa tới hạn 24 giờ', async () => {
    const cod = await overdueOrder({ paymentMethod: 'COD', status: 'CONFIRMED' });
    const paid = await overdueOrder({ paymentStatus: 'PAID', status: 'CONFIRMED' });
    const partial = await overdueOrder({ pancakePaidReported: 50_000 });
    const fresh = await overdueOrder({ createdAt: new Date(Date.now() - 3_600_000) });
    await expect(rescue.handleOverdue(cod.order.code)).resolves.toEqual({ outcome: 'skipped', reason: 'not_bank_transfer' });
    await expect(rescue.handleOverdue(paid.order.code)).resolves.toEqual({ outcome: 'skipped', reason: 'paid' });
    await expect(rescue.handleOverdue(partial.order.code)).resolves.toEqual({ outcome: 'skipped', reason: 'partially_paid' });
    await expect(rescue.handleOverdue(fresh.order.code)).resolves.toMatchObject({ outcome: 'not_due' });
    for (const f of [cod, paid, partial, fresh]) {
      const s = await state(f.order.id, f.variationId);
      expect(s.order.status).not.toBe('CANCELLED');
      expect(s.cancels).toHaveLength(0);
      expect(s.stock).toBe(START_STOCK);
    }
    expect(notify).not.toHaveBeenCalled();
  });
});
