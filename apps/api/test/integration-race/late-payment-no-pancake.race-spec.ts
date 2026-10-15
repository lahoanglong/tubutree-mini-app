import { createHmac } from 'node:crypto';
import type { Job } from 'bullmq';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { ZalopayService } from '../../src/modules/integrations/payment/zalopay.service';
import { PancakeProcessor } from '../../src/modules/integrations/pancake/pancake.processor';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { PancakeSyncHooks } from '../../src/modules/integrations/pancake/pancake-sync-hooks';
import { PancakePushReconcileService } from '../../src/modules/integrations/pancake/pancake-push-reconcile.service';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { GomdonAlertService } from '../../src/modules/integrations/gomdon/gomdon-alert.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import type { CartService } from '../../src/modules/cart/cart.service';
import { createOrder, createUser, randCode, sleep, summarize, warmPool } from './helpers';

const ZALOPAY_KEY2 = 'it-key2';
const zalopayConfig = () => {
  const map: Record<string, string> = { ZALOPAY_APP_ID: '2553', ZALOPAY_KEY1: 'it-key1', ZALOPAY_KEY2, ZALOPAY_ENDPOINT: 'http://127.0.0.1:9' };
  return { get: (k: string) => map[k] ?? '' };
};
const zalopayMac = (raw: string) => createHmac('sha256', ZALOPAY_KEY2).update(raw).digest('hex');

/**
 * Tích hợp p5 (tiền về muộn → hàng hoàn tiền) × p1 (PAID → đẩy/báo thanh toán Pancake) trên Postgres THẬT: tiền về sau khi
 * đơn đã huỷ không "hồi sinh" đơn và không chạm kho Pancake — chỉ tạo đúng MỘT khoản LATE_PAYMENT để khách chọn nơi nhận.
 * Đường ZaloPay (callback lặp lại, chồng với khách huỷ) và đường Pancake (webhook đối soát chuyển khoản + admin "Đã nhận tiền").
 * Stub: PancakeClient (HTTP), BullMQ queue (ghi job để chạy tay như worker), thông báo, điểm, hoa hồng.
 */
describe('Đơn đã huỷ rồi mới có tiền → vào hàng hoàn tiền, không đẩy Pancake (real Postgres)', () => {
  let prisma: PrismaService;
  let pancake: PancakeOrderService;
  let reconcile: PancakePushReconcileService;
  let orderStatus: OrderStatusService;
  let orders: OrdersService;
  let zalopay: ZalopayService;
  let processor: PancakeProcessor;

  const jobs: { name: string; orderId: string }[] = [];
  const queue = {
    name: 'pancake-push',
    getJob: jest.fn().mockResolvedValue(null),
    add: jest.fn(async (name: string, data: { orderId: string }) => {
      jobs.push({ name, orderId: data.orderId });
      return {};
    }),
  };
  const client = {
    isConfigured: jest.fn().mockReturnValue(true),
    createOrder: jest.fn(),
    searchOrders: jest.fn().mockResolvedValue([]),
    getOrder: jest.fn(),
    updateOrder: jest.fn(),
  };
  const notify = jest.fn().mockResolvedValue(undefined);
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) } as unknown as GomdonAlertService;

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
    const pancakeClient = client as unknown as PancakeClient;
    const config = new SystemConfigService(prisma);
    const analytics = new AnalyticsEventsService(prisma);
    pancake = new PancakeOrderService(prisma, pancakeClient, queue as never, config, alerts);
    const hooks = new PancakeSyncHooks(prisma, pancakeClient, queue as never, alerts);
    reconcile = new PancakePushReconcileService(prisma, pancakeClient, pancake, alerts);
    orderStatus = new OrderStatusService(prisma, loyalty, affiliate, notifications, reversal, undefined, analytics, hooks);
    orders = new OrdersService(prisma, loyalty, {} as CartService, notifications, config, affiliate, reversal, undefined, orderStatus);
    zalopay = new ZalopayService(prisma, notifications, zalopayConfig() as never, undefined, analytics, hooks);
    processor = new PancakeProcessor(prisma, notifications, orderStatus, alerts);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(() => {
    jobs.length = 0;
    queue.add.mockClear();
    client.createOrder.mockReset();
    client.searchOrders.mockReset().mockResolvedValue([]);
    client.getOrder.mockReset();
    client.updateOrder.mockReset();
    notify.mockClear();
  });

  /** Chạy các job đã xếp cho đơn này như worker pancake-push. */
  async function drain(orderId: string) {
    const mine = jobs.filter((j) => j.orderId === orderId);
    await Promise.allSettled(
      mine.map((j) => (j.name === 'push' ? pancake.pushOrder(orderId) : j.name === 'payment' ? pancake.syncPayment(orderId) : pancake.cancelOnPancake(orderId))),
    );
    return mine.map((j) => j.name);
  }

  async function pancakeVariationId() {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: { pancakeId: `itlp-p-${tag}`, fulfilment: 'TUBU', brand: 'IT', slug: `itlp-${tag.toLowerCase()}`, name: `SP ${tag}`, description: 'IT', basePrice: 150_000 },
    });
    const v = await prisma.variation.create({
      data: { pancakeId: `itlp-v-${tag}`, productId: product.id, sku: `ITLP-${tag}`, name: 'Chai', attributes: {}, retailPrice: 150_000, stock: 30 },
    });
    return v.id;
  }

  async function zalopayOrder(userId: string) {
    const appTransId = `260101_${randCode(10)}`;
    const order = await createOrder(prisma, {
      userId,
      status: 'PENDING_PAYMENT',
      paymentMethod: 'ZALOPAY',
      paymentStatus: 'UNPAID',
      subtotal: 150_000,
      total: 150_000,
      paymentTxnId: appTransId,
      createdAt: new Date(Date.now() - 30 * 60_000),
      items: { create: [{ variationId: await pancakeVariationId(), productName: 'Nước giặt', variationName: 'Chai', unitPrice: 150_000, quantity: 1, total: 150_000 }] },
    });
    const raw = JSON.stringify({ app_trans_id: appTransId, amount: 150_000 });
    return { order, raw, mac: zalopayMac(raw) };
  }

  const walletOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).walletBalance;

  it('ZaloPay: khách huỷ rồi callback về 3 lần cùng lúc với cron cứu hộ → đúng 1 khoản LATE_PAYMENT, đơn vẫn CANCELLED/UNPAID, Pancake không nhận lệnh nào', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const { order, raw, mac } = await zalopayOrder(user.id);
    await orders.cancel(user.id, order.code);

    const s = summarize(await Promise.allSettled([...[1, 2, 3].map(() => zalopay.handleCallback(raw, mac)), reconcile.reconcile()]));
    expect(s.errors).toEqual([]);
    const ran = await drain(order.id);

    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID', pancakeOrderId: null });
    const late = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ kind: 'LATE_PAYMENT', amount: 150_000, status: 'PENDING' });
    expect(ran.filter((n) => n === 'push' || n === 'payment')).toEqual([]);
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(client.updateOrder).not.toHaveBeenCalled();
    expect(await walletOf(user.id)).toBe(0);
  });

  it('ZaloPay: callback chạy chồng với khách huỷ (8 vòng) → tiền được trả lại đúng MỘT lần (Ví hoặc khoản LATE_PAYMENT), không vòng nào tạo đơn Pancake', async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < 8; round++) {
      jobs.length = 0;
      const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
      const { order, raw, mac } = await zalopayOrder(user.id);

      // Vòng lẻ cho callback xuất phát trước vài ms để cả hai thứ tự thắng đều xảy ra.
      const head = round % 2 === 1 ? round * 2 : 0;
      const [cancel, callback] = await Promise.allSettled([
        sleep(head).then(() => orders.cancel(user.id, order.code, { refundMethod: 'WALLET' })),
        zalopay.handleCallback(raw, mac),
      ]);
      expect(cancel.status).toBe('fulfilled');
      expect(callback.status).toBe('fulfilled');
      const ran = await drain(order.id);

      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      const late = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id, kind: 'LATE_PAYMENT' } });
      const wallet = await walletOf(user.id);
      expect(after.status).toBe('CANCELLED');
      expect(after.pancakeOrderId).toBeNull();
      if (late.length > 0) {
        // Huỷ thắng: tiền về muộn → hàng hoàn tiền, đơn không được báo "đã thanh toán" sang Pancake.
        outcomes.push('late');
        expect(after.paymentStatus).toBe('UNPAID');
        expect(late).toHaveLength(1);
        expect(late[0]!.amount).toBe(150_000);
        expect(wallet).toBe(0);
        expect(ran.filter((n) => n === 'push' || n === 'payment')).toEqual([]);
      } else {
        // Thanh toán thắng: đơn PAID rồi bị huỷ → hoàn Ví qua luồng huỷ; job đẩy (nếu đã xếp) gặp đơn đã huỷ thì bỏ.
        outcomes.push('paid-then-cancelled');
        expect(after.paymentStatus).toBe('REFUNDED');
        expect(wallet).toBe(150_000);
      }
    }
    console.log('[zalopay x cancel] %j', outcomes);
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(client.updateOrder).not.toHaveBeenCalled();
  });

  it('Pancake: đơn chuyển khoản đã huỷ (cả bên Pancake) — 2 webhook đối soát tiền + admin "Đã nhận tiền" cùng lúc → 1 khoản LATE_PAYMENT, không lệnh thanh toán nào sang Pancake', async () => {
    const user = await createUser(prisma, { role: 'CUSTOMER', walletBalance: 0 });
    const pancakeOrderId = `pc-${randCode(8)}`;
    const order = await createOrder(prisma, {
      userId: user.id,
      status: 'CANCELLED',
      paymentMethod: 'BANK_TRANSFER',
      paymentStatus: 'UNPAID',
      subtotal: 197_000,
      total: 197_000,
      pancakeOrderId,
      pancakePushStatus: 'SYNCED',
      pancakeCancelStatus: 'CANCELLED',
      items: { create: [{ variationId: await pancakeVariationId(), productName: 'Nước giặt', variationName: 'Chai', unitPrice: 197_000, quantity: 1, total: 197_000 }] },
    });
    const deliver = async () => {
      const ev = await prisma.pancakeWebhookEvent.create({
        data: {
          eventType: 'orders',
          rawPayload: { id: pancakeOrderId, extension: { external_order_id: order.code }, status: 6, bank_payment: 197_000 },
          status: 'PENDING',
        },
      });
      await processor.process({ data: { eventId: ev.id } } as Job<{ eventId: string }>);
    };

    const s = summarize(
      await Promise.allSettled([deliver(), deliver(), orderStatus.markPaid(order.id, { actorType: 'ADMIN', actorId: 'admin-it' })]),
    );
    expect(s.errors).toEqual([]);
    expect(s.fulfilled.some((r) => (r.value as { outcome?: string } | undefined)?.outcome === 'CLOSED')).toBe(true);
    const ran = await drain(order.id);

    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' });
    const late = await prisma.orderCustomerRefund.findMany({ where: { orderId: order.id } });
    expect(late).toHaveLength(1);
    expect(late[0]).toMatchObject({ kind: 'LATE_PAYMENT', amount: 197_000 });
    expect(ran.filter((n) => n === 'payment' || n === 'push')).toEqual([]);
    expect(client.updateOrder).not.toHaveBeenCalled();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(notify.mock.calls.filter(([, code]) => code === 'REFUND_LATE_PAYMENT')).toHaveLength(1);
    expect(notify.mock.calls.filter(([, code]) => code === 'ORDER_CONFIRMED')).toHaveLength(0);
  });
});
