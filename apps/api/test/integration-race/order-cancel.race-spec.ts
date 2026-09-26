import { Test, type TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { DealerService } from '../../src/modules/dealer/dealer.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { createOrder, createUser, summarize, warmPool } from './helpers';

/**
 * Khách/đại lý tự huỷ đơn (OrdersService.cancel) chạy chồng với admin xác nhận đã nhận chuyển khoản
 * (DealerService.confirmDealerOrderPayment — POST /admin/dealer-orders/:id/confirm-payment) trên Postgres
 * THẬT. Lỗi cũ: cancel() đọc đơn NGOÀI tx (UNPAID), admin lật PAID chen giữa, tx huỷ vẫn chạy nhưng
 * reverseFinancials chỉ hoàn khi ẢNH CHỤP là PAID → đơn CANCELLED + PAID, tiền đại lý đã trả mất trắng.
 * Chỉ stub thông báo / Pancake / giỏ / hoa hồng / flash-sale / coupon (không liên quan tiền của đơn này).
 */
describe('Order cancel vs admin confirm-payment race (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  let dealer: DealerService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrdersService,
        DealerService,
        { provide: CartService, useValue: {} },
        { provide: AffiliateService, useValue: { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
        { provide: PancakeOrderService, useValue: { enqueuePush: jest.fn().mockResolvedValue(undefined) } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orders = moduleRef.get(OrdersService);
    dealer = moduleRef.get(DealerService);
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  /** Đơn đại lý TRẢ TRƯỚC vừa đặt: PENDING_PAYMENT + UNPAID, chuyển khoản (không có dòng ghi nợ). */
  async function prepaidDealerOrder(total = 7_500_000) {
    const user = await createUser(prisma, { role: 'DEALER', walletBalance: 0 });
    const order = await createOrder(prisma, {
      userId: user.id,
      type: 'DEALER',
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total,
      subtotal: total,
    });
    return { user, order };
  }

  it('(a) admin xác nhận CK chen giữa lúc cancel() đọc đơn và tx huỷ → đơn huỷ VÀ hoàn ví đại lý đúng 1 lần', async () => {
    const { user, order } = await prepaidDealerOrder();
    const admin = await createUser(prisma, { role: 'ADMIN' });

    // Rào tất định: lần đọc đơn đầu tiên của cancel() (detail → prisma.order.findUnique) thấy UNPAID; ngay
    // sau đó — TRƯỚC khi cancel() mở tx — admin xác nhận chuyển khoản và commit (PENDING_PAYMENT+UNPAID →
    // CONFIRMED+PAID). Các lần đọc sau đi thẳng DB.
    const original = prisma.order.findUnique.bind(prisma.order);
    const spy = jest.spyOn(prisma.order, 'findUnique').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const snap = await original(args);
      await dealer.confirmDealerOrderPayment(admin.id, order.id, { bankRef: 'FT-RACE-A' });
      return snap;
    }) as never);
    let cancelled;
    try {
      cancelled = await orders.cancel(user.id, order.code);
    } finally {
      spy.mockRestore();
    }

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const wallet = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { walletBalance: true } });
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });

    expect(cancelled.status).toBe('CANCELLED');
    expect(after.status).toBe('CANCELLED');
    expect(after.paymentStatus).toBe('REFUNDED');
    expect(wallet.walletBalance).toBe(order.total);
    // Lịch sử: admin PENDING_PAYMENT → CONFIRMED rồi khách CONFIRMED → CANCELLED (trạng thái THẬT lúc huỷ).
    expect(history.map((h) => [h.fromStatus, h.toStatus, h.actorType])).toEqual([
      ['PENDING_PAYMENT', 'CONFIRMED', 'ADMIN'],
      ['CONFIRMED', 'CANCELLED', 'CUSTOMER'],
    ]);

    // Huỷ lại (double-tap / retry) → không hoàn lần 2.
    await orders.cancel(user.id, order.code).catch(() => undefined);
    const wallet2 = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { walletBalance: true } });
    expect(wallet2.walletBalance).toBe(order.total);
  });

  it('(b) 10 đơn, mỗi đơn huỷ + xác nhận CK chạy ĐỒNG THỜI → không đơn nào CANCELLED mà còn PAID; tiền hoàn = đúng số đơn đã PAID', async () => {
    const admin = await createUser(prisma, { role: 'ADMIN' });
    const N = 10;
    const fixtures = await Promise.all(Array.from({ length: N }, (_, i) => prepaidDealerOrder(1_000_000 + i * 10_000)));

    const results = await Promise.allSettled(
      fixtures.flatMap(({ user, order }) => [
        orders.cancel(user.id, order.code),
        dealer.confirmDealerOrderPayment(admin.id, order.id, { bankRef: `FT-RACE-${order.code}` }),
      ]),
    );
    const s = summarize(results);
    // eslint-disable-next-line no-console
    console.log('[b] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    // Chỉ lời gọi xác nhận CK được phép thất bại (400: đơn đã huỷ / vừa đổi trạng thái) — không có lỗi 500/deadlock.
    for (const r of s.rejected) expect(r.reason).toBeInstanceOf(BadRequestException);
    results.forEach((r, i) => {
      if (i % 2 === 0) expect(r.status).toBe('fulfilled'); // cancel() luôn thành công
    });

    let refundedCount = 0;
    for (const { user, order } of fixtures) {
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const wallet = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { walletBalance: true } });
      expect(after.status).toBe('CANCELLED');
      // Tiền đã nhận thì phải được hoàn: không bao giờ kẹt CANCELLED + PAID.
      expect(['UNPAID', 'REFUNDED']).toContain(after.paymentStatus);
      if (after.paymentStatus === 'REFUNDED') {
        refundedCount += 1;
        expect(wallet.walletBalance).toBe(order.total);
      } else {
        expect(wallet.walletBalance).toBe(0);
      }
      const cancelRows = await prisma.orderStatusHistory.count({ where: { orderId: order.id, toStatus: 'CANCELLED' } });
      expect(cancelRows).toBe(1);
    }
    // eslint-disable-next-line no-console
    console.log('[b] refunded=%d / %d', refundedCount, N);
  });
});
