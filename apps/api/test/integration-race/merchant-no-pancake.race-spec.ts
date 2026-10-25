import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SystemConfigService } from '../../src/modules/system-config/system-config.service';
import { OrderStatusService } from '../../src/modules/orders/order-status.service';
import { OrderReversalService } from '../../src/modules/orders/order-reversal.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { AnalyticsEventsService } from '../../src/modules/analytics/analytics-events.service';
import { PancakeOrderService } from '../../src/modules/integrations/pancake/pancake-order.service';
import { PancakeSyncHooks } from '../../src/modules/integrations/pancake/pancake-sync-hooks';
import { PancakePushReconcileService } from '../../src/modules/integrations/pancake/pancake-push-reconcile.service';
import { pancakeUnsyncedWhere } from '../../src/modules/admin/admin-order-filter';
import type { PancakeClient } from '../../src/modules/integrations/pancake/pancake.client';
import type { GomdonAlertService } from '../../src/modules/integrations/gomdon/gomdon-alert.service';
import type { LoyaltyService } from '../../src/modules/loyalty/loyalty.service';
import type { AffiliateService } from '../../src/modules/affiliate/affiliate.service';
import type { NotificationsService } from '../../src/modules/notifications/notifications.service';
import type { FlashSaleService } from '../../src/modules/flash-sale/flash-sale.service';
import type { CouponsService } from '../../src/modules/coupons/coupons.service';
import type { CartService } from '../../src/modules/cart/cart.service';
import { createOrder, createUser, randCode, sleep, summarize, warmPool } from './helpers';

/**
 * Tích hợp p1 (đẩy Pancake) × p8 (gian hàng tự giao) trên Postgres THẬT: đơn fulfiller=MERCHANT không bao giờ chạm Pancake —
 * job đẩy/thanh toán/huỷ, nút "Đẩy lại Pancake", cron cứu hộ và móc huỷ của khách cùng chạy trên một đơn mà client Pancake
 * không nhận một lệnh nào. Checkout tách đơn: chỉ đơn kho Tubu lên Pancake, chỉ với dòng có mã Pancake thật (không MCH_).
 * Stub: PancakeClient (HTTP), BullMQ queue (ghi lại job để chạy tay như worker), thông báo, điểm, hoa hồng.
 */
describe('Đơn gian hàng tự giao không bao giờ tới Pancake (real Postgres)', () => {
  let prisma: PrismaService;
  let pancake: PancakeOrderService;
  let hooks: PancakeSyncHooks;
  let reconcile: PancakePushReconcileService;
  let orders: OrdersService;

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
    resolveOrderTags: jest.fn().mockResolvedValue([]),
    getOrder: jest.fn(),
    updateOrder: jest.fn(),
  };
  const notify = jest.fn().mockResolvedValue(undefined);
  const alerts = { alert: jest.fn().mockResolvedValue(undefined) };

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
    pancake = new PancakeOrderService(prisma, pancakeClient, queue as never, config, alerts as unknown as GomdonAlertService);
    hooks = new PancakeSyncHooks(prisma, pancakeClient, queue as never, alerts as unknown as GomdonAlertService);
    reconcile = new PancakePushReconcileService(prisma, pancakeClient, pancake, alerts as unknown as GomdonAlertService);
    const orderStatus = new OrderStatusService(
      prisma,
      loyalty,
      affiliate,
      notifications,
      reversal,
      undefined,
      new AnalyticsEventsService(prisma),
      hooks,
    );
    orders = new OrdersService(prisma, loyalty, {} as CartService, notifications, config, affiliate, reversal, undefined, orderStatus);
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
  });

  /** Chạy các job đã xếp cho những đơn này như worker pancake-push (lỗi của từng job nuốt như BullMQ thử lại). */
  async function drain(orderIds: string[]) {
    const mine = jobs.filter((j) => orderIds.includes(j.orderId));
    await Promise.allSettled(
      mine.map((j) =>
        j.name === 'push' ? pancake.pushOrder(j.orderId) : j.name === 'payment' ? pancake.syncPayment(j.orderId) : pancake.cancelOnPancake(j.orderId),
      ),
    );
    return mine;
  }

  async function merchantStore() {
    const owner = await createUser(prisma, { role: 'DEALER' });
    const tag = randCode(8).toLowerCase();
    const store = await prisma.storefront.create({
      data: { type: 'MERCHANT', slug: `itnp-${tag}`, title: `Shop IT ${tag}`, ownerUserId: owner.id, commissionPct: 0.15 },
    });
    return { owner, store };
  }

  async function variation(data: { fulfilment: 'TUBU' | 'MERCHANT'; storefrontId?: string; pancakeId?: string | null }) {
    const tag = randCode(8);
    const product = await prisma.product.create({
      data: {
        pancakeId: data.fulfilment === 'TUBU' ? `itnp-p-${tag}` : null,
        storefrontId: data.storefrontId ?? null,
        fulfilment: data.fulfilment,
        brand: 'IT',
        slug: `itnp-${tag.toLowerCase()}`,
        name: `SP ${tag}`,
        description: 'IT',
        basePrice: 100_000,
      },
    });
    return prisma.variation.create({
      data: {
        pancakeId: data.pancakeId === undefined ? (data.fulfilment === 'TUBU' ? `itnp-v-${tag}` : null) : data.pancakeId,
        productId: product.id,
        sku: `ITNP-${tag}`,
        name: 'Mặc định',
        attributes: {},
        retailPrice: 100_000,
        stock: 50,
      },
    });
  }

  async function merchantOrder(buyerId: string, storefrontId: string, variationId: string, data: Record<string, unknown> = {}) {
    return createOrder(prisma, {
      userId: buyerId,
      status: 'CONFIRMED',
      fulfiller: 'MERCHANT',
      fulfillerStorefrontId: storefrontId,
      merchantCommissionPct: 0.15,
      subtotal: 100_000,
      shippingFee: 25_000,
      total: 125_000,
      items: { create: [{ variationId, productName: 'Mật ong', variationName: 'Hũ', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
      ...data,
    });
  }

  function pancakeTouched() {
    return {
      createOrder: client.createOrder.mock.calls.length,
      searchOrders: client.searchOrders.mock.calls.length,
      getOrder: client.getOrder.mock.calls.length,
      updateOrder: client.updateOrder.mock.calls.length,
    };
  }

  it('đẩy ×3, báo thanh toán, "Đẩy lại Pancake", cron cứu hộ, móc PAID và khách huỷ cùng lúc trên đơn gian hàng → Pancake không nhận lệnh nào', async () => {
    const { store } = await merchantStore();
    const buyer = await createUser(prisma, { role: 'CUSTOMER' });
    const v = await variation({ fulfilment: 'MERCHANT', storefrontId: store.id });
    const now = Date.now();
    const live = await merchantOrder(buyer.id, store.id, v.id, { createdAt: new Date(now - 30 * 60_000) });
    const overdue = await merchantOrder(buyer.id, store.id, v.id, { createdAt: new Date(now - 30 * 86_400_000) });
    const paid = await merchantOrder(buyer.id, store.id, v.id, {
      paymentMethod: 'WALLET',
      paymentStatus: 'PAID',
      paidAt: new Date(now - 60 * 60_000),
      createdAt: new Date(now - 2 * 60 * 60_000),
    });
    const cancelLeft = await merchantOrder(buyer.id, store.id, v.id, {
      status: 'CANCELLED',
      pancakeCancelStatus: 'PENDING',
      createdAt: new Date(now - 86_400_000),
      updatedAt: new Date(now - 60 * 60_000),
    });
    // Đối chứng: đơn kho Tubu cùng tuổi với `overdue` — cron phải đánh dấu nó, chứng minh cron có chạy qua lô này.
    const tubuV = await variation({ fulfilment: 'TUBU' });
    const control = await createOrder(prisma, {
      userId: buyer.id,
      status: 'CONFIRMED',
      createdAt: new Date(now - 30 * 86_400_000),
      items: { create: [{ variationId: tubuV.id, productName: 'Nước giặt', variationName: '1L', unitPrice: 100_000, quantity: 1, total: 100_000 }] },
    });
    const merchantIds = [live.id, overdue.id, paid.id, cancelLeft.id];

    const results = await Promise.allSettled([
      pancake.pushOrder(live.id),
      pancake.pushOrder(live.id),
      pancake.pushOrder(paid.id),
      pancake.syncPayment(paid.id),
      pancake.retryPushByAdmin('admin-it', live.code),
      pancake.retryPushByAdmin('admin-it', overdue.id),
      pancake.cancelOnPancake(cancelLeft.id),
      reconcile.reconcile(),
      hooks.afterPaid(paid.id),
      orders.cancel(buyer.id, live.code),
    ]);
    const s = summarize(results);
    console.log('[merchant x10] fulfilled=%d rejected=%d errors=%j', s.fulfilled.length, s.rejected.length, [...new Set(s.errors)]);
    const ran = await drain(merchantIds);

    expect(s.rejected.map((r) => r.reason)).toEqual([expect.any(BadRequestException), expect.any(BadRequestException)]);
    expect(s.errors.every((e) => e.includes('gian hàng'))).toBe(true);
    expect(ran).toEqual([]);
    expect(pancakeTouched()).toEqual({ createOrder: 0, searchOrders: 0, getOrder: 0, updateOrder: 0 });

    const rows = await prisma.order.findMany({ where: { id: { in: merchantIds } } });
    for (const o of rows) {
      expect(o.pancakeOrderId).toBeNull();
      expect(o.pancakePushAttempts).toBe(0);
      expect(o.pancakeAttention).toBeNull();
      expect(o.pancakeSyncError).toBeNull();
      expect(o.pancakePushClaimedAt).toBeNull();
      if (o.id !== cancelLeft.id) expect(o.pancakePushStatus).toBeNull();
    }
    expect(rows.find((o) => o.id === live.id)!.status).toBe('CANCELLED');
    expect(rows.find((o) => o.id === live.id)!.pancakeCancelStatus).toBeNull();
    expect(await prisma.order.count({ where: { id: { in: merchantIds }, ...pancakeUnsyncedWhere() } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: control.id } })).pancakePushStatus).toBe('STALE');
  });

  it('tách đơn Tubu + gian hàng: 4 lần đẩy cả nhóm cùng cron → đúng 1 đơn Pancake của đơn Tubu, chỉ dòng có mã Pancake thật, COD chỉ tính phần gửi kho', async () => {
    const { store } = await merchantStore();
    const buyer = await createUser(prisma, { role: 'CUSTOMER' });
    const tubuV = await variation({ fulfilment: 'TUBU' });
    const shopV = await variation({ fulfilment: 'MERCHANT', storefrontId: store.id });
    // Biến thể gian hàng đời cũ còn mã giả MCH_ trong một đơn kho Tubu cũ: không bao giờ được gửi.
    const legacyV = await variation({ fulfilment: 'TUBU', pancakeId: `MCH_${randCode(8)}` });
    const group = `itnp-${randCode(10)}`;
    const createdAt = new Date(Date.now() - 30 * 60_000);
    const tubu = await createOrder(prisma, {
      userId: buyer.id,
      checkoutGroup: group,
      createdAt,
      subtotal: 150_000,
      shippingFee: 30_000,
      total: 180_000,
      items: {
        create: [
          { variationId: tubuV.id, productName: 'Nước giặt', variationName: '1L', unitPrice: 100_000, quantity: 1, total: 100_000 },
          { variationId: legacyV.id, productName: 'Hàng cũ', variationName: 'Gói', unitPrice: 50_000, quantity: 1, total: 50_000 },
        ],
      },
    });
    const shop = await merchantOrder(buyer.id, store.id, shopV.id, { checkoutGroup: group, createdAt });
    const pkId = `pk-${randCode(8)}`;
    client.createOrder.mockImplementation(async () => {
      await sleep(120);
      return { id: pkId };
    });

    const s = summarize(
      await Promise.allSettled([
        ...[tubu.id, shop.id, tubu.id, shop.id].map((id) => pancake.pushOrder(id)),
        reconcile.reconcile(),
        pancake.syncPayment(shop.id),
      ]),
    );
    console.log('[split x6] errors=%j', [...new Set(s.errors)]);
    await drain([tubu.id, shop.id]);

    expect(client.createOrder).toHaveBeenCalledTimes(1);
    const body = client.createOrder.mock.calls[0]![0] as Record<string, unknown>;
    const json = JSON.stringify(body);
    expect(json).toContain(tubuV.pancakeId!);
    expect(json).not.toContain('MCH_');
    expect(json).not.toContain(shopV.id);
    expect(json).not.toContain(legacyV.id);
    expect(json).not.toContain(shop.code);
    // 100.000 hàng gửi kho + 30.000 ship; dòng MCH_ 50.000 và đơn gian hàng 125.000 không bị kho thu hộ.
    expect(body['cod']).toBe(130_000);

    const [t, m] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: tubu.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: shop.id } }),
    ]);
    expect(t.pancakeOrderId).toBe(pkId);
    expect(t.pancakeAttention).toContain('1 dòng không có mã Pancake');
    expect(m).toMatchObject({ pancakeOrderId: null, pancakePushStatus: null, pancakePushAttempts: 0 });
  });
});
