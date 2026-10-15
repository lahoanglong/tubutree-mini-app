import { Test, type TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { CartService } from '../../src/modules/cart/cart.service';
import { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import { CouponsService } from '../../src/modules/coupons/coupons.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { PancakeSyncHooks } from '../../src/modules/integrations/pancake/pancake-sync-hooks';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import { createDealer, createOrder, createUser, randCode, warmPool } from './helpers';

const DIVERGENCE = 'Pancake đã huỷ nhưng đơn Tubu còn hiệu lực';

/**
 * SYNC-1/2/3/7 trên Postgres THẬT với PancakeClient giả (không gọi Pancake thật):
 *  - SYNC-1: lệnh huỷ đã tới Pancake rồi lần lật CANCELLED ở Tubu trượt (tiền về / vận đơn chen giữa) → đơn còn sống nhưng
 *    kho không còn đơn: phải có pancakeCancelStatus + "Cần xử lý Pancake", không im lặng.
 *  - SYNC-2: huỷ gặp "Đã bàn giao" của Pancake trên đơn có vận đơn Gomdon sống → không chốt DELIVERED hộ.
 *  - SYNC-3: đơn đại lý ghi công nợ mà Pancake phản ánh transfer_money thành prepaid → không lật PAID, không hoàn hai lần.
 *  - SYNC-7: "Đang hoàn"/"Đã xoá" tới trễ sau khi đơn đã huỷ → không ghim banner.
 */
describe('Đồng bộ huỷ đơn Tubu ↔ Pancake: lệch kết cục, Gomdon, công nợ đại lý (real Postgres)', () => {
  let app: TestingModule;
  let prisma: PrismaService;
  let orders: OrdersService;
  let status: OrderStatusService;
  let processor: PancakeProcessor;
  const notify = jest.fn().mockResolvedValue(undefined);
  const loyalty = {
    creditOrderPoints: jest.fn().mockResolvedValue(undefined),
    reverseOrderPoints: jest.fn().mockResolvedValue(undefined),
  };
  const affiliate = {
    reverseCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    lockCommissionsForOrder: jest.fn().mockResolvedValue(undefined),
    grantReferralReward: jest.fn().mockResolvedValue(undefined),
  };
  const queue = { name: 'pancake-push', getJob: jest.fn().mockResolvedValue(null), add: jest.fn().mockResolvedValue({}) };
  const client = {
    isConfigured: jest.fn().mockReturnValue(true),
    searchOrders: jest.fn().mockResolvedValue([]),
    getOrder: jest.fn(),
    updateOrder: jest.fn(),
  };

  beforeAll(async () => {
    app = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [
        SystemConfigService,
        OrderReversalService,
        OrderStatusService,
        OrdersService,
        { provide: LoyaltyService, useValue: loyalty },
        {
          provide: PancakeSyncHooks,
          useFactory: (p: PrismaService) => new PancakeSyncHooks(p, client as unknown as PancakeClient, queue as never),
          inject: [PrismaService],
        },
        { provide: CartService, useValue: {} },
        { provide: AffiliateService, useValue: affiliate },
        { provide: NotificationsService, useValue: { notify } },
        { provide: FlashSaleService, useValue: { restore: jest.fn().mockResolvedValue(undefined) } },
        { provide: CouponsService, useValue: { release: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    await app.init();
    prisma = app.get(PrismaService);
    await warmPool(prisma);
    orders = app.get(OrdersService);
    status = app.get(OrderStatusService);
    processor = new PancakeProcessor(prisma, { notify } as unknown as NotificationsService, status);
    await createUser(prisma, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    client.isConfigured.mockReturnValue(true);
    client.searchOrders.mockResolvedValue([]);
  });

  const cronCancel = { actorType: 'SYSTEM', pancakeGate: true, onlyIfUnpaid: true, expectedStatus: 'PENDING_PAYMENT' } as const;
  const alertsFor = (code: string) =>
    notify.mock.calls.filter(([, template, data]) => template === 'OPS_PANCAKE_ALERT' && (data as { order_code?: string }).order_code === code);
  const refundRows = (orderId: string) => prisma.orderCustomerRefund.count({ where: { orderId } });
  const reload = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });
  const walletOf = async (userId: string) => (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).walletBalance;

  async function expiringBankTransfer(overrides: Record<string, unknown> = {}) {
    const user = await createUser(prisma);
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      total: 450_000,
      subtotal: 450_000,
      pancakeOrderId: `pk-${randCode(8)}`,
      ...overrides,
    });
    return { user, order };
  }

  async function deliver(payload: Record<string, unknown>) {
    const ev = await prisma.pancakeWebhookEvent.create({ data: { eventType: 'orders', rawPayload: payload as object, status: 'PENDING' } });
    await processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);
    return prisma.pancakeWebhookEvent.findUniqueOrThrow({ where: { id: ev.id } });
  }

  describe('SYNC-1: Pancake đã huỷ mà lần huỷ ở Tubu trượt', () => {
    it('cron hết hạn: tiền Pancake về (markPaid) chen giữa lúc PUT huỷ và lúc lật → đơn CONFIRMED+PAID, có pancakeCancelStatus + "Cần xử lý" + báo admin', async () => {
      const { order } = await expiringBankTransfer();
      client.getOrder.mockResolvedValue({ id: order.pancakeOrderId, status: 1 });
      client.updateOrder.mockImplementation(async () => {
        await status.markPaid(order.id, { actorType: 'PANCAKE', note: 'Pancake ghi nhận chuyển khoản' });
        return { id: order.pancakeOrderId, status: 6 };
      });

      const res = await status.setStatus(order.id, 'CANCELLED', { ...cronCancel, notifyEvent: 'ORDER_PAYMENT_EXPIRED' });

      expect(res).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID' });
      const after = await reload(order.id);
      expect(after).toMatchObject({ status: 'CONFIRMED', paymentStatus: 'PAID', pancakeCancelStatus: 'CANCELLED', pancakeOrderId: order.pancakeOrderId });
      expect(after.pancakeAttention).toContain(DIVERGENCE);
      expect(after.pancakeAttention).toContain(`#${order.pancakeOrderId}`);
      expect(after.pancakeAttentionAt).not.toBeNull();
      expect(alertsFor(order.code).length).toBeGreaterThan(0);
      expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, toStatus: 'CANCELLED' } })).toBe(0);
      expect(await refundRows(order.id)).toBe(0);
    });

    it('khách tự huỷ: vận đơn/"Đã gửi hàng" về chen giữa → tx huỷ ném đúng lỗi 400 cũ cho khách, đơn còn sống kèm dấu lệch', async () => {
      const { user, order } = await expiringBankTransfer({ status: 'CONFIRMED' });
      client.getOrder.mockResolvedValue({ id: order.pancakeOrderId, status: 1 });
      client.updateOrder.mockImplementation(async () => {
        await prisma.order.update({ where: { id: order.id }, data: { status: 'SHIPPING', shippingCode: 'GHNSYNC1', shippingPartner: 'GHN' } });
        return { id: order.pancakeOrderId, status: 6 };
      });

      const err = (await orders.cancel(user.id, order.code).catch((e: unknown) => e)) as { getStatus(): number; message: string };
      expect(err.getStatus()).toBe(400);
      expect(err.message).toContain('Đơn đã vào quy trình giao');

      const after = await reload(order.id);
      expect(after).toMatchObject({ status: 'SHIPPING', pancakeCancelStatus: 'CANCELLED', shippingCode: 'GHNSYNC1' });
      expect(after.pancakeAttention).toContain(DIVERGENCE);
      expect(await refundRows(order.id)).toBe(0);
    });

    it('webhook Pancake "Đã huỷ" thắng lần lật (cùng lúc với PUT) → đơn CANCELLED một lần, KHÔNG có dấu lệch', async () => {
      const { order } = await expiringBankTransfer();
      client.getOrder.mockResolvedValue({ id: order.pancakeOrderId, status: 1 });
      client.updateOrder.mockImplementation(async () => {
        await status.setStatus(order.id, 'CANCELLED', { actorType: 'PANCAKE' });
        return { id: order.pancakeOrderId, status: 6 };
      });

      await status.setStatus(order.id, 'CANCELLED', cronCancel);

      const after = await reload(order.id);
      expect(after.status).toBe('CANCELLED');
      expect(after.pancakeAttention).toBeNull();
      expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, toStatus: 'CANCELLED' } })).toBe(1);
    });

    it('lệch được tự gỡ khi webhook Pancake "Đã huỷ" tới sau và huỷ nốt đơn Tubu', async () => {
      const { order } = await expiringBankTransfer();
      client.getOrder.mockResolvedValue({ id: order.pancakeOrderId, status: 1 });
      client.updateOrder.mockImplementation(async () => {
        await status.markPaid(order.id, { actorType: 'PANCAKE' });
        return { id: order.pancakeOrderId, status: 6 };
      });
      await status.setStatus(order.id, 'CANCELLED', cronCancel);
      expect((await reload(order.id)).pancakeAttention).toContain(DIVERGENCE);

      await deliver({ id: order.pancakeOrderId, extension: { external_order_id: order.code }, status: 6 });

      const after = await reload(order.id);
      expect(after.status).toBe('CANCELLED');
      expect(after.pancakeAttention).toBeNull();
    });
  });

  describe('SYNC-2: huỷ gặp Pancake "đã bàn giao" trên đơn có vận đơn Gomdon sống', () => {
    async function recycling(overrides: Record<string, unknown> = {}) {
      const user = await createUser(prisma, { walletBalance: 1_000_000 });
      const order = await createOrder(prisma, {
        userId: user.id,
        status: 'PACKED',
        paymentMethod: 'WALLET',
        paymentStatus: 'PAID',
        total: 114_000,
        subtotal: 114_000,
        pancakeOrderId: `pk-${randCode(8)}`,
        hasRecyclingPickup: true,
        gomdonOrderId: `GM${randCode(6)}`,
        gomdonStatus: '1',
        pointsEarned: 120,
        ...overrides,
      });
      return { user, order };
    }

    it.each([
      ['admin huỷ', 'ADMIN'],
      ['khách huỷ', 'CUSTOMER'],
    ])('kho bấm "hoàn thành" (3) trên Pancake, bưu tá chưa lấy hàng — %s → KHÔNG DELIVERED, không cộng điểm/khoá hoa hồng, vào "Cần xử lý" kèm lý do Gomdon', async (_label, who) => {
      const { user, order } = await recycling();
      client.getOrder.mockResolvedValue({ id: order.pancakeOrderId, status: 3 });

      const err = (await (who === 'ADMIN'
        ? status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN', actorId: user.id })
        : orders.cancel(user.id, order.code)
      ).catch((e: unknown) => e)) as { getStatus(): number; message: string };
      expect(err.getStatus()).toBe(400);

      const after = await reload(order.id);
      expect(after).toMatchObject({ status: 'PACKED', paymentStatus: 'PAID', deliveredAt: null });
      expect(after.pancakeAttention).toContain('chỉ theo Gomdon');
      expect(loyalty.creditOrderPoints).not.toHaveBeenCalled();
      expect(affiliate.lockCommissionsForOrder).not.toHaveBeenCalled();
      expect(await walletOf(user.id)).toBe(1_000_000);
    });

    it('vận đơn Gomdon đã huỷ → Gomdon hết sở hữu, Pancake được đồng bộ về DELIVERED như trước', async () => {
      const { user, order } = await recycling({ gomdonStatus: '2' });
      client.getOrder.mockResolvedValue({ id: order.pancakeOrderId, status: 3 });

      await expect(orders.cancel(user.id, order.code)).rejects.toThrow('liên hệ CSKH');

      expect(await reload(order.id)).toMatchObject({ status: 'DELIVERED' });
      expect(loyalty.creditOrderPoints).toHaveBeenCalledWith(order.id);
    });
  });

  describe('SYNC-3: đơn đại lý ghi công nợ', () => {
    async function creditOrder(overrides: Record<string, unknown> = {}) {
      const dealer = await createDealer(prisma);
      const order = await createOrder(prisma, {
        userId: dealer.id,
        type: 'DEALER',
        status: 'CONFIRMED',
        paymentMethod: 'BANK_TRANSFER',
        paymentStatus: 'UNPAID',
        total: 700_000,
        subtotal: 700_000,
        pancakeOrderId: `pk-${randCode(8)}`,
        ...overrides,
      });
      await prisma.dealerCreditLedger.create({ data: { userId: dealer.id, delta: 700_000, refType: 'ORDER', refId: order.id, note: `Đơn ${order.code}` } });
      return { dealer, order };
    }
    const debtOf = async (userId: string) => (await prisma.dealerCreditLedger.aggregate({ where: { userId }, _sum: { delta: true } }))._sum.delta ?? 0;

    it('Pancake phản ánh transfer_money thành prepaid = tổng đơn → đơn vẫn UNPAID; huỷ sau đó chỉ đảo công nợ, Ví không đổi, không có khoản "tiền về muộn"', async () => {
      const { dealer, order } = await creditOrder();
      const payload = { id: order.pancakeOrderId, extension: { external_order_id: order.code }, status: 1, prepaid: 700_000, cod: 0 };

      await deliver(payload);
      expect(await reload(order.id)).toMatchObject({ paymentStatus: 'UNPAID', paidAt: null, status: 'CONFIRMED' });

      await status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN', actorId: dealer.id, pancakeGate: false });
      await deliver({ ...payload, status: 6 });

      expect(await reload(order.id)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
      expect(await debtOf(dealer.id)).toBe(0);
      expect(await walletOf(dealer.id)).toBe(0);
      expect(await refundRows(order.id)).toBe(0);
    });

    it('đơn công nợ đã lỡ bị lật PAID (dữ liệu cũ): huỷ chỉ đảo công nợ, KHÔNG cộng Ví thêm', async () => {
      const { dealer, order } = await creditOrder({ paymentStatus: 'PAID', paidAt: new Date() });

      await status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN', actorId: dealer.id, pancakeGate: false });

      expect(await debtOf(dealer.id)).toBe(0);
      expect(await walletOf(dealer.id)).toBe(0);
      expect(await refundRows(order.id)).toBe(0);
      expect((await reload(order.id)).paymentStatus).toBe('REFUNDED');
    });

    it('đơn đại lý TRẢ TRƯỚC (không công nợ) vẫn được Pancake đối soát PAID, và huỷ vẫn hoàn Ví 1 lần', async () => {
      const dealer = await createDealer(prisma);
      const order = await createOrder(prisma, {
        userId: dealer.id,
        type: 'DEALER',
        status: 'PENDING_PAYMENT',
        paymentMethod: 'BANK_TRANSFER',
        paymentStatus: 'UNPAID',
        total: 700_000,
        subtotal: 700_000,
        pancakeOrderId: `pk-${randCode(8)}`,
      });

      await deliver({ id: order.pancakeOrderId, extension: { external_order_id: order.code }, status: 1, bank_payment: 700_000 });
      expect(await reload(order.id)).toMatchObject({ paymentStatus: 'PAID', status: 'CONFIRMED' });

      await status.setStatus(order.id, 'CANCELLED', { actorType: 'ADMIN', actorId: dealer.id, pancakeGate: false });
      expect(await walletOf(dealer.id)).toBe(700_000);
    });
  });

  describe('SYNC-7: sự kiện cần xử lý tới trễ sau khi đơn đã đóng', () => {
    it.each([
      ['CANCELLED', 4],
      ['RETURNED', 4],
      ['CANCELLED', 7],
      ['RETURNED', 7],
    ])('đơn %s nhận trạng thái Pancake %s → không ghim banner, không báo admin', async (orderStatus, code) => {
      const user = await createUser(prisma);
      const order = await createOrder(prisma, { userId: user.id, status: orderStatus as 'CANCELLED' | 'RETURNED', paymentMethod: 'COD', pancakeOrderId: `pk-${randCode(8)}` });

      await deliver({ id: order.pancakeOrderId, extension: { external_order_id: order.code }, status: code });

      const after = await reload(order.id);
      expect(after.pancakeAttention).toBeNull();
      expect(alertsFor(order.code)).toHaveLength(0);
    });

    it('đơn còn sống nhận "Đang hoàn" (4) → vẫn vào hàng đợi như trước', async () => {
      const user = await createUser(prisma);
      const order = await createOrder(prisma, { userId: user.id, status: 'SHIPPING', paymentMethod: 'COD', pancakeOrderId: `pk-${randCode(8)}` });

      await deliver({ id: order.pancakeOrderId, extension: { external_order_id: order.code }, status: 4 });

      expect((await reload(order.id)).pancakeAttention).toContain('ĐANG HOÀN');
      expect(alertsFor(order.code).length).toBeGreaterThan(0);
    });
  });
});
