import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PendingPaymentExpiryCron } from '../../src/modules/orders/pending-payment-expiry.cron';
import { PancakeHandedOverError, PancakeSyncHooks } from '../../src/modules/integrations/pancake/pancake-sync-hooks';
import { createOrder, createUser, randCode, warmPool } from './helpers';

/**
 * R5-SYNC-1 trên Postgres THẬT: đơn chuyển khoản chưa trả mà Pancake đã gửi hàng (D1: đã bàn giao, chỉ còn trả/hoàn). Khách
 * không còn thấy hạn "quá hạn đơn sẽ tự huỷ" hay nút "Hủy đơn"; bấm huỷ (app cũ, màn cũ) bị từ chối ngay, không hỏi lại Pancake
 * nên đơn admin đã "Đã xử lý" không quay về "Cần xử lý Pancake". Stub: Pancake (đã gửi hàng, mã 2), thông báo, hoa hồng.
 */
describe('Đơn chờ chuyển khoản đã bàn giao vận chuyển — khách không huỷ được, hàng đợi không bị bắn lại (real Postgres)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  let status: OrderStatusService;
  let cron: PendingPaymentExpiryCron;
  const precheckCancel = jest.fn();
  const notify = jest.fn().mockResolvedValue(undefined);

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        LoyaltyService,
        OrderReversalService,
        OrderStatusService,
        OrdersService,
        PendingPaymentExpiryCron,
        {
          provide: PancakeSyncHooks,
          useValue: { precheckCancel, afterLocalCancel: jest.fn().mockResolvedValue(undefined), afterPaid: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: AffiliateService,
          useValue: { reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined), lockCommissionsForOrder: jest.fn() },
        },
        { provide: NotificationsService, useValue: { notify } },
        { provide: CartService, useValue: {} },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    await warmPool(prisma);
    orders = moduleRef.get(OrdersService);
    status = moduleRef.get(OrderStatusService);
    cron = moduleRef.get(PendingPaymentExpiryCron);
    await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await moduleRef?.close();
  });

  beforeEach(() => {
    precheckCancel.mockReset();
    precheckCancel.mockRejectedValue(new PancakeHandedOverError(2));
    notify.mockClear();
  });

  /** Mốc tạo đơn cũ hẳn (năm 2001): lượt cron trong spec chỉ quét đúng đơn của spec này, không đụng đơn của spec khác. */
  async function shippedUnpaidTransfer(createdAt: Date) {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      pancakeOrderId: `pk-${randCode(8)}`,
      createdAt,
    });
    return { user, order };
  }

  const read = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const adminResolves = (id: string) => prisma.order.update({ where: { id }, data: { pancakeAttention: null, pancakeAttentionAt: null } });
  /**
   * Số lượt báo động "Cần xử lý Pancake" in-app cho đơn này: mỗi lượt gửi mỗi admin một tin, và người nhận bị chặn ở 20 admin
   * đầu nên admin của spec này không chắc nằm trong đó khi DB dùng chung đã có nhiều admin của spec khác.
   */
  const opsAlerts = (code: string) => {
    const calls = notify.mock.calls.filter((c) => c[1] === 'OPS_PANCAKE_ALERT' && c[2]?.order_code === code);
    const recipients = new Set(calls.map((c) => c[0]));
    return recipients.size === 0 ? 0 : calls.length / recipients.size;
  };
  /** Số lần hỏi Pancake cho đúng đơn này: lượt cron còn quét cả đơn chờ quá hạn mà spec khác để lại trong DB. */
  const prechecks = (id: string) => precheckCancel.mock.calls.filter((c) => c[0]?.id === id).length;

  it('cron chặn tự huỷ → admin "Đã xử lý" → khách: không hạn, không nút huỷ; bấm huỷ 3 lần bị từ chối, không hỏi Pancake, không quay lại hàng đợi', async () => {
    const createdAt = new Date('2001-03-01T00:00:00.000Z');
    const { user, order } = await shippedUnpaidTransfer(createdAt);
    await cron.expireStale(new Date('2001-03-02T01:00:00.000Z'));
    const blocked = await read(order.id);
    expect(blocked.status).toBe('PENDING_PAYMENT');
    expect(blocked.autoCancelBlockedAt).not.toBeNull();
    expect(blocked.pancakeAttention).toContain('Hệ thống không tự huỷ được đơn');
    expect(prechecks(order.id)).toBe(1);
    expect(opsAlerts(order.code)).toBe(1);
    await adminResolves(order.id);

    const view = await orders.detailView(user.id, order.code);
    expect(view).toMatchObject({ canCancel: false, paymentDeadline: null, manualHandling: true });
    expect((await orders.list(user.id, {}, 1, 20)).data[0]).toMatchObject({ code: order.code, canCancel: false, manualHandling: true });

    for (let i = 0; i < 3; i++) {
      const err = await orders.cancel(user.id, order.code).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as Error).message).toContain('Tubu đang xử lý');
    }
    expect(prechecks(order.id)).toBe(1);
    const after = await read(order.id);
    expect(after).toMatchObject({ status: 'PENDING_PAYMENT', paymentStatus: 'UNPAID', pancakeAttention: null });
    expect(opsAlerts(order.code)).toBe(1);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id } })).toBe(0);

    // Pancake báo lại "Đã gửi hàng" (webhook cập nhật khác của cùng đơn): vẫn chưa nhận tiền nên không đi tiếp, nhưng không bắn lại hàng đợi.
    await expect(status.setStatus(order.id, 'SHIPPING', { actorType: 'PANCAKE' })).rejects.toThrow();
    expect((await read(order.id)).pancakeAttention).toBeNull();

    // Cron các lượt sau không thử lại, không nhắc lại.
    await cron.expireStale(new Date('2001-03-02T01:10:00.000Z'));
    expect(prechecks(order.id)).toBe(1);
    expect((await read(order.id)).pancakeAttention).toBeNull();
  });

  it('khách bấm huỷ TRƯỚC lượt cron: lần đầu hỏi Pancake, ghi mốc + nhắc đúng một lần; admin xử lý xong thì lần bấm sau bị chặn ngay, cron không bắn lại', async () => {
    const createdAt = new Date('2001-04-01T00:00:00.000Z');
    const { user, order } = await shippedUnpaidTransfer(createdAt);

    const first = await orders.cancel(user.id, order.code).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(BadRequestException);
    expect((first as Error).message).toContain('vui lòng liên hệ CSKH');
    const flagged = await read(order.id);
    expect(flagged.status).toBe('PENDING_PAYMENT');
    expect(flagged.autoCancelBlockedAt).not.toBeNull();
    expect(flagged.pancakeAttention).toContain('Khách bấm huỷ nhưng Pancake báo đã bàn giao vận chuyển (mã 2)');
    expect(opsAlerts(order.code)).toBe(1);

    await adminResolves(order.id);
    const again = await orders.cancel(user.id, order.code).catch((e: unknown) => e);
    expect((again as Error).message).toContain('Tubu đang xử lý');
    await cron.expireStale(new Date('2001-04-02T01:00:00.000Z'));

    expect(prechecks(order.id)).toBe(1);
    expect(await read(order.id)).toMatchObject({ status: 'PENDING_PAYMENT', pancakeAttention: null });
    expect(opsAlerts(order.code)).toBe(1);
    expect(await orders.detailView(user.id, order.code)).toMatchObject({ canCancel: false, paymentDeadline: null, manualHandling: true });
  });

  it('đơn chờ chuyển khoản Pancake chưa gửi hàng: khách vẫn thấy hạn, vẫn huỷ được', async () => {
    precheckCancel.mockResolvedValue({ kind: 'CONFIRMED', cancelStatus: 'CANCELLED', pancakeOrderId: 'pk' });
    const { user, order } = await shippedUnpaidTransfer(new Date(Date.now() - 60 * 60_000));
    const view = await orders.detailView(user.id, order.code);
    expect(view).toMatchObject({ canCancel: true, manualHandling: false });
    expect(view.paymentDeadline).toEqual(expect.any(String));
    await orders.cancel(user.id, order.code);
    expect((await read(order.id)).status).toBe('CANCELLED');
  });
});
