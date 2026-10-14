import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { UnpaidPrepaidTransitionError } from '../../src/modules/orders/order-transition';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import {
  DEALER_PENDING_PAYMENT_TTL_KEY,
  PENDING_PAYMENT_TTL_KEY,
  PendingPaymentExpiryCron,
} from '../../src/modules/orders/pending-payment-expiry.cron';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, randCode, setConfig, summarize, warmPool } from './helpers';

/**
 * Cron tự huỷ đơn trả trước quá hạn thanh toán (PendingPaymentExpiryCron) chạy chồng với tiền về
 * (OrderStatusService.markPaid — hàm chung của nút "Đã nhận tiền"; và lần lật kiểu callback cổng thanh
 * toán) trên Postgres THẬT: đơn đã PAID không bao giờ bị huỷ/hoàn kho, đơn bị huỷ thì hoàn kho đúng 1 lần
 * (C-024). Chỉ stub thông báo / điểm / hoa hồng / flash-sale / coupon.
 */
describe('Pending-payment expiry cron vs payment race (real Postgres)', () => {
  let prisma: PrismaService;
  let orderStatus: OrderStatusService;
  const notify = jest.fn().mockResolvedValue(undefined);
  const QTY = 2;
  const START_STOCK = 8; // tồn bán được sau khi đơn đã giữ QTY đơn vị

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    await warmPool(prisma);
    await setConfig(prisma, PENDING_PAYMENT_TTL_KEY, 24);
    await setConfig(prisma, DEALER_PENDING_PAYMENT_TTL_KEY, 72);
    const loyalty = {
      creditOrderPoints: jest.fn().mockResolvedValue(undefined),
      reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
    } as unknown as LoyaltyService;
    const affiliate = {
      lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
      grantReferralReward: jest.fn().mockResolvedValue(undefined),
      reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as AffiliateService;
    const reversal = new OrderReversalService(
      { restore: jest.fn().mockResolvedValue(undefined) } as unknown as FlashSaleService,
      { release: jest.fn().mockResolvedValue(undefined) } as unknown as CouponsService,
    );
    orderStatus = new OrderStatusService(
      prisma,
      loyalty,
      affiliate,
      { notify } as unknown as NotificationsService,
      reversal,
      undefined,
      new AnalyticsEventsService(prisma),
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(() => notify.mockClear());

  const newCron = () => new PendingPaymentExpiryCron(prisma, new SystemConfigService(prisma), orderStatus);

  // createdAt rất cũ: đơn của spec luôn nằm đầu lô quét (orderBy createdAt asc), không phụ thuộc đơn của spec khác.
  const ancient = () => new Date(Date.UTC(2001, 0, 1) + Math.floor(Math.random() * 86_400_000));

  async function variation() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: `itppx-p-${tag}`,
        brand: 'IT',
        slug: `itppx-${tag.toLowerCase()}`,
        name: `IT PPX ${tag}`,
        description: 'IT',
        basePrice: 100_000,
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: `itppx-v-${tag}`,
        productId: product.id,
        sku: `ITPPX-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        stock: START_STOCK,
        reservedStock: QTY,
      },
    });
  }

  async function staleOrder(over: Partial<Prisma.OrderUncheckedCreateInput> = {}) {
    const user = await createUser(prisma, { role: 'CUSTOMER' });
    const v = await variation();
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total: 200_000,
      subtotal: 200_000,
      createdAt: ancient(),
      ...over,
      items: {
        create: [
          {
            variationId: v.id,
            productName: 'IT PPX',
            variationName: 'Mặc định',
            unitPrice: 100_000,
            quantity: QTY,
            total: 200_000,
          },
        ],
      },
    });
    return { user, order, variationId: v.id };
  }

  async function state(orderId: string, variationId: string, userId: string) {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    const v = await prisma.variation.findUniqueOrThrow({ where: { id: variationId } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });
    return { order, stock: v.stock, reserved: v.reservedStock, wallet: user.walletBalance, history };
  }

  /** Bất biến tiền/kho: hoặc đã trả (giữ kho, không huỷ), hoặc đã huỷ chưa trả (hoàn kho đúng 1 lần). */
  function expectConsistent(s: Awaited<ReturnType<typeof state>>) {
    const cancels = s.history.filter((h) => h.toStatus === 'CANCELLED');
    if (s.order.paymentStatus === 'PAID') {
      expect(s.order.status).toBe('CONFIRMED');
      expect(s.stock).toBe(START_STOCK);
      expect(s.reserved).toBe(QTY);
      expect(cancels).toHaveLength(0);
    } else {
      expect(s.order).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
      expect(s.stock).toBe(START_STOCK + QTY);
      expect(s.reserved).toBe(0);
      expect(cancels).toHaveLength(1);
      expect(cancels[0]).toMatchObject({ fromStatus: 'PENDING_PAYMENT', actorType: 'SYSTEM' });
    }
    expect(s.wallet).toBe(0);
  }

  /** Lần đọc đơn đầu tiên của setStatus (cron) trả ảnh chụp cũ; `between` chạy & commit trước khi cron lật. */
  async function runCronWithPaymentBetween(between: () => Promise<unknown>) {
    const original = prisma.order.findFirst.bind(prisma.order);
    const spy = jest.spyOn(prisma.order, 'findFirst').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const snap = await original(args);
      await between();
      return snap;
    }) as never);
    try {
      return await newCron().expireStale();
    } finally {
      spy.mockRestore();
    }
  }

  it('(a) cron đọc đơn quá hạn, tiền về (markPaid) chen giữa trước khi cron lật → đơn giữ PAID, không huỷ, không hoàn kho', async () => {
    const { order, variationId, user } = await staleOrder();
    let outcome: string | undefined;
    await runCronWithPaymentBetween(async () => {
      outcome = (await orderStatus.markPaid(order.id, { actorType: 'SYSTEM', note: 'callback' })).outcome;
    });

    expect(outcome).toBe('PAID');
    const s = await state(order.id, variationId, user.id);
    expect(s.order.paymentStatus).toBe('PAID');
    expectConsistent(s);
    const forThis = notify.mock.calls.filter((c) => (c[2] as { order_code?: string })?.order_code === order.code);
    expect(forThis.map((c) => c[1])).toEqual(['ORDER_CONFIRMED']);
  });

  it('(b) tiền về chỉ lật thanh toán (status vẫn PENDING_PAYMENT) chen giữa → guard onlyIfUnpaid chặn huỷ, không hoàn ví', async () => {
    const { order, variationId, user } = await staleOrder();
    await runCronWithPaymentBetween(() =>
      prisma.order.updateMany({ where: { id: order.id, paymentStatus: 'UNPAID' }, data: { paymentStatus: 'PAID', paidAt: new Date() } }),
    );

    const s = await state(order.id, variationId, user.id);
    expect(s.order).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'PAID' });
    expect(s.history.filter((h) => h.toStatus === 'CANCELLED')).toHaveLength(0);
    expect(s.stock).toBe(START_STOCK);
    expect(s.wallet).toBe(0);
    const forThis = notify.mock.calls.filter((c) => (c[2] as { order_code?: string })?.order_code === order.code);
    expect(forThis).toHaveLength(0);
  });

  it('(c) 8 đơn quá hạn, cron và markPaid chạy ĐỒNG THỜI cho từng đơn → mỗi đơn hoặc PAID nguyên kho, hoặc CANCELLED hoàn kho 1 lần', async () => {
    const fixtures = await Promise.all(Array.from({ length: 8 }, () => staleOrder()));
    const results = await Promise.allSettled([
      newCron().expireStale(),
      ...fixtures.map(({ order }) => orderStatus.markPaid(order.id, { actorType: 'SYSTEM', note: 'callback' })),
    ]);
    const s = summarize(results);
    expect(s.errors).toEqual([]);

    for (const { order, variationId, user } of fixtures) {
      expectConsistent(await state(order.id, variationId, user.id));
    }
    // markPaid thua cron thì báo CLOSED (tiền thật đã về thì hoàn thủ công), không "hồi sinh" đơn đã huỷ.
    const outcomes = s.fulfilled.slice(1).map((r) => (r.value as { outcome: string }).outcome);
    for (const o of outcomes) expect(['PAID', 'CLOSED']).toContain(o);
  });

  it('(d) hai instance cron chạy cùng lúc → một bên bỏ lượt (khoá advisory), mỗi đơn huỷ + hoàn kho đúng 1 lần', async () => {
    const fixtures = await Promise.all(Array.from({ length: 5 }, () => staleOrder()));
    const [r1, r2] = await Promise.all([newCron().expireStale(), newCron().expireStale()]);
    expect([r1, r2].filter((r) => 'skipped' in r)).toEqual([{ skipped: 'LOCKED' }]);

    for (const { order, variationId, user } of fixtures) {
      const st = await state(order.id, variationId, user.id);
      expect(st.order.status).toBe('CANCELLED');
      expectConsistent(st);
    }
    const codes = new Set(fixtures.map((f) => f.order.code));
    const notices = notify.mock.calls.filter(
      (c) => c[1] === 'ORDER_PAYMENT_EXPIRED' && codes.has((c[2] as { order_code: string }).order_code),
    );
    expect(notices).toHaveLength(5);
  });

  // Review lượt 1: trước đây admin bấm "Xác nhận" đơn chưa trả → CONFIRMED+UNPAID, cron (chỉ quét
  // PENDING_PAYMENT) bỏ qua mãi mãi, kho bị giữ vĩnh viễn.
  it('(f) admin bấm "Xác nhận" đơn chuyển khoản chưa trả → bị chặn, đơn vẫn PENDING_PAYMENT và cron vẫn huỷ + hoàn kho', async () => {
    const { order, variationId, user } = await staleOrder();
    await expect(orderStatus.setStatus(order.id, 'CONFIRMED', { actorType: 'ADMIN', actorId: 'admin-1' })).rejects.toThrow(
      UnpaidPrepaidTransitionError,
    );
    await expect(orderStatus.setStatus(order.id, 'PACKED', { actorType: 'ADMIN' })).rejects.toThrow(UnpaidPrepaidTransitionError);
    await newCron().expireStale();
    const st = await state(order.id, variationId, user.id);
    expect(st.order.status).toBe('CANCELLED');
    expectConsistent(st);
  });

  it('(g) đơn bị đẩy sang CONFIRMED (vẫn UNPAID) giữa lúc cron quét danh sách và lúc huỷ → cron không huỷ (expectedStatus)', async () => {
    const { order, variationId, user } = await staleOrder();
    // Chen giữa findMany của cron và lần đọc lại của setStatus (khác runCronWithPaymentBetween: chen sau lần đọc lại).
    const original = prisma.order.findMany.bind(prisma.order);
    const spy = jest.spyOn(prisma.order, 'findMany').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const rows = await original(args);
      await prisma.order.updateMany({ where: { id: order.id, status: 'PENDING_PAYMENT' }, data: { status: 'CONFIRMED' } });
      return rows;
    }) as never);
    try {
      await newCron().expireStale();
    } finally {
      spy.mockRestore();
    }
    const st = await state(order.id, variationId, user.id);
    expect(st.order).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'UNPAID' });
    expect(st.history.filter((h) => h.toStatus === 'CANCELLED')).toHaveLength(0);
    expect(st.stock).toBe(START_STOCK);
  });

  it('(h) webhook vận chuyển báo DELIVERED cho đơn chưa trả (2 lần song song + 1 lần lặp) → bị chặn, mục cần xử lý có đúng 1 dấu, ghi chú của khách giữ nguyên', async () => {
    const { order } = await staleOrder({ createdAt: new Date(), status: 'PACKED', note: 'Giao giờ hành chính' });
    const calls = [
      orderStatus.setStatus(order.id, 'DELIVERED', { actorType: 'PANCAKE' }),
      orderStatus.setStatus(order.id, 'DELIVERED', { actorType: 'PANCAKE' }),
    ];
    const settled = await Promise.allSettled(calls);
    await orderStatus.setStatus(order.id, 'DELIVERED', { actorType: 'PANCAKE' }).catch(() => undefined);
    for (const r of settled) {
      expect(r.status).toBe('rejected');
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(UnpaidPrepaidTransitionError);
    }
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PACKED');
    expect(after.note).toBe('Giao giờ hành chính');
    expect(after.pancakeAttention?.split('vận chuyển đã báo DELIVERED')).toHaveLength(2);
    expect(after.pancakeAttentionAt).not.toBeNull();
  });

  it('(e) phạm vi: đơn mới đặt, đơn đại lý còn trong hạn riêng, đơn COD, đơn đã PAID → không bị đụng tới', async () => {
    const fresh = await staleOrder({ createdAt: new Date() });
    // Quá hạn khách lẻ (24 giờ) nhưng còn trong hạn đơn đại lý (72 giờ).
    const dealer = await staleOrder({ type: 'DEALER', createdAt: new Date(Date.now() - 48 * 3_600_000) });
    const cod = await staleOrder({ paymentMethod: 'COD' });
    const paid = await staleOrder({ paymentStatus: 'PAID' });
    await newCron().expireStale();
    for (const f of [fresh, dealer, cod, paid]) {
      const st = await state(f.order.id, f.variationId, f.user.id);
      expect(st.order.status).toBe('PENDING_PAYMENT');
      expect(st.stock).toBe(START_STOCK);
      expect(st.history).toHaveLength(0);
    }
  });

  it('(i) đơn đại lý chuyển khoản quá hạn riêng (SELLER-7) → huỷ và hoàn kho đúng 1 lần, chạy cron lặp không huỷ lại', async () => {
    const dealer = await staleOrder({ type: 'DEALER' });
    await Promise.all([newCron().expireStale(), newCron().expireStale()]);
    await newCron().expireStale();
    const st = await state(dealer.order.id, dealer.variationId, dealer.user.id);
    expect(st.order.status).toBe('CANCELLED');
    expect(st.history.filter((h) => h.toStatus === 'CANCELLED')).toHaveLength(1);
    expectConsistent(st);
  });
});
